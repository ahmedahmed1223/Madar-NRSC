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

/** Reason the user may not move a story to `to`, or null when allowed. */
export function transitionDenial(can: Can, userId: string, item: Partial<NewsItem> | null | undefined, to: NewsStatus): string | null {
  const from = item?.id ? (item.status as NewsStatus) : undefined;
  if (from === to) return null;
  if (!canTransition(from, to)) {
    return `لا يمكن نقل الخبر من «${from ? NEWS_STATUS_LABELS[from] : 'جديد'}» إلى «${NEWS_STATUS_LABELS[to]}» مباشرة`;
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
