import { appLocale, zoneOptions } from './dateFormat';
import type { NewsItem, NewsStatus } from '../types/index';

/**
 * Editorial workflow shared by the editor UI and the server policy, so a button is
 * shown exactly when the server will accept the action.
 */
export const NEWS_STATUS_LABELS: Record<NewsStatus, string> = {
  DRAFT: 'مسودة',
  IN_PROGRESS: 'قيد الكتابة',
  UNDER_REVIEW: 'قيد المراجعة',
  NEEDS_REVISION: 'مُعاد للتعديل',
  APPROVED: 'معتمد',
  SCHEDULED: 'مجدول',
  PUBLISHED: 'منشور',
  ARCHIVED: 'مؤرشف',
  REJECTED: 'مرفوض',
  UNPUBLISHED: 'أُلغي نشره',
};

/** Allowed status changes. Publishing always goes through review and approval. */
export const NEWS_TRANSITIONS: Record<NewsStatus, NewsStatus[]> = {
  DRAFT: ['IN_PROGRESS', 'UNDER_REVIEW', 'ARCHIVED'],
  IN_PROGRESS: ['DRAFT', 'UNDER_REVIEW', 'ARCHIVED'],
  UNDER_REVIEW: ['APPROVED', 'NEEDS_REVISION', 'REJECTED', 'DRAFT'],
  NEEDS_REVISION: ['IN_PROGRESS', 'UNDER_REVIEW', 'DRAFT', 'ARCHIVED'],
  APPROVED: ['PUBLISHED', 'SCHEDULED', 'NEEDS_REVISION', 'UNDER_REVIEW', 'ARCHIVED'],
  SCHEDULED: ['PUBLISHED', 'APPROVED', 'ARCHIVED'],
  PUBLISHED: ['UNPUBLISHED', 'ARCHIVED'],
  UNPUBLISHED: ['PUBLISHED', 'NEEDS_REVISION', 'DRAFT', 'ARCHIVED'],
  ARCHIVED: ['DRAFT'],
  REJECTED: ['DRAFT', 'ARCHIVED'],
};

/** Statuses a new story may be created with. */
export const NEWS_INITIAL_STATUSES: NewsStatus[] = ['DRAFT', 'IN_PROGRESS', 'UNDER_REVIEW'];

export type Can = (permission: string) => boolean;

export function canTransition(from: NewsStatus | undefined, to: NewsStatus): boolean {
  if (!from) return NEWS_INITIAL_STATUSES.includes(to);
  return from === to || (NEWS_TRANSITIONS[from] || []).includes(to);
}

const isOwn = (item: Pick<NewsItem, 'authorId'> | null | undefined, userId: string) => !!item && item.authorId === userId;

/** May the user change the text/metadata of this story (not its status)? */
export function canEditNewsContent(can: Can, userId: string, item: Partial<NewsItem> | null | undefined): boolean {
  if (!item || !item.id) return can('news.create');
  if (item.deletedAt) return false;
  if (!can('news.edit_any') && !(isOwn(item as NewsItem, userId) && can('news.edit_own'))) return false;
  // Live (or cleared-for-air) copy must not change without the matching sign-off.
  if (item.status === 'PUBLISHED' || item.status === 'SCHEDULED') return can('news.publish');
  if (item.status === 'APPROVED') return can('news.approve') || can('news.publish');
  return true;
}

/** Is the story still under embargo at `now`? */
export function isUnderEmbargo(item: Pick<NewsItem, 'embargoUntil'> | null | undefined, now = Date.now()): boolean {
  const until = item?.embargoUntil ? Date.parse(item.embargoUntil) : NaN;
  return Number.isFinite(until) && until > now;
}

