import { describe, expect, it } from 'vitest';
import { addSecondsToTime, bulletinEpisodeClashes, bulletinSlot, episodeSlot, episodeWindow, findStudioClashes, findStudioConflicts, scheduledBulletinSlot, studioConflictsFor } from '../../src/shared/schedule';

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

describe('bulletins on the broadcast calendar', () => {
  const bulletin = { id: 'bul-8', title: 'نشرة الثامنة', kind: 'MAIN', date: '2026-11-20', startTime: '20:00', plannedSeconds: 30 * 60, studioName: 'استوديو A1', anchors: ['فيصل'], status: 'PLANNING' };
  const episode = (id: string, startTime: string, endTime: string, studioName = 'استوديو A1') =>
    episodeSlot({ id, title: id, programName: 'برنامج', studioName, broadcastDate: '2026-11-20', startTime, endTime });

  it('gives a bulletin a slot from its start for its planned length', () => {
    const slot = bulletinSlot(bulletin, 'النشرة الرئيسية');
    expect(slot).toMatchObject({ id: 'bulletin:bul-8', kind: 'bulletin', refId: 'bul-8', startTime: '20:00', endTime: '20:30', durationMinutes: 30 });
    expect(addSecondsToTime('23:50', 20 * 60)).toBe('00:10');
  });

  it('detects a bulletin and an episode in the same studio at overlapping times', () => {
    const clashes = bulletinEpisodeClashes([bulletinSlot(bulletin), episode('ep-a', '20:15', '21:00'), episode('ep-b', '20:30', '21:30'), episode('ep-c', '20:00', '20:20', 'استوديو B')]);
    expect(clashes).toHaveLength(1);
    expect(clashes[0]).toMatchObject({ studioName: 'استوديو A1', overlapMinutes: 15 });
    expect([clashes[0].a.refId, clashes[0].b.refId]).toEqual(['bul-8', 'ep-a']);
  });

  it('also catches a scheduled bulletin that has not been created yet', () => {
    const format = { id: 'fmt-8', name: 'نشرة الثامنة', startTime: '20:00', plannedSeconds: 1800, studioName: 'استوديو a1 ' };
    const clashes = bulletinEpisodeClashes([scheduledBulletinSlot(format, '2026-11-20'), episode('ep-a', '19:45', '20:05')]);
    expect(clashes).toHaveLength(1);
    expect(clashes[0].a.kind).toBe('episode');
    expect(clashes[0].b).toMatchObject({ kind: 'scheduled-bulletin', refId: 'fmt-8', id: 'format:fmt-8:2026-11-20' });
  });

  it('ignores back-to-back slots, other days and deleted bulletins', () => {
    expect(bulletinEpisodeClashes([bulletinSlot(bulletin), episode('ep-a', '20:30', '21:00'), episode('ep-b', '19:00', '20:00')])).toEqual([]);
    expect(bulletinEpisodeClashes([bulletinSlot({ ...bulletin, deletedAt: '2026-11-01' }), episode('ep-a', '20:10', '20:20')])).toEqual([]);
    expect(bulletinEpisodeClashes([bulletinSlot({ ...bulletin, date: '2026-11-21' }), episode('ep-a', '20:10', '20:20')])).toEqual([]);
  });

  it('lists every overlapping pair, episode clashes included', () => {
    const all = findStudioClashes([bulletinSlot(bulletin), episode('ep-a', '19:30', '21:00'), episode('ep-b', '20:45', '21:15')]);
    expect(all.map((c) => [c.a.refId, c.b.refId])).toEqual([['ep-a', 'bul-8'], ['ep-a', 'ep-b']]);
  });
});
