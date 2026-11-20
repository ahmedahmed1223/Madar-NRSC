import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestServer, listen, loginAgent } from '../helpers';
import { addressInRanges, parseCidr, safeFileName, validateStorage } from '../../src/shared/storage';
import { headerJson, dropboxPath } from '../../src/server/dropbox';
import { runStorageSync } from '../../src/server/storage';

const H = { 'X-NRCS-Client': 'web' };
const run = promisify(execFile);

/** A small in-memory stand-in for the Dropbox and Google Drive APIs. */
function fakeCloud() {
  const dropbox = new Map<string, Buffer>();
  const drive = new Map<string, { name: string; parents: string[]; data?: Buffer; folder?: boolean }>();
  const sessions = new Map<string, Buffer[]>();
  let nextId = 1;
  const app = express();
  const raw = express.raw({ type: '*/*', limit: '200mb' });
  const arg = (req: express.Request) => JSON.parse(String(req.get('dropbox-api-arg') || '{}'));
  const entry = (p: string) => ({ '.tag': 'file', id: `id:${p}`, name: path.posix.basename(p), path_display: p, size: dropbox.get(p)!.length, server_modified: '2026-11-19T10:00:00Z' });

  app.post('/oauth2/token', express.urlencoded({ extended: false }), (req, res) => {
    if (req.body.grant_type === 'authorization_code') {
      if (req.body.code !== 'good-code') return res.status(400).json({ error: 'invalid_grant' });
      return res.json({ access_token: 'at', refresh_token: 'rt', expires_in: 14400 });
    }
    if (req.body.refresh_token !== 'rt' && req.body.refresh_token !== 'g-rt') return res.status(400).json({ error: 'invalid_grant' });
    res.json({ access_token: 'at', expires_in: 14400 });
  });
  app.post('/2/users/get_current_account', (_req, res) => res.json({ name: { display_name: 'غرفة الأخبار' }, email: 'desk@example.com' }));
  app.post('/2/files/upload', raw, (req, res) => {
    const a = arg(req);
    let p = a.path;
    for (let i = 2; dropbox.has(p); i++) p = a.path.replace(/(\.[^.]*)?$/, ` (${i})$1`);
    dropbox.set(p, req.body);
    res.json(entry(p));
  });
  app.post('/2/files/upload_session/start', raw, (req, res) => {
    const id = `s${nextId++}`;
    sessions.set(id, [req.body]);
    res.json({ session_id: id });
  });
  app.post('/2/files/upload_session/append_v2', raw, (req, res) => {
    const a = arg(req);
    const parts = sessions.get(a.cursor.session_id)!;
    expect(Buffer.concat(parts).length).toBe(a.cursor.offset);
    parts.push(req.body);
    res.json(null);
  });
  app.post('/2/files/upload_session/finish', raw, (req, res) => {
    const a = arg(req);
    const parts = sessions.get(a.cursor.session_id)!;
    expect(Buffer.concat(parts).length).toBe(a.cursor.offset);
    parts.push(req.body);
    dropbox.set(a.commit.path, Buffer.concat(parts));
    res.json(entry(a.commit.path));
  });
  app.post('/2/files/download', (req, res) => {
    const data = dropbox.get(arg(req).path);
    if (!data) return res.status(409).json({ error_summary: 'path/not_found/' });
    const range = /bytes=(\d+)-(\d*)/.exec(String(req.get('range') || ''));
    if (range) {
      const start = Number(range[1]);
      const end = range[2] ? Number(range[2]) : data.length - 1;
      res.status(206).set('content-range', `bytes ${start}-${end}/${data.length}`).send(data.subarray(start, end + 1));
    } else res.send(data);
  });
  app.post('/2/files/search_v2', express.json(), (req, res) => {
    const q = String(req.body.query).toLowerCase();
    res.json({ matches: [...dropbox.keys()].filter((p) => p.toLowerCase().includes(q)).map((p) => ({ metadata: { metadata: entry(p) } })) });
  });
  app.post('/2/files/list_folder', express.json(), (req, res) => {
    const dir = String(req.body.path).toLowerCase();
    res.json({ entries: [...dropbox.keys()].filter((p) => path.posix.dirname(p).toLowerCase() === dir).map(entry) });
  });

  // Google Drive
  app.get('/drive/v3/about', (_req, res) => res.json({ user: { displayName: 'أرشيف المحطة' } }));
  app.get('/drive/v3/files', (req, res) => {
    const q = String(req.query.q || '');
    const name = /name = '([^']*)'/.exec(q)?.[1];
    const parent = /'([^']*)' in parents/.exec(q)?.[1];
    const contains = /name contains '([^']*)'/.exec(q)?.[1];
    const files = [...drive.entries()]
      .filter(([, f]) => (!name || f.name === name) && (!parent || f.parents.includes(parent)) && (!contains || f.name.includes(contains)) && (!q.includes("!= 'application/vnd.google-apps.folder'") || !f.folder))
      .map(([id, f]) => ({ id, name: f.name, size: f.data ? String(f.data.length) : undefined, mimeType: f.folder ? 'application/vnd.google-apps.folder' : 'video/mp4' }));
    res.json({ files });
  });
  app.post('/drive/v3/files', express.json(), (req, res) => {
    const id = `fold${nextId++}`;
    drive.set(id, { name: req.body.name, parents: req.body.parents, folder: true });
    res.json({ id });
  });
  app.get('/drive/v3/files/:id', (req, res) => {
    const f = drive.get(req.params.id);
    if (!f) return res.status(404).json({ error: { message: 'File not found' } });
    if (req.query.alt === 'media') return res.send(f.data);
    res.json({ id: req.params.id, name: f.name, size: String(f.data?.length || 0), mimeType: f.folder ? 'application/vnd.google-apps.folder' : 'video/mp4' });
  });
  app.post('/upload/drive/v3/files', express.json(), (req, res) => {
    const id = `file${nextId++}`;
    drive.set(id, { name: req.body.name, parents: req.body.parents, data: Buffer.alloc(0) });
    res.set('location', `${base}/upload/session/${id}`).json({});
  });
  app.put('/upload/session/:id', raw, (req, res) => {
    const f = drive.get(req.params.id)!;
    const [, start, end, total] = /bytes (\d+)-(\d+)\/(\d+)/.exec(String(req.get('content-range')))!.map(Number) as number[];
    expect(start).toBe(f.data!.length);
    f.data = Buffer.concat([f.data!, req.body]);
    if (end + 1 < total) return res.status(308).set('range', `bytes=0-${end}`).end();
    res.json({ id: req.params.id, name: f.name, size: String(f.data.length), mimeType: 'video/mp4' });
  });
  let base = '';
  return { app, dropbox, drive, setBase: (b: string) => (base = b) };
}

