import { expect, it } from 'vitest';
import type { Episode, Guest, NewsItem } from '../../src/types';
import { overlappingGuestBookings, overlappingNews } from '../../src/shared/coverageOverlap';
import { airedGuestAppearances, guestAppearanceHistory } from '../../src/shared/guestAppearances';
import type { OnAirState } from '../../src/shared/onair';

const at = '2026-11-22T12:00:00.000Z';
const now = Date.parse(at);
const directory = [{ id: 'other', stationId: 'beirut' }, { id: 'same', stationId: 'gaza' }];

it('warns about recent authorized cross-station copy and confirmed guest bookings', () => {
  const headline = 'افتتاح مؤتمر الاستثمار الإقليمي في العاصمة';
  const copy = { title: headline, createdAt: at, status: 'DRAFT', authorId: 'other' };
  expect(overlappingNews(headline, [
    { ...copy, id: 'match' }, { ...copy, id: 'same', authorId: 'same' },
    { ...copy, id: 'old', createdAt: '2026-11-20T10:00:00.000Z' },
    { ...copy, id: 'under-embargo', embargoUntil: '2026-11-23T00:00:00.000Z' },
  ] as NewsItem[], directory, 'gaza', undefined, now).map(match => match.item.id)).toEqual(['match']);
  const booking = { guestId: 'guest', bookingStatus: 'CONFIRMED', connectionType: 'ZOOM_SKYPE', bookingChangedAt: at };
  expect(overlappingGuestBookings('guest', 'local', [
    { id: 'remote', producerId: 'other', status: 'PREPARING', guests: [booking] },
    { id: 'unconfirmed', producerId: 'other', status: 'PREPARING', guests: [{ ...booking, bookingStatus: 'CANDIDATE' }] },
  ] as Episode[], directory, 'gaza', now).map(match => match.episode.id)).toEqual(['remote']);
});

it('counts a guest only once and records topics that actually aired', () => {
  const episode = { id: 'episode', title: 'الحلقة', programName: 'البرنامج', rundown: [
    { id: 'aired', title: 'المحور المذاع', guests: [{ guestId: 'guest', role: 'MAIN' }] },
    { id: 'dropped', title: 'المحور المسقط', guests: [{ guestId: 'guest', role: 'MAIN' }] },
  ] } as Episode;
  const states = [{ episodeId: 'episode', status: 'ENDED', startedAt: at, log: [{ segmentId: 'aired' }] }] as OnAirState[];
  const actual = airedGuestAppearances([episode], states, 'Asia/Hebron');
  const history = guestAppearanceHistory({ appearanceHistory: [{ episodeId: 'episode', episodeTitle: 'نسخة قديمة', programName: 'البرنامج', date: '2026-11-22' }] } as Guest, actual.get('guest'));
  expect(history).toMatchObject([{ episodeId: 'episode', episodeTitle: 'الحلقة', topics: ['المحور المذاع'] }]);
});
