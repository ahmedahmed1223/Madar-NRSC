import {
  APPEND_ONLY_COLLECTIONS,
  COLLECTIONS,
  COLLECTION_NAMES,
  CollectionName,
  EntityRow,
  SINGLETON_ID,
  SyncOp,
  SyncOpResult,
  collectionForStorageKey,
} from '../shared/collections';
import { ApiError, apiFetch } from './http';

interface RowMeta {
  /** Server version; 0 while a locally created row awaits its first acknowledgement. */
  v: number;
  p: number;
  /** JSON of the last state known to match the server (used for change detection). */
  json: string;
}

export type DataStoreEvent =
  | { type: 'data-changed'; collections: CollectionName[]; remote: boolean }
  | { type: 'sync-error'; code: string; message: string; collection: CollectionName }
  | {
      type: 'sync-status';
      pending: number;
      /** The server answered the last request (false after a failed attempt or a dropped stream). */
      online: boolean;
      /** What the browser reports (navigator.onLine). */
      browserOnline?: boolean;
      /** When the next automatic retry is due (epoch ms), or null when none is scheduled. */
      retryAt?: number | null;
    }
  /** The server answered from a different database than before (several copies behind one address). */
  | { type: 'storage-warning'; message: string };

export interface WriteOutcome {
  ok: boolean;
  /** Still waiting for the server when the wait ended (kept and retried in the background). */
  pending?: boolean;
  /**
   * There is no connection: the write is stored on this device and will be sent automatically
   * once the connection is back. Always comes with `pending: true`.
   */
  queued?: boolean;
  message?: string;
}

/** Said to the user when a write waits on this device for the connection to come back. */
export const QUEUED_MESSAGE = 'محفوظ على جهازك — سيُرسل تلقائياً عند عودة الاتصال.';
const QUEUED_OUTCOME: WriteOutcome = { ok: false, pending: true, queued: true, message: QUEUED_MESSAGE };

/** Browser connectivity as seen by the sync layer; injectable for tests. */
export interface Connectivity {
  isOnline(): boolean;
  /** Calls back on the browser's online/offline events; returns an unsubscribe function. */
  subscribe(listener: (online: boolean) => void): () => void;
}

