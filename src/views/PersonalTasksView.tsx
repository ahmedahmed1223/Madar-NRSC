import { useRef, useState, type FormEvent } from 'react';
import { Bell, CheckCircle2, Circle, Plus, Trash2 } from 'lucide-react';
import { FormPage } from '../components/common/FormPage';
import { FilterTabs } from '../components/common/FilterTabs';
import { useLiveData } from '../hooks/useLiveData';
import { apiService } from '../services/api';
import { dataStore } from '../services/dataStore';
import { confirmDialog } from '../services/dialogs';
import { appLocale, basisZone, zoneOptions } from '../shared/dateFormat';
import { fromLocalInputValue, toLocalInputValue } from '../shared/dates';
import { newId } from '../shared/ids';
import { PERSONAL_TASK_NOTES_LIMIT, PERSONAL_TASK_TITLE_LIMIT, type PersonalTask } from '../shared/personalTasks';

const button = 'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-semibold disabled:opacity-50';
const secondary = `${button} border border-slate-300 bg-white text-slate-800 hover:bg-slate-50`;
const primary = `${button} bg-blue-600 text-white hover:bg-blue-700`;
const field = 'mt-1 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900';
type Filter = 'OPEN' | 'DONE' | 'ALL';
type ReminderMode = 'none' | 'due' | 'custom';
type Draft = Pick<PersonalTask, 'id' | 'title' | 'notes' | 'completed'> & { due: string; reminder: string; mode: ReminderMode };
type Feedback = { text: string; error?: boolean };

const filters: { id: Filter; label: string }[] = [
  { id: 'OPEN', label: 'مفتوحة' }, { id: 'DONE', label: 'مكتملة' }, { id: 'ALL', label: 'الكل' },
];

function taskDraft(task?: PersonalTask): Draft {
  return {
    id: task?.id || newId('personal-task'),
    title: task?.title || '',
    notes: task?.notes || '',
    completed: task?.completed || false,
    due: task?.dueAt ? toLocalInputValue(task.dueAt) : '',
    reminder: task?.reminderAt ? toLocalInputValue(task.reminderAt) : '',
    mode: !task?.reminderAt ? 'none' : task.reminderAt === task.dueAt ? 'due' : 'custom',
  };
}

function TaskTime({ value }: { value: string }) {
  return <time dateTime={value}>{new Date(value).toLocaleString(appLocale(), { ...zoneOptions(), dateStyle: 'short', timeStyle: 'short' })}</time>;
}

