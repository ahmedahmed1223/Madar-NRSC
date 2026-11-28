import request from 'supertest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTestServer, loginAgent } from '../helpers';

let server: Awaited<ReturnType<typeof createTestServer>>;
const endpoint = '/api/v1/storage/dropbox/team-members';
const credentials = { appKey: 'demoapp123', appSecret: 'test-app-secret', refreshToken: 'test-refresh-token' };

beforeEach(async () => { server = await createTestServer(); });
afterEach(() => { vi.unstubAllGlobals(); server.close(); });

function profile(id: string, status: string, display_name: string) {
  return { profile: { team_member_id: id, status: { '.tag': status }, name: { display_name } } };
}

it('returns only active Dropbox team members and paginates without storing supplied credentials', async () => {
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    switch (new URL(url).pathname) {
      case '/oauth2/token':
        return Response.json({ access_token: 'temporary-access-token', expires_in: 14400 });
      case '/2/team/members/list_v2':
        expect(JSON.parse(String(init.body))).toEqual({ limit: 100, include_removed: false });
        expect(new Headers(init.headers).has('dropbox-api-select-user')).toBe(false);
        return Response.json({
          members: [profile('dbmid:active-a', 'active', 'عضو نشط'), profile('dbmid:inactive', 'suspended', 'عضو معلّق')],
          has_more: true, cursor: 'second-page',
        });
      case '/2/team/members/list/continue_v2':
        expect(JSON.parse(String(init.body))).toEqual({ cursor: 'second-page' });
        return Response.json({ members: [profile('dbmid:active-b', 'active', 'عضو إضافي')], has_more: false, cursor: 'end' });
      default:
        throw new Error('Unexpected Dropbox call');
    }
  });
  vi.stubGlobal('fetch', fetchMock);
  const admin = await loginAgent(server.app, 'admin@akhbar.tv');
  const fetchPage = (cursor?: string) => admin.post(endpoint).set('X-NRCS-Client', 'web').send({ ...credentials, cursor });

  const first = await fetchPage();
  expect(first.status).toBe(200);
  expect(first.headers['cache-control']).toContain('no-store');
  expect(first.body.data).toEqual({ members: [{ id: 'dbmid:active-a', name: 'عضو نشط' }], cursor: 'second-page' });
  const second = await fetchPage(first.body.data.cursor);
  expect(second.body.data).toEqual({ members: [{ id: 'dbmid:active-b', name: 'عضو إضافي' }] });
  expect(JSON.stringify(first.body)).not.toContain(credentials.refreshToken);
  expect(server.db.getMeta('storage.dropbox.credentials')).toBeFalsy();
});

it('restricts directory access to storage administrators and explains the Dropbox member permission', async () => {
  const fetchMock = vi.fn(async (url: string) => new URL(url).pathname === '/oauth2/token'
    ? Response.json({ access_token: 'temporary-access-token', expires_in: 14400 })
    : Response.json({ error_summary: 'missing_scope/' }, { status: 401 }));
  vi.stubGlobal('fetch', fetchMock);
  const journalist = await loginAgent(server.app, 'journalist@akhbar.tv');
  expect((await request(server.app).post(endpoint).set('X-NRCS-Client', 'web').send(credentials)).status).toBe(401);
  expect((await journalist.post(endpoint).set('X-NRCS-Client', 'web').send(credentials)).status).toBe(403);
  expect(fetchMock).not.toHaveBeenCalled();
  const admin = await loginAgent(server.app, 'admin@akhbar.tv');
  const missing = await admin.post(endpoint).set('X-NRCS-Client', 'web').send(credentials);
  expect(missing.status).toBe(400);
  expect(missing.body.error).toContain('members.read');
});
