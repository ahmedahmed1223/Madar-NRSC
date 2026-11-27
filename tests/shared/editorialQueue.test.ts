import { describe, expect, it } from 'vitest';
import { managerQueue } from '../../src/shared/editorialQueue';
import { taskAssigneeId } from '../../src/shared/assignedWork';
import { isTaskClosed, normalizeTaskStatus } from '../../src/shared/taskWorkflow';
import { normalizeTaskStatus as labelsNormalizeTaskStatus } from '../../src/shared/labels';
import type { Bulletin, BulletinStory } from '../../src/shared/bulletins';
import type { EditorialTask, User } from '../../src/types';

const reporter: User = {
  id: 'usr-reporter',
  fullName: 'مراسل اختبار',
  email: 'reporter@example.test',
  role: 'REPORTER',
  department: 'الأخبار',
  avatarUrl: '',
  jobTitle: 'مراسل',
  createdAt: '2026-11-27T08:00:00Z',
  isActive: true,
};

const bulletin: Bulletin = {
  id: 'bul-1',
  title: 'نشرة المنتصف',
  kind: 'MAIN',
  date: '2026-11-27',
  startTime: '12:00',
  plannedSeconds: 1800,
  anchors: [],
  status: 'PLANNING',
  editorId: 'usr-editor',
  createdAt: '2026-11-27T08:00:00Z',
  updatedAt: '2026-11-27T08:00:00Z',
};

const story: BulletinStory = {
  id: 'story-1',
  bulletinId: 'bul-1',
  slug: 'متابعة ميدانية',
  type: 'PKG',
  script: 'نص تمهيدي',
  status: 'DRAFT',
  rank: 1,
  writerId: 'usr-other',
  createdAt: '2026-11-27T08:00:00Z',
  updatedAt: '2026-11-27T08:00:00Z',
};

describe('task status & assignee helpers', () => {
  it('re-exports the single normalizeTaskStatus and exposes isTaskClosed', () => {
    expect(labelsNormalizeTaskStatus).toBe(normalizeTaskStatus);
    expect(normalizeTaskStatus('DONE')).toBe('COMPLETED');
    expect(normalizeTaskStatus(undefined)).toBe('TODO');
    expect(isTaskClosed('DONE')).toBe(true);
    expect(isTaskClosed('COMPLETED')).toBe(true);
    expect(isTaskClosed('CANCELLED')).toBe(true);
    expect(isTaskClosed('IN_PROGRESS')).toBe(false);
    expect(isTaskClosed(undefined)).toBe(false);
  });

  it('resolves taskAssigneeId from assigneeId or legacy assignedToId', () => {
    expect(taskAssigneeId({ assigneeId: 'u1', assignedToId: 'u2' })).toBe('u1');
    expect(taskAssigneeId({ assignedToId: 'u2' })).toBe('u2');
    expect(taskAssigneeId(undefined)).toBeUndefined();
  });
});

describe('editorialQueue legacy assigneeId compatibility', () => {
  it('surfaces bulletin story and bulletin tasks that only have legacy assignedToId', () => {
    const legacyStoryTask: EditorialTask = {
      id: 'tsk-story-legacy',
      title: 'تجهيز مادة القصة',
      priority: 'HIGH',
      status: 'IN_PROGRESS',
      assignedToId: reporter.id,
      relatedEntityType: 'BULLETIN_STORY',
      relatedEntityId: story.id,
      dueDate: '2026-11-27T11:00:00Z',
    };
    const legacyBulletinTask: EditorialTask = {
      id: 'tsk-bul-legacy',
      title: 'متابعة ضيف النشرة',
      priority: 'MEDIUM',
      status: 'TODO',
      assignedToId: reporter.id,
      relatedEntityType: 'BULLETIN',
      relatedEntityId: bulletin.id,
      dueDate: '2026-11-27T11:30:00Z',
    };
    const closedLegacyTask: EditorialTask = {
      id: 'tsk-closed-legacy',
      title: 'مهمة مكتملة',
      priority: 'LOW',
      status: 'DONE',
      assignedToId: reporter.id,
      relatedEntityType: 'BULLETIN',
      relatedEntityId: bulletin.id,
    };

    const rows = managerQueue({
      user: reporter,
      bulletins: [bulletin],
      stories: [story],
      tasks: [legacyStoryTask, legacyBulletinTask, closedLegacyTask],
      readiness: [],
      now: new Date('2026-11-27T10:00:00Z'),
      teamScope: false,
    });

    expect(rows.map((r) => r.taskId)).toEqual(['tsk-story-legacy', 'tsk-bul-legacy']);
    expect(rows[0].assigneeId).toBe(reporter.id);
    expect(rows[0].unassigned).toBe(false);
    expect(rows[1].assigneeId).toBe(reporter.id);
    expect(rows[1].unassigned).toBe(false);
  });
});
