import type { Episode, Guest, MediaFile, NewsItem, RundownSegment, Story } from '../types';
import { bulletinTiming, type Bulletin, type BulletinStory } from './bulletins';
import type { TeamComment } from './comments';
import { fromLocalInputValue } from './dates';
import { bookingStatusOf, episodeGuestList, guestKey, isBooked, segmentGuests } from './episodePlan';
import { NEWS_STATUS_LABELS } from './newsWorkflow';
import type { OnAirState } from './onair';
import { requestStatusName, type DeptRequest } from './production';
import type { ProductionCard } from './productionCards';

export interface CoverageSegment { episode: Episode; segment: RundownSegment }

interface CoverageEvent {
  id: string;
  at: string;
  label: string;
  detail: string;
  link?: string;
}

const WORKFLOW_ACTIONS = {
  QUALITY_PASSED: 'اجتاز الخبر التدقيق', REVIEW_CLAIMED: 'بدأت مراجعة الخبر',
  REVIEW_RELEASED: 'تحرير حجز المراجعة', BREAKING_REQUESTED: 'طلب النشر العاجل',
};

export function coverageTimeline(story: Story, news: readonly NewsItem[], requests: readonly DeptRequest[], media: readonly MediaFile[], comments: readonly TeamComment[],
  related?: { segments: readonly CoverageSegment[]; sessions: readonly OnAirState[]; cards: readonly ProductionCard[] }): CoverageEvent[] {
  const events: CoverageEvent[] = [];
  const add = (id: string, at: string | undefined, label: string, detail: string, link?: string) => {
    if (at && Number.isFinite(Date.parse(at))) events.push({ id, at, label, detail, link });
  };
  add(`coverage:${story.id}`, story.startedAt || story.createdAt, 'بدأت التغطية', story.title);
  add(`coverage:${story.id}:end`, story.endedAt, 'انتهت التغطية', story.title);
  for (const item of news) {
    const id = `news:${item.id}`;
    const link = `/news/${encodeURIComponent(item.id)}`;
    add(id, item.createdAt, 'أُضيف خبر', item.title, link);
    for (const update of item.workflowLogs || []) {
      const label = update.action ? WORKFLOW_ACTIONS[update.action] : update.fromStatus !== update.toStatus ? NEWS_STATUS_LABELS[update.toStatus] : '';
      if (label) add(`${id}:${update.id}`, update.timestamp, label, [item.title, update.changedBy?.name].filter(Boolean).join(' · '), link);
    }
  }
  for (const request of requests) {
    const id = `request:${request.id}`;
    const link = `/requests/${encodeURIComponent(request.id)}`;
    add(id, request.createdAt, 'أُرسل طلب إلى قسم', request.title, link);
    for (const [index, update] of (request.history || []).entries()) {
      if (update.at === request.createdAt && update.status === 'OPEN') continue;
      add(`${id}:${index}`, update.at, requestStatusName(update.status), [request.title, update.byName].filter(Boolean).join(' · '), link);
    }
  }
  for (const file of media) add(`media:${file.id}`, file.createdAt, 'أُضيف ملف وسائط', file.title || file.fileName, `/media/${encodeURIComponent(file.id)}`);
  for (const comment of comments) add(`comment:${comment.id}`, comment.createdAt, `تعليق · ${comment.authorName}`, comment.text);
  for (const card of related?.cards || []) add(`card:${card.id}`, card.createdAt, 'أُنشئ تكليف', card.title, `/cards/${encodeURIComponent(card.id)}`);
  const linkedSegments = new Set(related?.segments.map(({ episode, segment }) => `${episode.id}:${segment.id}`));
  for (const state of related?.sessions || []) {
    for (const entry of state.log || []) {
      if (!linkedSegments.has(`${state.episodeId}:${entry.segmentId}`)) continue;
      add(`air:${state.episodeId}:${entry.segmentId}:${entry.startedAt}`, entry.startedAt, 'بدأت الفقرة على الهواء', entry.title, `/episodes/${encodeURIComponent(state.episodeId)}`);
    }
  }
  return events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.id.localeCompare(b.id));
}

