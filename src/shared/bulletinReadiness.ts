import { nextApprovalStep, plainText, storyTiming, storyTypeOf, type Bulletin, type BulletinStory } from './bulletins';
import type { MediaFile, NewsItem } from '../types';

export interface ReadinessIssue {
  storyId: string;
  code: string;
  severity: 'blocker' | 'warning';
  message: string;
  responsibleId?: string;
}

export function evaluateBulletinReadiness(bulletin: Bulletin, stories: BulletinStory[], news: NewsItem[], media: MediaFile[], now: Date): ReadinessIssue[] {
  const issues: ReadinessIssue[] = [];
  for (const s of stories.filter(s => !s.killed && !s.floated && !s.deletedAt)) {
    const type = storyTypeOf(s.type);
    const add = (code: string, message: string, severity: ReadinessIssue['severity'] = 'blocker') => issues.push({ storyId: s.id, code, message, severity, responsibleId: s.writerId || bulletin.editorId });
    if (type.read && !plainText(s.script || '').trim()) add('SCRIPT', 'نص القصة غير مكتمل');
    if (storyTiming(s).total <= 0) add('DURATION', 'مدة القصة غير محددة');
    if (type.clip && (!s.clipMediaId || !media.some(m => m.id === s.clipMediaId && !(m as MediaFile & { deletedAt?: string }).deletedAt && m.mediaType === 'VIDEO') || !(s.clipSeconds! > 0))) add('VIDEO', 'فيديو القصة أو مدته غير مكتمل');
    // Legacy approvals without a configured chain remain supported; explicit chains require every signature.
    if (s.status !== 'APPROVED' || (bulletin.approvalSteps?.length && nextApprovalStep(bulletin, s))) add('APPROVAL', 'لم يكتمل اعتماد القصة');
    const source = news.find(n => n.id === s.newsId);
    if (source?.embargoUntil && Date.parse(source.embargoUntil) > now.getTime()) add('EMBARGO', 'الخبر تحت حظر النشر');
    if (source && s.newsUpdatedAt && source.updatedAt > s.newsUpdatedAt) add('SOURCE_CHANGED', 'تغير الخبر الأصلي؛ راجع مقارنة النص', 'warning');
    if (source?.deletedAt) add('SOURCE_DELETED', 'الخبر الأصلي محذوف', 'warning');
    if (!s.anchorName && type.read) add('PRESENTER', 'لم يحدد مذيع للقصة', 'warning');
  }
  return issues;
}
