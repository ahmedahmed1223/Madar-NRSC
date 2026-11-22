import { countLabel } from './arabicPlural';

/**
 * One reading-time figure for the whole app: what the anchor reads on air (the lead and the
 * body; the headline is not read), at the Arabic broadcast pace of 130 words a minute.
 */
export const BROADCAST_WPM = 130;

const SECONDS = { one: 'ثانية واحدة', two: 'ثانيتان', few: 'ثوانٍ', many: 'ثانية' };
const MINUTES = { one: 'دقيقة واحدة', two: 'دقيقتان', few: 'دقائق', many: 'دقيقة' };

/** Visible words of a text or an HTML body (tags and entities count as spaces). */
export function countWords(text: string | undefined): number {
  const clean = String(text || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;| /gi, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .trim();
  return clean ? (clean.match(/\S+/g) || []).length : 0;
}

/** The words the anchor reads: the lead (summary) and the body. */
export function spokenWords(summary: string | undefined, bodyHtml: string | undefined): number {
  return countWords(summary) + countWords(bodyHtml);
}

export function readingSeconds(words: number, wpm = BROADCAST_WPM): number {
  return words > 0 ? Math.max(1, Math.round((words / wpm) * 60)) : 0;
}

/** «45 ثانية», «دقيقة واحدة و10 ثوانٍ», «3 دقائق» — never «00:24 دقيقة». */
export function formatReadTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return s === 0 ? '0 ثانية' : countLabel(s, SECONDS);
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest ? `${countLabel(m, MINUTES)} و${countLabel(rest, SECONDS)}` : countLabel(m, MINUTES);
}

/** Compact clock form for chips and prompter headers: «0:45», «2:05». */
export function clockReadTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function spokenReadTime(summary: string | undefined, bodyHtml: string | undefined) {
  const words = spokenWords(summary, bodyHtml);
  const seconds = readingSeconds(words);
  return { words, seconds, label: formatReadTime(seconds), clock: clockReadTime(seconds) };
}
