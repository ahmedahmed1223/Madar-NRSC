import { expect, it } from 'vitest';
import { nextProgrammeEpisodes } from '../../src/shared/productionPreflight';
import { suggestedStudioStart } from '../../src/shared/schedule';

it('chooses the next scheduled episode per programme in station time', () => {
  const now = Date.parse('2026-11-21T15:00:00Z');
  const episode = (id: string, startTime: string, extra: Record<string, unknown> = {}) => ({ id, programId: 'program', status: 'IN_PREPARATION', broadcastDate: '2026-11-21', startTime, ...extra });
  const episodes = [episode('past', '16:00'), episode('cancelled', '17:05', { status: 'CANCELLED' }), episode('finished', '17:10', { status: 'BROADCASTED' }), episode('later', '18:00'), episode('next', '17:30'), episode('other', '17:10', { programId: 'other' }), episode('invalid', '99:00')];
  const upcoming = nextProgrammeEpisodes(episodes, now, 'Asia/Hebron');
  expect(upcoming.get('program')?.id).toBe('next');
  expect(upcoming.get('other')?.id).toBe('other');
});

it('finds an advisory studio slot of the same duration after consecutive clashes', () => {
  const slot = (id: string, startTime: string, endTime: string, extra: Record<string, unknown> = {}) => ({ id, broadcastDate: '2026-11-21', studioName: 'Studio A', startTime, endTime, ...extra });
  const candidate = slot('candidate', '23:25', '00:05');
  const others = [slot('late', '23:20', '23:45'), slot('night', '23:45', '00:15'), slot('other-studio', '00:05', '02:00', { broadcastDate: '2026-11-22', studioName: 'Studio B' })];
  expect(suggestedStudioStart(candidate, others)).toEqual({ date: '2026-11-22', startTime: '00:15' });
  expect(suggestedStudioStart(candidate, [])).toBeNull();
});
