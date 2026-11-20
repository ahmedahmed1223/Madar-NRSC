import type { CountForms } from './arabicPlural';
import { STORY_TYPES } from './bulletins';

/** Counted nouns of the programme screens, for countLabel (shared/arabicPlural). */
export const EP_NOUNS = {
  segment: { one: 'فقرة واحدة', two: 'فقرتان', few: 'فقرات', many: 'فقرة', zero: 'بلا فقرات' },
  topic: { one: 'محور واحد', two: 'محوران', few: 'محاور', many: 'محوراً', zero: 'بلا محاور' },
  question: { one: 'سؤال واحد', two: 'سؤالان', few: 'أسئلة', many: 'سؤالاً', zero: 'بلا أسئلة' },
  guest: { one: 'ضيف واحد', two: 'ضيفان', few: 'ضيوف', many: 'ضيفاً', zero: 'بلا ضيوف' },
  gap: { one: 'نقص واحد', two: 'نقصان', few: 'نواقص', many: 'نقصاً', zero: 'بلا نواقص' },
  item: { one: 'عنصر واحد', two: 'عنصران', few: 'عناصر', many: 'عنصراً', zero: 'لا عناصر' },
  program: { one: 'برنامج واحد', two: 'برنامجان', few: 'برامج', many: 'برنامجاً', zero: 'لا برامج' },
  clash: { one: 'تعارض واحد', two: 'تعارضان', few: 'تعارضات', many: 'تعارضاً', zero: 'لا تعارضات' },
  show: { one: 'موعد واحد', two: 'موعدان', few: 'مواعيد', many: 'موعداً', zero: 'لا مواعيد' },
} as const satisfies Record<string, CountForms>;

/** Arabic names of rundown segment types (never show the raw code such as NEWS_ITEM). */
export const SEGMENT_TYPE_NAMES: Record<string, string> = {
  INTRO: 'مقدمة',
  REPORT: 'تقرير مصور',
  NEWS_ITEM: 'خبر',
  LIVE_INTERVIEW: 'مقابلة',
  DISCUSSION: 'نقاش',
  BREAK: 'فاصل',
  OUTRO: 'ختام',
};

/** The type of a segment in words: a bulletin story keeps its own story type («صورة وتصريح»). */
export function segmentTypeName(seg: { segmentType?: string; storyType?: string } | null | undefined): string {
  if (!seg) return '';
  if (seg.storyType) {
    const story = STORY_TYPES.find((t) => t.id === seg.storyType);
    if (story) return story.name;
  }
  return SEGMENT_TYPE_NAMES[seg.segmentType || ''] || 'فقرة';
}
