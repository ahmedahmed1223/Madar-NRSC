import { isStepOpen, stepTypeName, stepTypesOf, type ProductionCard } from '../shared/productionCards';
import { normalizeTaskStatus } from '../shared/taskWorkflow';
import { workReminderEnabled, workReminderInstant } from '../shared/workReminders';
import type { EditorialTask } from '../types';
import type { NewsroomDatabase } from './db';
import { writeNotification } from './notifications';
import { changeBus } from './sync';

export type WorkReminderCollection = 'tasks' | 'productionCards';
export interface WorkReminder {
  slot: string;
  kind: 'deadline' | 'overdue';
  userId: string;
  fireAt: string;
  enabled: number;
}

const OVERDUE_MINUTES = 15;

/** Reconcile an opted-in deadline within the same transaction as the task or card write. */
export function updateWorkReminders(db: NewsroomDatabase, collection: WorkReminderCollection, id: string, value: EditorialTask | ProductionCard | null) {
  const options = value?.reminderOptions;
  const jobs: WorkReminder[] = [];
  const add = (slot: string, userId: string | undefined, dueAt: string | undefined, enabled: boolean) => {
    const due = workReminderInstant(dueAt);
    if (!userId || !Number.isFinite(due)) return;
    const schedule = (kind: WorkReminder['kind'], delay: number) => jobs.push({ slot, kind, userId, fireAt: new Date(due + delay * 60_000).toISOString(), enabled: Number(enabled) });
    if (options?.leadMinutes != null) schedule('deadline', -options.leadMinutes);
    if (options?.overdue) schedule('overdue', OVERDUE_MINUTES);
  };
  if (value && workReminderEnabled(options)) {
    if (collection === 'tasks') {
      const task = value as EditorialTask;
      add('task', task.assigneeId || task.assignedToId, task.dueDate, !['COMPLETED', 'CANCELLED'].includes(normalizeTaskStatus(task.status)));
    } else {
      const card = value as ProductionCard;
      const open = card.status === 'OPEN';
      add('card', card.ownerId, card.dueAt || card.airAt, open);
      for (const step of card.steps) add(`step:${step.id}`, step.assigneeId, step.dueAt, open && isStepOpen(step));
    }
  }
  db.replaceWorkReminders(collection, id, jobs);
}

export function sendDueWorkReminders(db: NewsroomDatabase, now = new Date()): number {
  const stamp = now.toISOString();
  const sent = db.transaction(() => {
    const jobs = db.dueWorkReminders(stamp);
    const types = stepTypesOf(db.getRow('settings', 'singleton')?.d);
    for (const job of jobs) {
      const item = db.getRow(job.collection, job.entityId)?.d;
      if (item && !item.deletedAt) {
        const stepId = job.slot.startsWith('step:') ? job.slot.slice(5) : undefined;
        const step = stepId ? (item as ProductionCard).steps.find(candidate => candidate.id === stepId) : undefined;
        const name = step ? `${item.title} — ${step.title || stepTypeName(types, step.type)}` : item.title;
        writeNotification(db, {
          userId: job.userId,
          category: 'assignment-reminder',
          type: 'TASK',
          title: job.kind === 'overdue' ? 'تأخر موعد التسليم' : 'تذكير بموعد التسليم',
          message: name,
          linkUrl: `/${job.collection === 'tasks' ? 'tasks' : 'cards'}/${encodeURIComponent(job.entityId)}`,
        });
      }
      db.markWorkReminderSent(job, stamp);
    }
    return jobs.length;
  });
  if (sent) changeBus.emit('rev', db.currentRev());
  return sent;
}
