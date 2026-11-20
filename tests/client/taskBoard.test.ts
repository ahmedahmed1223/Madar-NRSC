import { describe, expect, it } from 'vitest';
import { canChangeTaskStatus, savedTaskView } from '../../src/services/taskBoard';

describe('task status buttons', () => {
  it('are offered to task managers and to the task\'s own assignee only', () => {
    expect(canChangeTaskStatus({ assigneeId: 'u1' }, 'u1', false)).toBe(true);
    expect(canChangeTaskStatus({ assigneeId: 'u2' }, 'u1', false)).toBe(false);
    expect(canChangeTaskStatus({ assigneeId: undefined }, 'u1', false)).toBe(false);
    expect(canChangeTaskStatus({ assigneeId: 'u2' }, 'u1', true)).toBe(true);
  });
  it('open on the list unless this device chose the board', () => {
    expect(savedTaskView()).toBe('LIST');
  });
});
