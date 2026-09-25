import fs from 'fs';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestServer, loginAgent, DEMO_PASSWORD } from '../helpers';
import { base32Decode, base32Encode, hotp, totp, totpCounter, verifyTotp } from '../../src/server/totp';

let server: Awaited<ReturnType<typeof createTestServer>>;
const H = { 'X-NRCS-Client': 'web' };

beforeAll(async () => {
  server = await createTestServer({ MEDIA_MAX_UPLOAD_MB: '1' });
});

afterAll(() => server.close());

describe('TOTP primitives', () => {
  it('matches the RFC 6238 SHA-1 test vector', () => {
    const secret = Buffer.from('12345678901234567890');
    // T = 59s -> counter 1 -> 94287082 (8 digits) / 287082 (6 digits)
    expect(hotp(secret, 1, 8)).toBe('94287082');
    expect(totp(base32Encode(secret), 59_000)).toBe('287082');
  });

  it('round-trips base32', () => {
    const buf = Buffer.from('madar-nrcs-2fa');
    expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true);
  });

  it('accepts ±1 step of drift and rejects replays', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    const now = 1_800_000_000_000;
    const previous = totp(secret, now - 30_000);
    const counter = verifyTotp(secret, previous, 0, now);
    expect(counter).toBe(totpCounter(now) - 1);
    expect(verifyTotp(secret, previous, counter!, now)).toBeNull();
    expect(verifyTotp(secret, '000000', 0, now)).toBeNull();
    expect(verifyTotp(secret, 'abc', 0, now)).toBeNull();
  });
});

describe('two-factor login flow', () => {
  it('enrols, then requires a code at login, and blocks code reuse', async () => {
    const agent = await loginAgent(server.app, 'producer@akhbar.tv');
    const setup = await agent.post('/api/v1/auth/2fa/setup').set(H).send({ password: DEMO_PASSWORD });
    expect(setup.status).toBe(200);
    expect(setup.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    const secret = setup.body.secret;

    const wrong = await agent.post('/api/v1/auth/2fa/enable').set(H).send({ code: '000000' });
    expect(wrong.status).toBe(400);
    const enable = await agent.post('/api/v1/auth/2fa/enable').set(H).send({ code: totp(secret) });
    expect(enable.status).toBe(200);
    expect(server.db.getRow('users', 'usr-4')!.d.twoFactorEnabled).toBe(true);

    const noCode = await request(server.app).post('/api/v1/auth/login').set(H).send({ email: 'producer@akhbar.tv', password: DEMO_PASSWORD });
    expect(noCode.status).toBe(401);
    expect(noCode.body.code).toBe('TOTP_REQUIRED');

    // The code used for enrolment cannot be replayed for login.
    const replay = await request(server.app)
      .post('/api/v1/auth/login')
      .set(H)
      .send({ email: 'producer@akhbar.tv', password: DEMO_PASSWORD, totp: totp(secret) });
    expect(replay.status).toBe(401);
    expect(replay.body.code).toBe('TOTP_INVALID');

    const next = totp(secret, Date.now() + 30_000);
    const ok = await request(server.app)
      .post('/api/v1/auth/login')
      .set(H)
      .send({ email: 'producer@akhbar.tv', password: DEMO_PASSWORD, totp: next });
    expect(ok.status).toBe(200);
  });

  it('does not let a client toggle twoFactorEnabled through data sync', async () => {
    const admin = await loginAgent(server.app, 'admin@akhbar.tv');
    const data = await admin.get('/api/v1/data');
    const row = data.body.collections.users.find((r: any) => r.id === 'usr-4');
    const res = await admin.post('/api/v1/data/sync').set(H).send({
      ops: [{ c: 'users', op: 'upsert', id: 'usr-4', d: { ...row.d, twoFactorEnabled: false }, baseV: row.v }],
    });
    expect(res.body.results[0].row.d.twoFactorEnabled).toBe(true);
  });

  it('lets an administrator reset 2FA for a user who lost their device', async () => {
    const editor = await loginAgent(server.app, 'editor@akhbar.tv');
    expect((await editor.post('/api/v1/users/usr-4/2fa/reset').set(H)).status).toBe(403);
    const admin = await loginAgent(server.app, 'admin@akhbar.tv');
    expect((await admin.post('/api/v1/users/usr-4/2fa/reset').set(H)).status).toBe(200);
    await loginAgent(server.app, 'producer@akhbar.tv');
    expect(server.db.getRow('users', 'usr-4')!.d.twoFactorEnabled).toBe(false);
  });
});

describe('media uploads', () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(2048, 1)]);

  it('stores a file, serves it only to signed-in users, and deletes it with its media record', async () => {
    const editor = await loginAgent(server.app, 'editor@akhbar.tv');
    const up = await editor
      .post('/api/v1/media/upload')
      .set(H)
      .set('Content-Type', 'image/png')
      .set('X-File-Name', encodeURIComponent('صورة الحدث.png'))
      .send(png);
    expect(up.status).toBe(201);
    const { id, url, sizeBytes, originalName } = up.body.data;
    expect(sizeBytes).toBe(png.length);
    expect(originalName).toBe('صورة الحدث.png');

    const file = await editor.get(url).buffer(true);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toMatch(/image\/png/);
    expect(file.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(file.body, png)).toBe(0);
    expect((await request(server.app).get(url)).status).toBe(401);

    const sync = await editor.post('/api/v1/data/sync').set(H).send({
      ops: [{ c: 'media', op: 'upsert', id: 'med-upl-1', d: { fileName: 'x.png', url, mediaType: 'IMAGE', tags: [], uploadedById: 'usr-2' } }],
    });
    expect(sync.body.results[0].ok).toBe(true);

    const del = await editor.post('/api/v1/data/sync').set(H).send({ ops: [{ c: 'media', op: 'delete', id: 'med-upl-1' }] });
    expect(del.body.results[0].ok).toBe(true);
    expect(server.db.getUpload(id)).toBeNull();
    expect((await editor.get(url)).status).toBe(404);
  });

  it('rejects script-capable types, oversized files and users without upload rights', async () => {
    const editor = await loginAgent(server.app, 'editor@akhbar.tv');
    const svg = await editor.post('/api/v1/media/upload').set(H).set('Content-Type', 'image/svg+xml').send(Buffer.from('<svg onload="alert(1)"/>'));
    expect(svg.status).toBe(415);

    const big = await editor.post('/api/v1/media/upload').set(H).set('Content-Type', 'video/mp4').send(Buffer.alloc(1024 * 1024 + 10));
    expect(big.status).toBe(413);
    const leftovers = fs.readdirSync(path.join(server.dir, 'uploads')).filter((f) => f.endsWith('.part'));
    expect(leftovers).toEqual([]);

    const viewer = await loginAgent(server.app, 'trainee@akhbar.tv').catch(() => null);
    if (viewer) {
      const res = await viewer.post('/api/v1/media/upload').set(H).set('Content-Type', 'image/png').send(png);
      expect(res.status).toBe(403);
    }
  });

  it("refuses attaching another user's upload to a media record", async () => {
    const editor = await loginAgent(server.app, 'editor@akhbar.tv');
    const up = await editor.post('/api/v1/media/upload').set(H).set('Content-Type', 'image/png').send(png);
    const journalist = await loginAgent(server.app, 'journalist@akhbar.tv');
    const res = await journalist.post('/api/v1/data/sync').set(H).send({
      ops: [{ c: 'media', op: 'upsert', id: 'med-steal', d: { fileName: 'x.png', url: up.body.data.url, mediaType: 'IMAGE', tags: [] } }],
    });
    expect(res.body.results[0]).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });
});

