import { expect, it } from 'vitest';
import { managerQueue } from '../src/shared/editorialQueue';
import { reviewThreadError, anchorStatus } from '../src/shared/reviewThreads';
it('queues only personal assignments unless team scope is authorized', () => {
  const input: any = { user: { id: 'u', role: 'VIEWER' }, bulletins: [{ id: 'b', date: '2026-10-07', startTime: '20:00', editorId: 'u' }], stories: [], tasks: [{ id: 't', relatedEntityType: 'BULLETIN', relatedEntityId: 'b', assigneeId: 'other', dueDate: '2026-10-01', status: 'TODO' }], readiness: [], now: new Date('2026-10-07'), teamScope: false };
  expect(managerQueue(input).some(r => r.taskId === 't')).toBe(false);
});
it('review anchors reject oversize quotes and do not guess ambiguous locations', () => {
  expect(reviewThreadError({ collection: 'news', entityId: 'n', field: 'content', baseVersion: 'stamp', quote: 'x'.repeat(2001), contextBefore: '', contextAfter: '', resolved: false })).toBeTruthy();
  expect(anchorStatus('hello hello', 'hello')).toBe('ambiguous');
  expect(anchorStatus('changed text', 'hello')).toBe('stale');
});
it('a new required approver sees an already approved story in their personal queue', () => {
  const rows = managerQueue({ user: { id: 'next', role: 'VIEWER' } as any, bulletins: [{ id: 'b', date: '2026-10-07', startTime: '20:00', approvalSteps: [{ id: 'new', kind: 'USER', userId: 'next' }] }] as any, stories: [{ id: 's', bulletinId: 'b', status: 'APPROVED', approvals: [], slug: 'pending' }] as any, tasks: [], readiness: [], now: new Date(), teamScope: false });
  expect(rows).toEqual([expect.objectContaining({ storyId: 's', waitingApproval: true })]);
});
