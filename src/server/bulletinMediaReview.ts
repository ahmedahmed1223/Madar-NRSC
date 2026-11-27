import { bulletinClipSource, bulletinClipUploadId, INITIAL_MEDIA_PREVIEW_MS, mayReviewBulletinMedia, type BulletinMediaReview } from '../shared/bulletinMediaReview';
import { storyTypeOf, type Bulletin, type BulletinStory } from '../shared/bulletins';
import type { CollectionName, EntityRow } from '../shared/collections';
import { newId } from '../shared/ids';
import { mediaRightsIssue, plannedMediaAirAt } from '../shared/mediaEditorial';
import type { AuthContext } from './auth';
import { buildAuthContext } from './auth';
import type { NewsroomDatabase } from './db';
import { writeNotification } from './notifications';
import { canRead } from './policy';

export class BulletinMediaReviewError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function mediaCandidate(db: NewsroomDatabase, clipMediaId?: string) {
  const media = typeof clipMediaId === 'string' ? db.getRow('media', clipMediaId)?.d : undefined;
  if (!media || media.deletedAt || media.privateMessageMedia || media.mediaType !== 'VIDEO' || !bulletinClipSource(media)) return null;
  const uploadId = bulletinClipUploadId(media);
  if (uploadId) {
    const upload = db.getUpload(uploadId);
    if (!upload || upload.scope === 'chat' || !upload.mimeType.startsWith('video/') || !(upload.sizeBytes > 0)) return null;
  }
  return { media, uploadId };
}

/** Review state is derived at the server when the story links a completed upload. */
export function stampBulletinMediaReview(db: NewsroomDatabase, before: BulletinStory | undefined, after: BulletinStory): BulletinStory {
  const previous = before?.mediaReview;
  const candidate = storyTypeOf(after.type).clip ? mediaCandidate(db, after.clipMediaId) : null;
  let mediaReview = previous;
  const same = previous && previous.mediaId === after.clipMediaId && previous.uploadId === candidate?.uploadId;
  if (candidate && !same && (previous || (candidate.uploadId && before?.clipMediaId !== after.clipMediaId))) {
    const now = Date.now();
    mediaReview = {
      id: newId('media-review'), mediaId: after.clipMediaId!, uploadId: candidate.uploadId,
      state: previous ? 'REPLACEMENT' : 'PREVIEW', startedAt: new Date(now).toISOString(),
      ...(!previous ? { deadlineAt: new Date(now + INITIAL_MEDIA_PREVIEW_MS).toISOString() } : {}),
    };
  }
  return { ...after, mediaReview };
}

function approvalProblem(db: NewsroomDatabase, bulletin: Bulletin, story: BulletinStory, review: BulletinMediaReview, now: Date) {
  const candidate = storyTypeOf(story.type).clip ? mediaCandidate(db, story.clipMediaId) : null;
  if (!candidate || story.clipMediaId !== review.mediaId || candidate.uploadId !== review.uploadId || !(Number(story.clipSeconds) > 0)) {
    return 'المادة تغيّرت أو لم تكتمل؛ حدّد الفيديو ومدته قبل الاعتماد';
  }
  const planned = plannedMediaAirAt(bulletin.date, bulletin.startTime, db.getRow('settings', 'singleton')?.d.defaultTimezone);
  const air = db.getRow('onAir', bulletin.id)?.d;
  const session = air?.status === 'LIVE' ? { showId: bulletin.id, startedAt: air.startedAt } : undefined;
  return mediaRightsIssue(candidate.media, now, planned, session);
}

function writeReview(db: NewsroomDatabase, row: EntityRow, story: BulletinStory, mediaReview: BulletinMediaReview, by: string | null) {
  db.recordHistory('bulletinStories', row.id, row.v, story, by, by ? db.getRow('users', by)?.d.fullName ?? null : null);
  db.writeRow('bulletinStories', row.id, { ...story, mediaReview }, row.p, by);
  return mediaReview;
}

