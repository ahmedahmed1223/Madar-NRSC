export interface PersonalTaskInput {
  title: string;
  notes: string;
  dueAt: string | null;
  reminderAt: string | null;
  completed: boolean;
}

export interface PersonalTask extends PersonalTaskInput {
  id: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  /** Set by the scheduler for the specific reminder that reached the inbox. */
  reminderSentFor: string | null;
}

export const PERSONAL_TASK_TITLE_LIMIT = 160;
export const PERSONAL_TASK_NOTES_LIMIT = 4000;

function normalizedInstant(value: unknown, error: string): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(error);
  }
  return new Date(value).toISOString();
}

export function preparePersonalTask(id: string, ownerId: string, input: PersonalTaskInput, before?: PersonalTask | null, now = new Date().toISOString()): PersonalTask {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title || title.length > PERSONAL_TASK_TITLE_LIMIT) throw new Error('أدخل عنوانًا صالحًا للمهمة الشخصية');
  if (typeof input.notes !== 'string' || input.notes.length > PERSONAL_TASK_NOTES_LIMIT) throw new Error('ملاحظات المهمة الشخصية غير صالحة');
  if (typeof input.completed !== 'boolean') throw new Error('حالة المهمة الشخصية غير صالحة');
  const dueAt = normalizedInstant(input.dueAt, 'موعد المهمة غير صالح');
  const reminderAt = normalizedInstant(input.reminderAt, 'موعد التذكير غير صالح');
  return {
    id, ownerId, title, notes: input.notes, completed: input.completed, dueAt, reminderAt,
    reminderSentFor: before?.reminderAt === reminderAt ? before.reminderSentFor : null,
    createdAt: before?.createdAt || now, updatedAt: now,
  };
}