/** "27 سبتمبر 2026 الساعة 14:30" — reads correctly inside Arabic sentences. */
export const embargoLabel = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const date = d.toLocaleDateString(appLocale(), { ...zoneOptions(), day: 'numeric', month: 'long', year: 'numeric' });
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${date} الساعة ${time}`;
};

/**
 * Embargoed stories may be written, reviewed and approved, but not published before the
 * embargo lifts; a scheduled time must fall after it.
 */
export function embargoDenial(item: Partial<NewsItem> | null | undefined, to: NewsStatus, now = Date.now()): string | null {
  if (!isUnderEmbargo(item as NewsItem, now)) return null;
  if (to === 'PUBLISHED') return `الخبر تحت الحظر حتى ${embargoLabel(item!.embargoUntil)} ولا يُنشر قبل ذلك`;
  if (to === 'SCHEDULED' && item?.scheduledDate && Date.parse(item.scheduledDate) < Date.parse(item.embargoUntil!)) {
    return `موعد النشر المجدول قبل انتهاء الحظر (${embargoLabel(item.embargoUntil)})`;
  }
  return null;
}

/** Title placeholder given to untitled drafts; never acceptable past the draft stage. */
export const UNTITLED_NEWS = 'خبر جديد بدون عنوان';
/** Statuses that need a real title and body. */
export const CONTENT_REQUIRED_STATUSES: NewsStatus[] = ['UNDER_REVIEW', 'APPROVED', 'SCHEDULED', 'PUBLISHED'];
export const MIN_BODY_WORDS = 10;

/** Visible text of a story body (tags, entities and extra spaces removed). */
export function plainText(html: string | undefined): string {
  return String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;|\u00a0/gi, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Drafts may be incomplete; anything sent to review, approved, scheduled or published must have
 * a real title and body. Returns the field at fault so forms can point to it.
 */
export function contentDenial(item: Partial<NewsItem> | null | undefined, to: NewsStatus): { field: 'title' | 'content'; message: string } | null {
  if (!CONTENT_REQUIRED_STATUSES.includes(to)) return null;
  const title = String(item?.title || '').trim();
  if (!title || title === UNTITLED_NEWS || title.length < 5) {
    return { field: 'title', message: 'اكتب عنواناً فعلياً للخبر (5 أحرف على الأقل) قبل إرساله للمراجعة أو اعتماده أو نشره' };
  }
  const words = plainText(item?.content).split(' ').filter(Boolean).length;
  if (words < MIN_BODY_WORDS) {
    return {
      field: 'content',
      message: words === 0 ? 'نص الخبر فارغ؛ لا يمكن إرساله للمراجعة أو اعتماده أو نشره' : `نص الخبر قصير جداً (${words} كلمات)؛ الحد الأدنى ${MIN_BODY_WORDS} كلمات`,
    };
  }
  return null;
}

/** Reason the user may not move a story to `to`, or null when allowed. */
export function transitionDenial(can: Can, userId: string, item: Partial<NewsItem> | null | undefined, to: NewsStatus): string | null {
  const from = item?.id ? (item.status as NewsStatus) : undefined;
  if (from === to) return null;
  const embargo = embargoDenial(item, to);
  if (embargo) return embargo;
  if (!canTransition(from, to)) {
    return `لا يمكن نقل الخبر من «${from ? NEWS_STATUS_LABELS[from] : 'جديد'}» إلى «${NEWS_STATUS_LABELS[to]}» مباشرة`;
  }
  // A reviewer who claimed the story («أراجعها الآن») decides it; others wait or take it over.
  if (from === 'UNDER_REVIEW' && REVIEW_DECISIONS.includes(to)) {
    const claim = reviewClaimedByOther(item, userId);
    if (claim) return `يراجع ${claim.userName} هذا الخبر الآن؛ انتظر حتى ينهي أو تولَّ المراجعة`;
  }
  switch (to) {
    case 'APPROVED':
      return can('news.approve') ? null : 'صلاحياتك لا تسمح باعتماد الأخبار';
    case 'PUBLISHED':
    case 'SCHEDULED':
    case 'UNPUBLISHED':
      return can('news.publish') ? null : 'صلاحياتك لا تسمح بنشر الأخبار أو إلغاء نشرها';
    case 'NEEDS_REVISION':
    case 'REJECTED':
      return can('news.review') || can('news.approve') ? null : 'صلاحياتك لا تسمح بمراجعة الأخبار';
    case 'ARCHIVED':
      if (from === 'PUBLISHED') return can('news.publish') ? null : 'صلاحياتك لا تسمح بأرشفة خبر منشور';
      return can('news.edit_any') || (isOwn(item as NewsItem, userId) && can('news.edit_own')) ? null : 'صلاحياتك لا تسمح بأرشفة هذا الخبر';
    default:
      // DRAFT / IN_PROGRESS / UNDER_REVIEW: the author, or anyone who may edit any story.
      if (!from) return can('news.create') ? null : 'صلاحياتك لا تسمح بإنشاء الأخبار';
      if (from === 'UNDER_REVIEW' && to === 'DRAFT' && (can('news.review') || can('news.approve'))) return null;
      return can('news.edit_any') || (isOwn(item as NewsItem, userId) && can('news.edit_own'))
        ? null
        : 'صلاحياتك لا تسمح بتغيير حالة هذا الخبر';
  }
}

/** Status changes offered to this user for this story (for workflow buttons). */
export function availableTransitions(can: Can, userId: string, item: Partial<NewsItem> | null | undefined): NewsStatus[] {
  const from = item?.id ? (item.status as NewsStatus) : undefined;
  const targets = from ? NEWS_TRANSITIONS[from] || [] : NEWS_INITIAL_STATUSES;
  return targets.filter((to) => transitionDenial(can, userId, item, to) === null);
}

/** Is a breaking flag currently on air? (published, flagged and not expired) */
export function isBreakingLive(item: Pick<NewsItem, 'isBreaking' | 'status' | 'breakingUntil' | 'deletedAt'>, now = Date.now()): boolean {
  if (!item.isBreaking || item.deletedAt || item.status !== 'PUBLISHED') return false;
  return !item.breakingUntil || new Date(item.breakingUntil).getTime() > now;
}

export const DEFAULT_BREAKING_HOURS = 4;

/** URL slug that keeps Arabic letters, drops punctuation and is unique via the id suffix. */
export function makeNewsSlug(title: string, id: string): string {
  const base = (title || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ً-ٰٟ]/g, '') // Arabic diacritics
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  const suffix = id.split('-').pop() || id;
  return base ? `${base}-${suffix}` : `news-${suffix}`;
}

// ---------------------------------------------------------------------------------------------
// Review bookkeeping: quality pass, claiming a review, breaking requests from the field.
// Shared by the editor (what to offer) and the server policy (what to accept).
// ---------------------------------------------------------------------------------------------

/** «اجتازت التدقيق»: who passed which text and when. Valid while the text stays the same. */
export interface NewsQualityCheck {
  byId: string;
  byName: string;
  at: string;
  /** contentSignature() of the text that was checked. */
  signature: string;
  note?: string;
}

/** «أراجعها الآن»: one reviewer at a time. */
export interface NewsReviewClaim {
  userId: string;
  userName: string;
  at: string;
}

/** A breaking alert sent from the field; whether it goes on air stays with the editors. */
export interface NewsBreakingRequest {
  byId: string;
  byName: string;
  at: string;
}

/** Decisions on a story under review that a claim reserves for its reviewer. */
export const REVIEW_DECISIONS: NewsStatus[] = ['APPROVED', 'NEEDS_REVISION', 'REJECTED'];
/** A claim lapses on its own, so a reviewer who walks away does not hold the story. */
export const REVIEW_CLAIM_TTL_MS = 30 * 60_000;
/** Client clocks may differ from the server's by this much when stamping a claim or a pass. */
export const REVIEW_CLOCK_SKEW_MS = 5 * 60_000;

export const canReviewNews = (can: Can) => can('news.review') || can('news.approve');
export const canRequestBreaking = (can: Can) => can('news.breaking_request') || can('news.breaking_push');

/** Short stable fingerprint of the reviewed text (headline, lead and body). */
export function contentSignature(item: Partial<Pick<NewsItem, 'title' | 'summary' | 'content'>> | null | undefined): string {
  const text = `${String(item?.title || '').trim()}\u0001${String(item?.summary || '').trim()}\u0001${plainText(item?.content)}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return `${h1.toString(36)}${h2.toString(36)}-${text.length.toString(36)}`;
}

