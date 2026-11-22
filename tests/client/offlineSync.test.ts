import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Connectivity, DataStore, DataStoreEvent, OFFLINE_PROBE_MS, RETRY_MAX_MS, Transport } from '../../src/services/dataStore';
import { COLLECTIONS, SyncOp } from '../../src/shared/collections';

/**
 * Field reporters lose the network mid-edit. One save must not turn into hundreds of requests a
 * second: retries are spaced out (1s, 2s, 4s … 60s), pause while the browser is offline, there is
 * never more than one request in flight, and the queue is sent in order once the network is back.
 */

const GUESTS = COLLECTIONS.guests.storageKey;

class FakeConnectivity implements Connectivity {
  online = true;
  private listeners = new Set<(online: boolean) => void>();
  isOnline() {
    return this.online;
  }
  subscribe(listener: (online: boolean) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  set(online: boolean) {
    this.online = online;
    this.listeners.forEach((l) => l(online));
  }
}

function harness(opts: { latencyMs?: number } = {}) {
  const net = new FakeConnectivity();
  let reachable = true;
  let inFlight = 0;
  let maxInFlight = 0;
  const syncBodies: SyncOp[][] = [];
  let rev = 1;
  const transport = (async (url: string, init: any = {}) => {
    if (url === '/api/v1/data') {
      return { rev, dbId: 'db-1', collections: { guests: [{ c: 'guests', id: 'gst-1', v: 1, p: 0, d: { id: 'gst-1', fullName: 'ضيف' } }] } };
    }
    if (url.startsWith('/api/v1/data/changes')) {
      if (!reachable || !net.online) throw new TypeError('Failed to fetch');
      return { rev, dbId: 'db-1', reset: false, changes: [] };
    }
    if (url === '/api/v1/data/sync') {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        if (opts.latencyMs) await new Promise((r) => setTimeout(r, opts.latencyMs));
        // A real browser fails every request while offline, whatever navigator.onLine says.
        if (!reachable || !net.online) throw new TypeError('Failed to fetch');
        const ops: SyncOp[] = init.json.ops;
        syncBodies.push(ops);
        rev++;
        return {
          rev,
          dbId: 'db-1',
          results: ops.map((op) => ({ ok: true, row: { c: op.c, id: op.id, v: (op.baseV ?? 0) + 1, p: op.p ?? 0, d: op.d } })),
        };
      } finally {
        inFlight--;
      }
    }
    throw new Error(`unexpected ${url}`);
  }) as Transport;
  let syncCalls = 0;
  const counted = (async (url: string, init?: any) => {
    if (url === '/api/v1/data/sync') syncCalls++;
    return transport(url, init);
  }) as Transport;
  const store = new DataStore(counted, false, { connectivity: net, random: () => 0.5 });
  const events: DataStoreEvent[] = [];
  store.subscribe((e) => events.push(e));
  return {
    store,
    net,
    events,
    syncBodies,
    get syncCalls() {
      return syncCalls;
    },
    get maxInFlight() {
      return maxInFlight;
    },
    setReachable(v: boolean) {
      reachable = v;
    },
  };
}