let server: Awaited<ReturnType<typeof createTestServer>>;
let cloud: ReturnType<typeof fakeCloud>;
let cloudServer: { baseUrl: string; close: () => Promise<void> };
const shareDir = fs.mkdtempSync(path.join(os.tmpdir(), 'madar-share-'));

async function saveSettings(agent: any, patch: (s: any) => any) {
  const data = await agent.get('/api/v1/data');
  const row = data.body.collections.settings[0];
  const res = await agent.post('/api/v1/data/sync').set(H).send({ ops: [{ c: 'settings', op: 'upsert', id: row.id, d: patch(row.d), baseV: row.v }] });
  expect(res.body.results[0].ok).toBe(true);
}

async function uploadToLibrary(agent: any, name: string, body: Buffer, extra: Record<string, string> = {}) {
  const up = await agent.post('/api/v1/media/upload').set(H).set(extra).set('Content-Type', 'video/mp4').set('X-File-Name', encodeURIComponent(name)).send(body);
  expect(up.status).toBe(201);
  const { id, url } = up.body.data;
  // Only files something points to are copied: attach it to a library item.
  const res = await agent.post('/api/v1/data/sync').set(H).send({ ops: [{ c: 'media', op: 'upsert', id: `med-${id}`, d: { id: `med-${id}`, fileName: name, url, mediaType: 'VIDEO', tags: [] } }] });
  expect(res.body.results[0].ok).toBe(true);
  return id as string;
}

