import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataStore, DataStoreEvent, Transport } from '../../src/services/dataStore';
import { ApiError } from '../../src/services/http';
import { COLLECTIONS } from '../../src/shared/collections';
import { createTestServer, listen, DEMO_PASSWORD } from '../helpers';

let server: Awaited<ReturnType<typeof createTestServer>>;
let http: Awaited<ReturnType<typeof listen>>;

beforeAll(async () => {
  server = await createTestServer();
  http = await listen(server.app);
});

afterAll(async () => {
  await http.close();
  server.close();
});

/** A browser-like client: its own cookie jar and its own DataStore. */
async function connect(email: string) {
  let cookie = '';
  const transport: Transport = async <T,>(url: string, init: RequestInit & { json?: unknown } = {}) => {
    const headers = new Headers(init.headers);
    headers.set('X-NRCS-Client', 'web');
    if (cookie) headers.set('Cookie', cookie);
    let body = init.body;
    if (init.json !== undefined) {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(init.json);
    }
    const res = await fetch(http.baseUrl + url, { ...init, headers, body });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const payload = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(res.status, payload?.error || String(res.status), payload?.code);
    return payload as T;
  };
  const login = await transport<{ user: { id: string } }>('/api/v1/auth/login', {
    method: 'POST',
    json: { email, password: DEMO_PASSWORD },
  });
  const store = new DataStore(transport, false);
  const events: DataStoreEvent[] = [];
  store.subscribe((e) => events.push(e));
  await store.start(login.user.id);
  return { store, events };
}

const NEWS = COLLECTIONS.news.storageKey;
const GUESTS = COLLECTIONS.guests.storageKey;

describe('several users working at the same time', () => {
  it('shares new records between users', async () => {
    const a = await connect('editor@akhbar.tv');
    const b = await connect('director@akhbar.tv');

    const guests = a.store.get<any[]>(GUESTS, []);
    a.store.set(GUESTS, [{ id: 'gst-shared-1', fullName: 'ضيف مشترك' }, ...guests]);
    await a.store.flush();
    expect(a.store.pendingCount()).toBe(0);

    await b.store.pull();
    const seen = b.store.get<any[]>(GUESTS, []);
    expect(seen[0].id).toBe('gst-shared-1'); // same ordering for everyone
  });

  it('never loses an edit silently: the second writer gets a conflict and the latest copy', async () => {
    const a = await connect('editor@akhbar.tv');
    const b = await connect('director@akhbar.tv');

    // Both users start from the same version of the story.
    const aNews = a.store.get<any[]>(NEWS, []);
    const bNews = b.store.get<any[]>(NEWS, []);
    const idx = aNews.findIndex((n) => n.id === 'nws-3');

    aNews[idx].title = 'عنوان المستخدم الأول';
    a.store.set(NEWS, aNews);
    await a.store.flush();

    const bIdx = bNews.findIndex((n) => n.id === 'nws-3');
    bNews[bIdx].title = 'عنوان المستخدم الثاني';
    b.store.set(NEWS, bNews);
    await b.store.flush();

    const conflict = b.events.find((e) => e.type === 'sync-error');
    expect(conflict).toMatchObject({ type: 'sync-error', code: 'CONFLICT' });
    // B's view was corrected to the server copy instead of keeping a divergent version.
    expect(b.store.get<any[]>(NEWS, []).find((n) => n.id === 'nws-3').title).toBe('عنوان المستخدم الأول');
    expect(server.db.getRow('news', 'nws-3')!.d.title).toBe('عنوان المستخدم الأول');

    // After the refresh B can apply its change on top of the latest version.
    const retry = b.store.get<any[]>(NEWS, []);
    retry.find((n) => n.id === 'nws-3').summary = 'إضافة من المستخدم الثاني';
    b.store.set(NEWS, retry);
    await b.store.flush();
    const final = server.db.getRow('news', 'nws-3')!.d;
    expect(final.title).toBe('عنوان المستخدم الأول');
    expect(final.summary).toBe('إضافة من المستخدم الثاني');
  });

  it('keeps many concurrent writers consistent', async () => {
    const clients = await Promise.all(
      ['editor@akhbar.tv', 'director@akhbar.tv', 'admin@akhbar.tv', 'producer@akhbar.tv'].map(connect)
    );
    // Every user adds 25 guests concurrently.
    await Promise.all(
      clients.map(async (c, ci) => {
        const list = c.store.get<any[]>(GUESTS, []);
        for (let i = 0; i < 25; i++) list.unshift({ id: `gst-load-${ci}-${i}`, fullName: `ضيف ${ci}-${i}` });
        c.store.set(GUESTS, list);
        await c.store.flush();
      })
    );
    await Promise.all(clients.map((c) => c.store.pull()));

    const expected = server.db.listCollection('guests').map((r) => r.id);
    expect(expected.filter((id) => id.startsWith('gst-load-'))).toHaveLength(100);
    for (const c of clients) {
      expect(c.store.pendingCount()).toBe(0);
      expect(c.store.get<any[]>(GUESTS, []).map((g) => g.id).sort()).toEqual([...expected].sort());
    }
  });

  it('reverts a change the server refuses and reports why', async () => {
    const journalist = await connect('journalist@akhbar.tv');
    const programs = journalist.store.get<any[]>(COLLECTIONS.programs.storageKey, []);
    journalist.store.set(COLLECTIONS.programs.storageKey, [{ id: 'prg-hack', name: 'برنامج غير مصرح' }, ...programs]);
    await journalist.store.flush();

    expect(journalist.events.find((e) => e.type === 'sync-error')).toMatchObject({ code: 'FORBIDDEN' });
    expect(journalist.store.get<any[]>(COLLECTIONS.programs.storageKey, []).some((p) => p.id === 'prg-hack')).toBe(false);
    expect(server.db.getRow('programs', 'prg-hack')).toBeNull();
  });

  it('propagates deletions', async () => {
    const a = await connect('editor@akhbar.tv');
    const b = await connect('director@akhbar.tv');
    a.store.set(GUESTS, a.store.get<any[]>(GUESTS, []).filter((g) => g.id !== 'gst-shared-1'));
    await a.store.flush();
    await b.store.pull();
    expect(b.store.get<any[]>(GUESTS, []).some((g) => g.id === 'gst-shared-1')).toBe(false);
  });
});
