import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestServer, loginAgent, DEMO_PASSWORD } from '../helpers';

let server: Awaited<ReturnType<typeof createTestServer>>;

beforeAll(async () => {
  server = await createTestServer();
});

afterAll(() => server.close());

const H = { 'X-NRCS-Client': 'web' };

async function rowOf(agent: request.Agent, collection: string, id: string) {
  const res = await agent.get('/api/v1/data');
  return res.body.collections[collection].find((r: any) => r.id === id);
}

describe('authentication', () => {
  it('rejects anonymous access to data', async () => {
    const res = await request(server.app).get('/api/v1/data');
    expect(res.status).toBe(401);
  });

  it('rejects bad credentials without revealing whether the account exists', async () => {
    const unknown = await request(server.app).post('/api/v1/auth/login').set(H).send({ email: 'nobody@x.tv', password: 'wrong' });
    const wrong = await request(server.app).post('/api/v1/auth/login').set(H).send({ email: 'editor@akhbar.tv', password: 'wrong' });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body.error).toBe(wrong.body.error);
  });

  it('issues an httpOnly session cookie and never stores the raw token', async () => {
    const res = await request(server.app)
      .post('/api/v1/auth/login')
      .set(H)
      .send({ email: 'editor@akhbar.tv', password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    const cookie = res.headers['set-cookie'][0];
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    const token = cookie.split(';')[0].split('=')[1];
    expect(server.db.getSession(token)).toBeNull();
  });

  it('locks the account after repeated failures', async () => {
    for (let i = 0; i < 5; i++) {
      await request(server.app).post('/api/v1/auth/login').set(H).send({ email: 'trainee@akhbar.tv', password: 'bad-password-1' });
    }
    const res = await request(server.app).post('/api/v1/auth/login').set(H).send({ email: 'trainee@akhbar.tv', password: DEMO_PASSWORD });
    expect(res.status).toBe(423);
  });

  it('invalidates the session on logout', async () => {
    const agent = await loginAgent(server.app, 'producer@akhbar.tv');
    expect((await agent.get('/api/v1/auth/me')).status).toBe(200);
    await agent.post('/api/v1/auth/logout').set(H);
    expect((await agent.get('/api/v1/auth/me')).status).toBe(401);
  });

  it('changes password, revoking other sessions', async () => {
    const first = await loginAgent(server.app, 'media@akhbar.tv');
    const second = await loginAgent(server.app, 'media@akhbar.tv');
    const weak = await first.post('/api/v1/auth/change-password').set(H).send({ currentPassword: DEMO_PASSWORD, newPassword: 'short' });
    expect(weak.status).toBe(400);
    const ok = await first.post('/api/v1/auth/change-password').set(H).send({ currentPassword: DEMO_PASSWORD, newPassword: 'NewMedia2026pass' });
    expect(ok.status).toBe(200);
    expect((await first.get('/api/v1/auth/me')).status).toBe(200);
    expect((await second.get('/api/v1/auth/me')).status).toBe(401);
    await loginAgent(server.app, 'media@akhbar.tv', 'NewMedia2026pass');
  });

  it('forces a password change after an administrator reset', async () => {
    const admin = await loginAgent(server.app, 'admin@akhbar.tv');
    const res = await admin.post('/api/v1/users/usr-6/password').set(H).send({ password: 'Temporary2026x' });
    expect(res.status).toBe(200);
    const user = await loginAgent(server.app, 'reporter@akhbar.tv', 'Temporary2026x');
    expect((await user.get('/api/v1/auth/me')).body.mustChangePassword).toBe(true);
  });
});

describe('CSRF protection', () => {
  it('refuses state-changing requests without the client header', async () => {
    const agent = await loginAgent(server.app, 'editor@akhbar.tv');
    const res = await agent.post('/api/v1/data/sync').send({ ops: [] });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CSRF');
  });
});

describe('data sync and concurrency', () => {
  it('detects concurrent edits instead of silently overwriting (optimistic locking)', async () => {
    const editor = await loginAgent(server.app, 'editor@akhbar.tv');
    const director = await loginAgent(server.app, 'director@akhbar.tv');
    const row = await rowOf(editor, 'news', 'nws-2');

    const first = await editor.post('/api/v1/data/sync').set(H).send({
      ops: [{ c: 'news', op: 'upsert', id: 'nws-2', d: { ...row.d, title: 'تعديل المحرر' }, baseV: row.v }],
    });
    expect(first.body.results[0].ok).toBe(true);

    const second = await director.post('/api/v1/data/sync').set(H).send({
      ops: [{ c: 'news', op: 'upsert', id: 'nws-2', d: { ...row.d, title: 'تعديل المدير' }, baseV: row.v }],
    });
    expect(second.body.results[0]).toMatchObject({ ok: false, code: 'CONFLICT' });
    expect(second.body.results[0].current.d.title).toBe('تعديل المحرر');
  });

  it('streams changes to other users through the change feed', async () => {
    const a = await loginAgent(server.app, 'editor@akhbar.tv');
    const b = await loginAgent(server.app, 'director@akhbar.tv');
    const { rev } = (await b.get('/api/v1/data')).body;
    await a.post('/api/v1/data/sync').set(H).send({
      ops: [{ c: 'guests', op: 'upsert', id: 'gst-feed-1', d: { fullName: 'ضيف جديد', organization: 'x' } }],
    });
    const feed = await b.get(`/api/v1/data/changes?since=${rev}`);
    expect(feed.body.reset).toBe(false);
    expect(feed.body.changes.map((c: any) => c.id)).toContain('gst-feed-1');
    expect(feed.body.rev).toBeGreaterThan(rev);
  });

  it('propagates deletions as tombstones', async () => {
    const a = await loginAgent(server.app, 'editor@akhbar.tv');
    const { rev } = (await a.get('/api/v1/data')).body;
    await a.post('/api/v1/data/sync').set(H).send({ ops: [{ c: 'guests', op: 'delete', id: 'gst-feed-1' }] });
    const feed = await a.get(`/api/v1/data/changes?since=${rev}`);
    expect(feed.body.changes).toContainEqual(expect.objectContaining({ id: 'gst-feed-1', deleted: true }));
  });

  it('asks clients to re-bootstrap when they are ahead of or behind the retained history', async () => {
    const a = await loginAgent(server.app, 'editor@akhbar.tv');
    const res = await a.get('/api/v1/data/changes?since=99999999');
    expect(res.body.reset).toBe(true);
  });

  it('rejects malformed ids and oversized payloads', async () => {
    const a = await loginAgent(server.app, 'editor@akhbar.tv');
    const res = await a.post('/api/v1/data/sync').set(H).send({
      ops: [
        { c: 'guests', op: 'upsert', id: '../etc/passwd', d: {} },
        { c: 'nope', op: 'upsert', id: 'x', d: {} },
        { c: 'guests', op: 'upsert', id: 'big', d: { blob: 'x'.repeat(600 * 1024) } },
      ],
    });
    expect(res.body.results.map((r: any) => r.code)).toEqual(['INVALID', 'INVALID', 'INVALID']);
  });
});

describe('server-side authorization', () => {
  it('prevents a journalist from publishing by calling the API directly', async () => {
    const journalist = await loginAgent(server.app, 'journalist@akhbar.tv');
    const row = await rowOf(journalist, 'news', 'nws-5'); // own draft
    const res = await journalist.post('/api/v1/data/sync').set(H).send({
      ops: [{ c: 'news', op: 'upsert', id: 'nws-5', d: { ...row.d, status: 'PUBLISHED' }, baseV: row.v }],
    });
    expect(res.body.results[0]).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });

  it('lets authors edit their drafts but not change stories that are already on air', async () => {
    const journalist = await loginAgent(server.app, 'journalist@akhbar.tv');
    const draft = await rowOf(journalist, 'news', 'nws-5');
    const okEdit = await journalist.post('/api/v1/data/sync').set(H).send({
      ops: [{ c: 'news', op: 'upsert', id: 'nws-5', d: { ...draft.d, summary: 'تحديث المسودة' }, baseV: draft.v }],
    });
    expect(okEdit.body.results[0].ok).toBe(true);

    const live = await rowOf(journalist, 'news', 'nws-1'); // own story, already PUBLISHED
    const liveEdit = await journalist.post('/api/v1/data/sync').set(H).send({
      ops: [{ c: 'news', op: 'upsert', id: 'nws-1', d: { ...live.d, title: 'تعديل غير معتمد' }, baseV: live.v }],
    });
    expect(liveEdit.body.results[0]).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });

  it('prevents users from escalating their own role', async () => {
    const editor = await loginAgent(server.app, 'editor@akhbar.tv');
    const row = await rowOf(editor, 'users', 'usr-2');
    const res = await editor.post('/api/v1/data/sync').set(H).send({
      ops: [{ c: 'users', op: 'upsert', id: 'usr-2', d: { ...row.d, role: 'SUPER_ADMIN' }, baseV: row.v }],
    });
    expect(res.body.results[0]).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });

  it('rejects duplicate e-mail addresses across accounts', async () => {
    const admin = await loginAgent(server.app, 'admin@akhbar.tv');
    const res = await admin.post('/api/v1/data/sync').set(H).send({
      ops: [{ c: 'users', op: 'upsert', id: 'usr-dup', d: { fullName: 'نسخة', email: 'EDITOR@akhbar.tv', role: 'VIEWER', isActive: true } }],
    });
    expect(res.body.results[0]).toMatchObject({ ok: false, code: 'INVALID' });
  });

  it('keeps audit logs append-only and stamps the real author and IP', async () => {
    const journalist = await loginAgent(server.app, 'journalist@akhbar.tv');
    const res = await journalist.post('/api/v1/data/sync').set(H).send({
      ops: [{ c: 'auditLogs', op: 'upsert', id: 'aud-forged', d: { userId: 'usr-1', userName: 'مزور', details: 'x', ipAddress: '1.2.3.4' } }],
    });
    const row = res.body.results[0].row;
    expect(row.d.userId).toBe('usr-3');
    expect(row.d.ipAddress).not.toBe('1.2.3.4');

    const edit = await journalist.post('/api/v1/data/sync').set(H).send({
      ops: [{ c: 'auditLogs', op: 'upsert', id: 'aud-forged', d: { details: 'edited' }, baseV: row.v }],
    });
    expect(edit.body.results[0].code).toBe('FORBIDDEN');
  });

  it('hides audit logs from users without audit.view', async () => {
    const journalist = await loginAgent(server.app, 'journalist@akhbar.tv');
    const res = await journalist.get('/api/v1/data');
    expect(res.body.collections.auditLogs).toEqual([]);
  });

  it('restricts database administration to authorised users', async () => {
    const editor = await loginAgent(server.app, 'editor@akhbar.tv');
    expect((await editor.get('/api/v1/db/stats')).status).toBe(403);
    expect((await editor.get('/api/v1/db/export')).status).toBe(403);
    expect((await editor.post('/api/v1/db/query').set(H).send({ query: 'SELECT 1' })).status).toBe(403);
  });
});

describe('SQL console', () => {
  it('only runs read-only statements and hides credentials', async () => {
    const admin = await loginAgent(server.app, 'admin@akhbar.tv');
    const select = await admin.post('/api/v1/db/query').set(H).send({ query: "SELECT COUNT(*) AS n FROM entities WHERE collection = 'news'" });
    expect(select.body.success).toBe(true);
    expect(select.body.data.values[0][0]).toBeGreaterThan(0);

    for (const query of ['DELETE FROM entities', 'DROP TABLE entities', 'SELECT * FROM user_credentials', 'SELECT 1; DELETE FROM entities']) {
      const res = await admin.post('/api/v1/db/query').set(H).send({ query });
      expect(res.body.success, query).toBe(false);
    }
    expect(server.db.countCollection('news')).toBeGreaterThan(0);
  });

  it('is disabled when ENABLE_SQL_CONSOLE is off', async () => {
    const prod = await createTestServer({ ENABLE_SQL_CONSOLE: 'false', ALLOW_DB_RESET: 'false' });
    try {
      const admin = await loginAgent(prod.app, 'admin@akhbar.tv');
      expect((await admin.post('/api/v1/db/query').set(H).send({ query: 'SELECT 1' })).status).toBe(403);
      expect((await admin.post('/api/v1/db/reset').set(H)).status).toBe(403);
    } finally {
      prod.close();
    }
  });
});

describe('backups', () => {
  it('creates, lists and restores a backup, and refuses path traversal', async () => {
    const admin = await loginAgent(server.app, 'admin@akhbar.tv');
    const created = await admin.post('/api/v1/db/backups').set(H);
    expect(created.status).toBe(200);
    const fileName = created.body.data.fileName;

    await admin.post('/api/v1/data/sync').set(H).send({
      ops: [{ c: 'guests', op: 'upsert', id: 'gst-after-backup', d: { fullName: 'بعد النسخة' } }],
    });
    expect(server.db.getRow('guests', 'gst-after-backup')).not.toBeNull();

    const confirmation = await admin.post('/api/v1/db/confirm-operation').set(H).send({ action: 'restore', fileName, password: DEMO_PASSWORD });
    expect(confirmation.status).toBe(200);
    const restored = await admin.post('/api/v1/db/backups/restore').set(H).send({ fileName, confirmationToken: confirmation.body.data.token, localAirEnded: true });
    expect(restored.status).toBe(200);
    expect(server.db.getRow('guests', 'gst-after-backup')).toBeNull();

    const evil = await admin.post('/api/v1/db/backups/restore').set(H).send({ fileName: '../../etc/passwd', confirmationToken: 'invalid', localAirEnded: true });
    expect(evil.status).toBe(400);
    expect(evil.body.error).not.toMatch(/passwd/);
  });
});

describe('exports and infrastructure', () => {
  it('exports MOS XML with escaped content', async () => {
    const producer = await loginAgent(server.app, 'producer@akhbar.tv');
    const row = await rowOf(producer, 'episodes', 'ep-101');
    const rundown = [{ ...(row.d.rundown?.[0] || {}), id: 'seg-x', title: '<script>alert(1)</script> & "quotes"', durationSeconds: 60 }];
    await producer.post('/api/v1/data/sync').set(H).send({ ops: [{ c: 'episodes', op: 'upsert', id: 'ep-101', d: { ...row.d, rundown }, baseV: row.v }] });
    const res = await producer.get('/api/v1/episodes/ep-101/export/mos');
    expect(res.status).toBe(200);
    expect(res.text).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot;');
    expect(res.text).not.toContain('<script>');
  });

  it('reports health and readiness', async () => {
    expect((await request(server.app).get('/api/health')).body.status).toBe('ok');
    expect((await request(server.app).get('/api/ready')).status).toBe(200);
  });

  it('returns 503 from the AI endpoint when Gemini is not configured', async () => {
    const editor = await loginAgent(server.app, 'editor@akhbar.tv');
    const res = await editor.post('/api/v1/ai/copilot').set(H).send({ mode: 'HEADLINES', title: 'x' });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('AI_NOT_CONFIGURED');
  });

  it('rate-limits repeated login attempts', async () => {
    const limited = await createTestServer({ LOGIN_RATE_LIMIT_PER_15MIN: '3' });
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 5; i++) {
        statuses.push((await request(limited.app).post('/api/v1/auth/login').set(H).send({ email: 'x@y.z', password: 'nope' })).status);
      }
      expect(statuses.slice(-1)[0]).toBe(429);
    } finally {
      limited.close();
    }
  });
});

describe('first run without demo data', () => {
  it('creates only reference data and a single administrator', async () => {
    const fresh = await createTestServer({
      SEED_DEMO_DATA: 'false',
      ADMIN_EMAIL: 'chief@station.tv',
      ADMIN_PASSWORD: 'ChiefStation2026',
    });
    try {
      expect(fresh.db.countCollection('news')).toBe(0);
      expect(fresh.db.countCollection('users')).toBe(1);
      expect(fresh.db.countCollection('categories')).toBeGreaterThan(0);
      const admin = await loginAgent(fresh.app, 'chief@station.tv', 'ChiefStation2026');
      const me = await admin.get('/api/v1/auth/me');
      expect(me.body.user.role).toBe('SUPER_ADMIN');
    } finally {
      fresh.close();
    }
  });
});
