import type { Episode, Guest } from '../types';
import { segmentGuests } from './episodePlan';
import type { OnAirState } from './onair';
import { stationWall } from './stationTime';

export interface GuestAppearance {
  episodeId: string;
  episodeTitle: string;
  programName: string;
  date: string;
  topics: string[];
}

export function airedGuestAppearances(episodes: Episode[], states: OnAirState[], zone?: string) {
  const shows = new Map(episodes.filter(episode => !episode.deletedAt).map(episode => [episode.id, episode]));
  const appearances = new Map<string, GuestAppearance[]>();
  for (const state of states) {
    const episode = shows.get(state.episodeId);
    if (!episode || state.status !== 'ENDED' || !Number.isFinite(Date.parse(state.startedAt))) continue;
    const date = stationWall(Date.parse(state.startedAt), zone).date;
    const aired = new Set((state.log || []).map(entry => entry.segmentId));
    const topicsByGuest = new Map<string, Set<string>>();
    for (const segment of episode.rundown || []) {
      if (!aired.has(segment.id)) continue;
      for (const guest of segmentGuests(segment)) {
        const topics = topicsByGuest.get(guest.guestId) || new Set<string>();
        if (segment.title?.trim()) topics.add(segment.title.trim());
        topicsByGuest.set(guest.guestId, topics);
      }
    }
    for (const [id, topics] of topicsByGuest) {
      const entry = { episodeId: episode.id, episodeTitle: episode.title, programName: episode.programName || state.programName || '', date, topics: [...topics] };
      const history = appearances.get(id) || [];
      history.push(entry);
      appearances.set(id, history);
    }
  }
  return appearances;
}

export function guestAppearanceHistory(guest: Guest, aired: GuestAppearance[] = []): GuestAppearance[] {
  const rows = new Map((guest.appearanceHistory || []).map(entry => [entry.episodeId, { ...entry, topics: [] as string[] }]));
  for (const entry of aired) {
    const prior = rows.get(entry.episodeId);
    rows.set(entry.episodeId, { ...entry, topics: [...new Set([...(prior?.topics || []), ...entry.topics])] });
  }
  return [...rows.values()].sort((a, b) => b.date.localeCompare(a.date));
}