/** Finish due first previews in bounded batches. An ineligible clip falls back to manual review. */
export function approveDueBulletinMedia(db: NewsroomDatabase, now = new Date()): number {
  const at = now.toISOString();
  return db.transaction(() => {
    let changed = 0;
    for (const row of db.listDueBulletinMediaReviews(at)) {
      const story = row.d as BulletinStory;
      const review = story.mediaReview!;
      const bulletin = db.getRow('bulletins', story.bulletinId)?.d as Bulletin | undefined;
      const ready = bulletin && !bulletin.deletedAt && !approvalProblem(db, bulletin, story, review, now);
      writeReview(db, row, story, ready
        ? { ...review, state: 'APPROVED', decision: 'AUTOMATIC', decidedAt: at }
        : { ...review, state: 'REPLACEMENT', deadlineAt: undefined }, null);
      changed++;
    }
    return changed;
  });
}

export function decideBulletinMediaReview(db: NewsroomDatabase, auth: AuthContext, bulletinId: string, storyId: string, value: unknown) {
  const { action, reviewId } = (value ?? {}) as { action?: unknown; reviewId?: unknown };
  if ((action !== 'APPROVE' && action !== 'REQUEST_REPLACEMENT') || typeof reviewId !== 'string' || !/^[\w-]{1,128}$/.test(reviewId)) {
    throw new BulletinMediaReviewError(400, 'قرار معاينة المادة غير صالح');
  }
  const lookup = (collection: CollectionName, id: string) => db.getRow(collection, id)?.d;
  return db.transaction(() => {
    const bulletin = lookup('bulletins', bulletinId) as Bulletin | undefined;
    const row = db.getRow('bulletinStories', storyId);
    const story = row?.d as BulletinStory | undefined;
    if (!bulletin || bulletin.deletedAt || !row || !story || story.deletedAt || story.bulletinId !== bulletinId || !canRead(auth, 'bulletinStories', story, lookup)) {
      throw new BulletinMediaReviewError(404, 'قصة النشرة غير متاحة');
    }
    if (!mayReviewBulletinMedia(bulletin, { id: auth.user.id, role: auth.user.role, canApprove: auth.can('bulletins.approve'), canEdit: auth.can('bulletins.edit') })) {
      throw new BulletinMediaReviewError(403, 'القرار لمحرر النشرة أو المفوّض بالاعتماد');
    }
    const review = story.mediaReview;
    if (!review || review.id !== reviewId || review.mediaId !== story.clipMediaId) throw new BulletinMediaReviewError(409, 'تغيّرت المادة؛ راجع المعاينة الحالية');
    const state = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    if (review.state === state) return review;
    const now = new Date();
    if ((review.state !== 'PREVIEW' && review.state !== 'REPLACEMENT') || (review.state === 'PREVIEW' && Date.parse(review.deadlineAt || '') <= now.getTime())) {
      throw new BulletinMediaReviewError(409, 'انتهت هذه المعاينة؛ راجع حالة المادة الحالية');
    }
    if (action === 'APPROVE') {
      const clip = lookup('media', review.mediaId);
      if (!clip || !canRead(auth, 'media', clip, lookup)) throw new BulletinMediaReviewError(403, 'لا تملك صلاحية معاينة هذه المادة');
      const problem = approvalProblem(db, bulletin, story, review, now);
      if (problem) throw new BulletinMediaReviewError(409, problem);
    }
    const decided = writeReview(db, row, story, { ...review, state, decidedAt: now.toISOString(), decidedById: auth.user.id, decision: 'MANUAL' }, auth.user.id);
    if (state === 'REJECTED' && story.writerId && story.writerId !== auth.user.id) {
      const writer = lookup('users', story.writerId);
      if (writer && !writer.deletedAt && writer.isActive !== false && canRead(buildAuthContext(db, writer, ''), 'bulletinStories', story, lookup)) {
        writeNotification(db, { userId: story.writerId, title: 'طُلبت مادة بديلة للنشرة', message: story.slug,
          category: 'news', linkUrl: `/bulletins/${encodeURIComponent(bulletin.id)}` });
      }
    }
    return decided;
  });
}
