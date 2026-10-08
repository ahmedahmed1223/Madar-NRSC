import { z } from 'zod';
import type { AuthContext } from './auth';
import type { NewsroomDatabase } from './db';
import type { SyncService } from './sync';
import { OfflineAirError } from './offlineAir';
import { canRead } from './policy';
const schema = z.object({ collection: z.enum(['episodes','bulletinStories']), id: z.string().min(1).max(200), segmentId: z.string().min(1).max(200), baseV: z.number().int().positive(), script: z.string().max(20000), userId: z.string().min(1).max(200), dbId: z.string().min(1).max(200) });
export function offlineDraftTarget(db: NewsroomDatabase, auth: AuthContext, collection: string, id: string) {
  if (collection !== 'episodes' && collection !== 'bulletinStories') throw new OfflineAirError(400, 'نوع المسودة غير صالح');
  const row = db.getRow(collection, id);
  if (!row || row.d.deletedAt) throw new OfflineAirError(404, 'المادة حذفت أو لم تعد متاحة');
  if (!canRead(auth, collection, row.d)) throw new OfflineAirError(403, 'لا تملك صلاحية قراءة المادة');
  return row;
}
export function applyOfflineDraft(db: NewsroomDatabase, sync: SyncService, auth: AuthContext, body: unknown, ip?: string) {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new OfflineAirError(400, 'المسودة غير صالحة');
  const value = parsed.data;
  if (value.userId !== auth.user.id || value.dbId !== db.dbId) throw new OfflineAirError(403, 'تغير المستخدم أو قاعدة البيانات؛ لم تطبق المسودة');
  if (db.getRow('settings', 'singleton')?.d.allowOfflineScriptEdits !== true) throw new OfflineAirError(403, 'عطلت المحطة تطبيق المسودات المحلية؛ تبقى المسودة محفوظة');
  const row = offlineDraftTarget(db, auth, value.collection, value.id);
  if (row.v !== value.baseV) throw new OfflineAirError(409, 'تغيرت المادة منذ تنزيل النسخة؛ قارن النسختين ولا تستبدل تعديل الزميل');
  const lock = db.getRow('editLocks', `${value.collection}:${value.id}`)?.d;
  if (!lock || lock.userId !== auth.user.id || Date.parse(lock.expiresAt) <= Date.now()) throw new OfflineAirError(409, 'يلزم قفل تحرير ساري تملكه');
  let after = { ...row.d };
  if (value.collection === 'bulletinStories') {
    if (value.segmentId !== row.id) throw new OfflineAirError(400, 'القصة غير مطابقة');
    after.script = value.script;
  } else {
    if (!Array.isArray(after.rundown) || after.rundown.filter((segment: any) => segment.id === value.segmentId).length !== 1) throw new OfflineAirError(400, 'الفقرة غير موجودة أو معرّفها مكرر');
    after.rundown = after.rundown.map((segment: any) => segment.id === value.segmentId ? { ...segment, scriptText: value.script } : segment);
  }
  const result = sync.apply(auth, [{ c: value.collection, id: value.id, op: 'upsert', baseV: value.baseV, d: after }], ip)[0];
  if (result.ok === false) throw new OfflineAirError(result.code === 'CONFLICT' ? 409 : 403, result.message || 'رفض الخادم تطبيق المسودة');
  return result;
}
