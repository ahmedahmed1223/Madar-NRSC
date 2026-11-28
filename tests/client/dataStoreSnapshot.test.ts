import { describe, expect, it } from 'vitest';
import { DataStore, type Transport } from '../../src/services/dataStore';
import { COLLECTIONS, type EntityRow } from '../../src/shared/collections';

const NEWS_KEY = COLLECTIONS.news.storageKey;
const TASKS_KEY = COLLECTIONS.tasks.storageKey;
const SETTINGS_KEY = COLLECTIONS.settings.storageKey;

function createMockTransport(initialNews: EntityRow[], initialSettings: EntityRow[]) {
  let rev = 1;
  let pendingChanges: EntityRow[] = [];

  const transport: Transport = async <T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> => {
    if (url === '/api/v1/data') {
      return {
        rev,
        dbId: 'db-test',
        collections: {
          news: initialNews,
          tasks: [],
          settings: initialSettings,
        },
      } as T;
    }
    if (url.startsWith('/api/v1/data/changes')) {
      const changes = pendingChanges;
      pendingChanges = [];
      return { rev, dbId: 'db-test', reset: false, changes } as T;
    }
    if (url === '/api/v1/data/sync') {
      const ops = ((init?.json as any)?.ops || []) as Array<{ c: any; op: 'upsert' | 'delete'; id: string; d?: any; p?: number }>;
      rev += 1;
      const results = ops.map((op) => ({
        ok: true as const,
        row: { c: op.c, id: op.id, v: rev, p: op.p ?? 0, d: op.d, deleted: op.op === 'delete' },
      }));
      return { rev, dbId: 'db-test', results } as T;
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  return {
    transport,
    pushRemoteChanges(rows: EntityRow[]) {
      rev += 1;
      pendingChanges.push(...rows);
    },
  };
}

describe('DataStore.getSnapshot', () => {
  it('returns the exact same reference across repeated reads when unchanged and a new reference after local or remote updates', async () => {
    const mock = createMockTransport(
      [{ c: 'news', id: 'n-1', v: 1, p: 0, d: { id: 'n-1', title: 'Initial' } }],
      [{ c: 'settings', id: '_singleton', v: 1, p: 0, d: { organizationName: 'Madar' } }]
    );

    const store = new DataStore(mock.transport, false);
    await store.start('usr-1');

    // Repeated snapshot reads return the exact same reference (O(1), zero-copy).
    const newsSnap1 = store.getSnapshot<any[]>(NEWS_KEY, []);
    const newsSnap2 = store.getSnapshot<any[]>(NEWS_KEY, []);
    expect(newsSnap1).toBe(newsSnap2);
    expect(newsSnap1).toHaveLength(1);
    expect(newsSnap1[0].title).toBe('Initial');

    const tasksSnap1 = store.getSnapshot<any[]>(TASKS_KEY, []);
    const tasksSnap2 = store.getSnapshot<any[]>(TASKS_KEY, []);
    expect(tasksSnap1).toBe(tasksSnap2);

    const settingsSnap1 = store.getSnapshot<any>(SETTINGS_KEY, {});
    const settingsSnap2 = store.getSnapshot<any>(SETTINGS_KEY, {});
    expect(settingsSnap1).toBe(settingsSnap2);

    // get() still deep-clones so callers can mutate freely without corrupting snapshots.
    const clonedNews = store.get<any[]>(NEWS_KEY, []);
    expect(clonedNews).not.toBe(newsSnap1);
    clonedNews[0].title = 'Mutated Locally Without Set';
    expect(store.getSnapshot<any[]>(NEWS_KEY, [])[0].title).toBe('Initial');

    // Local set() produces a new reference for the modified collection only.
    store.set(NEWS_KEY, [{ id: 'n-1', title: 'Updated Locally' }]);
    const newsSnap3 = store.getSnapshot<any[]>(NEWS_KEY, []);
    expect(newsSnap3).not.toBe(newsSnap1);
    expect(newsSnap3[0].title).toBe('Updated Locally');
    expect(store.getSnapshot<any[]>(TASKS_KEY, [])).toBe(tasksSnap1);
    await store.settle();

    // Remote pull updating an existing row in-place MUST produce a new array reference.
    const newsBeforeRemoteEdit = store.getSnapshot<any[]>(NEWS_KEY, []);
    mock.pushRemoteChanges([{ c: 'news', id: 'n-1', v: 10, p: 0, d: { id: 'n-1', title: 'Updated Remotely' } }]);
    await store.pull();
    const newsAfterRemoteEdit = store.getSnapshot<any[]>(NEWS_KEY, []);
    expect(newsAfterRemoteEdit).not.toBe(newsBeforeRemoteEdit);
    expect(newsAfterRemoteEdit[0].title).toBe('Updated Remotely');
    expect(newsBeforeRemoteEdit[0].title).toBe('Updated Locally');
    expect(store.getSnapshot<any[]>(TASKS_KEY, [])).toBe(tasksSnap1);

    // Remote pull inserting a new row MUST produce a new array reference.
    mock.pushRemoteChanges([{ c: 'news', id: 'n-2', v: 11, p: 1, d: { id: 'n-2', title: 'Inserted Remotely' } }]);
    await store.pull();
    const newsAfterRemoteInsert = store.getSnapshot<any[]>(NEWS_KEY, []);
    expect(newsAfterRemoteInsert).not.toBe(newsAfterRemoteEdit);
    expect(newsAfterRemoteInsert).toHaveLength(2);
    expect(newsAfterRemoteEdit).toHaveLength(1);

    // Remote pull deleting a row MUST produce a new array reference.
    mock.pushRemoteChanges([{ c: 'news', id: 'n-2', v: 12, p: 1, d: null, deleted: true }]);
    await store.pull();
    const newsAfterRemoteDelete = store.getSnapshot<any[]>(NEWS_KEY, []);
    expect(newsAfterRemoteDelete).not.toBe(newsAfterRemoteInsert);
    expect(newsAfterRemoteDelete).toHaveLength(1);

    // Remote pull updating a singleton MUST produce a new object reference.
    mock.pushRemoteChanges([{ c: 'settings', id: '_singleton', v: 13, p: 0, d: { organizationName: 'Madar Pro' } }]);
    await store.pull();
    const settingsSnap3 = store.getSnapshot<any>(SETTINGS_KEY, {});
    expect(settingsSnap3).not.toBe(settingsSnap1);
    expect(settingsSnap3.organizationName).toBe('Madar Pro');

    store.stop();
  });
});