const isBookkeeping = (log: { fromStatus?: string; toStatus?: string; action?: string }) => !!log.action || log.fromStatus === log.toStatus;

/** When the story last entered review (its latest submission), if known. */
export function lastSubmittedAt(item: Partial<NewsItem> | null | undefined): string | undefined {
  const logs = item?.workflowLogs || [];
  for (let i = logs.length - 1; i >= 0; i--) {
    const log = logs[i];
    if (log.toStatus === 'UNDER_REVIEW' && !isBookkeeping(log)) return log.timestamp;
  }
  return undefined;
}

const notBefore = (at: string | undefined, since: string | undefined) => !since || (!!at && Date.parse(at) >= Date.parse(since));

/** The live claim on a story under review (expired claims and claims from an earlier round do not count). */
export function activeReviewClaim(item: Partial<NewsItem> | null | undefined, now = Date.now()): NewsReviewClaim | null {
  const claim = item?.reviewClaim;
  if (!claim || item?.status !== 'UNDER_REVIEW' || item.deletedAt) return null;
  const at = Date.parse(claim.at);
  if (!Number.isFinite(at) || now - at > REVIEW_CLAIM_TTL_MS) return null;
  return notBefore(claim.at, lastSubmittedAt(item)) ? claim : null;
}

export function reviewClaimedByOther(item: Partial<NewsItem> | null | undefined, userId: string, now = Date.now()): NewsReviewClaim | null {
  const claim = activeReviewClaim(item, now);
  return claim && claim.userId !== userId ? claim : null;
}