export function PersonalTasksView({ userId, focusId, onClearFocus }: {
  userId: string; focusId?: string | null; onClearFocus: () => void;
}) {
  useLiveData(['personalTasks'], 30_000);
  const [filter, setFilter] = useState<Filter>('OPEN');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const writing = useRef(false);
  const tasks = apiService.getPersonalTasks().filter(task => task.ownerId === userId);
  const visible = tasks.filter(task => focusId ? task.id === focusId : filter === 'ALL' || task.completed === (filter === 'DONE'))
    .sort((a, b) => (a.dueAt || '\uffff').localeCompare(b.dueAt || '\uffff') || b.updatedAt.localeCompare(a.updatedAt));
  const editing = !!draft && tasks.some(task => task.id === draft.id);
  const pending = (id: string) => dataStore.hasPendingWrite('personalTasks', id);

  const write = async (id: string, apply: () => void, success: string, afterSave?: () => void) => {
    if (writing.current || pending(id) || apiService.getCurrentUser().id !== userId) return;
    writing.current = true;
    setBusy(true);
    setFeedback(null);
    try {
      apply();
      const result = await dataStore.awaitWrite('personalTasks', id);
      if (apiService.getCurrentUser().id !== userId) return;
      if (result.ok || result.pending || result.queued) {
        setFeedback({ text: result.ok ? success : 'حُفظ التغيير على هذا الجهاز. تبدأ التذكيرات بعد المزامنة مع الخادم.' });
        afterSave?.();
      } else {
        setFeedback({ error: true, text: result.message || 'تعذر حفظ المهمة الشخصية.' });
      }
    } catch (error) {
      setFeedback({ error: true, text: error instanceof Error ? error.message : 'تعذر حفظ المهمة الشخصية.' });
    } finally {
      writing.current = false;
      setBusy(false);
    }
  };

  const start = (task?: PersonalTask) => {
    setFeedback(null);
    setDraft(taskDraft(task));
  };

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft) return;
    const dueAt = draft.due ? fromLocalInputValue(draft.due) : null;
    const reminderAt = draft.mode === 'due' ? dueAt : draft.mode === 'custom' ? fromLocalInputValue(draft.reminder) : null;
    if ((draft.due && !dueAt) || (draft.mode !== 'none' && !reminderAt)) {
      setFeedback({ error: true, text: 'أدخل تاريخًا ووقتًا صالحين للموعد أو التذكير.' });
      return;
    }
    void write(draft.id, () => apiService.savePersonalTask(draft.id, { title: draft.title, notes: draft.notes, completed: draft.completed, dueAt, reminderAt }), 'حُفظت المهمة الشخصية.', () => {
      setDraft(null);
      if (!editing) {
        setFilter('OPEN');
        if (focusId) onClearFocus();
      }
    });
  };

  const remove = async (task: PersonalTask) => {
    if (await confirmDialog({ title: 'حذف المهمة الشخصية', message: `حذف «${task.title}» وإلغاء موعد تذكيرها؟`, confirmLabel: 'حذف', danger: true })) {
      void write(task.id, () => apiService.deletePersonalTask(task.id), 'حُذفت المهمة الشخصية.', () => { if (focusId) onClearFocus(); });
    }
  };

  const status = feedback && <p role={feedback.error ? 'alert' : 'status'} className={`rounded-lg border px-3 py-2 text-sm ${feedback.error ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>{feedback.text}</p>;
  const zone = basisZone();

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1>مهامي الشخصية</h1>
          <p className="mt-1 text-sm text-slate-600">قائمة خاصة بحسابك لمتابعة المواعيد والتذكيرات.</p>
        </div>
        <button type="button" onClick={() => start()} className={primary}><Plus className="size-4" aria-hidden="true" /> مهمة شخصية جديدة</button>
      </header>

      {focusId
        ? <button type="button" className={secondary} onClick={onClearFocus}>عرض كل مهامي</button>
        : <FilterTabs<Filter> label="تصفية المهام الشخصية" tabs={filters} active={filter} onChange={setFilter} />}
      {!draft && status}
      {visible.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
          {focusId ? 'هذه المهمة غير متاحة في حسابك.' : filter === 'DONE' ? 'لا توجد مهام شخصية مكتملة.' : 'لا توجد مهام شخصية في هذه القائمة.'}
        </p>
      ) : (
        <ul aria-label="قائمة المهام الشخصية" className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
          {visible.map(task => (
            <li key={task.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start">
              <div className="min-w-0 flex-1">
                <button type="button" disabled={busy || pending(task.id)} onClick={() => start(task)} className="min-h-11 max-w-full text-start text-sm font-bold text-blue-700 [overflow-wrap:anywhere] hover:underline disabled:opacity-50">{task.title}</button>
                {task.notes && <p className="whitespace-pre-wrap text-sm text-slate-700 [overflow-wrap:anywhere]">{task.notes}</p>}
                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
                  <span className={task.completed ? 'font-semibold text-emerald-700' : 'font-semibold text-slate-700'}>{task.completed ? 'مكتملة' : 'مفتوحة'}</span>
                  {task.dueAt && <span>الموعد <TaskTime value={task.dueAt} /></span>}
                  {task.reminderAt && !task.completed && <span className="inline-flex flex-wrap items-center gap-1"><Bell className="size-3" aria-hidden="true" /> {task.reminderSentFor ? 'أُرسل التذكير' : <><span>التذكير</span><TaskTime value={task.reminderAt} /></>}</span>}
                  {pending(task.id) && <span>بانتظار المزامنة</span>}
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <button type="button" disabled={busy || pending(task.id)} className={secondary} onClick={() => void write(task.id, () => apiService.savePersonalTask(task.id, { ...task, completed: !task.completed }), task.completed ? 'أُعيد فتح المهمة.' : 'أُكملت المهمة.')}>
                  {task.completed ? <Circle className="size-4" aria-hidden="true" /> : <CheckCircle2 className="size-4" aria-hidden="true" />}
                  {task.completed ? 'إعادة فتح' : 'إكمال'}
                </button>
                <button type="button" disabled={busy || pending(task.id)} className={`${secondary} min-w-11 text-rose-700`} aria-label={`حذف ${task.title}`} onClick={() => void remove(task)}><Trash2 className="size-4" aria-hidden="true" /></button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <FormPage isOpen={!!draft} onClose={() => { if (writing.current) return false; setDraft(null); }} title={editing ? 'تعديل مهمة شخصية' : 'مهمة شخصية جديدة'}>
        {draft && <form onSubmit={save} className="max-w-xl space-y-4">
          {status}
          <fieldset disabled={busy} className="min-w-0 space-y-4">
            <label className="block text-sm font-semibold">عنوان المهمة
              <input className={field} value={draft.title} maxLength={PERSONAL_TASK_TITLE_LIMIT} required onChange={event => setDraft({ ...draft, title: event.target.value })} />
            </label>
            <label className="block text-sm font-semibold">ملاحظات
              <textarea className={field} rows={3} value={draft.notes} maxLength={PERSONAL_TASK_NOTES_LIMIT} onChange={event => setDraft({ ...draft, notes: event.target.value })} />
            </label>
            <p className="text-xs text-slate-600">{zone ? <>التوقيت المعتمد للمواعيد <bdi>{zone}</bdi></> : 'تُعرض المواعيد بتوقيت جهازك.'}</p>
            <label className="block min-w-0 text-sm font-semibold">موعد المهمة
              <input className={field} type="datetime-local" dir="ltr" value={draft.due} required={draft.mode === 'due'} onChange={event => setDraft({ ...draft, due: event.target.value })} />
            </label>
            <label className="block text-sm font-semibold">التذكير
              <select className={field} value={draft.mode} onChange={event => setDraft({ ...draft, mode: event.target.value as ReminderMode })}>
                <option value="none">دون تذكير</option>
                <option value="due">عند موعد المهمة</option>
                <option value="custom">في وقت أختاره</option>
              </select>
            </label>
            {draft.mode === 'custom' && <label className="block min-w-0 text-sm font-semibold">موعد التذكير
              <input className={field} type="datetime-local" dir="ltr" value={draft.reminder} required onChange={event => setDraft({ ...draft, reminder: event.target.value })} />
            </label>}
            <button type="submit" className={primary} disabled={busy || pending(draft.id) || !draft.title.trim()}>حفظ المهمة</button>
          </fieldset>
        </form>}
      </FormPage>
    </div>
  );
}
