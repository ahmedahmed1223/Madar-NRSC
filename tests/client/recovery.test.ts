import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataStore, DataStoreEvent, Transport } from '../../src/services/dataStore';
import { ApiError } from '../../src/services/http';
import { COLLECTIONS } from '../../src/shared/collections';
import { createTestServer, listen, DEMO_PASSWORD } from '../helpers';

/**
 * A deployment that answers from two separate databases (e.g. two Cloud Run instances with
 * their own disks): writes confirmed by one must not vanish when the next answer comes from the other.
 */
let a: Awaited<ReturnType<typeof createTestServer>>;
let b: Awaited<ReturnType<typeof createTestServer>>;
let httpA: Awaited<ReturnType<typeof listen>>;
let httpB: Awaited<ReturnType<typeof listen>>;

beforeAll(async () => {
  a = await createTestServer();
  b = await createTestServer();
  httpA = await listen(a.app);
  httpB = await listen(b.app);
});

afterAll(async () => {
  await httpA.close();
  await httpB.close();
  a.close();
  b.close();
});

function balancedClient(email: string) {
  const cookies = new Map<string, string>();
  let base = httpA.baseUrl;
  const raw = async <T,>(url: string, init: RequestInit & { json?: unknown } = {}): Promise<T> => {
    const headers = new Headers(init.headers);
    headers.set('X-NRCS-Client', 'web');
    const cookie = cookies.get(base);
    if (cookie) headers.set('Cookie', cookie);
    let body = init.body;
    if (init.json !== undefined) {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(init.json);
    }
    const res = await fetch(base + url, { ...init, headers, body });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookies.set(base, setCookie.split(';')[0]);
    const payload = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(res.status, payload?.error || String(res.status), payload?.code);
    return payload as T;
  };
  const login = () => raw<{ user: { id: string } }>('/api/v1/auth/login', { method: 'POST', json: { email, password: DEMO_PASSWORD } });
  return {
    transport: raw as Transport,
    login,
    /** The load balancer starts sending this browser to the other instance. */
    async switchTo(url: string) {
      base = url;
      await login();
    },
  };
}

const GUESTS = COLLECTIONS.guests.storageKey;
const NEWS = COLLECTIONS.news.storageKey;

describe('answers from another or older database', () => {
  it('resends recently confirmed writes the other copy lacks, and says so', async () => {
    const client = balancedClient('editor@akhbar.tv');
    const { user } = await client.login();
    const store = new DataStore(client.transport, false);
    const events: DataStoreEvent[] = [];
    store.subscribe((e) => events.push(e));
    await store.start(user.id);

    // Confirmed by instance A: a new guest and an edited story.
    store.set(GUESTS, [{ id: 'gst-rewind-1', fullName: 'ضيف لا يجب أن يضيع' }, ...store.get<any[]>(GUESTS, [])]);
    const news = store.get<any[]>(NEWS, []);
    const idx = news.findIndex((n) => n.id === 'nws-3');
    news[idx] = { ...news[idx], title: 'عنوان محفوظ على النسخة الأولى' };
    store.set(NEWS, news);
    await store.settle();
    expect(store.pendingCount()).toBe(0);

    // The next request lands on instance B, which never saw those writes.
    await client.switchTo(httpB.baseUrl);
    await store.pull();
    await store.settle();

    expect(events.some((e) => e.type === 'storage-warning' && /أُعيد إرسالها/.test(e.message))).toBe(true);
    expect(store.get<any[]>(GUESTS, []).some((g) => g.id === 'gst-rewind-1')).toBe(true);

    // Instance B now holds them too.
    const other = balancedClient('director@akhbar.tv');
    await other.switchTo(httpB.baseUrl);
    const viewer = new DataStore(other.transport, false);
    await viewer.start((await other.login()).user.id);
    expect(viewer.get<any[]>(GUESTS, []).some((g) => g.id === 'gst-rewind-1')).toBe(true);
    expect(viewer.get<any[]>(NEWS, []).find((n) => n.id === 'nws-3')?.title).toBe('عنوان محفوظ على النسخة الأولى');
  });

  it('does nothing when the same database answers', async () => {
    const client = balancedClient('editor@akhbar.tv');
    const { user } = await client.login();
    const store = new DataStore(client.transport, false);
    const events: DataStoreEvent[] = [];
    store.subscribe((e) => events.push(e));
    await store.start(user.id);
    store.set(GUESTS, [{ id: 'gst-same-1', fullName: 'ضيف' }, ...store.get<any[]>(GUESTS, [])]);
    await store.settle();
    await store.pull();
    expect(events.some((e) => e.type === 'storage-warning')).toBe(false);
    expect(store.pendingCount()).toBe(0);
  });
});
