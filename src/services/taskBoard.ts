import type { EditorialTask, TaskStatus } from '../types';

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
