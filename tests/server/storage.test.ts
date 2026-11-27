import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestServer, listen, loginAgent } from '../helpers';
import { addressInRanges, parseCidr, safeFileName, storageOf, validateStorage } from '../../src/shared/storage';
import { headerJson, dropboxPath } from '../../src/server/dropbox';
import { runStorageSync } from '../../src/server/storage';
import { runRetention } from '../../src/server/retention';
import { uploadsDir } from '../../src/server/uploads';

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
      if (req.body.client_secret === 'incorrect-secret') return res.status(401).json({ error: 'invalid_client', error_description: 'private tenant detail' });
      if (req.body.code === 'no-offline-token') return res.json({ access_token: 'short-lived' });
      if (req.body.code === 'unavailable') return res.status(503).json({});
      if (req.body.code === 'network-interrupted') return req.socket.destroy();
      if (req.body.code !== 'good-code') return res.status(400).json({ error: 'invalid_grant' });
      return res.json({ access_token: 'at', refresh_token: 'rt', expires_in: 14400 });
    }
    if (req.body.client_secret === 'incorrect-secret') return res.status(401).json({ error: 'invalid_client' });
    if (req.body.refresh_token === 'provider-down') return res.status(503).end();
    if (!['rt', 'g-rt', 'existing-private-refresh-token'].includes(req.body.refresh_token)) return res.status(400).json({ error: 'invalid_grant' });
    if (req.body.scope === 'files.content.write' && req.body.client_id === 'read-only') {
      return res.status(400).json({ error: 'invalid_scope', error_description: 'private provider detail' });
    }
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
    if (dir === '/missing') return res.status(409).json({ error_summary: 'path/not_found/...' });
    if (dir === '/مدار-المكتبة/النشرات') return res.json({ entries: [], has_more: true, cursor: dir });
    res.json({ entries: [...dropbox.keys()].filter((p) => path.posix.dirname(p).toLowerCase() === dir).map(entry) });
  });

  app.post('/2/files/list_folder/continue', express.json(), (req, res) => {
    const entries = [...dropbox.keys()].filter(p => path.posix.dirname(p).toLowerCase() === req.body.cursor).map(entry);
    res.json({ entries, has_more: false });
  });
  app.post('/2/files/get_metadata', express.json(), (req, res) => {
    const key = [...dropbox.keys()].find(p => p.toLowerCase() === String(req.body.path).toLowerCase());
    if (!key) return res.status(409).json({ error_summary: 'path/not_found/...' });
    res.json(entry(key));
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
    expect(storageOf(undefined)).toMatchObject({ primaryMedia: 'local', primaryBackups: 'local' });
    expect(validateStorage({ primaryMedia: 'nas', primaryBackups: 'dropbox' })).toBeNull();
    expect(validateStorage({ primaryBackups: 'unsupported' })).toMatch(/وجهة التخزين/);
    expect(validateStorage({ share: { enabled: true, displayPath: '\\\\srv\\news', localNetworks: ['nope'], copyByDefault: true } })).toMatch(/نطاق/);
    expect(validateStorage({ dropbox: { enabled: true, rootPath: '/a/../b' } })).toMatch(/Dropbox/);
    expect(validateStorage({ keepLocalCopy: false, gdrive: { enabled: true, rootName: 'مدار', rootFolderId: '' } })).toBeNull();
  });
});

