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
  | { type: 'sync-status'; pending: number; online: boolean }
  /** The server answered from a different database than before (several copies behind one address). */
  | { type: 'storage-warning'; message: string };

export interface WriteOutcome {
  ok: boolean;
  /** Still waiting for the server when the wait ended (kept and retried in the background). */
  pending?: boolean;
  message?: string;
}

type Listener = (event: DataStoreEvent) => void;

interface PersistedPending {
  userId: string;
  ops: SyncOp[];
}

const PENDING_KEY = 'nrcs_pending_sync_v3';
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
  constructor(private request: Transport = apiFetch, private realtime = true) {}

  private data = new Map<CollectionName, any>();
  private meta = new Map<CollectionName, Map<string, RowMeta>>();
  private dirty = new Map<string, { c: CollectionName; id: string; op: 'upsert' | 'delete' }>();
  private inFlight = new Set<string>();
  private listeners = new Set<Listener>();
  private rev = 0;
  private userId: string | null = null;
  private ready = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private retryDelay = 1000;
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

  /**
   * Resolves once the server has accepted or refused the pending write of this row, so forms
   * can report success only when the data is really stored (and keep their input otherwise).
   */
  awaitWrite(c: CollectionName, id: string, timeoutMs = 12_000): Promise<WriteOutcome> {
    const k = keyOf(c, id);
    if (!this.dirty.has(k) && !this.inFlight.has(k)) return Promise.resolve({ ok: true });
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

  private settleWaiters(k: string, outcome: WriteOutcome) {
    const list = this.waiters.get(k);
    if (!list) return;
    this.waiters.delete(k);
    list.forEach((f) => f(outcome));
  }

  private checkDb(dbId: unknown) {
    if (typeof dbId !== 'string' || !dbId) return;
    if (this.dbId && this.dbId !== dbId) {
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

  private emitStatus() {
    this.emit({ type: 'sync-status', pending: this.pendingCount(), online: this.online });
  }

  // --- Lifecycle -------------------------------------------------------------

  private starting: Promise<void> | null = null;

  /** Idempotent per user (React StrictMode mounts effects twice in development). */
  start(userId: string): Promise<void> {
    if (this.starting && this.userId === userId) return this.starting;
    if (this.userId && this.userId !== userId) this.stop();
    this.userId = userId;
    this.starting = (async () => {
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
    for (const { c, id, m } of pending) {
      if (!this.meta.has(c)) continue;
      this.replaceLocal(c, { c, id, v: m.v, p: m.p, d: JSON.parse(m.json) });
    }
  }

  private connectRealtime() {
    if (!this.realtime) return;
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
    // Safety net for proxies that buffer SSE.
    this.pollTimer = setInterval(() => void this.pull(), POLL_FALLBACK_MS);
  }

  private setOnline(online: boolean) {
    if (this.online === online) return;
    this.online = online;
    this.emitStatus();
    if (online) this.scheduleFlush(0);
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

  private scheduleFlush(delay: number) {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, delay);
  }

  private buildOp(c: CollectionName, id: string, op: 'upsert' | 'delete'): SyncOp {
    const m = this.meta.get(c)?.get(id);
    if (op === 'delete') return { c, op, id, baseV: undefined };
    const baseV = m && m.v > 0 ? m.v : undefined;
    return { c, op, id, d: m ? JSON.parse(m.json) : undefined, p: m?.p, baseV };
  }

  /** Pushes everything pending and waits until the server has answered (or the timeout passes). */
  async settle(timeoutMs = 10_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (this.pendingCount() > 0 && Date.now() < deadline) {
      await this.flush();
      if (this.pendingCount() > 0) await new Promise((r) => setTimeout(r, 100));
    }
    return this.pendingCount() === 0;
  }

  /** Sends dirty rows; rows already in flight wait for the next round. */
  async flush(): Promise<void> {
    if (!this.ready || this.inFlight.size > 0) return;
    const entries = [...this.dirty.entries()].slice(0, this.singleOps > 0 ? 1 : BATCH_SIZE);
    if (entries.length === 0) return;

    const ops = entries.map(([, e]) => this.buildOp(e.c, e.id, e.op));
    entries.forEach(([k]) => {
      this.dirty.delete(k);
      this.inFlight.add(k);
    });

    try {
      const res = await this.request<{ rev: number; dbId?: string; results: SyncOpResult[] }>('/api/v1/data/sync', { method: 'POST', json: { ops } });
      this.checkDb(res.dbId);
      this.retryDelay = 1000;
      if (this.singleOps > 0) this.singleOps--;
      this.setOnline(true);
      const touched = new Set<CollectionName>();
      res.results.forEach((result, i) => this.handleResult(ops[i], result, touched));
      entries.forEach(([k]) => this.inFlight.delete(k));
      if (touched.size) this.emit({ type: 'data-changed', collections: [...touched], remote: true });
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      // Only a malformed request is final; everything else (404 from a proxy, 5xx, network) is retried.
      const malformed = status === 400 || status === 413 || status === 422;
      entries.forEach(([k, e]) => {
        this.inFlight.delete(k);
        if (!this.dirty.has(k)) this.dirty.set(k, e);
      });
      if (status === 401) return; // shell handles re-login; changes stay pending
      if (malformed && entries.length > 1) {
        // Isolate the bad op: resend these one at a time.
        this.singleOps = entries.length;
        this.scheduleFlush(0);
        return;
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
        return;
      }
      this.setOnline(false);
      // Say it once per streak of failures, with the server's reason, without dropping anything.
      if (Date.now() - this.lastErrorAt > 60_000 && entries[0]) {
        this.lastErrorAt = Date.now();
        const reason = err instanceof ApiError ? err.message : 'تعذر الاتصال بالخادم';
        this.emit({ type: 'sync-error', code: 'RETRY', message: `${reason} — تعديلاتك محفوظة على هذا الجهاز وستُرسل تلقائياً عند استجابة الخادم.`, collection: entries[0][1].c });
      }
      this.retryDelay = Math.min(this.retryDelay * 2, 30_000);
      setTimeout(() => this.scheduleFlush(0), this.retryDelay);
    } finally {
      this.persistPending();
      this.emitStatus();
    }
    if (this.dirty.size > 0) this.scheduleFlush(0);
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
    if (!this.ready) return;
    if (this.pulling) {
      this.pullAgain = true;
      return;
    }
    this.pulling = true;
    try {
      const res = await this.request<{ rev: number; dbId?: string; reset: boolean; changes?: EntityRow[] }>(`/api/v1/data/changes?since=${this.rev}`);
      this.checkDb(res.dbId);
      this.setOnline(true);
      if (res.reset) {
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

  // --- Durability across reloads -------------------------------------------

  private persistPending() {
    if (typeof localStorage === 'undefined' || !this.userId) return;
    try {
      const keys = [...this.dirty.values(), ...[...this.inFlight].map((k) => {
        const [c, id] = k.split('\u0000') as [CollectionName, string];
        return { c, id, op: this.meta.get(c)?.has(id) ? ('upsert' as const) : ('delete' as const) };
      })];
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
