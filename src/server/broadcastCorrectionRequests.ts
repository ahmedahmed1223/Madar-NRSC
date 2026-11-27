import { createHash } from 'node:crypto';
import { broadcastOutcomes, type BroadcastCorrectionRequest, type BroadcastWithArchive } from '../shared/broadcastArchive';
import { canControlOnAir } from '../shared/onair';
import { buildAuthContext, type AuthContext } from './auth';
import type { NewsroomDatabase } from './db';
import { canRead } from './policy';

type CorrectionRequestInput = { startedAt?: unknown; segmentId?: unknown; correctionId?: unknown; reason?: unknown; requestId?: unknown };

export function addBroadcastCorrectionRequest(db: NewsroomDatabase, auth: AuthContext, showId: string, input: CorrectionRequestInput) {
  const { startedAt, segmentId, correctionId, reason, requestId } = input;
  if (typeof startedAt !== 'string' || typeof segmentId !== 'string' || !segmentId || segmentId.length > 200 ||
      typeof reason !== 'string' || !reason.trim() || reason.length > 1000 ||
      typeof requestId !== 'string' || !/^[\w-]{8,128}$/.test(requestId) ||
      (correctionId !== undefined && (typeof correctionId !== 'string' || correctionId.length > 200))) {
    return { error: 'حدّد الفقرة واكتب سبب التصحيح في 1000 حرف أو أقل', status: 400 };
  }

  const relatedId = typeof correctionId === 'string' ? correctionId : undefined;
  return db.transaction(() => {
    const user = db.getRow('users', auth.user.id)?.d;
    if (!user || user.deletedAt || user.isActive === false) return { error: 'الحساب غير متاح', status: 403 };
    const current = buildAuthContext(db, user, auth.sessionId);
    if (!canControlOnAir(user, current.can) && !current.can('news.review') && !current.can('news.edit_any')) {
      return { error: 'لا تملك صلاحية تسجيل طلب تصحيح على الهواء', status: 403 };
    }
    const row = db.getRow('onAir', showId);
    const lookup = (collection: Parameters<typeof db.getRow>[0], id: string) => db.getRow(collection, id)?.d;
    if (!row || !canRead(current, 'onAir', row.d, lookup)) return { error: 'سجل البث غير متاح', status: 404 };
    const state: BroadcastWithArchive = row.d;
    if (state.status !== 'ENDED' || state.startedAt !== startedAt) return { error: 'حدّث السجل بعد انتهاء جلسة البث', status: 409 };
    const outcome = broadcastOutcomes(state).find(entry => entry.id === segmentId && entry.item && entry.actual);
    if (!outcome?.item || !outcome.actual) return { error: 'الفقرة غير موجودة في البث المؤرشف', status: 404 };

    const digest = createHash('sha256').update(JSON.stringify([showId, startedAt, user.id, requestId])).digest('hex');
    const id = `broadcast-correction-${digest}`;
    const prior = (state.correctionRequests || []).find(entry => entry.id === id);
    if (prior) {
      if (prior.segmentId !== segmentId || prior.reason !== reason.trim() || prior.correctionId !== relatedId) return { error: 'تغير طلب التصحيح؛ أرسل طلباً جديداً', status: 409 };
      return { data: prior, status: 200 };
    }
    if ((state.correctionRequests || []).length >= 200) return { error: 'بلغ سجل البث الحد الأقصى لطلبات التصحيح', status: 409 };
    if (relatedId !== undefined) {
      const correction = lookup('newsCorrections', relatedId);
      if (!correction || !outcome.item.newsId || correction.newsId !== outcome.item.newsId || !canRead(current, 'newsCorrections', correction, lookup)) {
        return { error: 'التصحيح التحريري لا ينتمي إلى الخبر المؤرشف أو لا يمكن الوصول إليه', status: 400 };
      }
    }

    const record: BroadcastCorrectionRequest = {
      id, startedAt, segmentId, segmentTitle: outcome.title, airedAt: outcome.actual.startedAt,
      ...(outcome.item.newsId ? { newsId: outcome.item.newsId } : {}),
      ...(relatedId ? { correctionId: relatedId } : {}),
      reason: reason.trim(), actorId: user.id, actorName: user.fullName, createdAt: new Date().toISOString(),
    };
    db.writeRow('onAir', row.id, { ...state, correctionRequests: [...(state.correctionRequests || []), record] }, row.p, user.id);
    db.writeRow('auditLogs', id, {
      id, userId: user.id, userName: user.fullName, action: 'BROADCAST_CORRECTION_REQUEST', entityType: 'BROADCAST', entityId: row.id,
      severity: 'INFO', details: `طلب تصحيح على الهواء للفقرة «${record.segmentTitle}»`, createdAt: record.createdAt,
    }, db.positionBounds('auditLogs').min - 1, user.id);
    return { data: record, status: 201 };
  });
}
