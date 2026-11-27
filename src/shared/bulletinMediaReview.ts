import type { Bulletin, BulletinActor } from './bulletins';
import { isApprover } from './bulletins';

export const INITIAL_MEDIA_PREVIEW_MS = 180_000;

export interface BulletinMediaReview {
  id: string;
  mediaId: string;
  uploadId?: string;
  state: 'PREVIEW' | 'REPLACEMENT' | 'REJECTED' | 'APPROVED';
  startedAt: string;
  deadlineAt?: string;
  decidedAt?: string;
  decidedById?: string;
  decision?: 'AUTOMATIC' | 'MANUAL';
}

export type BulletinMediaAction = 'APPROVE' | 'REQUEST_REPLACEMENT';
type ClipSource = { fileUrl?: string; url?: string };

export function bulletinClipSource(clip?: ClipSource): string | undefined {
  const source = clip?.fileUrl || clip?.url;
  return typeof source === 'string' && source.trim() ? source : undefined;
}

export function bulletinClipUploadId(clip?: ClipSource): string | undefined {
  return /^\/api\/v1\/media\/files\/([A-Za-z0-9_-]+)(?:[?#]|$)/.exec(bulletinClipSource(clip) ?? '')?.[1];
}

export function mayReviewBulletinMedia(bulletin: Bulletin, actor: BulletinActor): boolean {
  return actor.canApprove || bulletin.editorId === actor.id || isApprover(bulletin, actor);
}

export function bulletinMediaReviewIssue(review: BulletinMediaReview | undefined, clipMediaId?: string, clip?: ClipSource): string | null {
  if (!review || !clipMediaId) return null;
  if (review.mediaId !== clipMediaId || review.uploadId !== bulletinClipUploadId(clip)) return 'المادة الجديدة تحتاج إلى مراجعة';
  if (review.state === 'PREVIEW') return 'المادة الأولى قيد المعاينة';
  if (review.state === 'REPLACEMENT') return 'المادة تحتاج إلى اعتماد يدوي';
  if (review.state === 'REJECTED') return 'أُوقفت المادة وطُلب بديل';
  return null;
}