/** Has quality passed the text as it is now (in this round of review)? */
export function isQualityPassed(item: Partial<NewsItem> | null | undefined): boolean {
  const check = item?.qualityCheck;
  if (!check || !item) return false;
  return check.signature === contentSignature(item) && notBefore(check.at, lastSubmittedAt(item));
}

/** Reason the user may not claim this story for review, or null. */
export function claimDenial(can: Can, userId: string, item: Partial<NewsItem> | null | undefined, now = Date.now()): string | null {
  if (!item?.id || item.status !== 'UNDER_REVIEW' || item.deletedAt) return 'يُستلم للمراجعة الخبر الذي ينتظر المراجعة فقط';
  if (!canReviewNews(can)) return 'صلاحياتك لا تسمح بمراجعة الأخبار';
  if (item.authorId === userId) return 'لا تراجع خبرك بنفسك';
  const other = reviewClaimedByOther(item, userId, now);
  if (other && !can('news.approve')) return `يراجع ${other.userName} هذا الخبر الآن`;
  return null;
}

/** Reason the user may not mark the story «اجتازت التدقيق», or null. */
export function qualityPassDenial(can: Can, userId: string, item: Partial<NewsItem> | null | undefined, now = Date.now()): string | null {
  if (!item?.id || item.status !== 'UNDER_REVIEW' || item.deletedAt) return 'يُجاز في التدقيق الخبر الذي ينتظر المراجعة فقط';
  if (!can('news.review')) return 'تسجيل اجتياز التدقيق لمن يملك صلاحية المراجعة';
  if (item.authorId === userId) return 'لا يُجيز الكاتب خبره بنفسه';
  const other = reviewClaimedByOther(item, userId, now);
  if (other) return `يراجع ${other.userName} هذا الخبر الآن`;
  if (isQualityPassed(item)) return 'اجتاز هذا النص التدقيق من قبل';
  return null;
}

/**
 * Is this story waiting on this user's review? Approvers see everything under review; a quality
 * reviewer (news.review without news.approve) stops seeing a text once it passed quality.
 * Stories a colleague is reviewing right now, and one's own stories, are left out.
 */
