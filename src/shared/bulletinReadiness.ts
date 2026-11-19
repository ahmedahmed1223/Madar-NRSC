import { nextApprovalStep, plainText, scheduledBulletinId, storyTiming, storyTypeOf, type Bulletin, type BulletinFormat, type BulletinStory } from './bulletins';
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
    // The story's own presenter, or the bulletin's lead presenter (as the rundown table shows it).
    if (type.read && !storyPresenter(bulletin, s)) add('PRESENTER', 'لم يحدد مذيع للقصة ولا للنشرة', 'warning');
  }
  return issues;
}

/**
 * Who reads a story on air: its own presenter, else the bulletin's lead presenter.
 * The rundown table and the readiness check both use this, so they never disagree.
 */
export function storyPresenter(bulletin: Pick<Bulletin, 'anchors'>, story: Pick<BulletinStory, 'anchorName'>): string {
  return (story.anchorName || '').trim() || (bulletin.anchors || []).map((a) => a.trim()).find(Boolean) || '';
}

/** A length in words: «20 د 36 ث», «45 ث», «1 س 05 د». Always positive. */
export function durationWords(seconds: number): string {
  const total = Math.abs(Math.round(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return m ? `${h} س ${String(m).padStart(2, '0')} د` : `${h} س`;
  if (m) return s ? `${m} د ${String(s).padStart(2, '0')} ث` : `${m} د`;
  return `${s} ث`;
}

export interface TimingDelta {
  /** «في الوقت», «ناقص 20 د 36 ث», «زائد 1 د 05 ث». */
  text: string;
  /** Just the verdict, for a label above a figure: «في الوقت», «ناقص», «زائد». */
  verdict: 'في الوقت' | 'ناقص' | 'زائد';
  /** The amount in words, empty when on time. */
  amount: string;
  state: 'ON_TIME' | 'SHORT' | 'OVER';
}

/**
 * The gap between what the stories add up to and the planned length, read as a duration
 * (never as a clock time): «ناقص 20 د 36 ث» means 20 minutes 36 seconds short of the plan.
 * Within `tolerance` seconds either way counts as on time.
 */
export function timingDelta(overUnder: number, tolerance = 30): TimingDelta {
  const gap = Math.round(Number(overUnder) || 0);
  if (Math.abs(gap) <= tolerance) return { text: 'في الوقت', verdict: 'في الوقت', amount: '', state: 'ON_TIME' };
  const amount = durationWords(gap);
  return gap > 0 ? { text: `زائد ${amount}`, verdict: 'زائد', amount, state: 'OVER' } : { text: `ناقص ${amount}`, verdict: 'ناقص', amount, state: 'SHORT' };
}

/**
 * Whether a scheduled bulletin from this format already exists on this day: the one created from
 * the schedule (stable id), or any live bulletin made from the format that day, or (for bulletins
 * made by hand or imported) one of the same kind at the same start time that day.
 */
export function scheduledBulletinExists(
  format: Pick<BulletinFormat, 'id' | 'kind' | 'startTime'>,
  date: string,
  bulletins: Pick<Bulletin, 'id' | 'date' | 'formatId' | 'kind' | 'startTime' | 'deletedAt'>[]
): boolean {
  const id = scheduledBulletinId(format.id, date);
  return bulletins.some(
    (b) =>
      b.id === id ||
      (!b.deletedAt && b.date === date && (b.formatId === format.id || (!b.formatId && b.kind === format.kind && b.startTime === format.startTime)))
  );
}
