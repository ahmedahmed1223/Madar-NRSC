import { expect, it } from 'vitest';
import { episodeStudioBookings, mediaDeliveryQueue } from '../../src/shared/productionWorkQueues';
import type { Booking, Resource } from '../../src/shared/planning';
import type { DeptRequest } from '../../src/shared/production';

const when = '2026-11-20T12:00:00.000Z';
const resource = (id: string, kind: Resource['kind']): Resource => ({ id, kind, name: id, isActive: true, updatedAt: when, createdAt: when });
const booking = (id: string, extra: Partial<Booking> = {}): Booking => ({
  id, resourceId: 'studio', status: 'CONFIRMED', link: { kind: 'episode', id: 'episode', title: 'Episode' },
  title: id, start: when, end: '2026-11-20T13:00:00.000Z', createdAt: when, updatedAt: when, ...extra,
});
const request = (id: string, extra: Partial<DeptRequest> = {}): DeptRequest => ({
  id, title: id, type: 'MONTAGE', departmentId: 'montage', priority: 'NORMAL', status: 'OPEN',
  requesterId: 'producer', requesterName: 'Producer', createdAt: when, updatedAt: when, ...extra,
});

it('only shows active studio bookings linked to this episode and sorts by start time', () => {
  const records = [booking('later', { start: '2026-11-20T13:00:00.000Z', end: '2026-11-20T14:00:00.000Z' }),
    booking('tentative', { status: 'TENTATIVE' }), booking('cancelled', { status: 'CANCELLED' }), booking('deleted', { deletedAt: when }),
    booking('camera', { resourceId: 'camera' }), booking('unavailable', { resourceId: 'unknown' }),
    booking('other-episode', { link: { kind: 'episode', id: 'another', title: 'Another' } }),
    booking('wrong-kind', { link: { kind: 'news', id: 'episode', title: 'News' } })];
  expect(episodeStudioBookings('episode', records, [resource('studio', 'STUDIO'), resource('camera', 'CAMERA')]).map(b => b.id))
    .toEqual(['tentative', 'later']);
});

it('orders actionable media requests by urgency, real deadlines, age and stable ID', () => {
  const records = [request('invalid-deadline', { dueAt: 'invalid' }), request('urgent', { priority: 'URGENT' }),
    request('later', { dueAt: '2026-11-21T12:00:00.000Z' }), request('b', { dueAt: when }),
    request('a', { dueAt: when }), request('earlier-created', { dueAt: when, createdAt: '2026-11-19T12:00:00.000Z' }),
    request('accepted', { status: 'ACCEPTED', dueAt: '2026-11-19T12:00:00.000Z' }),
    request('done', { status: 'DONE' }), request('deleted', { deletedAt: when })];
  expect(mediaDeliveryQueue(records, 'montage', false).map(r => r.id))
    .toEqual(['urgent', 'accepted', 'earlier-created', 'a', 'b', 'later', 'invalid-deadline']);
});

it('includes only media work in the handler scope', () => {
  const records = [request('mine'), request('graphics', { type: 'GRAPHICS', departmentId: 'graphics' }),
    request('archive', { type: 'ARCHIVE', departmentId: 'archive' }), request('studio', { type: 'STUDIO', departmentId: 'studio' })];
  expect(mediaDeliveryQueue(records, 'montage', false).map(r => r.id)).toEqual(['mine']);
  expect(mediaDeliveryQueue(records, 'montage', true).map(r => r.id)).toEqual(['archive', 'graphics', 'mine']);
});

it('keeps a locally completed delivery visible while its write is pending', () => {
  const records = [request('awaiting-server', { status: 'DONE' }), request('confirmed', { status: 'DONE' })];
  expect(mediaDeliveryQueue(records, 'montage', false, new Set(['awaiting-server'])).map(r => r.id)).toEqual(['awaiting-server']);
});