function rename(store: DataStore, id: string, fullName: string) {
  const list = store.get<any[]>(GUESTS, []);
  const idx = list.findIndex((g) => g.id === id);
  if (idx === -1) list.push({ id, fullName });
  else list[idx] = { ...list[idx], fullName };
  store.set(GUESTS, list);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

it('removes cached rows and pending edits when the server revokes a module', async () => {
  const episode = { c: 'episodes', id: 'ep-example', v: 1, p: 0, d: { id: 'ep-example', title: 'حلقة' } };
  const net = new FakeConnectivity();
  let restricted = false;
  const transport = (async (url: string) => {
    if (url === '/api/v1/data') return {
      rev: restricted ? 2 : 1,
      access: restricted ? 'restricted' : 'open',
      modules: { programmes: !restricted, assignments: true },
      collections: { episodes: restricted ? [] : [episode] },
    };
    if (url.startsWith('/api/v1/data/changes')) return { rev: 2, reset: true };
    if (url === '/api/v1/data/sync') throw new TypeError('Temporary connection loss during the write');
    throw new Error(`Unexpected request ${url}`);
  }) as Transport;
  const store = new DataStore(transport, false, { connectivity: net });
  try {
    await store.start('producer');
    const episodes = COLLECTIONS.episodes.storageKey;
    expect(store.get(episodes, [])).toEqual([episode.d]);
    store.set(episodes, [{ ...episode.d, title: 'تعديل معلّق' }]);
    expect(store.pendingCount()).toBe(1);
    restricted = true;
    await store.pull();
    expect(store.moduleAvailability('producer', 'programmes')).toBe(false);
    expect(store.get(episodes, [])).toEqual([]);
    expect(store.pendingCount()).toBe(0);
  } finally {
    store.stop();
  }
});

describe('sync while the connection is down', () => {
  it('backs off exponentially when the network fails but the browser claims to be online', async () => {
    const h = harness();
    await h.store.start('u1');
    h.setReachable(false);

    rename(h.store, 'gst-1', 'تعديل بلا شبكة');
    await vi.advanceTimersByTimeAsync(60_000);
    // 1s, 2s, 4s, 8s, 16s, 32s… (jittered to 75%): a handful of attempts a minute, not thousands.
    expect(h.syncCalls).toBeGreaterThan(1);
    expect(h.syncCalls).toBeLessThanOrEqual(8);

    // Later the gap reaches the cap and stays there.
    const before = h.syncCalls;
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(h.syncCalls - before).toBeLessThanOrEqual(Math.ceil((10 * 60_000) / (RETRY_MAX_MS / 2)) + 1);
    expect(h.store.pendingCount()).toBe(1);
    expect(h.store.syncState().retryAt).not.toBeNull();

    // New edits while waiting do not trigger extra requests.
    const mid = h.syncCalls;
    for (let i = 0; i < 20; i++) rename(h.store, 'gst-1', `كتابة ${i}`);
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.syncCalls).toBe(mid);

    // Network back: the next scheduled retry sends the latest text and the queue empties.
    h.setReachable(true);
    await vi.advanceTimersByTimeAsync(RETRY_MAX_MS);
    expect(h.store.pendingCount()).toBe(0);
    expect(h.syncBodies.at(-1)![0].d.fullName).toBe('كتابة 19');
  });

  it('pauses while the browser is offline and flushes in order on the online event', async () => {
    const h = harness();
    await h.store.start('u1');
    h.net.set(false);

    rename(h.store, 'gst-1', 'أول تعديل');
    rename(h.store, 'gst-new', 'ضيف جديد من الميدان');
    rename(h.store, 'gst-1', 'ثاني تعديل');

    // Ten minutes offline: only the occasional probe in case navigator.onLine is wrong.
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(h.syncCalls).toBeLessThanOrEqual(Math.ceil((10 * 60_000) / (OFFLINE_PROBE_MS / 2)));
    expect(h.store.pendingCount()).toBe(2);
    const status = h.events.filter((e) => e.type === 'sync-status').at(-1) as Extract<DataStoreEvent, { type: 'sync-status' }>;
    expect(status).toMatchObject({ pending: 2, browserOnline: false });

    const before = h.syncCalls;
    h.net.set(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.syncCalls).toBe(before + 1);
    expect(h.store.pendingCount()).toBe(0);
    const sent = h.syncBodies.at(-1)!;
    expect(sent.map((op) => op.id)).toEqual(['gst-1', 'gst-new']);
    expect(sent[0].d.fullName).toBe('ثاني تعديل');
    expect(h.store.get<any[]>(GUESTS, []).map((g) => g.fullName)).toEqual(['ثاني تعديل', 'ضيف جديد من الميدان']);
  });

  it('answers a waiting form at once with "queued" instead of spinning for 12 seconds', async () => {
    const h = harness();
    await h.store.start('u1');
    h.net.set(false);
    rename(h.store, 'gst-1', 'محفوظ محلياً');
    const outcome = await h.store.awaitWrite('guests', 'gst-1');
    expect(outcome).toMatchObject({ ok: false, pending: true, queued: true });
    expect(outcome.message).toContain('عند عودة الاتصال');
    expect(await h.store.settle()).toBe(false);
    expect(h.syncCalls).toBe(0);

    // Browser online but the request fails: the form learns after that single attempt.
    h.setReachable(false);
    h.net.set(true);
    const waiting = h.store.awaitWrite('guests', 'gst-1');
    await vi.advanceTimersByTimeAsync(1000);
    await expect(waiting).resolves.toMatchObject({ queued: true });
    expect(h.syncCalls).toBe(1);
    // Now in backoff after a network failure: answered at once, no extra request.
    await expect(h.store.awaitWrite('guests', 'gst-1')).resolves.toMatchObject({ queued: true });
    expect(h.syncCalls).toBe(1);

    // Back online: a fresh wait resolves ok once the server stores it.
    h.setReachable(true);
    h.net.set(true);
    const confirmed = h.store.awaitWrite('guests', 'gst-1');
    await vi.advanceTimersByTimeAsync(1000);
    await expect(confirmed).resolves.toEqual({ ok: true });
  });

  it('never has two sync requests in flight', async () => {
    const h = harness({ latencyMs: 800 });
    await h.store.start('u1');
    for (let i = 0; i < 10; i++) {
      rename(h.store, 'gst-1', `نص ${i}`);
      void h.store.flush();
      void h.store.awaitWrite('guests', 'gst-1');
      await vi.advanceTimersByTimeAsync(150);
    }
    const settled = h.store.settle();
    await vi.advanceTimersByTimeAsync(5000);
    expect(await settled).toBe(true);
    expect(h.maxInFlight).toBe(1);
    expect(h.syncBodies.at(-1)![0].d.fullName).toBe('نص 9');
  });

  it('an explicit retry is sent even while waiting out the backoff', async () => {
    const h = harness();
    await h.store.start('u1');
    h.setReachable(false);
    rename(h.store, 'gst-1', 'إعادة يدوية');
    await vi.advanceTimersByTimeAsync(20_000);
    h.setReachable(true);
    const before = h.syncCalls;
    await h.store.flush(); // waits for the scheduled retry
    expect(h.syncCalls).toBe(before);
    await h.store.flush({ force: true });
    expect(h.syncCalls).toBe(before + 1);
    expect(h.store.pendingCount()).toBe(0);
  });
});
