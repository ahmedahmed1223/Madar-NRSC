import { useState, type FormEvent } from 'react';
import { ListChecks, Save } from 'lucide-react';
import { useLiveData } from '../../hooks/useLiveData';
import { apiService } from '../../services/api';
import { confirmSaved } from '../../services/confirmSave';
import { SINGLETON_ID } from '../../shared/collections';
import type { TaskWorkflowRules } from '../../shared/taskWorkflow';

const RULES = [
  { key: 'requireReview', label: 'اشتراط المراجعة قبل إكمال المهمة', hint: 'تنتقل المهمة إلى المراجعة، ثم يقرّ مسؤولو المهام الإكمال بعد المراجعة.' },
  { key: 'requireBlockedReason', label: 'اشتراط توضيح سبب التعطل', hint: 'يُسجّل الزميل السبب قبل نقل المهمة إلى حالة التعطل.' },
  { key: 'reopenManagersOnly', label: 'قصر إعادة الفتح على مديري المهام', hint: 'يعيد فتح المهمة المكتملة من يملك صلاحية إدارة المهام وإسنادها.' },
] as const;
const linkButton = 'min-h-11 rounded-lg border border-slate-300 px-3 text-xs font-bold text-slate-800 hover:bg-slate-50';

interface Props {
  onOpenStepTypes: () => void;
  onOpenTemplates?: () => void;
}

export function TaskWorkflowSettings({ onOpenStepTypes, onOpenTemplates }: Props) {
  useLiveData(['settings']);
  const [draft, setDraft] = useState<TaskWorkflowRules>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const current = apiService.getSettings().taskWorkflow;
  const dirty = Object.keys(draft).length > 0;

  const toggle = (key: keyof TaskWorkflowRules, checked: boolean) => {
    setDraft(previous => {
      const next = { ...previous };
      if (checked === (current?.[key] === true)) delete next[key];
      else next[key] = checked;
      return next;
    });
    setMessage('');
    setError('');
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!dirty || saving) return;
    setSaving(true);
    setMessage('');
    setError('');
    try {
      const latest = apiService.getSettings().taskWorkflow;
      apiService.saveSettings({ taskWorkflow: { ...latest, ...draft } });
      if (await confirmSaved('settings', SINGLETON_ID)) {
        setDraft({});
        setMessage('حُفظت قواعد سير العمل');
      } else {
        setMessage('لم يؤكد الخادم الحفظ بعد');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذر حفظ قواعد سير العمل');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="task-workflow-settings-title" className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <div>
        <h2 id="task-workflow-settings-title" className="flex items-center gap-2 text-base font-bold text-slate-900">
          <ListChecks aria-hidden="true" className="size-4 text-blue-700" /> سير عمل المهام والتكليفات
        </h2>
        <p className="mt-1 text-xs text-slate-600">تسري قواعد المهام على انتقالات الحالة الجديدة في كل المحطات. يحتفظ السجل بتوقيت الانتقالات السابقة ونتائجها كما حُفظت.</p>
      </div>
      <form onSubmit={save} className="space-y-3" aria-busy={saving}>
        <fieldset disabled={saving} className="grid gap-2 lg:grid-cols-3">
          <legend className="sr-only">قواعد حالة المهام</legend>
          {RULES.map(({ key, label, hint }) => (
            <div key={key} className="min-w-0 rounded-lg border border-slate-200 p-3">
              <label htmlFor={`task-workflow-${key}`} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-bold text-slate-800">
                <input type="checkbox" id={`task-workflow-${key}`} aria-describedby={`task-workflow-${key}-hint`}
                  checked={draft[key] ?? current?.[key] ?? false} onChange={event => toggle(key, event.target.checked)} className="size-4 shrink-0 accent-blue-700" />
                {label}
              </label>
              <p id={`task-workflow-${key}-hint`} className="text-xs leading-relaxed text-slate-600">{hint}</p>
            </div>
          ))}
        </fieldset>
        <p className="text-xs text-slate-600">يتوقف احتساب وقت التنفيذ أثناء المراجعة وعند التعطل.</p>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={saving || !dirty} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-blue-700 px-3 text-xs font-bold text-white disabled:opacity-50">
            <Save aria-hidden="true" className="size-4" /> حفظ قواعد سير العمل
          </button>
          <p role="status" className="text-xs text-slate-700">{saving ? 'بانتظار تأكيد الخادم' : message}</p>
        </div>
        {error && <p role="alert" className="text-xs font-bold text-rose-800">{error}</p>}
      </form>
      <div className="grid gap-3 border-t border-slate-200 pt-4 sm:grid-cols-2">
        <div className="space-y-2">
          <h3 className="text-sm font-bold text-slate-900">أنواع خطوات التكليفات</h3>
          <p className="text-xs text-slate-600">تُعرّف أنواع الخطوات وأوزانها في إعدادات المحطات والتكليفات.</p>
          <button type="button" onClick={onOpenStepTypes} className={linkButton}>إعداد أنواع خطوات التكليفات</button>
        </div>
        <div className="space-y-2">
          <h3 className="text-sm font-bold text-slate-900">قوالب سير عمل التكليفات</h3>
          <p className="text-xs text-slate-600">اختر «القوالب» من طرق العرض في التكليفات لترتيب الخطوات وتحديد المسؤوليات عند إنشاء تكليف.</p>
          {onOpenTemplates ? <button type="button" onClick={onOpenTemplates} className={linkButton}>فتح التكليفات والقوالب</button>
            : <p className="text-xs text-slate-600">تتطلب إدارة القوالب صلاحية إدارة التكليفات.</p>}
        </div>
      </div>
    </section>
  );
}