beforeAll(async () => {
  cloud = fakeCloud();
  cloudServer = await listen(cloud.app as any);
  cloud.setBase(cloudServer.baseUrl);
  Object.assign(process.env, {
    DROPBOX_API_URL: cloudServer.baseUrl,
    DROPBOX_CONTENT_URL: cloudServer.baseUrl,
    GDRIVE_OAUTH_URL: `${cloudServer.baseUrl}/oauth2`,
    GDRIVE_API_URL: `${cloudServer.baseUrl}/drive/v3`,
    GDRIVE_UPLOAD_URL: `${cloudServer.baseUrl}/upload/drive/v3`,
  });
  server = await createTestServer({ STORAGE_SYNC_SECONDS: '0' });
});

afterAll(async () => {
  server.close();
  await cloudServer.close();
  fs.rmSync(shareDir, { recursive: true, force: true });
  delete process.env.SHARE_DIRECTORY;
});

describe('storage helpers', () => {
  it('matches local network ranges for IPv4, mapped IPv4 and IPv6', () => {
    const ranges = ['10.0.0.0/8', '192.168.1.0/24', 'fc00::/7', '::1/128'];
    expect(addressInRanges('10.20.30.40', ranges)).toBe(true);
    expect(addressInRanges('::ffff:192.168.1.9', ranges)).toBe(true);
    expect(addressInRanges('192.168.2.9', ranges)).toBe(false);
    expect(addressInRanges('fd12:3456::1', ranges)).toBe(true);
    expect(addressInRanges('::1', ranges)).toBe(true);
    expect(addressInRanges('2001:db8::1', ranges)).toBe(false);
    expect(addressInRanges('8.8.8.8', ranges)).toBe(false);
    expect(parseCidr('300.1.1.1/8')).toBeNull();
    expect(parseCidr('10.0.0.0/33')).toBeNull();
  });

  it('keeps Arabic names and refuses names a share cannot hold', () => {
    expect(safeFileName('تقرير: غزة/الشمال?.mp4')).toBe('تقرير_ غزة_الشمال_.mp4');
    expect(safeFileName('CON')).toBe('file');
    expect(dropboxPath('/مدار/', '2026/11-19', '../x.mp4')).toBe('/مدار/2026/11-19/x.mp4');
    expect(headerJson({ path: '/مدار' })).toBe('{"path":"/\\u0645\\u062f\\u0627\\u0631"}');
  });

  it('validates storage settings', () => {
    expect(validateStorage({ share: { enabled: true, displayPath: '\\\\srv\\news', localNetworks: ['nope'], copyByDefault: true } })).toMatch(/نطاق/);
    expect(validateStorage({ dropbox: { enabled: true, rootPath: '/a/../b' } })).toMatch(/Dropbox/);
    expect(validateStorage({ keepLocalCopy: false, gdrive: { enabled: true, rootName: 'مدار', rootFolderId: '' } })).toBeNull();
  });
});