describe('media trash', () => {
  it('hides managed files while trashed and restores the same bytes through the central trash', async () => {
    const editor = await loginAgent(server.app, 'editor@akhbar.tv');
    const admin = await loginAgent(server.app, 'admin@akhbar.tv');
    const bytes = Buffer.from('recoverable local clip');
    const uploadId = await uploadToLibrary(editor, 'لقطة مستعادة.mp4', bytes);
    const id = `med-${uploadId}`;
    const entry = server.db.getRow('media', id)!;
    const file = `/api/v1/media/files/${uploadId}`;
    const locations = `/api/v1/storage/locations/${uploadId}`;
    const trashed = await editor.post('/api/v1/data/sync').set(H).send({ ops: [{ c: 'media', id, op: 'upsert', baseV: entry.v, d: { ...entry.d, deletedAt: '2000-01-01T00:00:00.000Z' } }] });
    expect(trashed.body.results[0].ok).toBe(true);
    const deleted = server.db.getRow('media', id)!;
    expect(Date.parse(deleted.d.deletedAt)).toBeGreaterThan(Date.now() - 5000);
    expect((await editor.get(file)).status).toBe(404);
    expect((await editor.get(locations)).status).toBe(404);
    expect((await editor.get(`/api/v1/chat/files/${uploadId}`)).status).toBe(404);
    expect(server.db.getUpload(uploadId)).not.toBeNull();
    expect(server.db.findOrphanUploads(0).map(row => row.id)).not.toContain(uploadId);

    const list = await admin.get('/api/v1/trash').query({ collection: 'media' });
    expect(list.body.data.items).toContainEqual(expect.objectContaining({ id, title: 'لقطة مستعادة.mp4' }));
    const bypass = await editor.post('/api/v1/data/sync').set(H).send({ ops: [{ c: 'media', id, op: 'upsert', baseV: deleted.v, d: { ...deleted.d, deletedAt: null } }] });
    expect(bypass.body.results[0]).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    const alias = await editor.post('/api/v1/data/sync').set(H).send({ ops: [{ c: 'media', id: `${id}-alias`, op: 'upsert', d: entry.d }] });
    expect(alias.body.results[0]).toMatchObject({ ok: false, code: 'FORBIDDEN' });

    const restored = await editor.post(`/api/v1/trash/media/${id}/restore`).set(H).send({ baseV: deleted.v });
    expect(restored.status).toBe(200);
    expect(server.db.getRow('media', id)?.d).toMatchObject({ ...entry.d, deletedAt: null });
    const result = await editor.get(file).set('Range', 'bytes=0-10');
    expect(result.status).toBe(206);
    expect(result.headers['content-range']).toBe(`bytes 0-10/${bytes.length}`);
    expect((await editor.get(locations)).body.data.local).toBe(true);
    const inventory = () => editor.post('/api/v1/storage/copies').set(H).send({ ids: [uploadId, 'unavailable-upload'], inventory: true });
    const restoredInventory = (await inventory()).body.locations;
    expect(restoredInventory[uploadId]).toMatchObject({ local: true });
    expect(restoredInventory).not.toHaveProperty('unavailable-upload');

    const active = server.db.getRow('media', id)!;
    const deletedAgain = await editor.post('/api/v1/data/sync').set(H).send({ ops: [{ c: 'media', id, op: 'upsert', baseV: active.v, d: { ...active.d, deletedAt: new Date().toISOString() } }] });
    expect(deletedAgain.body.results[0].ok).toBe(true);
    const localFile = path.join(uploadsDir(server.config.dataDir), server.db.getUpload(uploadId)!.storedName);
    expect(fs.existsSync(localFile)).toBe(true);
    runRetention(server.db, server.config.dataDir, { trashDays: 1, notificationDays: 0, logDays: 0, auditLogDays: 0 }, Date.now() + 2 * 86_400_000);
    expect(server.db.getUpload(uploadId)).toBeNull();
    await expect.poll(() => fs.existsSync(localFile)).toBe(false);
  });

  it('keeps a retained media alias readable when a different row for its upload is permanently deleted', async () => {
    const editor = await loginAgent(server.app, 'editor@akhbar.tv');
    const uploadId = await uploadToLibrary(editor, 'لقطة مشتركة.mp4', Buffer.from('shared file'));
    const id = `med-${uploadId}`;
    const row = server.db.getRow('media', id)!;
    const alias = { ...row.d, id: `${id}-alias`, url: `${row.d.url}?v=1` };
    const saved = await editor.post('/api/v1/data/sync').set(H).send({ ops: [{ c: 'media', id: alias.id, op: 'upsert', d: alias }] });
    expect(saved.body.results[0].ok).toBe(true);

    const purged = await editor.post('/api/v1/data/sync').set(H).send({ ops: [{ c: 'media', id, op: 'delete', baseV: row.v }] });
    expect(purged.body.results[0].ok).toBe(true);
    expect(server.db.getRow('media', id)).toBeNull();
    expect((await editor.get(`/api/v1/media/files/${uploadId}`)).status).toBe(200);
  });
});