const browserConnectivity: Connectivity = {
  // Node (tests, SSR) has no navigator.onLine: treat as online.
  isOnline: () => typeof navigator === 'undefined' || (navigator as Navigator).onLine !== false,
  subscribe(listener) {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return () => undefined;
    const on = () => listener(true);
    const off = () => listener(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  },
};

export interface DataStoreOptions {
  connectivity?: Connectivity;
  /** Source of randomness for retry jitter (0 ≤ x < 1). */
  random?: () => number;
}

/** First retry after a failed sync, doubled on each further failure… */
export const RETRY_BASE_MS = 1000;
/** …up to this cap. */
export const RETRY_MAX_MS = 60_000;
/** While the browser says it is offline, one probe this often in case navigator.onLine is wrong. */
export const OFFLINE_PROBE_MS = 60_000;

type AttemptResult = 'ok' | 'again' | 'network' | 'server' | 'auth' | 'idle';

type Listener = (event: DataStoreEvent) => void;

interface PersistedPending {
  userId: string;
  ops: SyncOp[];
}

const PENDING_KEY = 'nrcs_pending_sync_v3';
const JOURNAL_KEY = 'nrcs_recent_writes_v1';
/** Writes the server confirmed recently, kept to resend if it later answers from older data. */
const JOURNAL_MS = 30 * 60_000;
const JOURNAL_MAX = 300;

interface JournalEntry {
  c: CollectionName;
  id: string;
  op: 'upsert' | 'delete';
  d?: any;
  p?: number;
  /** Row version the server gave this write. */
  v: number;
  at: number;
}

interface PersistedJournal {
  userId: string;
  /** Database and revision the entries were confirmed by. */
  dbId: string | null;
  rev: number;
  entries: JournalEntry[];
}
const BATCH_SIZE = 200;
const POLL_FALLBACK_MS = 30_000;

const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const keyOf = (c: CollectionName, id: string) => `${c}\u0000${id}`;

/**
 * Browser-side mirror of the server's SQLite collections.
 *
 * Reads are synchronous (from memory) so the existing views keep working unchanged.
 * Writes are diffed per row, applied optimistically, and pushed to the server in batches
 * with the row version they were based on. If another user changed the row in the
 * meantime the server answers CONFLICT and the local copy is replaced by the latest one.
 * Other users' changes arrive through Server-Sent Events (with a polling fallback).
 */
export type Transport = <T>(url: string, init?: RequestInit & { json?: unknown }) => Promise<T>;

export class DataStore {
  /** `transport` is injectable so tests can run several independent users in one process. */
  constructor(private request: Transport = apiFetch, private realtime = true, options: DataStoreOptions = {}) {
    this.connectivity = options.connectivity ?? browserConnectivity;
    this.random = options.random ?? Math.random;
  }

  private connectivity: Connectivity;
  private random: () => number;

  private data = new Map<CollectionName, any>();
  private meta = new Map<CollectionName, Map<string, RowMeta>>();
  private dirty = new Map<string, { c: CollectionName; id: string; op: 'upsert' | 'delete' }>();
  private inFlight = new Set<string>();
  private listeners = new Set<Listener>();
  private rev = 0;
  private userId: string | null = null;
  private ready = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  /** The one scheduled retry after a failure (or the offline probe). */
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryAt: number | null = null;
  /** Consecutive failed sync attempts; drives the exponential backoff. */
  private failures = 0;
  private lastFailure: Exclude<AttemptResult, 'ok' | 'again' | 'idle'> | null = null;
  /** The single sync request in flight, if any. */
  private syncing: Promise<void> | null = null;
  private attemptListeners = new Set<() => void>();
  private unsubscribeConnectivity: (() => void) | null = null;
  private online = true;
  private pulling = false;
  private pullAgain = false;
  private eventSource: EventSource | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  /** Identity of the server database; a change means the deployment serves several copies. */
  private dbId: string | null = null;
  /** After a malformed batch, ops are sent one by one so a single bad op cannot sink the rest. */
  private singleOps = 0;
  private waiters = new Map<string, ((o: WriteOutcome) => void)[]>();
  private lastErrorAt = 0;
  /** Set when a response came from another database: the next pull reloads everything. */
  private dbSwitched = false;
  private journal = new Map<string, JournalEntry>();
  private journalDbId: string | null = null;
  private journalRev = 0;

  /**
   * Resolves once the server has accepted or refused the pending write of this row, so forms
   * can report success only when the data is really stored (and keep their input otherwise).
   */
  awaitWrite(c: CollectionName, id: string, timeoutMs = 12_000): Promise<WriteOutcome> {
    const k = keyOf(c, id);
    if (!this.hasPendingWrite(c, id)) return Promise.resolve({ ok: true });
    // No connection: say so at once instead of waiting; the write stays queued on this device.
    if (this.waitingForConnection()) return Promise.resolve({ ...QUEUED_OUTCOME });
    return new Promise((resolve) => {
      const done = (o: WriteOutcome) => {
        clearTimeout(timer);
        resolve(o);
      };
      const timer = setTimeout(() => {
        const list = this.waiters.get(k) || [];
        this.waiters.set(k, list.filter((f) => f !== done));
        resolve({ ok: false, pending: true, message: 'لم يؤكد الخادم الحفظ بعد؛ سيُعاد الإرسال تلقائياً ولن يُفقد ما كتبته.' });
      }, timeoutMs);
      this.waiters.set(k, [...(this.waiters.get(k) || []), done]);
      this.scheduleFlush(0);
    });
  }

  hasPendingWrite(c: CollectionName, id: string): boolean {
    const key = keyOf(c, id);
    return this.dirty.has(key) || this.inFlight.has(key);
  }

  private settleWaiters(k: string, outcome: WriteOutcome) {
    const list = this.waiters.get(k);
    if (!list) return;
    this.waiters.delete(k);
    list.forEach((f) => f(outcome));
  }

  /** Every write still waiting is kept on this device: tell its form now. */
  private settleAllWaitersQueued() {
    for (const k of [...this.waiters.keys()]) this.settleWaiters(k, { ...QUEUED_OUTCOME });
  }

  /** True while writes cannot reach the server: the browser is offline or the last attempt hit the network. */
  private waitingForConnection() {
    return !this.connectivity.isOnline() || (this.retryTimer !== null && this.lastFailure === 'network');
  }

  private checkDb(dbId: unknown) {
    if (typeof dbId !== 'string' || !dbId) return;
    if (this.dbId && this.dbId !== dbId) {
      this.dbSwitched = true;
      void this.pull();
      this.emit({
        type: 'storage-warning',
        message:
          'الخادم أجاب من قاعدة بيانات مختلفة عن السابقة: هذا النشر يشغّل أكثر من نسخة من النظام بتخزين غير مشترك، فقد تختفي تعديلات. على مدير النظام تشغيل نسخة واحدة بقرص دائم.',
      });
    }
    this.dbId = dbId;
  }

  isReady() {
    return this.ready;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: DataStoreEvent) {
    this.listeners.forEach((l) => {
      try {
        l(event);
      } catch (err) {
        console.error('[DataStore] listener error', err);
      }
    });
  }

  pendingCount() {
    return this.dirty.size + this.inFlight.size;
  }

  isServerOnline() {
    return this.online;
  }

  /** Snapshot for status chips: what waits, whether the server answers, and when the next retry is. */
  syncState() {
    return { pending: this.pendingCount(), online: this.online, browserOnline: this.connectivity.isOnline(), retryAt: this.retryAt };
  }

  /** Versions may be compared with an offline packet only while all source records are synchronized. */
  synchronizedVersions(userId: string, sources: { collection: CollectionName; id: string }[], check: { collection: CollectionName; id: string }) {
    if (!this.ready || !this.dbId || this.userId !== userId || !this.online || !this.connectivity.isOnline() || this.dbSwitched) return null;
    const isPending = ({ collection, id }: { collection: CollectionName; id: string }) => {
      const key = keyOf(collection, id);
      return this.dirty.has(key) || this.inFlight.has(key);
    };
    if ([...sources, check].some(isPending)) return null;
    const versions = sources.map(({ collection, id }) => this.meta.get(collection)?.get(id)?.v || 0);
    if (versions.some(version => version === 0)) return null;
    return { dbId: this.dbId, versions };
  }

  private emitStatus() {
    this.emit({ type: 'sync-status', ...this.syncState() });
  }

  // --- Lifecycle -------------------------------------------------------------

  private starting: Promise<void> | null = null;

  /** Idempotent per user (React StrictMode mounts effects twice in development). */
  start(userId: string): Promise<void> {
    if (this.starting && this.userId === userId) return this.starting;
    if (this.userId && this.userId !== userId) this.stop();
    this.userId = userId;
    this.starting = (async () => {
      this.loadJournal();
      this.watchConnectivity();
      await this.bootstrap();
      this.replayPersistedPending();
      this.connectRealtime();
    })().catch((err) => {
      this.starting = null;
      throw err;
    });
    return this.starting;
  }

  stop() {
    this.eventSource?.close();
    this.eventSource = null;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    this.clearRetry();
    this.failures = 0;
    this.lastFailure = null;
    this.unsubscribeConnectivity?.();
    this.unsubscribeConnectivity = null;
    this.data.clear();
    this.meta.clear();
    this.dirty.clear();
    this.inFlight.clear();
    this.ready = false;
    this.userId = null;
    this.starting = null;
    this.rev = 0;
  }

  private async bootstrap() {
    const res = await this.request<{ rev: number; dbId?: string; collections: Partial<Record<CollectionName, EntityRow[]>> }>('/api/v1/data');
    this.checkDb(res.dbId);
    // Unsent local edits survive a full reload: they are laid back over the server copy.
    const pendingKeys = [...this.dirty.keys(), ...this.inFlight];
    const pending = pendingKeys
      .map((k) => {
        const [c, id] = k.split('\u0000') as [CollectionName, string];
        const m = this.meta.get(c)?.get(id);
        return m ? { c, id, m } : null;
      })
      .filter(Boolean) as { c: CollectionName; id: string; m: RowMeta }[];
    this.data.clear();
    this.meta.clear();
    for (const name of COLLECTION_NAMES) {
      const rows = res.collections[name] || [];
      const metaMap = new Map<string, RowMeta>();
      rows.forEach((r) => metaMap.set(r.id, { v: r.v, p: r.p, json: JSON.stringify(r.d) }));
      this.meta.set(name, metaMap);
      if (COLLECTIONS[name].kind === 'singleton') {
        this.data.set(name, rows[0]?.d ?? null);
      } else {
        this.data.set(name, rows.map((r) => r.d));
      }
    }
    this.rev = res.rev;
    this.ready = true;
    this.recoverRecentWrites(res.rev, res.dbId ?? null);
    for (const { c, id, m } of pending) {
      if (!this.meta.has(c)) continue;
      this.replaceLocal(c, { c, id, v: m.v, p: m.p, d: JSON.parse(m.json) });
    }
  }

  private watchConnectivity() {
    if (this.unsubscribeConnectivity) return;
    this.unsubscribeConnectivity = this.connectivity.subscribe((online) => this.onConnectivityChange(online));
  }

  /** Browser went offline: stop trying (bar a rare probe). Back online: resume at once. */
  private onConnectivityChange(online: boolean) {
    if (!this.userId) return;
    if (!online) {
      // The stream would otherwise reconnect every few seconds into the void.
      this.eventSource?.close();
      this.eventSource = null;
      this.setOnline(false);
      this.settleAllWaitersQueued();
      if (this.dirty.size > 0 || this.inFlight.size > 0) this.scheduleRetry();
      this.emitStatus();
      return;
    }
    // A fresh connection: start the backoff over, with a little jitter so a whole newsroom
    // coming back at once does not hit the server in the same millisecond.
    this.failures = 0;
    this.clearRetry();
    if (this.realtime && !this.eventSource) this.openStream();
    if (this.dirty.size > 0) this.scheduleFlush(Math.round(this.random() * RETRY_BASE_MS));
    void this.pull();
    this.emitStatus();
  }

  private connectRealtime() {
    if (!this.realtime) return;
    if (this.connectivity.isOnline()) this.openStream();
    // Safety net for proxies that buffer SSE.
    this.pollTimer = setInterval(() => void this.pull(), POLL_FALLBACK_MS);
  }

  private openStream() {
    if (typeof EventSource !== 'undefined') {
      this.eventSource = new EventSource('/api/v1/data/stream', { withCredentials: true });
      this.eventSource.addEventListener('rev', (e) => {
        const remoteRev = Number((e as MessageEvent).data);
        if (Number.isFinite(remoteRev) && remoteRev !== this.rev) void this.pull();
      });
      this.eventSource.onopen = () => {
        this.setOnline(true);
        void this.pull();
      };
      this.eventSource.onerror = () => this.setOnline(false);
    }
  }

  private setOnline(online: boolean) {
    if (this.online === online) return;
    this.online = online;
    this.emitStatus();
    if (!online || this.dirty.size === 0) return;
    if (this.retryTimer && this.lastFailure === 'network') {
      // The server answered another request: the network is back, so retry soon. The failure
      // count is kept, so if this attempt fails too the next wait is still longer.
      this.clearRetry();
      this.scheduleFlush(Math.round(this.random() * RETRY_BASE_MS));
    } else if (!this.retryTimer) this.scheduleFlush(0);
  }

  // --- Synchronous access (used by ApiService) ------------------------------

  /** Deep copy, so callers may mutate freely before calling set(). */
  get<T>(storageKey: string, fallback: T): T {
    const c = collectionForStorageKey(storageKey);
    if (!c) return fallback;
    const value = this.data.get(c);
    if (value === undefined || value === null) {
      return COLLECTIONS[c].kind === 'list' ? ([] as unknown as T) : fallback;
    }
    return clone(value) as T;
  }

  set<T>(storageKey: string, value: T) {
    const c = collectionForStorageKey(storageKey);
    if (!c) throw new Error(`Unknown collection key ${storageKey}`);
    if (!this.ready) throw new Error('البيانات لم تُحمّل بعد من الخادم');
    const metaMap = this.meta.get(c)!;

    if (COLLECTIONS[c].kind === 'singleton') {
      const json = JSON.stringify(value);
      const m = metaMap.get(SINGLETON_ID);
      if (m?.json === json) return;
      metaMap.set(SINGLETON_ID, { v: m?.v ?? 0, p: 0, json });
      this.data.set(c, clone(value));
      this.markDirty(c, SINGLETON_ID, 'upsert');
      this.afterLocalChange(c);
      return;
    }

    const next = (Array.isArray(value) ? value : []).filter((it: any) => it && typeof it.id === 'string');
    const seen = new Set<string>();
    let lastP: number | undefined;
    next.forEach((item: any, idx: number) => {
      seen.add(item.id);
      const json = JSON.stringify(item);
      const m = metaMap.get(item.id);
      if (m) {
        lastP = m.p;
        if (m.json !== json) {
          metaMap.set(item.id, { ...m, json });
          this.markDirty(c, item.id, 'upsert');
        }
        return;
      }
      // New row: place it between its neighbours so everyone sees the same order.
      const following = next.slice(idx + 1).find((n: any) => metaMap.has(n.id));
      const nextP = following ? metaMap.get(following.id)!.p : undefined;
      let p: number;
      if (lastP === undefined) p = nextP === undefined ? 0 : nextP - 1;
      else p = nextP === undefined ? lastP + 1 : (lastP + nextP) / 2;
      lastP = p;
      metaMap.set(item.id, { v: 0, p, json });
      this.markDirty(c, item.id, 'upsert');
    });

    // Safety net: callers often read a list without soft-deleted rows and write it back.
    // Such rows must survive (trash / restore), so a missing soft-deleted row is kept, not deleted.
    const previous: any[] = this.data.get(c) || [];
    const keptSoftDeleted = previous.filter((it) => it && it.deletedAt && !seen.has(it.id));
    keptSoftDeleted.forEach((it) => seen.add(it.id));
    if (keptSoftDeleted.length) next.push(...keptSoftDeleted);

    for (const id of [...metaMap.keys()]) {
      if (seen.has(id)) continue;
      metaMap.delete(id);
      // Logs are append-only on the server; trimming them locally is purely cosmetic.
      if (!APPEND_ONLY_COLLECTIONS.has(c)) this.markDirty(c, id, 'delete');
      else this.dirty.delete(keyOf(c, id));
    }

    this.data.set(c, clone(next));
    this.afterLocalChange(c);
  }

  private afterLocalChange(c: CollectionName) {
    this.persistPending();
    this.emitStatus();
    this.scheduleFlush(30);
    this.emit({ type: 'data-changed', collections: [c], remote: false });
  }

  private markDirty(c: CollectionName, id: string, op: 'upsert' | 'delete') {
    this.dirty.set(keyOf(c, id), { c, id, op });
  }

  // --- Push -----------------------------------------------------------------

  /** Short delay before sending (batches quick edits); never preempts a scheduled retry. */
  private scheduleFlush(delay: number) {
    if (this.flushTimer || this.retryTimer) return;
    if (!this.connectivity.isOnline()) {
      this.scheduleRetry(false);
      return;
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      if (!this.connectivity.isOnline()) this.scheduleRetry(false);
      else void this.runOnce();
    }, delay);
  }

  private clearRetry() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.retryAt = null;
  }

  /** Delay before the next automatic attempt: 1s, 2s, 4s … capped at 60s, with jitter. */
  private retryDelay() {
    const base = this.connectivity.isOnline() ? Math.min(RETRY_BASE_MS * 2 ** Math.max(0, this.failures - 1), RETRY_MAX_MS) : OFFLINE_PROBE_MS;
    // "Equal jitter": somewhere between half and all of the base delay.
    return Math.round(base / 2 + this.random() * (base / 2));
  }

  /** Schedules the single retry timer. `replace` moves an existing one (after a new failure). */
  private scheduleRetry(replace = true) {
    if (this.retryTimer && !replace) return;
    this.clearRetry();
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    const delay = this.retryDelay();
    this.retryAt = Date.now() + delay;
    // Runs even when the browser says offline: that is the probe in case navigator.onLine is wrong.
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.retryAt = null;
      void this.runOnce();
    }, delay);
  }

  /** Resolves when the next sync attempt finishes, or after `ms`. */
  private nextAttempt(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.attemptListeners.delete(done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      this.attemptListeners.add(done);
    });
  }

  /**
   * Starts one sync request unless one is already in flight (then returns that one).
   * There is never more than one request at a time; what follows it is decided in `afterAttempt`.
   */
  private runOnce(): Promise<void> {
    if (this.syncing) return this.syncing;
    if (!this.ready || this.dirty.size === 0) return Promise.resolve();
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.clearRetry();
    let result: AttemptResult = 'idle';
    this.syncing = this.sendBatch()
      .then((r) => {
        result = r;
      })
      .finally(() => {
        this.syncing = null;
        this.afterAttempt(result);
        this.attemptListeners.forEach((f) => f());
      });
    return this.syncing;
  }

  private afterAttempt(result: AttemptResult) {
    switch (result) {
      case 'ok':
        this.failures = 0;
        this.lastFailure = null;
        if (this.dirty.size > 0) this.scheduleFlush(0);
        break;
      case 'again':
        if (this.dirty.size > 0) this.scheduleFlush(0);
        break;
      case 'network':
      case 'server':
        this.failures++;
        this.lastFailure = result;
        this.scheduleRetry();
        break;
      case 'auth':
        // The shell asks the user to sign in again; changes stay queued until the next edit or flush.
        this.lastFailure = 'auth';
        break;
    }
    this.emitStatus();
  }

  private buildOp(c: CollectionName, id: string, op: 'upsert' | 'delete'): SyncOp {
    const m = this.meta.get(c)?.get(id);
    if (op === 'delete') return { c, op, id, baseV: undefined };
    const baseV = m && m.v > 0 ? m.v : undefined;
    return { c, op, id, d: m ? JSON.parse(m.json) : undefined, p: m?.p, baseV };
  }

  /**
   * Pushes everything pending and waits until the server has answered (or the timeout passes).
   * Returns false at once when there is no connection: the writes stay queued on this device.
   */
  async settle(timeoutMs = 10_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (this.pendingCount() > 0) {
      if (this.syncing) {
        await this.syncing;
        continue;
      }
      if (this.waitingForConnection() || this.lastFailure === 'auth') return false;
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      if (this.flushTimer || this.retryTimer) {
        await this.nextAttempt(remaining);
        continue;
      }
      if (!this.ready || this.dirty.size === 0) break;
      await this.runOnce();
    }
    return this.pendingCount() === 0;
  }

  /**
   * Sends pending rows now. Waits for a request already in flight instead of starting a second
   * one. Without a connection, or while waiting out a retry delay, it does nothing unless
   * `force` is set (an explicit "retry now" from the user).
   */
  async flush(opts: { force?: boolean } = {}): Promise<void> {
    if (this.syncing) await this.syncing;
    if (!this.ready || this.dirty.size === 0) return;
    if (!opts.force && (!this.connectivity.isOnline() || this.retryTimer)) return;
    await this.runOnce();
  }

  /** One request with the next batch of dirty rows; never throws. */
  private async sendBatch(): Promise<AttemptResult> {
    const entries = [...this.dirty.entries()].slice(0, this.singleOps > 0 ? 1 : BATCH_SIZE);
    if (entries.length === 0) return 'idle';

    const ops = entries.map(([, e]) => this.buildOp(e.c, e.id, e.op));
    entries.forEach(([k]) => {
      this.dirty.delete(k);
      this.inFlight.add(k);
    });

    try {
      const res = await this.request<{ rev: number; dbId?: string; results: SyncOpResult[] }>('/api/v1/data/sync', { method: 'POST', json: { ops } });
      this.checkDb(res.dbId);
      if (this.singleOps > 0) this.singleOps--;
      this.failures = 0;
      this.lastFailure = null;
      this.setOnline(true);
      const touched = new Set<CollectionName>();
      res.results.forEach((result, i) => this.handleResult(ops[i], result, touched));
      this.recordJournal(ops, res.results, res.rev, res.dbId ?? null);
      entries.forEach(([k]) => this.inFlight.delete(k));
      if (touched.size) this.emit({ type: 'data-changed', collections: [...touched], remote: true });
      return 'ok';
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      // Only a malformed request is final; everything else (404 from a proxy, 5xx, network) is retried.
      const malformed = status === 400 || status === 413 || status === 422;
      entries.forEach(([k, e]) => {
        this.inFlight.delete(k);
        if (!this.dirty.has(k)) this.dirty.set(k, e);
      });
      if (status === 401) return 'auth';
      if (malformed && entries.length > 1) {
        // Isolate the bad op: resend these one at a time.
        this.singleOps = entries.length;
        return 'again';
      }
      if (malformed) {
        const [k, e] = entries[0];
        this.dirty.delete(k);
        if (this.singleOps > 0) this.singleOps--;
        const message = (err as ApiError).message || 'رفض الخادم هذه العملية';
        this.emit({ type: 'sync-error', code: 'INVALID', message, collection: e.c });
        this.settleWaiters(k, { ok: false, message });
        // Realign this row with the server copy.
        void this.pull();
        return 'again';
      }
      this.setOnline(false);
      const network = status === 0;
      // No connection: forms waiting on these rows learn now that the rows are kept on this device.
      if (network) this.settleAllWaitersQueued();
      // Say it once per streak of failures, with the server's reason, without dropping anything.
      // When the browser itself is offline the connection chip already says so.
      if (this.connectivity.isOnline() && Date.now() - this.lastErrorAt > 60_000 && entries[0]) {
        this.lastErrorAt = Date.now();
        const reason = err instanceof ApiError ? err.message : 'تعذر الاتصال بالخادم';
        this.emit({ type: 'sync-error', code: 'RETRY', message: `${reason} — تعديلاتك محفوظة على جهازك وستُرسل تلقائياً عند استجابة الخادم.`, collection: entries[0][1].c });
      }
      return network ? 'network' : 'server';
    } finally {
      this.persistPending();
      this.emitStatus();
    }
  }

  private handleResult(op: SyncOp, result: SyncOpResult, touched: Set<CollectionName>) {
    const metaMap = this.meta.get(op.c)!;
    const k = keyOf(op.c, op.id);
    if (result.ok) {
      const { row } = result as Extract<SyncOpResult, { ok: true }>;
      if (!this.dirty.has(k)) this.settleWaiters(k, { ok: true });
      if (op.op === 'delete' || row.deleted) return;
      const m = metaMap.get(op.id);
      const serverJson = JSON.stringify(row.d);
      if (this.dirty.has(k)) {
        // Edited again while in flight: keep the newer local data, adopt the new version.
        if (m) metaMap.set(op.id, { ...m, v: row.v });
        return;
      }
      metaMap.set(op.id, { v: row.v, p: row.p, json: serverJson });
      if (m?.json !== serverJson) {
        // Server stamped/normalised fields (e.g. log author): adopt its copy.
        this.replaceLocal(op.c, row);
        touched.add(op.c);
      }
      return;
    }

    const failure = result as Extract<SyncOpResult, { ok: false }>;
    this.dirty.delete(k);
    this.settleWaiters(k, { ok: false, message: failure.message });
    this.emit({ type: 'sync-error', code: failure.code, message: failure.message, collection: op.c });
    if (failure.current) this.replaceLocal(op.c, failure.current);
    else this.removeLocal(op.c, op.id);
    touched.add(op.c);
  }

  // --- Pull -----------------------------------------------------------------

  async pull(): Promise<void> {
    // Offline: nothing to fetch; the 'online' event pulls again.
    if (!this.ready || !this.connectivity.isOnline()) return;
    if (this.pulling) {
      this.pullAgain = true;
      return;
    }
    this.pulling = true;
    try {
      const res = await this.request<{ rev: number; dbId?: string; reset: boolean; changes?: EntityRow[] }>(`/api/v1/data/changes?since=${this.rev}`);
      this.checkDb(res.dbId);
      this.setOnline(true);
      if (res.reset || this.dbSwitched) {
        this.dbSwitched = false;
        await this.flush();
        await this.bootstrap();
        this.emit({ type: 'data-changed', collections: [...COLLECTION_NAMES], remote: true });
        return;
      }
      const touched = new Set<CollectionName>();
      for (const row of res.changes || []) {
        if (!this.meta.has(row.c)) continue;
        const k = keyOf(row.c, row.id);
        // Local unsent edits win locally; the server will report a conflict on push.
        if (this.dirty.has(k) || this.inFlight.has(k)) continue;
        const known = this.meta.get(row.c)!.get(row.id);
        if (known && known.v >= row.v && !row.deleted) continue;
        if (row.deleted) this.removeLocal(row.c, row.id);
        else this.replaceLocal(row.c, row);
        touched.add(row.c);
      }
      this.rev = res.rev;
      if (touched.size) this.emit({ type: 'data-changed', collections: [...touched], remote: true });
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) this.setOnline(false);
    } finally {
      this.pulling = false;
      if (this.pullAgain) {
        this.pullAgain = false;
        void this.pull();
      }
    }
  }

  private replaceLocal(c: CollectionName, row: EntityRow) {
    const metaMap = this.meta.get(c)!;
    metaMap.set(row.id, { v: row.v, p: row.p, json: JSON.stringify(row.d) });
    if (COLLECTIONS[c].kind === 'singleton') {
      this.data.set(c, clone(row.d));
      return;
    }
    const list: any[] = this.data.get(c) || [];
    const idx = list.findIndex((it) => it.id === row.id);
    if (idx !== -1) {
      list[idx] = clone(row.d);
      return;
    }
    // Insert by position.
    let at = list.length;
    for (let i = 0; i < list.length; i++) {
      const p = metaMap.get(list[i].id)?.p ?? 0;
      if (p > row.p) {
        at = i;
        break;
      }
    }
    list.splice(at, 0, clone(row.d));
    this.data.set(c, list);
  }

  private removeLocal(c: CollectionName, id: string) {
    this.meta.get(c)?.delete(id);
    if (COLLECTIONS[c].kind === 'singleton') return;
    const list: any[] = this.data.get(c) || [];
    this.data.set(
      c,
      list.filter((it) => it.id !== id)
    );
  }

  // --- Recent-writes journal -------------------------------------------------

  private recordJournal(ops: SyncOp[], results: SyncOpResult[], rev: number, dbId: string | null) {
    const now = Date.now();
    results.forEach((result, i) => {
      if (!result.ok) return;
      const op = ops[i];
      if (op.c === 'editLocks') return;
      const { row } = result as Extract<SyncOpResult, { ok: true }>;
      this.journal.set(keyOf(op.c, op.id), { c: op.c, id: op.id, op: op.op, d: op.op === 'delete' ? undefined : row?.d ?? op.d, p: row?.p ?? op.p, v: row?.v ?? 0, at: now });
    });
    if (dbId && dbId !== this.journalDbId) {
      // Confirmed by another database than the older entries: those were already recovered.
      this.journalDbId = dbId;
      this.journalRev = rev;
    } else this.journalRev = Math.max(this.journalRev, rev);
    this.persistJournal();
  }

  private pruneJournal() {
    const cutoff = Date.now() - JOURNAL_MS;
    for (const [k, e] of this.journal) if (e.at < cutoff) this.journal.delete(k);
    if (this.journal.size > JOURNAL_MAX) {
      const oldest = [...this.journal.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, this.journal.size - JOURNAL_MAX);
      oldest.forEach(([k]) => this.journal.delete(k));
    }
  }

  private persistJournal() {
    if (typeof localStorage === 'undefined' || !this.userId) return;
    this.pruneJournal();
    try {
      const payload: PersistedJournal = { userId: this.userId, dbId: this.journalDbId, rev: this.journalRev, entries: [...this.journal.values()] };
      localStorage.setItem(JOURNAL_KEY, JSON.stringify(payload));
    } catch {
      // Storage full or disabled: the journal still protects this tab.
    }
  }

  private loadJournal() {
    if (typeof localStorage === 'undefined') return;
    try {
      const saved: PersistedJournal | null = JSON.parse(localStorage.getItem(JOURNAL_KEY) || 'null');
      if (!saved || saved.userId !== this.userId || !Array.isArray(saved.entries)) return;
      this.journal = new Map(saved.entries.filter(e => e.c !== 'editLocks').map((e) => [keyOf(e.c, e.id), e]));
      this.journalDbId = saved.dbId;
      this.journalRev = saved.rev || 0;
      this.pruneJournal();
    } catch {
      // unreadable: start a new journal
    }
  }

  /**
   * The server answered from another database, or from an older copy of the same one (a
   * restarted instance, a second instance with its own disk, a restored backup). Writes it
   * confirmed in the last half hour that this copy lacks are sent again instead of vanishing.
   */
  private recoverRecentWrites(serverRev: number, serverDbId: string | null) {
    this.pruneJournal();
    if (this.journal.size === 0 || !this.journalDbId) return;
    const rewound = (serverDbId && serverDbId !== this.journalDbId) || serverRev < this.journalRev;
    if (!rewound) return;
    let resent = 0;
    for (const e of this.journal.values()) {
      if (!this.meta.has(e.c)) continue;
      const k = keyOf(e.c, e.id);
      if (this.dirty.has(k) || this.inFlight.has(k)) continue;
      const known = this.meta.get(e.c)!.get(e.id);
      if (e.op === 'delete') {
        if (!known || known.v >= e.v) continue;
        this.removeLocal(e.c, e.id);
        this.markDirty(e.c, e.id, 'delete');
      } else {
        if (known && known.v >= e.v) continue;
        // Based on this copy's version (or new here), so the server accepts it as the latest edit.
        this.replaceLocal(e.c, { c: e.c, id: e.id, v: known?.v ?? 0, p: e.p ?? known?.p ?? 0, d: e.d });
        this.markDirty(e.c, e.id, 'upsert');
      }
      resent++;
    }
    this.journalDbId = serverDbId;
    this.journalRev = serverRev;
    this.persistJournal();
    if (resent > 0) {
      this.emit({
        type: 'storage-warning',
        message: `أجاب الخادم من نسخة بيانات أقدم لا تحتوي ${resent} من تعديلاتك الأخيرة، فأُعيد إرسالها تلقائياً. إن تكرر هذا فالنشر يشغّل أكثر من نسخة بتخزين غير دائم؛ على مدير النظام ضبط نسخة واحدة بقرص دائم.`,
      });
      this.scheduleFlush(0);
    }
  }

  // --- Durability across reloads -------------------------------------------

  private persistPending() {
    if (typeof localStorage === 'undefined' || !this.userId) return;
    try {
      const keys = [...this.dirty.values(), ...[...this.inFlight].map((k) => {
        const [c, id] = k.split('\u0000') as [CollectionName, string];
        return { c, id, op: this.meta.get(c)?.has(id) ? ('upsert' as const) : ('delete' as const) };
      })].filter(e => e.c !== 'editLocks' || e.op === 'delete');
      if (keys.length === 0) {
        localStorage.removeItem(PENDING_KEY);
        return;
      }
      const payload: PersistedPending = { userId: this.userId, ops: keys.map((e) => this.buildOp(e.c, e.id, e.op)) };
      localStorage.setItem(PENDING_KEY, JSON.stringify(payload));
    } catch {
      // Storage full or disabled: changes are still retried while the tab stays open.
    }
  }

  private replayPersistedPending() {
    if (typeof localStorage === 'undefined') return;
    let saved: PersistedPending | null = null;
    try {
      saved = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null');
    } catch {
      saved = null;
    }
    localStorage.removeItem(PENDING_KEY);
    if (!saved || saved.userId !== this.userId || !Array.isArray(saved.ops) || saved.ops.length === 0) return;

    const touched = new Set<CollectionName>();
    for (const op of saved.ops) {
      // Leases belong to the open editor, never to recovered content drafts.
      if (op.c === 'editLocks' && op.op !== 'delete') continue;
      if (!this.meta.has(op.c)) continue;
      const metaMap = this.meta.get(op.c)!;
      const known = metaMap.get(op.id);
      if (op.op === 'delete') {
        if (!known) continue;
        this.removeLocal(op.c, op.id);
      } else {
        // Keep the version the edit was based on so stale edits surface as conflicts.
        const row: EntityRow = { c: op.c, id: op.id, v: op.baseV ?? 0, p: op.p ?? known?.p ?? 0, d: op.d };
        this.replaceLocal(op.c, row);
      }
      this.markDirty(op.c, op.id, op.op);
      touched.add(op.c);
    }
    if (touched.size) {
      this.emit({ type: 'data-changed', collections: [...touched], remote: false });
      this.scheduleFlush(0);
    }
  }
}

export const dataStore = new DataStore();