describe('Dropbox', () => {
  it('connects with a code, copies attached uploads, frees the server copy and still serves the file', async () => {
    const admin = await loginAgent(server.app, 'admin@akhbar.tv');
    const bad = await admin.post('/api/v1/storage/dropbox/connect').set(H).send({ appKey: 'abcde12345', appSecret: 's', code: 'wrong' });
    expect(bad.status).toBe(400);
    const ok = await admin.post('/api/v1/storage/dropbox/connect').set(H).send({ appKey: 'abcde12345', appSecret: 's', code: 'good-code' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.dropbox).toMatchObject({ connected: true, account: 'غرفة الأخبار' });
    // The keys never reach the synced settings.
    expect(JSON.stringify((await admin.get('/api/v1/data')).body)).not.toContain('"rt"');

    await saveSettings(admin, (s) => ({ ...s, storage: { keepLocalCopy: false, dropbox: { enabled: true, rootPath: '/مدار' } } }));
    const editor = await loginAgent(server.app, 'editor@akhbar.tv');
    const small = Buffer.from('small clip');
    const big = Buffer.alloc(17 * 1024 * 1024 + 123, 7);
    const smallId = await uploadToLibrary(editor, 'لقطة قصيرة.mp4', small);
    const bigId = await uploadToLibrary(editor, 'تقرير طويل.mp4', big);
    // An upload nobody attached is never sent anywhere.
    await editor.post('/api/v1/media/upload').set(H).set('Content-Type', 'video/mp4').set('X-File-Name', 'orphan.mp4').send(Buffer.from('x'));

    expect(await runStorageSync(server.db, server.config)).toBe(2);
    const paths = [...cloud.dropbox.keys()];
    expect(paths).toHaveLength(2);
    expect(paths.every((p) => /^\/مدار\/\d{4}\/\d{2}-\d{2}\//.test(p))).toBe(true);
    expect(cloud.dropbox.get(paths.find((p) => p.includes('تقرير'))!)!.equals(big)).toBe(true);

    const copies = await editor.post('/api/v1/storage/copies').set(H).send({ ids: [smallId, bigId] });
    expect(copies.body.data[smallId][0]).toMatchObject({ target: 'dropbox', state: 'DONE' });
    // keepLocalCopy is off: the server's copy is gone, yet the file still opens (and seeks).
    await new Promise((r) => setTimeout(r, 50));
    expect(server.db.getUpload(smallId)!.localEvicted).toBe(true);
    const file = await editor.get(`/api/v1/media/files/${smallId}`).buffer(true).parse((res, cb) => { const parts: Buffer[] = []; res.on('data', (c: Buffer) => parts.push(c)); res.on('end', () => cb(null, Buffer.concat(parts))); });
    expect(file.status).toBe(200);
    expect(Buffer.from(file.body).toString()).toBe('small clip');
    const part = await editor.get(`/api/v1/media/files/${smallId}`).set('Range', 'bytes=0-4');
    expect(part.status).toBe(206);
    expect(part.headers['content-range']).toBe('bytes 0-4/10');
  });

  it('searches the station folder and brings a file in without copying it', async () => {
    const editor = await loginAgent(server.app, 'editor@akhbar.tv');
    const found = await editor.get('/api/v1/storage/dropbox/search').query({ q: 'لقطة' });
    expect(found.status).toBe(200);
    expect(found.body.data[0]).toMatchObject({ name: 'لقطة قصيرة.mp4', supported: true });
    const outside = await editor.post('/api/v1/storage/dropbox/import').set(H).send({ ref: '/other/file.mp4' });
    expect(outside.status).toBe(403);
    const imported = await editor.post('/api/v1/storage/dropbox/import').set(H).send({ ref: found.body.data[0].ref });
    expect(imported.status).toBe(201);
    const file = await editor.get(imported.body.data.url);
    expect(file.status).toBe(200);
    const viewer = await loginAgent(server.app, 'trainee@akhbar.tv');
    expect((await viewer.post('/api/v1/storage/dropbox/import').set(H).send({ ref: found.body.data[0].ref })).status).toBe(403);
  });
});

describe('Google Drive', () => {
  it('uploads in resumable chunks into dated folders and serves the file back', async () => {
    server.db.setMeta('storage.gdrive.credentials', JSON.stringify({ creds: { clientId: 'x.apps.googleusercontent.com', clientSecret: 's', refreshToken: 'g-rt' }, account: 'أرشيف المحطة' }));
    const admin = await loginAgent(server.app, 'admin@akhbar.tv');
    await saveSettings(admin, (s) => ({ ...s, storage: { keepLocalCopy: true, gdrive: { enabled: true, rootName: 'مدار', rootFolderId: '' } } }));
    const url = await admin.post('/api/v1/storage/gdrive/authorize-url').set(H).send({ clientId: 'x.apps.googleusercontent.com', clientSecret: 's' });
    expect(url.body.data.url).toContain('access_type=offline');
    expect(url.body.data.redirectUri).toMatch(/\/api\/v1\/storage\/gdrive\/callback$/);

    const editor = await loginAgent(server.app, 'editor@akhbar.tv');
    const body = Buffer.alloc(9 * 1024 * 1024 + 5, 3);
    const id = await uploadToLibrary(editor, 'مقابلة.mp4', body);
    expect(await runStorageSync(server.db, server.config)).toBeGreaterThanOrEqual(1);
    const stored = [...cloud.drive.values()].find((f) => f.name === 'مقابلة.mp4')!;
    expect(stored.data!.equals(body)).toBe(true);
    const folders = [...cloud.drive.values()].filter((f) => f.folder).map((f) => f.name);
    expect(folders).toContain('مدار');
    // Drive copy recorded by id; the server keeps its own copy (keepLocalCopy on).
    expect(server.db.copiesOf(id).find((c) => c.target === 'gdrive')!.state).toBe('DONE');
    expect(server.db.getUpload(id)!.localEvicted).toBe(false);
    const found = await editor.get('/api/v1/storage/gdrive/search').query({ q: 'مقابلة' });
    expect(found.body.data[0]).toMatchObject({ name: 'مقابلة.mp4' });
  });
});

describe('shared folder', () => {
  it('copies a local colleague\'s upload when asked, directly into a mounted share', async () => {
    process.env.SHARE_DIRECTORY = shareDir;
    const admin = await loginAgent(server.app, 'admin@akhbar.tv');
    await saveSettings(admin, (s) => ({ ...s, storage: { keepLocalCopy: true, share: { enabled: true, displayPath: '\\\\fileserver\\news', localNetworks: ['127.0.0.0/8', '::1/128'], copyByDefault: true } } }));
    const editor = await loginAgent(server.app, 'editor@akhbar.tv');
    const status = await editor.get('/api/v1/storage/status');
    expect(status.body.data.isLocal).toBe(true);
    expect(status.body.data.share.mode).toBe('direct');
    const asked = await uploadToLibrary(editor, 'صورة.mp4', Buffer.from('to share'), { 'X-Storage-Share': '1' });
    const notAsked = await uploadToLibrary(editor, 'أخرى.mp4', Buffer.from('server only'));
    await runStorageSync(server.db, server.config);
    const copy = server.db.copiesOf(asked).find((c) => c.target === 'share')!;
    expect(copy.state).toBe('DONE');
    expect(fs.readFileSync(path.join(shareDir, copy.remotePath!)).toString()).toBe('to share');
    expect(server.db.copiesOf(notAsked).find((c) => c.target === 'share')).toBeUndefined();
    delete process.env.SHARE_DIRECTORY;
  });

  it('works through «جسر مدار»: copies, indexing, search and fetching a file for someone online', async () => {
    const admin = await loginAgent(server.app, 'admin@akhbar.tv');
    expect((await admin.post('/api/v1/bridge/heartbeat').set(H).set('Authorization', 'Bearer nope').send({})).status).toBe(401);
    const token = (await admin.post('/api/v1/storage/bridge/token').set(H).send({})).body.data.token as string;
    expect(token).toMatch(/^mdb_/);

    const editor = await loginAgent(server.app, 'editor@akhbar.tv');
    const id = await uploadToLibrary(editor, 'عبر الجسر.mp4', Buffer.from('via bridge'), { 'X-Storage-Share': '1' });
    fs.mkdirSync(path.join(shareDir, 'أرشيف'), { recursive: true });
    fs.writeFileSync(path.join(shareDir, 'أرشيف', 'مؤتمر صحفي.mp4'), 'archive clip');

    const live = await listen(server.app);
    try {
      const bridge = path.resolve('bridge/madar-bridge.mjs');
      const env = { ...process.env, MADAR_URL: live.baseUrl, MADAR_BRIDGE_TOKEN: token, SHARE_PATH: shareDir };
      await run(process.execPath, [bridge, '--once'], { env });
      const copy = server.db.copiesOf(id).find((c) => c.target === 'share')!;
      expect(copy.state).toBe('DONE');
      expect(fs.readFileSync(path.join(shareDir, copy.remotePath!)).toString()).toBe('via bridge');
      expect((await editor.get('/api/v1/storage/status')).body.data.share).toMatchObject({ mode: 'bridge', bridgeOnline: true });

      const found = await editor.get('/api/v1/storage/share/search').query({ q: 'مؤتمر' });
      expect(found.body.data).toHaveLength(1);
      const imported = await editor.post('/api/v1/storage/share/import').set(H).send({ ref: found.body.data[0].ref });
      expect(imported.status).toBe(201);
      // Not on the server yet: the bridge is asked for it and the browser told to retry.
      const first = await editor.get(imported.body.data.url);
      expect(first.status).toBe(503);
      expect(first.body.code).toBe('SHARE_FETCHING');
      await run(process.execPath, [bridge, '--once', '--index-minutes=0'], { env });
      const second = await editor.get(imported.body.data.url);
      expect(second.status).toBe(200);
      expect(Buffer.from(second.body).toString()).toBe('archive clip');
    } finally {
      await live.close();
    }
  }, 30_000);
});
