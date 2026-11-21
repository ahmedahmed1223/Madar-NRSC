import type { EditorialTask, TaskStatus } from '../types';
import { messageEntryPath, splitMessageFocus } from '../shared/chat';
import { normalizeTaskStatus, taskWorkflowOptions, type TaskWorkflowRules } from '../shared/taskWorkflow';
import { stationWorkDay } from '../shared/myWork';
import { weekDays } from '../shared/planning';

/** Board columns, in workflow order. Cancelled tasks sit in their own column, folded by default. */
export const TASK_BOARD_COLUMNS: { status: TaskStatus; label: string; color: string; collapsible?: boolean }[] = [
  { status: 'TODO', label: 'المهام المطلوبة', color: 'border-slate-300' },
  { status: 'IN_PROGRESS', label: 'قيد التنفيذ', color: 'border-blue-400' },
  { status: 'IN_REVIEW', label: 'قيد المراجعة والتدقيق', color: 'border-amber-400' },
  { status: 'BLOCKED', label: 'متوقفة', color: 'border-red-400' },
  { status: 'COMPLETED', label: 'مكتملة ومنجزة', color: 'border-emerald-400' },
  { status: 'CANCELLED', label: 'ملغاة', color: 'border-slate-400', collapsible: true },
];

/** Statuses offered in the filter and the edit form (DONE is the older spelling of COMPLETED). */
export const TASK_STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: 'TODO', label: 'مطلوبة' },
  { value: 'IN_PROGRESS', label: 'قيد التنفيذ' },
  { value: 'IN_REVIEW', label: 'قيد المراجعة' },
  { value: 'BLOCKED', label: 'متوقفة' },
  { value: 'COMPLETED', label: 'مكتملة' },
  { value: 'CANCELLED', label: 'ملغاة' },
];

export function taskStatusChoices(
  status: TaskStatus,
  rules: TaskWorkflowRules | undefined,
  canManage: boolean,
  includeCurrent = false,
) {
  const current = normalizeTaskStatus(status);
  const allowed = new Set<TaskStatus>(taskWorkflowOptions(current, rules, canManage));
  if (includeCurrent) allowed.add(current);
  return TASK_STATUS_OPTIONS.filter((option) => allowed.has(option.value));
}

export const TASK_PERIOD_OPTIONS = [
  { value: 'ALL', label: 'كل المواعيد' },
  { value: 'TODAY', label: 'اليوم' },
  { value: 'WEEK', label: 'هذا الأسبوع' },
  { value: 'MONTH', label: 'هذا الشهر' },
] as const;
export type TaskPeriod = typeof TASK_PERIOD_OPTIONS[number]['value'];

export function taskPeriodMatcher(period: TaskPeriod, now: number, timezone?: string) {
  if (period === 'ALL') return () => true;
  const today = stationWorkDay(new Date(now), timezone);
  const week = period === 'WEEK' ? new Set(weekDays(today)) : undefined;
  return (task: Pick<EditorialTask, 'dueDate' | 'status'>) => {
    if (!task.dueDate || !Number.isFinite(Date.parse(task.dueDate))) return false;
    const dueDay = /^\d{4}-\d{2}-\d{2}$/.test(task.dueDate) ? task.dueDate : stationWorkDay(new Date(task.dueDate), timezone);
    const status = normalizeTaskStatus(task.status);
    if (dueDay < today && status !== 'COMPLETED' && status !== 'CANCELLED') return true;
    if (period === 'TODAY') return dueDay === today;
    if (period === 'WEEK') return !!week?.has(dueDay);
    return dueDay.slice(0, 7) === today.slice(0, 7);
  };
}

/** Is the task assigned to this colleague (either spelling of the assignee field)? */
export function isMyTask(task: Pick<EditorialTask, 'assigneeId' | 'assignedToId'>, userId: string): boolean {
  return (task.assigneeId || task.assignedToId) === userId;
}

export const RELATED_ENTITY_LABELS: Record<string, string> = {
  NEWS: 'خبر',
  EPISODE: 'حلقة',
  PROGRAM: 'برنامج',
  BULLETIN: 'نشرة',
  BULLETIN_STORY: 'قصة في نشرة',
  MESSAGE: 'رسالة',
};

/**
 * In-app path of the record a task was created from, or null when it has none we can open.
 * A bulletin story opens its bulletin (the story's own id is not a route), looked up through `bulletinOfStory`.
 */
export function relatedTaskPath(
  task: Pick<EditorialTask, 'relatedEntityType' | 'relatedEntityId'>,
  bulletinOfStory: (storyId: string) => string | undefined = () => undefined,
): string | null {
  const id = task.relatedEntityId;
  if (!id) return null;
  switch (task.relatedEntityType) {
    case 'MESSAGE': {
      const { channel, messageId } = splitMessageFocus(id);
      return messageId ? messageEntryPath(channel, messageId) : null;
    }
    case 'BULLETIN':
      return `/bulletins/${encodeURIComponent(id)}`;
    case 'BULLETIN_STORY': {
      const bulletinId = bulletinOfStory(id);
      return bulletinId ? `/bulletins/${encodeURIComponent(bulletinId)}` : null;
    }
    case 'NEWS':
      return `/news/${encodeURIComponent(id)}`;
    case 'EPISODE':
      return `/episodes/${encodeURIComponent(id)}`;
    default:
      return null;
  }
}

/**
 * Whether this colleague may move the task between statuses: task managers (tasks.create_assign)
 * move any task, an assignee moves their own (the server applies the same rule).
 */
export function canChangeTaskStatus(task: Pick<EditorialTask, 'assigneeId' | 'assignedToId'>, userId: string, canAssign: boolean): boolean {
  return canAssign || (!!userId && isMyTask(task, userId));
}

export type TaskView = 'LIST' | 'KANBAN';
const VIEW_KEY = 'madar-tasks-view';

/** The list is the default; a colleague's own choice is remembered on this device. */
export function savedTaskView(): TaskView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'KANBAN' ? 'KANBAN' : 'LIST';
  } catch {
    return 'LIST';
  }
}

export function saveTaskView(view: TaskView): void {
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    // Storage blocked: the choice lasts for this visit.
  }
}
