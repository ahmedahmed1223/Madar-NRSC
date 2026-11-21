import { describe, expect, it } from 'vitest';
import { stampTaskWorkflow, taskTiming, taskTransitionError, taskWorkflowOptions } from '../../src/shared/taskWorkflow';
import type { EditorialTask } from '../../src/types';

const initial: EditorialTask = { id: 'task-duration', title: 'إعداد التقرير', priority: 'NORMAL', status: 'TODO' };
const at = (minutes: number) => new Date(Date.UTC(2026, 10, 21, 12, minutes)).toISOString();

describe('task execution workflow', () => {
  it('pauses active work while blocked or awaiting review and accumulates earlier work after reopening', () => {
    const active = stampTaskWorkflow(initial, { ...initial, status: 'IN_PROGRESS' }, 'reporter', at(0));
    const blocked = stampTaskWorkflow(active, { ...active, status: 'BLOCKED', blockedReason: 'المقطع لم يصل' }, 'reporter', at(12));
    expect(taskTiming(blocked, Date.parse(at(20)))).toEqual({ activeSeconds: 720, elapsedSeconds: 1200 });
    const resumed = stampTaskWorkflow(blocked, { ...blocked, status: 'IN_PROGRESS' }, 'reporter', at(20));
    const review = stampTaskWorkflow(resumed, { ...resumed, status: 'IN_REVIEW' }, 'reporter', at(35));
    const completed = stampTaskWorkflow(review, { ...review, status: 'COMPLETED' }, 'editor', at(45));
    expect(taskTiming(completed, Date.parse(at(60)))).toEqual({ activeSeconds: 1620, elapsedSeconds: 2700 });
    const reopened = stampTaskWorkflow(completed, { ...completed, status: 'IN_PROGRESS' }, 'editor', at(60));
    expect(taskTiming(reopened, Date.parse(at(62))).activeSeconds).toBe(1740);
    expect(reopened.statusHistory?.find((entry) => entry.status === 'BLOCKED')?.reason).toBe('المقطع لم يصل');
  });

  it('keeps legacy tasks readable and enforces optional workflow gates', () => {
    const legacy: EditorialTask = { ...initial, status: 'DONE', completedAt: at(45) };
    expect(taskTiming(legacy, Date.parse(at(60)))).toEqual({ activeSeconds: 0, elapsedSeconds: null });
    expect(taskWorkflowOptions('IN_PROGRESS', { requireReview: true }, true)).not.toContain('COMPLETED');
    expect(taskWorkflowOptions('IN_REVIEW', { requireReview: true }, true)).toContain('COMPLETED');
    expect(taskWorkflowOptions('DONE', { reopenManagersOnly: true }, false)).toEqual([]);
    expect(taskTransitionError(initial, { ...initial, status: 'BLOCKED' }, { requireBlockedReason: true }, false)).toBeTruthy();
    expect(taskTransitionError(initial, { ...initial, status: 'CANCELLED' }, {}, false)).toBeTruthy();
  });
});
