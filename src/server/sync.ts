import { EventEmitter } from 'events';
import {
  APPEND_ONLY_COLLECTIONS,
  COLLECTIONS,
  COLLECTION_NAMES,
  CollectionName,
  ENTITY_ID_PATTERN,
  EntityRow,
  LOG_BOOTSTRAP_LIMIT,
  SINGLETON_ID,
  SyncOp,
  SyncOpResult,
  isCollectionName,
} from '../shared/collections';
import type { AuthContext } from './auth';
import type { NewsroomDatabase } from './db';
import { canRead, POLICIES, WriteKind } from './policy';

export const MAX_OPS_PER_REQUEST = 500;
export const MAX_ENTITY_BYTES = 512 * 1024;
export const MAX_CHANGES_PER_POLL = 5000;

/** Broadcasts the latest revision to connected browsers (SSE). */
export const changeBus = new EventEmitter();
changeBus.setMaxListeners(0);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Server-authoritative fields: clients cannot forge who did what, from where, or when. */
function stamp(collection: CollectionName, data: any, auth: AuthContext, ip: string | undefined) {
  const now = new Date().toISOString();
  if (collection === 'auditLogs') {
    return {
      ...data,
      userId: auth.user.id,
      userName: auth.user.fullName,
      userRole: auth.user.role,
      ipAddress: ip ?? 'unknown',
      timestamp: now,
    };
  }
  if (collection === 'activityLogs') {
    return {
      ...data,
      userId: auth.user.id,
      userName: auth.user.fullName,
      userRole: auth.user.role,
      userAvatar: auth.user.avatarUrl,
      timestamp: now,
    };
  }
  return data;
}

export class SyncService {
  constructor(private db: NewsroomDatabase) {}

  private visible(auth: AuthContext, row: EntityRow): boolean {
    return row.deleted ? true : canRead(auth, row.c, row.d);
  }

  bootstrap(auth: AuthContext) {
    const rev = this.db.currentRev();
    const collections: Partial<Record<CollectionName, EntityRow[]>> = {};
    for (const name of COLLECTION_NAMES) {
      let rows: EntityRow[];
      if (APPEND_ONLY_COLLECTIONS.has(name)) {
        // Logs are ordered newest first (lowest position); only ship the recent window.
        rows = this.db.listCollection(name, { limit: LOG_BOOTSTRAP_LIMIT });
      } else {
        rows = this.db.listCollection(name);
      }
      collections[name] = rows.filter((r) => canRead(auth, name, r.d));
    }
    return { rev, collections };
  }

  changes(auth: AuthContext, since: number) {
    const rev = this.db.currentRev();
    if (since < this.db.tombstoneFloor() || since > rev) return { rev, reset: true as const };
    const { rows, truncated } = this.db.changesSince(since, MAX_CHANGES_PER_POLL);
    if (truncated) return { rev, reset: true as const };
    // Writes are synchronous in this process, so `rev` is consistent with `rows`.
    return {
      rev,
      reset: false as const,
      changes: rows.filter((r) => this.visible(auth, r)),
    };
  }

  /**
   * Apply a batch of writes. Each op is validated and authorized independently and
   * runs in its own transaction; one rejected op never blocks the others.
   */
  apply(auth: AuthContext, ops: SyncOp[], ip?: string): SyncOpResult[] {
    const results = ops.map((op) => this.applyOne(auth, op, ip));
    if (results.some((r) => r.ok)) changeBus.emit('rev', this.db.currentRev());
    return results;
  }

