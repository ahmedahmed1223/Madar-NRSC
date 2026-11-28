import { afterEach, describe, expect, it, vi } from 'vitest';
import { DropboxClient } from '../../src/server/dropbox';

const creds = { appKey: 'demo-app', appSecret: 'demo-secret', refreshToken: 'demo-refresh' };
const memberId = 'dbmid:member-1';
const hosts = { api: 'https://api.example.invalid', content: 'https://content.example.invalid' };
const teamAccount = {
  account_id: 'dbid:member-1', name: { display_name: 'Newsroom Team' },
  root_info: { '.tag': 'team', root_namespace_id: '13', home_namespace_id: '7' },
};

function fakeDropbox(options: { active?: boolean; personal?: boolean } = {}) {
  const requests: { path: string; headers: Headers }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    const headers = new Headers(init.headers);
    requests.push({ path, headers });
    switch (path) {
      case '/oauth2/token':
        return Response.json({ access_token: 'demo-access', expires_in: 14400 });
      case '/2/team/token/get_authenticated_admin':
        return Response.json({ admin_profile: { team_member_id: memberId, status: { '.tag': 'active' } } });
      case '/2/team/members/get_info_v2':
        expect(JSON.parse(String(init.body))).toEqual({ members: [{ '.tag': 'team_member_id', team_member_id: memberId }] });
        return Response.json({ members: [{ '.tag': 'member_info', profile: { team_member_id: memberId, status: { '.tag': options.active === false ? 'suspended' : 'active' } } }] });
      case '/2/users/get_current_account':
        if (options.personal) return Response.json({ name: { display_name: 'Personal Account' } });
        if (headers.get('dropbox-api-select-user') === memberId) return Response.json(teamAccount);
        return new Response('The OAuth 2 access token you provided is for an entire Dropbox Business team. Please specify a team member using the Dropbox-API-Select-User header.', { status: 400 });
      case '/2/files/list_folder':
        return Response.json({ entries: [{ '.tag': 'file', path_display: '/News/clip.mp4' }] });
      case '/2/files/download':
        return new Response('clip');
      default:
        throw new Error(`Unexpected Dropbox request ${path}`);
    }
  });
  return requests;
}

describe('Dropbox account selection', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses the authorizing administrator and team root on metadata and content routes in automatic mode', async () => {
    const requests = fakeDropbox();
    const client = new DropboxClient(creds, hosts);

    expect(await client.account()).toMatchObject({ name: 'Newsroom Team', teamMemberId: memberId, rootNamespaceId: '13' });
    expect(await client.list('/News')).toMatchObject([{ path: '/News/clip.mp4' }]);
    expect(await (await client.download('/News/clip.mp4', 'bytes=0-3')).text()).toBe('clip');

    expect(requests.find(({ path }) => path === '/2/team/token/get_authenticated_admin')?.headers.has('dropbox-api-select-user')).toBe(false);
    for (const { headers } of requests.filter(({ path }) => path.startsWith('/2/files/'))) {
      expect(headers.get('dropbox-api-select-user')).toBe(memberId);
      expect(headers.get('dropbox-api-path-root')).toBe('{".tag":"root","root":"13"}');
    }
    expect(requests.at(-1)?.headers.get('range')).toBe('bytes=0-3');
  });

  it('rejects a suspended explicit team member before any user file call', async () => {
    const requests = fakeDropbox({ active: false });
    const client = new DropboxClient({ ...creds, teamMemberId: memberId }, hosts);

    await expect(client.list('/News')).rejects.toMatchObject({ summary: 'invalid_team_member' });
    expect(requests.some(({ path }) => path.startsWith('/2/files/'))).toBe(false);
  });

  it('omits both team headers on files calls for a user-linked token', async () => {
    const requests = fakeDropbox({ personal: true });
    const client = new DropboxClient(creds, hosts);

    expect(await client.account()).toMatchObject({ name: 'Personal Account' });
    await client.list('/News');

    expect(requests.some(({ path }) => path.startsWith('/2/team/'))).toBe(false);
    const headers = requests.find(({ path }) => path === '/2/files/list_folder')?.headers;
    expect(headers?.has('dropbox-api-select-user')).toBe(false);
    expect(headers?.has('dropbox-api-path-root')).toBe(false);
  });
});
