import type { EditorialTask } from '../types';
import type { ProductionCard } from './productionCards';

export function assignedWorkOnly(can: (permission: string) => boolean): boolean {
  return can('work.assigned_only') && !can('tasks.create_assign') && !can('cards.manage');
}

export function taskAssignedTo(task: Pick<EditorialTask, 'assigneeId' | 'assignedToId'> | undefined, userId: string): boolean {
  return (task?.assigneeId || task?.assignedToId) === userId;
}

export function cardAssignedTo(card: Pick<ProductionCard, 'ownerId' | 'steps'> | undefined, userId: string): boolean {
  return card?.ownerId === userId || !!card?.steps?.some((step) => step.assigneeId === userId && step.status !== 'SKIPPED');
}
