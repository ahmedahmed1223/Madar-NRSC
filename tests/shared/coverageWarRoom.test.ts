import { describe, expect, it } from 'vitest';
import { coverageFieldReporters, coverageTimeline, upcomingBulletinGuests, upcomingCoverageGuests } from '../../src/shared/coverageWarRoom';
import type { Episode, NewsItem, Story } from '../../src/types';
import type { OnAirState } from '../../src/shared/onair';
import type { Bulletin, BulletinStory } from '../../src/shared/bulletins';

const now = Date.parse('2026-11-22T16:00:00Z');
const episode = {
  id: 'episode', title: 'لقاء المساء', status: 'PLANNED', broadcastDate: '2026-11-22', startTime: '19:00',
  guests: [{ guestId: 'g1', guestName: 'هند', arrivalStatus: 'CONFIRMED' }, { guestId: 'g2', guestName: 'زيد', arrivalStatus: 'PENDING' }],
  rundown: [{ id: 'r1', title: 'الميدان', durationSeconds: 90, report: { source: 'FIELD', reporterName: 'عامر', signalStatus: 'CHECKING', signalProvider: 'LIVEU' } },
    { id: 'g1-seg', durationSeconds: 300, guests: [{ guestId: 'g1', guestName: 'هند' }] }],
} as unknown as Episode;

describe('coverage war room', () => {
  it('orders linked newsroom updates by their event timestamps', () => {
    const story = { id: 'parent', title: 'التغطية', startedAt: '2026-11-22T14:00:00Z' } as Story;
    const news = { id: 'news', title: 'الخبر المرتبط', createdAt: '2026-11-22T15:01:00Z', workflowLogs: [
      { id: 'status', timestamp: '2026-11-22T15:10:00Z', fromStatus: 'DRAFT', toStatus: 'APPROVED', changedBy: { name: 'ريم' } },
    ] } as unknown as NewsItem;
    expect(coverageTimeline(story, [news], [], [], []).map(event => event.id)).toEqual(['news:news:status', 'news:news', 'coverage:parent']);
  });

  it('shows confirmed guests due within three hours at their segment time in the station zone', () => {
    const late = { ...episode, id: 'late', startTime: '22:01' };
    const guests = upcomingCoverageGuests([episode, late], now, 'Asia/Riyadh');
    expect(guests.map(guest => [guest.name, guest.episodeId, new Date(guest.at).toISOString()])).toEqual([['هند', 'episode', '2026-11-22T16:01:30.000Z']]);
  });

  it('keeps manually checked transmitter state and on-air status distinct', () => {
    const states = [{ episodeId: episode.id, status: 'LIVE', currentSegmentId: 'r1' }] as OnAirState[];
    expect(coverageFieldReporters([{ episode, segment: episode.rundown![0] }], states, [])).toEqual([
      expect.objectContaining({ name: 'عامر', onAir: true, signalStatus: 'CHECKING', signalProvider: 'LIVEU' }),
    ]);
  });

  it('includes confirmed bulletin guests at the first on-air story and leaves floated stories out', () => {
    const bulletin: Bulletin = { id: 'b', title: 'النشرة', date: '2026-11-22', startTime: '19:00', plannedSeconds: 300, status: 'PLANNING',
      kind: 'MAIN', anchors: [], createdAt: '2026-11-21T16:00:00Z', updatedAt: '2026-11-21T16:00:00Z' };
    const stories = [
      { id: 'break', bulletinId: 'b', rank: 0, type: 'BREAK', manualSeconds: 60 },
      { id: 'confirmed', bulletinId: 'b', rank: 1, type: 'LIVE', remoteGuest: { guestId: 'confirmed', confirmed: true } },
      { id: 'floated', bulletinId: 'b', rank: 2, type: 'LIVE', floated: true, remoteGuest: { guestId: 'floated', confirmed: true } },
    ] as BulletinStory[];
    const guests = [{ id: 'confirmed', fullName: 'هند' }, { id: 'floated', fullName: 'فلان' }];
    expect(upcomingBulletinGuests([bulletin], stories, guests, now, 'Asia/Riyadh').map(row => [row.name, new Date(row.at).toISOString()]))
      .toEqual([['هند', '2026-11-22T16:01:00.000Z']]);
  });
});