describe('shared on-air lock', () => {
  it('blocks deleting episodes and programs for everyone while locked', async () => {
    const editor = await loginAgent(server.app, 'editor@akhbar.tv');
    const lock = await editor.post('/api/v1/data/sync').set(H).send({
      ops: [{ c: 'broadcastState', op: 'upsert', id: 'singleton', d: { liveLock: true }, baseV: server.db.getRow('broadcastState', 'singleton')!.v }],
    });
    expect(lock.body.results[0].ok).toBe(true);
    expect(lock.body.results[0].row.d.lockedByName).toBeTruthy();

    const admin = await loginAgent(server.app, 'admin@akhbar.tv');
    const del = await admin.post('/api/v1/data/sync').set(H).send({ ops: [{ c: 'episodes', op: 'delete', id: 'ep-102' }] });
    expect(del.body.results[0]).toMatchObject({ ok: false, code: 'FORBIDDEN' });

    const journalist = await loginAgent(server.app, 'journalist@akhbar.tv');
    const unlock = await journalist.post('/api/v1/data/sync').set(H).send({
      ops: [{ c: 'broadcastState', op: 'upsert', id: 'singleton', d: { liveLock: false }, baseV: server.db.getRow('broadcastState', 'singleton')!.v }],
    });
    expect(unlock.body.results[0]).toMatchObject({ ok: false, code: 'FORBIDDEN' });

    await editor.post('/api/v1/data/sync').set(H).send({
      ops: [{ c: 'broadcastState', op: 'upsert', id: 'singleton', d: { liveLock: false }, baseV: server.db.getRow('broadcastState', 'singleton')!.v }],
    });
    const del2 = await admin.post('/api/v1/data/sync').set(H).send({ ops: [{ c: 'episodes', op: 'delete', id: 'ep-102' }] });
    expect(del2.body.results[0].ok).toBe(true);
  });
});

describe('internal chat', () => {
  it('stamps the real author and keeps messages immutable', async () => {
    const journalist = await loginAgent(server.app, 'journalist@akhbar.tv');
    const sent = await journalist.post('/api/v1/data/sync').set(H).send({
      ops: [{ c: 'messages', op: 'upsert', id: 'msg-t1', d: { channel: 'NEWSROOM', text: 'مرحبا', userName: 'مزيف' } }],
    });
    const row = sent.body.results[0].row;
    expect(row.d.userName).not.toBe('مزيف');
    expect(row.d.userId).toBe('usr-3');
    expect(row.d.timestamp).toBeTruthy();

    const edit = await journalist.post('/api/v1/data/sync').set(H).send({
      ops: [{ c: 'messages', op: 'upsert', id: 'msg-t1', d: { ...row.d, text: 'معدلة' }, baseV: row.v }],
    });
    expect(edit.body.results[0].code).toBe('FORBIDDEN');

    const bad = await journalist.post('/api/v1/data/sync').set(H).send({
      ops: [{ c: 'messages', op: 'upsert', id: 'msg-t2', d: { channel: 'SECRET', text: 'x' } }],
    });
    expect(bad.body.results[0].code).toBe('FORBIDDEN');

    const other = await loginAgent(server.app, 'editor@akhbar.tv');
    const data = await other.get('/api/v1/data');
    expect(data.body.collections.messages.some((m: any) => m.id === 'msg-t1')).toBe(true);
  });
});