export function upcomingCoverageGuests(episodes: readonly Episode[], now: number, zone?: string) {
  return episodes.flatMap(episode => {
    if (episode.deletedAt || ['CANCELLED', 'ARCHIVED', 'BROADCASTED'].includes(episode.status) || !episode.broadcastDate || !episode.startTime) return [];
    const start = Date.parse(fromLocalInputValue(`${episode.broadcastDate}T${episode.startTime}`, zone));
    if (!Number.isFinite(start)) return [];
    const guestOffsets = new Map<string, number>();
    let offset = 0;
    for (const segment of episode.rundown || []) {
      for (const guest of segmentGuests(segment)) if (!guestOffsets.has(guest.guestId)) guestOffsets.set(guest.guestId, offset);
      offset += Math.max(0, Number(segment.durationSeconds) || 0) * 1000;
    }
    return episodeGuestList(episode).flatMap(guest => {
      const status = bookingStatusOf(guest);
      const at = start + (guestOffsets.get(guestKey(guest)) || 0);
      return isBooked(status) && now <= at && at <= now + 3 * 3600_000 ? [{
        id: `${episode.id}:${guestKey(guest)}`, episodeId: episode.id, episodeTitle: episode.title,
        name: guest.guestName || guest.fullName || '', connectionType: guest.connectionType, status, at,
      }] : [];
    });
  }).sort((a, b) => a.at - b.at);
}

export function upcomingBulletinGuests(bulletins: readonly Bulletin[], stories: readonly BulletinStory[], guests: readonly Pick<Guest, 'id' | 'fullName'>[], now: number, zone?: string) {
  const names = new Map(guests.map(guest => [guest.id, guest.fullName]));
  return bulletins.flatMap(bulletin => {
    if (bulletin.deletedAt || ['CANCELLED', 'DONE'].includes(bulletin.status)) return [];
    const start = Date.parse(fromLocalInputValue(`${bulletin.date}T${bulletin.startTime}`, zone));
    if (!Number.isFinite(start)) return [];
    const list = stories.filter(story => story.bulletinId === bulletin.id);
    const timing = bulletinTiming(bulletin, list);
    return list.flatMap(story => {
      const row = timing.rows.get(story.id);
      if (!story.remoteGuest?.confirmed || !row) return [];
      const at = start + (row.front - timing.start) * 1000;
      return now <= at && at <= now + 3 * 3600_000 ? [{ id: story.id, bulletinId: bulletin.id, title: bulletin.title,
        name: names.get(story.remoteGuest.guestId) || 'ضيف مؤكد', phone: story.type === 'PHONE', at,
      }] : [];
    });
  }).sort((a, b) => a.at - b.at);
}

export function coverageFieldReporters(segments: readonly CoverageSegment[], states: readonly OnAirState[], requests: readonly DeptRequest[]) {
  const live = new Map(states.filter(state => state.status === 'LIVE').map(state => [state.episodeId, state.currentSegmentId]));
  return segments.flatMap(({ episode, segment }) => {
    const report = segment.report;
    if (!report || !['FIELD', 'ASSIGNED'].includes(report.source)) return [];
    const request = requests.find(item => item.type === 'FIELD' && item.link?.segmentId === segment.id && item.link.episodeId === episode.id && item.status !== 'CANCELLED');
    return [{
      id: `${episode.id}:${segment.id}`, episodeId: episode.id, title: segment.title,
      name: report.reporterName || request?.assigneeName || request?.addressedToName,
      location: report.location, onAir: live.get(episode.id) === segment.id,
      signalProvider: report.signalProvider, signalStatus: report.signalStatus,
    }];
  }).sort((a, b) => Number(b.onAir) - Number(a.onAir));
}
