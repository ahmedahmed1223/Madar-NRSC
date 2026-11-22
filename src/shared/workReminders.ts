export const WORK_REMINDER_OFFSETS = [
  { value: 0, label: 'عند الموعد' },
  { value: 15, label: 'قبل الموعد بـ15 دقيقة' },
  { value: 60, label: 'قبل الموعد بساعة' },
  { value: 1440, label: 'قبل الموعد بيوم' },
] as const;

export interface WorkReminderOptions {
  leadMinutes?: typeof WORK_REMINDER_OFFSETS[number]['value'];
  overdue?: boolean;
}

export function workReminderError(value: unknown, hasDeadline: boolean): string | null {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return 'خيارات التذكير غير صالحة';
  const { leadMinutes, overdue } = value as WorkReminderOptions;
  if (Object.keys(value).some(key => key !== 'leadMinutes' && key !== 'overdue') ||
      (leadMinutes != null && !WORK_REMINDER_OFFSETS.some(option => option.value === leadMinutes)) ||
      (overdue != null && typeof overdue !== 'boolean')) return 'خيارات التذكير غير صالحة';
  return (leadMinutes != null || overdue) && !hasDeadline ? 'حدد موعد التسليم قبل تفعيل التذكير' : null;
}

export function workReminderInstant(value: unknown): number {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    ? Date.parse(value) : NaN;
}

export function workReminderEnabled(value?: WorkReminderOptions): boolean {
  return value?.leadMinutes != null || value?.overdue === true;
}