describe('Dropbox', () => {
  it('verifies saved credentials, root and grants without changing Dropbox files', async () => {
    const admin = await loginAgent(server.app, 'admin@akhbar.tv');
    const editor = await loginAgent(server.app, 'editor@akhbar.tv');
    const check = (agent: typeof admin, check: 'connection' | 'permissions') => agent.post('/api/v1/storage/dropbox/verify').set(H).send({ check });
    expect((await check(editor, 'connection')).status).toBe(403);
    expect((await check(admin, 'connection')).body.data).toMatchObject({ credentials: 'not_configured' });

    const creds = (appKey: string, refreshToken = 'rt') => server.db.setMeta('storage.dropbox.credentials', JSON.stringify({ creds: { appKey, appSecret: 'private-app-secret', refreshToken } }));
    const original = [...cloud.dropbox.entries()];
    try {
      // Both checks work before mirroring is enabled.
      creds('full-access');
      const connection = await check(admin, 'connection');
      expect(connection.status).toBe(200);
      expect(connection.body.data).toMatchObject({ root: '/مدار', credentials: 'verified', folder: 'verified' });
      expect((await check(admin, 'permissions')).body.data).toMatchObject({ credentials: 'verified', read: 'verified', write: 'verified' });

      creds('read-only');
      const permissions = await check(admin, 'permissions');
      expect(permissions.body.data).toMatchObject({ credentials: 'verified', read: 'verified', write: 'missing_scope' });
      expect(permissions.text).not.toContain('private provider detail');
      expect(permissions.text).not.toContain('private-app-secret');

      await saveSettings(admin, (s) => ({ ...s, storage: { dropbox: { enabled: false, rootPath: '/missing' } } }));
      expect((await check(admin, 'connection')).body.data).toMatchObject({ root: '/missing', credentials: 'verified', folder: 'folder_missing' });

      creds('full-access', 'expired');
      expect((await check(admin, 'connection')).body.data).toMatchObject({ credentials: 'invalid_credentials' });
      expect([...cloud.dropbox.entries()]).toEqual(original);
    } finally {
      server.db.setMeta('storage.dropbox.credentials', '');
      await saveSettings(admin, (s) => ({ ...s, storage: undefined }));
    }
  });

  it('reports local and remote locations only for accessible library files', async () => {
    const editor = await loginAgent(server.app, 'editor@akhbar.tv');
    const id = await uploadToLibrary(editor, 'نسخة الخادم.mp4', Buffer.from('server copy'));
    const location = (id: string) => `/api/v1/storage/locations/${id}`;
    const result = await editor.get(location(id));
    expect(result.status).toBe(200);
    expect(result.body.data).toEqual({ local: true, copies: [] });
    expect((await editor.get(location('does-not-exist'))).status).toBe(404);

    const record = server.db.getUpload(id)!;
    server.db.insertUpload({ ...record, id: 'location-chat-only', scope: 'chat' });
    server.db.insertUpload({ ...record, id: 'location-unowned-legacy', scope: 'legacy', uploadedBy: 'other-user' });
    expect((await editor.get(location('location-chat-only'))).status).toBe(404);
    expect((await editor.get(location('location-unowned-legacy'))).status).toBe(404);
  });

  it('explains Dropbox code, app credential, offline grant and connectivity failures before saving', async () => {
    const admin = await loginAgent(server.app, 'admin@akhbar.tv');
    const bad = await admin.post('/api/v1/storage/dropbox/connect').set(H).send({ appKey: 'abcde12345', appSecret: 's', code: 'wrong' });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/رمز جديد/);
    const connect = (appSecret: string, code: string) => admin.post('/api/v1/storage/dropbox/connect').set(H).send({ appKey: 'abcde12345', appSecret, code });
    const wrongSecret = await connect('incorrect-secret', 'good-code').expect(400);
    expect(wrongSecret.body.error).toMatch(/App secret/);
    expect(JSON.stringify(wrongSecret.body)).not.toContain('private tenant detail');
    expect((await connect('s', 'no-offline-token').expect(400)).body.error).toMatch(/التفويض الدائم/);
    expect((await connect('s', 'unavailable').expect(503)).body.error).toMatch(/لاحقاً/);
    expect((await connect('s', 'network-interrupted').expect(503)).body.error).toMatch(/اتصال الخادم/);
    expect((await admin.get('/api/v1/storage/status')).body.data.dropbox.connected).toBe(false);
  });

  it('only saves a verified existing refresh token, preserves a working connection and never returns its secrets', async () => {
    const admin = await loginAgent(server.app, 'admin@akhbar.tv');
    const editor = await loginAgent(server.app, 'editor@akhbar.tv');
    const url = '/api/v1/storage/dropbox/connect';
    const keys = { appKey: 'abcde12345', appSecret: 'workstation-secret' };
    const refreshToken = 'existing-private-refresh-token';
    await editor.post(url).set(H).send({ ...keys, refreshToken }).expect(403);
    await admin.post(url).set(H).send({ ...keys, refreshToken, code: 'good-code' }).expect(400);
    const bad = await admin.post(url).set(H).send({ ...keys, refreshToken: 'revoked' }).expect(400);
    expect(bad.body.error).toMatch(/Refresh token/);
    const wrongClient = await admin.post(url).set(H).send({ ...keys, appSecret: 'incorrect-secret', refreshToken }).expect(400);
    expect(wrongClient.body.error).toMatch(/App secret/);
    expect((await admin.get('/api/v1/storage/status')).body.data.dropbox.connected).toBe(false);
    const saved = await admin.post(url).set(H).send({ ...keys, refreshToken }).expect(200);
    expect(saved.body.data.dropbox.connected).toBe(true);
    const original = server.db.getMeta('storage.dropbox.credentials');
    await admin.post(url).set(H).send({ ...keys, refreshToken: 'provider-down' }).expect(503);
    expect(server.db.getMeta('storage.dropbox.credentials')).toBe(original);
    for (const response of [saved, await admin.get('/api/v1/storage/status'), await admin.get('/api/v1/data')]) {
      expect(response.text).not.toContain(refreshToken);
      expect(response.text).not.toContain(keys.appSecret);
    }
    await admin.post('/api/v1/storage/dropbox/disconnect').set(H).send({}).expect(200);
  });

  it('connects with a code, copies attached uploads, frees the server copy and still serves the file', async () => {
    const admin = await loginAgent(server.app, 'admin@akhbar.tv');
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
    expect((await editor.get(`/api/v1/storage/locations/${smallId}`)).body.data).toMatchObject({ local: false, copies: [{ target: 'dropbox', state: 'DONE' }] });
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
    expect((await editor.get(`/api/v1/storage/locations/${imported.body.data.id}`)).body.data).toMatchObject({ local: false, copies: [{ target: 'dropbox', state: 'DONE' }] });
    const file = await editor.get(imported.body.data.url);
    expect(file.status).toBe(200);
    const viewer = await loginAgent(server.app, 'trainee@akhbar.tv');
    expect((await viewer.post('/api/v1/storage/dropbox/import').set(H).send({ ref: found.body.data[0].ref })).status).toBe(403);

    const { id: uploadId, url } = imported.body.data;
    const id = `med-${uploadId}`;
    const added = await editor.post('/api/v1/data/sync').set(H).send({ ops: [{ c: 'media', id, op: 'upsert', d: { url, fileName: 'ملف خارجي.mp4', mediaType: 'VIDEO', tags: [] } }] });
    expect(added.body.results[0].ok).toBe(true);
    const record = server.db.getRow('media', id)!;
    const moved = await editor.post('/api/v1/data/sync').set(H).send({ ops: [{ c: 'media', id, op: 'upsert', baseV: record.v, d: { ...record.d, deletedAt: new Date().toISOString() } }] });
    expect(moved.body.results[0].ok).toBe(true);
    expect((await editor.get(url)).status).toBe(404);
    runRetention(server.db, server.config.dataDir, { trashDays: 1, notificationDays: 0, logDays: 0, auditLogDays: 0 }, Date.now() + 2 * 86_400_000);
    expect(server.db.getUpload(uploadId)).toBeNull();
    expect(server.db.copiesOf(uploadId)).toHaveLength(0);
    expect(cloud.dropbox.get(found.body.data[0].ref)?.toString()).toBe('small clip');
  });
});