export function awaitsMyReview(can: Can, userId: string, item: Partial<NewsItem>, now = Date.now()): boolean {
  if (item.status !== 'UNDER_REVIEW' || item.deletedAt || item.authorId === userId || !canReviewNews(can)) return false;
  if (reviewClaimedByOther(item, userId, now)) return false;
  return can('news.approve') || !isQualityPassed(item);
}

const sameStamp = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const freshStamp = (at: unknown, now: number) => typeof at === 'string' && Number.isFinite(Date.parse(at)) && Math.abs(Date.parse(at) - now) <= REVIEW_CLOCK_SKEW_MS;
const lastNewLog = (before: Partial<NewsItem> | null | undefined, after: Partial<NewsItem>) => {
  const prev = before?.workflowLogs?.length || 0;
  const logs = after.workflowLogs || [];
  return logs.length > prev ? logs[logs.length - 1] : undefined;
};

/**
 * Server rule for the review fields (qualityCheck, reviewClaim, breakingRequest) on a story write.
 * These fields are workflow bookkeeping: they need review rights, not edit rights.
 */
export function reviewBookkeepingDenial(
  can: Can,
  user: { id: string; name: string },
  before: Partial<NewsItem> | null | undefined,
  after: Partial<NewsItem>,
  now = Date.now()
): string | null {
  // Quality pass.
  if (!sameStamp(before?.qualityCheck, after.qualityCheck)) {
    const check = after.qualityCheck;
    if (check) {
      if (!before) return 'يُسجَّل اجتياز التدقيق على خبر محفوظ';
      const denial = qualityPassDenial(can, user.id, before, now);
      if (denial) return denial;
      if (after.status !== 'UNDER_REVIEW') return 'اجتياز التدقيق لا يغيّر حالة الخبر';
      if (check.byId !== user.id || check.byName !== user.name || !freshStamp(check.at, now)) return 'بيانات اجتياز التدقيق غير صالحة';
      if (check.signature !== contentSignature(after) || check.signature !== contentSignature(before)) return 'تغيّر النص؛ راجع النسخة المحفوظة ثم سجّل اجتيازه';
      if (check.note !== undefined && (typeof check.note !== 'string' || check.note.length > 500)) return 'ملاحظة التدقيق أطول من المسموح';
      const log = lastNewLog(before, after);
      if (!log || log.action !== 'QUALITY_PASSED' || log.changedBy?.id !== user.id) return 'يُسجَّل اجتياز التدقيق في سجل سير العمل';
    } else if (before?.status === after.status && !canReviewNews(can) && !can('news.edit_any')) {
      return 'إلغاء اجتياز التدقيق للمراجعين';
    }
  }
  // Claim / release.
  if (!sameStamp(before?.reviewClaim, after.reviewClaim)) {
    const claim = after.reviewClaim;
    const held = activeReviewClaim(before, now);
    if (claim) {
      if (!before) return 'يُستلم للمراجعة خبر محفوظ';
      if (claim.userId !== user.id || claim.userName !== user.name || !freshStamp(claim.at, now)) return 'بيانات استلام المراجعة غير صالحة';
      const denial = claimDenial(can, user.id, before, now);
      if (denial) return denial;
      if (after.status !== 'UNDER_REVIEW') return 'استلام المراجعة لا يغيّر حالة الخبر';
    } else if (held && held.userId !== user.id && before?.status === after.status && !can('news.approve')) {
      return `يراجع ${held.userName} هذا الخبر الآن`;
    }
  }
  // Breaking request from the field.
  if (!sameStamp(before?.breakingRequest, after.breakingRequest)) {
    const req = after.breakingRequest;
    if (req) {
      if (!canRequestBreaking(can)) return 'صلاحياتك لا تسمح بإرسال عاجل للمراجعة';
      if (before && before.authorId !== user.id) return 'يرسل العاجل كاتب الخبر';
      if (req.byId !== user.id || req.byName !== user.name || !freshStamp(req.at, now)) return 'بيانات طلب العاجل غير صالحة';
    } else if (!(can('news.breaking_push') || can('news.approve') || before?.authorId === user.id)) {
      return 'إغلاق طلب العاجل لرئيس التحرير';
    }
  }
  return null;
}