  private applyOne(auth: AuthContext, op: SyncOp, ip?: string): SyncOpResult {
    if (!isPlainObject(op) || !isCollectionName(op.c) || !['upsert', 'delete'].includes(op.op)) {
      return { ok: false, code: 'INVALID', message: 'عملية مزامنة غير صالحة' };
    }
    const collection = op.c;
    const id = COLLECTIONS[collection].kind === 'singleton' ? SINGLETON_ID : op.id;
    if (typeof id !== 'string' || !ENTITY_ID_PATTERN.test(id)) {
      return { ok: false, code: 'INVALID', message: 'معرّف غير صالح' };
    }

    try {
      return this.db.transaction(() => {
        const current = this.db.getRow(collection, id);
        const before = current?.d ?? null;

        if (op.op === 'delete') {
          if (!current) return { ok: true, row: { c: collection, id, v: 0, p: 0, deleted: true } } as SyncOpResult;
          const denied = POLICIES[collection]({ auth, collection, kind: 'delete', before, after: null });
          if (denied) return { ok: false, code: 'FORBIDDEN', message: denied, current } as SyncOpResult;
          if (collection === 'users') {
            this.db.deleteCredentials(id);
            this.db.deleteUserSessions(id);
          }
          const row = this.db.deleteRow(collection, id, auth.user.id)!;
          return { ok: true, row } as SyncOpResult;
        }

        if (!isPlainObject(op.d)) return { ok: false, code: 'INVALID', message: 'بيانات غير صالحة' } as SyncOpResult;
        const size = Buffer.byteLength(JSON.stringify(op.d));
        if (size > MAX_ENTITY_BYTES) return { ok: false, code: 'INVALID', message: 'حجم السجل يتجاوز الحد المسموح' } as SyncOpResult;

        const kind: WriteKind = current ? 'update' : 'create';
        if (current && op.baseV !== undefined && op.baseV !== current.v) {
          return {
            ok: false,
            code: 'CONFLICT',
            message: 'تم تعديل هذا السجل من مستخدم آخر، تم تحميل أحدث نسخة',
            current,
          } as SyncOpResult;
        }
        if (current && op.baseV === undefined && !APPEND_ONLY_COLLECTIONS.has(collection)) {
          // Client thought this was new but the id already exists (created elsewhere).
          return { ok: false, code: 'CONFLICT', message: 'السجل موجود مسبقاً', current } as SyncOpResult;
        }

        let after: any = { ...op.d };
        if (COLLECTIONS[collection].kind === 'list') after.id = id;
        after = stamp(collection, after, auth, ip);

        const denied = POLICIES[collection]({ auth, collection, kind, before, after });
        if (denied) return { ok: false, code: 'FORBIDDEN', message: denied, current } as SyncOpResult;

        if (collection === 'users') {
          const invalid = this.validateUser(id, after);
          if (invalid) return { ok: false, code: 'INVALID', message: invalid, current } as SyncOpResult;
        }

        let position = typeof op.p === 'number' && Number.isFinite(op.p) ? op.p : undefined;
        if (position === undefined) {
          if (current) position = current.p;
          else position = this.db.positionBounds(collection).max + 1;
        }
        if (APPEND_ONLY_COLLECTIONS.has(collection) && !current) {
          // Newest entries first regardless of what the client asked for.
          position = this.db.positionBounds(collection).min - 1;
        }

        const row = this.db.writeRow(collection, id, after, position, auth.user.id);

        if (collection === 'users') {
          if (before && before.email !== after.email) this.db.updateCredentialEmail(id, String(after.email).toLowerCase());
          if (after.isActive === false || after.deletedAt) this.db.deleteUserSessions(id);
        }
        return { ok: true, row } as SyncOpResult;
      });
    } catch (err: any) {
      if (String(err?.message).includes('UNIQUE constraint failed: user_credentials.email')) {
        return { ok: false, code: 'INVALID', message: 'البريد الإلكتروني مستخدم لحساب آخر' };
      }
      throw err;
    }
  }

  private validateUser(id: string, user: any): string | null {
    if (typeof user.email !== 'string' || !/^\S+@\S+\.\S+$/.test(user.email)) return 'البريد الإلكتروني غير صالح';
    if (typeof user.fullName !== 'string' || !user.fullName.trim()) return 'اسم المستخدم مطلوب';
    const owner = this.db.findUserIdByEmail(user.email);
    if (owner && owner !== id) return 'البريد الإلكتروني مستخدم لحساب آخر';
    return null;
  }
}
