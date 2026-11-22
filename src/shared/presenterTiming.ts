import type { BulletinStory, StoryType } from './bulletins';
import type { OnAirLogEntry, OnAirState } from './onair';
import { normalizeProductionName } from './productionPeople';
import { countWords, readingSeconds } from './readTime';
import type { RundownSegment } from '../types';

export interface PresenterReading {
  presenterKey: string;
  words: number;
}

export interface PresenterPace {
  wpm: number;
  samples: number;
  sessions: number;
}

type ReadingSegment = Partial<Pick<RundownSegment, 'scriptText' | 'script' | 'segmentType' | 'presenterName' | 'guestId' | 'guestName' | 'guests' | 'mediaIds' | 'videoAssetUrl'>> & {
  storyType?: StoryType;
  notApproved?: boolean;
};

export function presenterKey(name: string | undefined): string {
  if (!name || /[،,؛;&/+\n]/u.test(name)) return '';
  return normalizeProductionName(name);
}

export function anchorScriptWords(script: string | undefined): number {
  return countWords(script?.replace(/\[[^\]]*\]/g, ' '));
}

/** Capture only whole-segment reads. Mixed audio and guest conversation have no reliable read duration. */
export function presenterReading(segment: ReadingSegment | undefined, showPresenter?: string): PresenterReading | null {
  if (!segment || segment.notApproved) return null;
  const pure = segment.storyType ? ['READER', 'HEADLINES'].includes(segment.storyType) :
    ['NEWS_ITEM', 'INTRO', 'OUTRO'].some(type => type === segment.segmentType) &&
    !segment.guestId && !segment.guestName && !segment.guests?.length && !segment.mediaIds?.length && !segment.videoAssetUrl;
  const key = presenterKey(segment.presenterName?.trim() || showPresenter);
  const words = anchorScriptWords(segment.scriptText || segment.script);
  return pure && key && words ? { presenterKey: key, words } : null;
}

export function estimatedSegmentRead(segment: ReadingSegment, paces: ReadonlyMap<string, PresenterPace>, showPresenter?: string): number | null {
  const read = presenterReading(segment, showPresenter);
  const pace = read ? paces.get(read.presenterKey) : undefined;
  return pace && read ? readingSeconds(read.words, pace.wpm) : null;
}

export function rundownBackTimes(
  rundown: readonly (ReadingSegment & { id: string; durationSeconds: number })[], hardOut: number,
  paces: ReadonlyMap<string, PresenterPace>, showPresenter?: string,
) {
  let back = hardOut;
  const rows = new Map<string, { estimatedRead: number | null; back: number }>();
  for (const segment of [...rundown].reverse()) {
    const estimatedRead = estimatedSegmentRead(segment, paces, showPresenter);
    back -= estimatedRead ?? (Number(segment.durationSeconds) || 0);
    rows.set(segment.id, { estimatedRead, back });
  }
  return rows;
}

export function presenterPaces(states: readonly OnAirState[], bulletinStories: readonly BulletinStory[] = []): Map<string, PresenterPace> {
  const historicalStories = new Map(bulletinStories.map(story => [story.id, story]));
  const byPresenter = new Map<string, { sessionId: string; rate: number; words: number; end: number }[]>();
  const readingFor = (entry: OnAirLogEntry, showId: string): PresenterReading | null => {
    if (entry.reading !== undefined) return entry.reading;
    // Old logs can use an explicitly attributed bulletin story only if its copy predates the read.
    const story = historicalStories.get(entry.segmentId);
    if (!story || story.bulletinId !== showId || !(Date.parse(story.updatedAt) <= Date.parse(entry.startedAt))) return null;
    return presenterReading({ storyType: story.type, scriptText: story.script, presenterName: story.anchorName, notApproved: story.status !== 'APPROVED' });
  };
  for (const state of states) {
    const showStart = Date.parse(state.startedAt);
    const showEnd = Date.parse(state.endedAt || '');
    if (state.status !== 'ENDED' || !(showStart < showEnd)) continue;
    const entries = state.log || [];
    const seen = new Set<string>();
    const repeated = new Set<string>();
    for (const entry of entries) {
      if (seen.has(entry.segmentId)) repeated.add(entry.segmentId);
      seen.add(entry.segmentId);
    }
    for (const entry of entries) {
      if (repeated.has(entry.segmentId)) continue;
      const start = Date.parse(entry.startedAt);
      const end = Date.parse(entry.endedAt || '');
      const durationMinutes = (end - start) / 60_000;
      if (!(start >= showStart && end <= showEnd && durationMinutes >= 1 / 6)) continue;
      const read = readingFor(entry, state.episodeId);
      if (!read || !Number.isInteger(read.words) || read.words < 25) continue;
      const rate = read.words / durationMinutes;
      if (!(rate >= 70 && rate <= 240)) continue;
      const records = byPresenter.get(read.presenterKey) || [];
      records.push({ sessionId: state.id, rate, words: read.words, end });
      byPresenter.set(read.presenterKey, records);
    }
  }
  const result = new Map<string, PresenterPace>();
  for (const [key, records] of byPresenter) {
    const recent = records.sort((a, b) => b.end - a.end).slice(0, 30);
    const sessions = new Set(recent.map(record => record.sessionId)).size;
    if (recent.length < 5 || sessions < 2 || recent.reduce((sum, record) => sum + record.words, 0) < 150) continue;
    const rates = recent.map(record => record.rate).sort((a, b) => a - b);
    const middle = Math.floor(rates.length / 2);
    const median = rates.length % 2 ? rates[middle] : (rates[middle - 1] + rates[middle]) / 2;
    result.set(key, { wpm: Math.round(median), samples: recent.length, sessions });
  }
  return result;
}
