import { useId } from 'react';
import { WORK_REMINDER_OFFSETS, workReminderEnabled, type WorkReminderOptions } from '../../shared/workReminders';

export function WorkReminderFields({ value, onChange }: {
  value?: WorkReminderOptions;
  onChange: (value: WorkReminderOptions | undefined) => void;
}) {
  const id = useId();
  const update = (changes: Partial<WorkReminderOptions>) => {
    const next = { ...value, ...changes };
    onChange(workReminderEnabled(next) ? next : undefined);
  };
  return (
    <fieldset className="min-w-0 rounded-xl border border-slate-200 px-3 pb-2">
      <legend className="px-1 font-bold text-slate-700">تنبيهات موعد التسليم</legend>
      <div className="grid gap-2 sm:grid-cols-2 sm:items-end">
        <div>
          <label htmlFor={id} className="mb-1 block font-semibold">التذكير بالموعد</label>
          <select id={id} value={value?.leadMinutes ?? ''} onChange={event => {
            const offset = WORK_REMINDER_OFFSETS.find(option => String(option.value) === event.target.value);
            update({ leadMinutes: offset?.value });
          }} className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-slate-900">
            <option value="">دون تذكير</option>
            {WORK_REMINDER_OFFSETS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" checked={value?.overdue ?? false} onChange={event => update({ overdue: event.target.checked })} />
          تنبيه بعد تأخر الموعد بـ15 دقيقة
        </label>
      </div>
    </fieldset>
  );
}
