import { MAX_RECEIPT_MINUTES, type StepExecutionRules, type StepDependency } from '../../shared/cardExecution';
import { WORKFLOW_TRACK_LABEL, type WorkflowTrack } from '../../shared/workflowTracks';
import { INPUT, LABEL } from './cardUi';

interface StepChoice {
  id: string;
  label: string;
}

export function StepExecutionFields({ step, choices, onChange, tracks = [], expanded = false }: {
  step: StepExecutionRules & { id: string; type: string };
  choices: StepChoice[];
  tracks?: readonly WorkflowTrack[];
  expanded?: boolean;
  onChange: (rules: Partial<StepExecutionRules>) => void;
}) {
  const changeDependency = (id: string, threshold: StepDependency['threshold'] | '') => {
    const dependencies = (step.dependencies || []).filter(dep => dep.stepId !== id);
    if (threshold) dependencies.push({ stepId: id, threshold });
    onChange({ dependencies });
  };
  return (
    <details open={expanded || undefined} className="rounded-lg border border-slate-200 bg-white p-3 space-y-3 sm:col-span-2">
      <summary className="min-h-9 cursor-pointer font-semibold text-slate-800">شروط التنفيذ والاستلام</summary>
      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          <span className={LABEL}>مهلة تأكيد الاستلام بالدقائق</span>
          <input type="number" min={1} max={MAX_RECEIPT_MINUTES} step={1} inputMode="numeric" className={INPUT}
            value={step.receiptMinutes ?? ''} placeholder="دون تأكيد"
            onChange={event => onChange({ receiptMinutes: event.target.value ? Number(event.target.value) : undefined })} />
        </label>
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" checked={step.optional === true} disabled={step.type === 'approve'}
            onChange={event => onChange({ optional: event.target.checked })} />
          مهمة اختيارية
        </label>
      </div>
      {tracks.length > 1 && <label className="block">
        <span className={LABEL}>مسار تنفيذ المهمة</span>
        <select className={INPUT} value={step.executionTrack || ''} onChange={event => onChange({ executionTrack: (event.target.value || undefined) as WorkflowTrack | undefined })}>
          <option value="">مسار التكليف</option>
          {tracks.map(track => <option key={track} value={track}>{WORKFLOW_TRACK_LABEL[track]}</option>)}
        </select>
      </label>}
      {choices.length > 1 && <fieldset className="space-y-2">
        <legend className="font-semibold text-slate-800">التبعيات المطلوبة</legend>
        {choices.filter(choice => choice.id !== step.id).map(choice => (
          <label key={choice.id} className="grid items-center gap-2 sm:grid-cols-2">
            <span className="text-slate-700">{choice.label}</span>
            <select value={step.dependencies?.find(dep => dep.stepId === choice.id)?.threshold || ''}
              className={INPUT} onChange={event => changeDependency(choice.id, event.target.value as StepDependency['threshold'] | '')}>
              <option value="">مستقلة</option>
              <option value="PARTIAL">بعد أول إفادة</option>
              <option value="DONE">بعد اكتمال المهمة</option>
            </select>
          </label>
        ))}
      </fieldset>}
    </details>
  );
}
