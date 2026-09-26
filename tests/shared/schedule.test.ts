import { describe, expect, it } from 'vitest';
import { episodeWindow, findStudioConflicts, studioConflictsFor } from '../../src/shared/schedule';

const ep = (id: string, startTime: string, endTime: string, extra: Record<string, any> = {}) => ({
  id,
  studioName: 'استوديو A',
  broadcastDate: '2026-09-26',
  startTime,
  endTime,
  ...extra,
});

describe('studio scheduling', () => {
  it('detects partial overlaps, not only identical start times', () => {
    const list = [ep('a', '21:00', '22:00'), ep('b', '21:30', '22:30'), ep('c', '22:30', '23:00')];
    expect([...findStudioConflicts(list)].sort()).toEqual(['a', 'b']);
  });

  it('back-to-back bookings and different studios do not conflict', () => {
    const list = [ep('a', '20:00', '21:00'), ep('b', '21:00', '22:00'), ep('c', '20:30', '21:30', { studioName: 'استوديو B' })];
    expect(findStudioConflicts(list).size).toBe(0);
  });

  it('handles shows that run past midnight', () => {
    const late = ep('late', '23:30', '00:30');
    const early = ep('early', '00:00', '01:00', { broadcastDate: '2026-09-27' });
    expect(episodeWindow(late)!.end - episodeWindow(late)!.start).toBe(60);
    expect(studioConflictsFor(early, [late]).map((e) => e.id)).toEqual(['late']);
  });

  it('ignores deleted and cancelled episodes, and uses duration without an end time', () => {
    const list = [
      ep('a', '21:00', '', { durationMinutes: 45 }),
      ep('b', '21:30', '22:00', { deletedAt: '2026-01-01' }),
      ep('c', '21:30', '22:00', { status: 'CANCELLED' }),
      ep('d', '21:40', '22:00'),
    ];
    expect([...findStudioConflicts(list)].sort()).toEqual(['a', 'd']);
  });

  it('detects a long booking overlapping a later one after a short one ended', () => {
    const list = [ep('long', '18:00', '23:00'), ep('short', '18:30', '19:00'), ep('late', '22:00', '22:30')];
    expect([...findStudioConflicts(list)].sort()).toEqual(['late', 'long', 'short']);
  });
});
