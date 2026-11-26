import type { NewsroomDatabase } from './db';
import { moduleAllowedForUser } from './moduleAccess';
import { writeNotification } from './notifications';
import { changeBus } from './sync';
import type { PersonalTask } from '../shared/personalTasks';

/** Commit the notification and its delivery marker together, including when catching up after restart. */
export function sendDuePersonalTaskReminders(db: NewsroomDatabase, now = new Date()): number {
  const stamp = now.toISOString();
  const sent = db.transaction(() => {
    const due = db.duePersonalTaskReminders(stamp);
    for (const row of due) {
      const task = row.d as PersonalTask;
      if (moduleAllowedForUser(db, 'personalTasks', task.ownerId)) writeNotification(db, {
        userId: task.ownerId,
        category: 'personal-task',
        type: 'TASK',
        title: 'تذكير بمهمة شخصية',
        message: 'حان موعد التذكير. افتح المهمة لمراجعة تفاصيلها.',
        linkUrl: `/personal-tasks/${encodeURIComponent(task.id)}`,
      });
      db.writeRow('personalTasks', task.id, { ...task, reminderSentFor: task.reminderAt }, row.p, null);
    }
    return due.length;
  });
  if (sent) changeBus.emit('rev', db.currentRev());
  return sent;
}