it('browses nested Dropbox folders, hides sibling roots, and respects server-only selection', async () => {
  const admin = await loginAgent(server.app, 'admin@akhbar.tv');
  const previous = (await admin.get('/api/v1/data')).body.collections.settings[0].d.storage;
  const root = '/مدار-المكتبة';
  const nested = root + '/النشرات';
  const within = nested + '/نشرة-الصباح.mp4';
  const outside = root + '-خارجي/نشرة-الصباح.mp4';
  await admin.post('/api/v1/storage/dropbox/connect').set(H)
    .send({ appKey: 'abcde12345', appSecret: 's', code: 'good-code' }).expect(200);
  await saveSettings(admin, s => ({ ...s, storage: { ...s.storage, keepLocalCopy: true, dropbox: { enabled: false, rootPath: root } } }));
  cloud.dropbox.set(within, Buffer.from('news clip'));
  cloud.dropbox.set(outside, Buffer.from('outside configured Dropbox folder'));
  try {
    const list = await admin.get('/api/v1/storage/dropbox/list').query({ at: nested }).expect(200);
    expect(list.body.data).toMatchObject({ at: nested, items: [expect.objectContaining({ ref: within })] });
    await admin.get('/api/v1/storage/dropbox/list').query({ at: root + '-خارجي' }).expect(403);
    const search = await admin.get('/api/v1/storage/dropbox/search').query({ q: 'نشرة-الصباح' }).expect(200);
    expect(search.body.data.map((value: { ref: string }) => value.ref)).toEqual([within]);
    await admin.post('/api/v1/storage/dropbox/import').set(H).send({ ref: within }).expect(201);
    await admin.post('/api/v1/storage/dropbox/import').set(H).send({ ref: outside }).expect(403);
    await admin.post('/api/v1/storage/dropbox/import').set(H).send({ ref: nested + '/مفقود.mp4' }).expect(404);
    await saveSettings(admin, s => ({ ...s, storage: { ...s.storage, dropbox: { enabled: true, rootPath: root } } }));
    const uploadId = await uploadToLibrary(admin, 'نسخة-الخادم.mp4', Buffer.from('server only'), { 'X-Storage-Cloud-Targets': 'none' });
    const metadata = await admin.post('/api/v1/storage/copies').set(H).send({ ids: [uploadId], inventory: true }).expect(200);
    expect(metadata.body.locations[uploadId]).toEqual({ local: true, copies: [] });
  } finally {
    cloud.dropbox.delete(within);
    cloud.dropbox.delete(outside);
    await saveSettings(admin, s => ({ ...s, storage: previous }));
  }
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

describe('primary cloud media storage', () => {
  it.each(['dropbox', 'gdrive'] as const)('commits to %s before acknowledging and reads the remote bytes', async (provider) => {
    const admin = await loginAgent(server.app, 'admin@akhbar.tv');
    const oldSettings = (await admin.get('/api/v1/data')).body.collections.settings[0].d.storage;
    const key = `storage.${provider}.credentials`;
    const oldCredentials = server.db.getMeta(key);
    const credentials = provider === 'dropbox'
      ? { appKey: 'primary-dropbox', appSecret: 's', refreshToken: 'rt' }
      : { clientId: 'primary-drive', clientSecret: 's', refreshToken: 'g-rt' };
    const bytes = Buffer.from(`only held by ${provider}`);
    try {
      server.db.setMeta(key, JSON.stringify({ creds: credentials }));
      await saveSettings(admin, (settings) => ({ ...settings, storage: {
        primaryMedia: provider,
        keepLocalCopy: true,
        dropbox: { enabled: provider === 'dropbox', rootPath: '/primary-media' },
        gdrive: { enabled: provider === 'gdrive', rootName: 'Primary media', rootFolderId: '' },
      } }));
      const id = await uploadToLibrary(admin, 'primary-clip.mp4', bytes);
      const record = server.db.getUpload(id)!;
      expect(record.localEvicted).toBe(true);
      expect(fs.existsSync(path.join(uploadsDir(server.dir), record.storedName))).toBe(false);
      const copies = server.db.copiesOf(id);
      expect(copies).toEqual([expect.objectContaining({ target: provider, state: 'DONE', remotePath: expect.any(String) })]);
      const remotePath = copies[0].remotePath!;
      const stored = provider === 'dropbox' ? cloud.dropbox.get(remotePath) : cloud.drive.get(remotePath)?.data;
      expect(stored).toEqual(bytes);
      const served = await admin.get(`/api/v1/media/files/${id}`).expect(200);
      expect(Buffer.from(served.body)).toEqual(bytes);

      const localFiles = () => fs.existsSync(uploadsDir(server.dir)) ? fs.readdirSync(uploadsDir(server.dir)) : [];
      const localFilesBefore = localFiles();
      const uploadSummaryBefore = server.db.uploadsSummary();
      const staging = path.join(server.dir, 'media-storage-staging');
      const collectionBefore = (await admin.get('/api/v1/data')).body.collections.media;
      server.db.setMeta(key, JSON.stringify({ creds: { ...credentials, refreshToken: 'provider-down' } }));
      await admin.post('/api/v1/media/upload').set(H)
        .set('Content-Type', 'video/mp4').set('X-File-Name', 'unavailable-primary.mp4')
        .set('X-Storage-Cloud-Targets', 'none').send(bytes).expect(503);
      expect(localFiles()).toEqual(localFilesBefore);
      expect(server.db.uploadsSummary()).toEqual(uploadSummaryBefore);
      expect(fs.readdirSync(staging)).toEqual([]);
      expect((await admin.get('/api/v1/data')).body.collections.media).toEqual(collectionBefore);
    } finally {
      server.db.setMeta(key, oldCredentials ?? '');
      await saveSettings(admin, (settings) => ({ ...settings, storage: oldSettings }));
    }
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
      const bridgeRun = await run(process.execPath, [bridge, '--once'], { env });
      const copy = server.db.copiesOf(id).find((c) => c.target === 'share')!;
      expect(copy.state, bridgeRun.stdout).toBe('DONE');
      expect(fs.readFileSync(path.join(shareDir, copy.remotePath!)).toString()).toBe('via bridge');
      expect((await editor.get('/api/v1/storage/status')).body.data.share).toMatchObject({ mode: 'bridge', bridgeOnline: true });

      const found = await editor.get('/api/v1/storage/share/search').query({ q: 'مؤتمر' });
      expect(found.body.data).toHaveLength(1);
      const imported = await editor.post('/api/v1/storage/share/import').set(H).send({ ref: found.body.data[0].ref });
      const location = `/api/v1/storage/locations/${imported.body.data.id}`;
      expect((await editor.get(location)).body.data).toMatchObject({ local: false, copies: [{ target: 'share', state: 'DONE' }] });
      expect(imported.status).toBe(201);
      // Not on the server yet: the bridge is asked for it and the browser told to retry.
      const first = await editor.get(imported.body.data.url);
      expect(first.status).toBe(503);
      expect(first.body.code).toBe('SHARE_FETCHING');
      await run(process.execPath, [bridge, '--once', '--index-minutes=0'], { env });
      const second = await editor.get(imported.body.data.url);
      expect(second.status).toBe(200);
      expect((await editor.get(location)).body.data).toMatchObject({ local: true, copies: [{ target: 'share', state: 'DONE' }] });
      expect(Buffer.from(second.body).toString()).toBe('archive clip');
    } finally {
      await live.close();
    }
  }, 30_000);
});
