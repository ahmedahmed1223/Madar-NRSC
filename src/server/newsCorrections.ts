import crypto from 'crypto';
import type { NewsroomDatabase } from './db';
import { buildAuthContext, type AuthContext } from './auth';
import { canRead } from './policy';
import { writeNotification } from './notifications';
import { notifyBulletinSourceCorrections } from './bulletinSourceCorrectionNotices';
import type { CreateCorrectionInput, NewsCorrection } from '../shared/newsCorrections';

export class NewsCorrectionError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const fail = (status: number, message: string): never => { throw new NewsCorrectionError(status, message); };
export function correctionTarget(db: NewsroomDatabase, auth: AuthContext, newsId: string) {
  const user = db.getRow('users', auth.user.id)?.d;
  if (!user || user.isActive === false || user.deletedAt) fail(403, 'الحساب غير متاح');
  const current = buildAuthContext(db, user, auth.sessionId);
  const row = db.getRow('news', newsId);
  if (!current.can('news.view') || !row || row.d.deletedAt || !canRead(current, 'news', row.d)) fail(404, 'الخبر غير متاح');
  return { row: row!, auth: current };
}
export function createNewsCorrection(db: NewsroomDatabase, auth: AuthContext, input: CreateCorrectionInput): NewsCorrection {
  if (Object.keys(input).some(key => !['newsId', 'expectedVersion', 'reason', 'summary', 'requestId', 'relatedCorrectionId'].includes(key))) fail(400, 'حقول التصحيح غير صالحة؛ الهوية والتوقيت يحددهما الخادم');
  const { row, auth: current } = correctionTarget(db, auth, input.newsId);
  if (!current.can('news.review') && !current.can('news.edit_any')) fail(403, 'لا تملك صلاحية تسجيل التصحيح');
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1 ||
      typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 2000 ||
      typeof input.summary !== 'string' || !input.summary.trim() || input.summary.length > 1000 ||
      typeof input.requestId !== 'string' || !/^[\w-]{8,200}$/.test(input.requestId) ||
      (input.relatedCorrectionId !== undefined && (typeof input.relatedCorrectionId !== 'string' || input.relatedCorrectionId.length > 200))) fail(400, 'راجع سبب التصحيح وملخصه ونسخة الخبر');
  const id = 'correction-' + crypto.createHash('sha256').update(JSON.stringify([current.user.id, input.requestId])).digest('hex');
  const prior = db.getRow('newsCorrections', id)?.d as NewsCorrection | undefined;
  if (prior) {
    if (prior.newsId !== input.newsId || prior.newsVersion !== input.expectedVersion || prior.reason !== input.reason || prior.summary !== input.summary || prior.relatedCorrectionId !== input.relatedCorrectionId) fail(409, 'تغير محتوى طلب التصحيح؛ أرسل طلباً جديداً');
    return prior;
  }
  if (row.v !== input.expectedVersion) fail(409, 'تغيرت نسخة الخبر؛ راجع النسخة الحالية قبل تسجيل التصحيح');
  if (input.relatedCorrectionId && db.getRow('newsCorrections', input.relatedCorrectionId)?.d.newsId !== input.newsId) fail(400, 'التصحيح السابق لا ينتمي لهذا الخبر');
  const record: NewsCorrection = { id, newsId: row.id, newsVersion: row.v, reason: input.reason, summary: input.summary, actorId: current.user.id, actorName: current.user.fullName, createdAt: new Date().toISOString(), ...(input.relatedCorrectionId ? { relatedCorrectionId: input.relatedCorrectionId } : {}) };
  return db.transaction(() => {
    db.writeRow('newsCorrections', id, record, db.positionBounds('newsCorrections').max + 1, current.user.id);
    const auditId = id + '-audit';
    db.writeRow('auditLogs', auditId, { id: auditId, userId: current.user.id, userName: current.user.fullName, action: 'NEWS_CORRECTION', entityType: 'NEWS', entityId: row.id, severity: 'INFO', details: `تسجيل تصحيح للنسخة ${row.v}`, createdAt: record.createdAt }, db.positionBounds('auditLogs').min - 1, current.user.id);
    const recipients = new Set<string>();
    const consider = (userId: unknown, collection: 'episodes' | 'bulletins', target: any) => {
      if (typeof userId !== 'string' || !userId) return;
      const user = db.getRow('users', userId)?.d;
      if (!user || user.isActive === false || user.deletedAt) return;
      const owner = buildAuthContext(db, user, '');
      // Parent visibility already checks the real permissions and module scope.
      // There are no episodes.view / bulletins.view permission definitions.
      if (owner.can('news.view') && canRead(owner, collection, target)) recipients.add(userId);
    };
    for (const { d: episode } of db.listCollection('episodes')) {
      if (episode.deletedAt || !(episode.rundown || []).some((s: any) => s.newsId === row.id)) continue;
      consider(episode.producerId, 'episodes', episode); consider(episode.presenterId, 'episodes', episode);
    }
    for (const { d: story } of db.listCollection('bulletinStories')) {
      if (story.deletedAt || story.newsId !== row.id) continue;
      const bulletin = db.getRow('bulletins', story.bulletinId)?.d;
      if (!bulletin || bulletin.deletedAt) continue;
      consider(bulletin.editorId, 'bulletins', bulletin); consider(story.writerId, 'bulletins', bulletin);
    }
    for (const userId of recipients) writeNotification(db, { userId, title: 'تصحيح مرتبط بمادة تحريرية', message: record.summary, linkUrl: `/news/${encodeURIComponent(row.id)}`, category: 'news' }, { id: `${id}-${userId}`, createdAt: record.createdAt });
    for (const { d: state } of db.listCollection('onAir')) notifyBulletinSourceCorrections(db, state, record);
    return record;
  });
}
