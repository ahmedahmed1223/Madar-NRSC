import { afterEach, expect, it, vi } from 'vitest';
import { DataStore, type DataStoreEvent, type Transport } from '../../src/services/dataStore';
import { COLLECTIONS } from '../../src/shared/collections';

const pendingKey = 'nrcs_pending_sync_v3';
const journalKey = 'nrcs_recent_writes_v1';
const guests = COLLECTIONS.guests.storageKey;
const aliceGuest = { id: 'g-alice', fullName: 'ضيف القسم الأول' };

function fixture() {
  const entries = new Map<string, string>();
  const storage = {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); },
    removeItem: (key: string) => { entries.delete(key); },
  };
  vi.stubGlobal('localStorage', storage);
  let online = false;
  let onConnectivity: ((online: boolean) => void) | undefined;
  const transport = vi.fn(async (url: string, init?: { json?: any }) => {
    if (url === '/api/v1/data') return { rev: 0, dbId: 'station', collections: { guests: [] } };
    if (url.startsWith('/api/v1/data/changes')) return { rev: 0, dbId: 'station', reset: false, changes: [] };
    const ops = init?.json?.ops ?? [];
    return { rev: 1, dbId: 'station', results: ops.map(op => ({
      ok: true, row: { c: op.c, id: op.id, p: op.p, v: 1, d: op.d },
    })) };
  });
  const store = new DataStore(transport as Transport, false, {
    connectivity: {
      isOnline: () => online,
      subscribe: listener => {
        onConnectivity = listener;
        return () => { onConnectivity = undefined; };
      },
    },
  });
  return { store, storage, transport, goOnline: () => { online = true; onConnectivity?.(online); } };
}

afterEach(() => vi.unstubAllGlobals());

it('keeps each employee’s unsent changes on a shared device until confirmed', async () => {
  const { store, storage, transport, goOnline } = fixture();
  try {
    await store.start('alice');
    store.set(guests, [aliceGuest]);
    store.stop();
    await store.start('bob');
    expect(store.get(guests, [])).toEqual([]);
    store.set(guests, [{ id: 'g-bob', fullName: 'ضيف القسم الثاني' }]);
    store.stop();
    await store.start('alice');
    expect(store.get(guests, [])).toEqual([aliceGuest]);
    expect(storage.getItem(pendingKey + ':alice')).toBeTruthy();
    goOnline();
    await store.settle();
    expect(transport.mock.calls.filter(([url]) => url === '/api/v1/data/sync')).toHaveLength(1);
    expect(storage.getItem(pendingKey + ':alice')).toBeNull();
    expect(storage.getItem(pendingKey + ':bob')).toBeTruthy();
    expect(storage.getItem(journalKey + ':alice')).toBeTruthy();
  } finally {
    store.stop();
  }
});

it('migrates legacy entries only when their owner signs in', async () => {
  const { store, storage } = fixture();
  storage.setItem(pendingKey, JSON.stringify({
    userId: 'alice', ops: [{ c: 'guests', id: aliceGuest.id, op: 'upsert', d: aliceGuest }],
  }));
  storage.setItem(journalKey, JSON.stringify({ userId: 'alice', entries: [], dbId: 'station', rev: 0 }));
  try {
    await store.start('bob');
    store.stop();
    expect(storage.getItem(pendingKey)).toBeTruthy();
    expect(storage.getItem(journalKey)).toBeTruthy();
    await store.start('alice');
    expect(store.get(guests, [])).toEqual([aliceGuest]);
    expect(storage.getItem(pendingKey)).toBeNull();
    expect(storage.getItem(journalKey)).toBeNull();
    expect(storage.getItem(pendingKey + ':alice')).toBeTruthy();
  } finally {
    store.stop();
  }
});

it('warns when the browser cannot persist offline changes', async () => {
  const { store, storage } = fixture();
  const events: DataStoreEvent[] = [];
  store.subscribe(event => events.push(event));
  try {
    await store.start('alice');
    storage.setItem = () => { throw new DOMException('Storage full', 'QuotaExceededError'); };
    store.set(guests, [aliceGuest]);
    expect(events.some(event => event.type === 'storage-warning')).toBe(true);
    expect(store.pendingCount()).toBe(1);
  } finally {
    store.stop();
  }
});
