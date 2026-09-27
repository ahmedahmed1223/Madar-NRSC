import React, { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, ShieldCheck, X } from 'lucide-react';
import { apiService } from '../../services/api';
import { RbacService } from '../../services/rbacService';
import { newId } from '../../shared/ids';
import { APPROVAL_PRESETS, APPROVAL_STEP_KINDS, ApprovalStep, ApprovalStepKind, approvalStepName, DEFAULT_APPROVAL_STEPS } from '../../shared/bulletins';

/**
 * Who signs off a bulletin story before air, in order: e.g. the bulletin editor then the
 * managing editor, or a custom chain of roles and named colleagues.
 */
export const ApprovalChainEditor: React.FC<{
  value: ApprovalStep[] | undefined;
  onChange: (steps: ApprovalStep[]) => void;
  disabled?: boolean;
  editorName?: string;
}> = ({ value, onChange, disabled, editorName }) => {
  const steps = value?.length ? value : DEFAULT_APPROVAL_STEPS;
  const [kind, setKind] = useState<ApprovalStepKind>('CHIEF');
  const [pick, setPick] = useState('');
  const roles = RbacService.getRoleDefinitions();
  const users = apiService.getUsers().filter((u) => u.isActive !== false);
  const presetId = APPROVAL_PRESETS.find((p) => JSON.stringify(p.steps.map((s) => s.kind)) === JSON.stringify(steps.map((s) => s.kind)) && steps.every((s) => s.kind === 'BULLETIN_EDITOR' || s.kind === 'CHIEF'))?.id;

  const move = (i: number, d: -1 | 1) => {
    const next = [...steps];
    const [s] = next.splice(i, 1);
    next.splice(i + d, 0, s);
    onChange(next);
  };
  const add = () => {
    let step: ApprovalStep = { id: newId('apr'), kind };
    if (kind === 'ROLE') {
      const r = roles.find((x) => x.roleCode === pick || x.id === pick);
      if (!r) return;
      step = { ...step, roleCode: String(r.roleCode), roleName: r.nameAr.split(' (')[0] };
    }
    if (kind === 'USER') {
      const u = users.find((x) => x.id === pick);
      if (!u) return;
      step = { ...step, userId: u.id, userName: u.fullName };
    }
    onChange([...steps, step]);
    setPick('');
  };

  return (
    <fieldset className="p-3 rounded-xl border border-slate-200 space-y-2" disabled={disabled}>
      <legend className="px-1 text-xs font-bold text-slate-700 flex items-center gap-1.5">
        <ShieldCheck className="w-4 h-4 text-emerald-600" /> مسار اعتماد القصص
      </legend>
      <p className="text-[11px] text-slate-500">لا تُعتمد القصة للهواء إلا بعد كل الخطوات بالترتيب؛ أي تعديل على نصها يعيد المسار من البداية.</p>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="مسارات جاهزة">
        {APPROVAL_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={presetId === p.id}
            onClick={() => onChange(p.steps.map((s) => ({ ...s })))}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border ${presetId === p.id ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}
          >
            {p.name}
          </button>
        ))}
      </div>
      <ol className="space-y-1">
        {steps.map((s, i) => (
          <li key={s.id} className="flex items-center gap-2 text-xs bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5">
            <span className="w-5 h-5 rounded-full bg-emerald-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0">{i + 1}</span>
            <span className="flex-1 font-bold text-slate-700">{approvalStepName(s, { editorName })}</span>
            <button type="button" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`تقديم الخطوة ${i + 1}`} className="p-0.5 text-slate-400 hover:text-slate-700 disabled:opacity-30">
              <ArrowUp className="w-3.5 h-3.5" />
            </button>
            <button type="button" disabled={i === steps.length - 1} onClick={() => move(i, 1)} aria-label={`تأخير الخطوة ${i + 1}`} className="p-0.5 text-slate-400 hover:text-slate-700 disabled:opacity-30">
              <ArrowDown className="w-3.5 h-3.5" />
            </button>
            <button type="button" disabled={steps.length === 1} onClick={() => onChange(steps.filter((x) => x.id !== s.id))} aria-label={`حذف الخطوة ${i + 1}`} className="p-0.5 text-slate-400 hover:text-rose-600 disabled:opacity-30">
              <X className="w-3.5 h-3.5" />
            </button>
          </li>
        ))}
      </ol>
      {steps.length < 6 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <select value={kind} onChange={(e) => { setKind(e.target.value as ApprovalStepKind); setPick(''); }} aria-label="نوع الخطوة" className="px-2 py-1.5 border border-slate-300 rounded-lg text-xs bg-white">
            {APPROVAL_STEP_KINDS.map((k) => (
              <option key={k.id} value={k.id} title={k.hint}>
                {k.name}
              </option>
            ))}
          </select>
          {kind === 'ROLE' && (
            <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="الدور" className="px-2 py-1.5 border border-slate-300 rounded-lg text-xs bg-white">
              <option value="">اختر الدور…</option>
              {roles.map((r) => (
                <option key={r.id} value={String(r.roleCode)}>
                  {r.nameAr}
                </option>
              ))}
            </select>
          )}
          {kind === 'USER' && (
            <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="الزميل" className="px-2 py-1.5 border border-slate-300 rounded-lg text-xs bg-white">
              <option value="">اختر الزميل…</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName} — {u.jobTitle || u.department}
                </option>
              ))}
            </select>
          )}
          <button type="button" onClick={add} disabled={(kind === 'ROLE' || kind === 'USER') && !pick} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-bold hover:bg-slate-50 disabled:opacity-40">
            <Plus className="w-3.5 h-3.5" /> إضافة خطوة
          </button>
        </div>
      )}
    </fieldset>
  );
};
