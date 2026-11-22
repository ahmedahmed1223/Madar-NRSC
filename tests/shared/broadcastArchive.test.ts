import { expect, it } from 'vitest';
import { airingSummary, broadcastOutcomes, type BroadcastArchiveItem, type BroadcastWithArchive } from '../../src/shared/broadcastArchive';
import { broadcastArchiveFiles } from '../../src/services/broadcastArchiveExport';

const start = '2026-11-22T12:00:00.000Z';
const end = '2026-11-22T12:00:30.000Z';
const item = { id: 'report', title: 'التقرير', plannedSeconds: 40, script: 'نص البث المحفوظ', guestNames: ['ضيف الاختبار'], newsId: 'source', stationId: 'gaza', departmentId: 'field' };
const plan: BroadcastArchiveItem[] = [item, { ...item, id: 'killed', title: 'قصة مسقطة', disposition: 'KILLED', guestNames: [] },
  { ...item, id: 'deferred', disposition: 'DEFERRED', guestNames: [] }, { ...item, id: 'break', countsForOutput: false }];
const ended: BroadcastWithArchive = {
  id: 'show', episodeId: 'show', episodeTitle: 'البرنامج', status: 'ENDED', startedAt: start, endedAt: end,
  currentSegmentId: item.id, segmentStartedAt: start, log: [{ segmentId: item.id, title: item.title, startedAt: start, endedAt: end }], archivedPlan: plan,
};

it('preserves a frozen rundown and distinguishes actual, deferred and killed material', () => {
  expect(broadcastOutcomes(ended).map(row => row.status)).toEqual(['AIRED', 'KILLED', 'DEFERRED', 'NOT_AIRED']);
  expect(airingSummary([ended], (_state, entry) => entry.stationId === 'gaza')).toMatchObject([{ prepared: 3, aired: 1, killed: 1, deferred: 1 }]);
  const files = broadcastArchiveFiles(ended, [{ ...item, script: 'نص عُدّل بعد البث' }], [
    { newsId: 'source', summary: 'تصحيح مرتبط' }, { newsId: 'other', summary: 'تصحيح منفصل' },
  ]);
  expect(files['scripts.txt']).toContain(item.script);
  expect(files['scripts.txt']).not.toContain('عُدّل');
  expect(files['guests.csv']).toContain('ضيف الاختبار');
  expect(files['corrections.csv']).toContain('تصحيح مرتبط');
  expect(files['corrections.csv']).not.toContain('تصحيح منفصل');
});
