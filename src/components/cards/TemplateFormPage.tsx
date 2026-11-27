import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { FormPage } from '../common/FormPage';
import { apiService } from '../../services/api';
import { notify } from '../../services/notify';
import { RbacService } from '../../services/rbacService';
import { newId } from '../../shared/ids';
import { CARD_KINDS, COMPLEXITIES, MAX_CARD_STEPS, MAX_CHECKLIST, stepTypesOf, type CardKind } from '../../shared/productionCards';
import { RULE_KINDS, type AssigneeRule, type TemplateStep, type WorkflowTemplate } from '../../shared/workflowTemplates';
import { DEPARTMENTS } from '../../shared/departments';
import { createDepartmentLabeler } from '../../services/departmentLabels';
import { stationsOf } from '../../shared/stations';
import { INPUT, LABEL, cardCandidates } from './cardUi';
import { buildTemplateWorkflowGraph } from '../../shared/workflowGraph';
import { WorkflowFlowchart } from '../workflow/WorkflowFlowchart';
import type { WorkflowGraphNode } from '../../shared/workflowGraph';

interface TemplateFormPageProps {
  isOpen: boolean;
  onClose: () => void;
  /** Template being edited, or a draft to start from (a copy, or one saved from an assignment). */
  template?: WorkflowTemplate | null;
  onSaved: (template: WorkflowTemplate) => void;
}

const newStep = (type: string): TemplateStep => ({ id: newId('tst'), type, rule: { kind: 'ASK' }, complexity: 1 });

/** Value of the rule's second field (person, role, department or station). */
const ruleValue = (rule: AssigneeRule) =>
  rule.kind === 'PERSON' ? rule.userId : rule.kind === 'ROLE' ? rule.role : rule.kind === 'DEPARTMENT' ? rule.departmentId : rule.kind === 'STATION' ? rule.stationId : '';

const makeRule = (kind: AssigneeRule['kind'], value: string): AssigneeRule => {
  switch (kind) {
    case 'PERSON':
      return { kind, userId: value };
    case 'ROLE':
      return { kind, role: value };
    case 'DEPARTMENT':
      return { kind, departmentId: value };
    case 'STATION':
      return { kind, stationId: value };
    default:
      return { kind: 'ASK' };
  }
};

/** Creates or edits a workflow template: the chain of steps an assignment is created from. */
export const TemplateFormPage: React.FC<TemplateFormPageProps> = ({ isOpen, onClose, template, onSaved }) => {
  const settings = apiService.getSettings();
  const stations = stationsOf(settings);
  const labelDepartment = useMemo(createDepartmentLabeler, [isOpen, settings]);
  const stepTypes = stepTypesOf(settings);
  const roles = useMemo(() => RbacService.getRoleDefinitions().map((r) => ({ id: r.roleCode, name: r.nameAr })), [isOpen]);
  const people = useMemo(() => (isOpen ? cardCandidates() : []), [isOpen]);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<CardKind>('REPORT');
  const [description, setDescription] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [steps, setSteps] = useState<TemplateStep[]>([]);
  const [error, setError] = useState<string | null>(null);
  const editing = !!template && apiService.getWorkflowTemplates().some((t) => t.id === template.id);

  useEffect(() => {
    if (!isOpen) return;
    setName(template?.name || '');
    setKind(template?.kind || 'REPORT');
    setDescription(template?.description || '');
    setUrgent(template?.priority === 'URGENT');
    setSteps(template?.steps?.length ? template.steps : [newStep(stepTypes[0]?.id || 'edit')]);
    setError(null);
    // Filled once when the page opens; later edits belong to the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, template?.id]);

  const patch = (id: string, changes: Partial<TemplateStep>) => setSteps((list) => list.map((s) => (s.id === id ? { ...s, ...changes } : s)));
  const move = (index: number, by: number) =>
    setSteps((list) => {
      const next = [...list];
      const [step] = next.splice(index, 1);
      next.splice(index + by, 0, step);
      return next;
    });

  const manageStep = (node: WorkflowGraphNode) => {
    const id = node.id.slice('step:'.length);
    requestAnimationFrame(() => {
      const item = document.getElementById(`template-step-${id}`);
      item?.scrollIntoView({ block: 'center' });
      item?.querySelector<HTMLSelectElement>('select')?.focus();
    });
  };

  const options = (kindId: AssigneeRule['kind']) => {
    if (kindId === 'PERSON') return people.map((p) => ({ id: p.id, name: p.name }));
    if (kindId === 'ROLE') return roles;
    if (kindId === 'DEPARTMENT') return DEPARTMENTS.map(d => ({ id: d.id, name: labelDepartment(d) }));
    if (kindId === 'STATION') return stations.map((s) => ({ id: s.id, name: s.name }));
    return [];
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const saved = apiService.saveWorkflowTemplate({
        ...(editing ? template! : { id: template?.id || newId('wft') }),
        name: name.trim(),
        kind,
        description: description.trim() || undefined,
        priority: urgent ? 'URGENT' : 'NORMAL',
        steps: steps.map((s) => ({ ...s, title: s.title?.trim() || undefined, checklist: s.checklist?.map((c) => c.trim()).filter(Boolean).slice(0, MAX_CHECKLIST) })),
      } as WorkflowTemplate);
      notify({ type: 'success', message: editing ? 'حُفظ القالب' : 'أُنشئ القالب؛ يمكنك الآن إنشاء تكليفات منه' });
      onSaved(saved);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'تعذر حفظ القالب');
    }
  };

  return (
    <FormPage isOpen={isOpen} onClose={onClose} title={editing ? 'تعديل قالب سير العمل' : 'قالب سير عمل جديد'} subtitle="سلسلة مهام تُنشأ منها التكليفات" maxWidth="4xl">
      <form onSubmit={submit} className="space-y-5 text-xs">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2">
            <label htmlFor="tpl-name" className={LABEL}>اسم القالب *</label>
            <input id="tpl-name" data-autofocus required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: نشرة الظهيرة" className={INPUT} />
          </div>
          <div>
            <label htmlFor="tpl-kind" className={LABEL}>نوع المادة</label>
            <select id="tpl-kind" value={kind} onChange={(e) => setKind(e.target.value as CardKind)} className={INPUT}>
              {CARD_KINDS.map((k) => (
                <option key={k.id} value={k.id}>{k.name}</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label htmlFor="tpl-desc" className={LABEL}>الوصف (يصبح «المطلوب إنجازه» في التكليف)</label>
          <textarea id="tpl-desc" rows={2} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} className={INPUT} />
        </div>
        <label className="inline-flex items-center gap-2 font-bold text-slate-700 min-h-11">
          <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} />
          عاجل افتراضياً
        </label>

        <WorkflowFlowchart
          graph={buildTemplateWorkflowGraph({ id: template?.id || 'draft', name: name || 'مسودة القالب', kind, priority: urgent ? 'URGENT' : 'NORMAL', steps }, stepTypes)}
          label="مخطط قالب سير العمل"
          onManage={manageStep}
        />
        <fieldset className="space-y-2">
          <legend className="font-bold text-slate-800 text-sm">المهام بالترتيب</legend>
          <p className="text-2xs text-slate-500">لكل مهمة من ينفّذها: زميل محدد، أو دور، أو قسم، أو محطة، أو يحدده المكلِّف عند الإنشاء. موعد المهمة يُحسب قبل موعد تسليم التكليف.</p>
          <ol className="space-y-2">
            {steps.map((step, index) => (
              <li key={step.id} id={`template-step-${step.id}`} className="border border-slate-200 rounded-2xl bg-white p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 shrink-0 rounded-full bg-slate-100 text-slate-700 font-bold flex items-center justify-center tabular-nums">{index + 1}</span>
                  <select aria-label={`نوع المهمة ${index + 1}`} value={step.type} onChange={(e) => patch(step.id, { type: e.target.value })} className={`${INPUT} font-bold`}>
                    {!stepTypes.some((t) => t.id === step.type) && <option value={step.type}>مهمة (نوع محذوف)</option>}
                    {stepTypes.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                  <button type="button" disabled={index === 0} onClick={() => move(index, -1)} aria-label="تقديم المهمة" className="w-11 h-11 shrink-0 inline-flex items-center justify-center rounded-lg border border-slate-200 text-slate-600 disabled:opacity-40"><ArrowUp className="w-4 h-4" /></button>
                  <button type="button" disabled={index === steps.length - 1} onClick={() => move(index, 1)} aria-label="تأخير المهمة" className="w-11 h-11 shrink-0 inline-flex items-center justify-center rounded-lg border border-slate-200 text-slate-600 disabled:opacity-40"><ArrowDown className="w-4 h-4" /></button>
                  <button type="button" disabled={steps.length === 1} onClick={() => setSteps((list) => list.filter((s) => s.id !== step.id))} aria-label="حذف المهمة" className="w-11 h-11 shrink-0 inline-flex items-center justify-center rounded-lg border border-rose-200 text-rose-700 disabled:opacity-40"><Trash2 className="w-4 h-4" /></button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                  <div>
                    <label htmlFor={`tpl-rule-${step.id}`} className={LABEL}>من ينفّذها</label>
                    <select id={`tpl-rule-${step.id}`} value={step.rule.kind} onChange={(e) => {
                      const k = e.target.value as AssigneeRule['kind'];
                      patch(step.id, { rule: makeRule(k, options(k)[0]?.id || '') });
                    }} className={INPUT}>
                      {RULE_KINDS.map((r) => (
                        <option key={r.id} value={r.id}>{r.name}</option>
                      ))}
                    </select>
                  </div>
                  {step.rule.kind !== 'ASK' && (
                    <div>
                      <label htmlFor={`tpl-rule-val-${step.id}`} className={LABEL}>{RULE_KINDS.find((r) => r.id === step.rule.kind)?.name}</label>
                      <select id={`tpl-rule-val-${step.id}`} value={ruleValue(step.rule)} onChange={(e) => patch(step.id, { rule: makeRule(step.rule.kind, e.target.value) })} className={INPUT}>
                        {!options(step.rule.kind).some((o) => o.id === ruleValue(step.rule)) && <option value={ruleValue(step.rule)}>غير متاح الآن</option>}
                        {options(step.rule.kind).map((o) => (
                          <option key={o.id} value={o.id}>{o.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div>
                    <label htmlFor={`tpl-due-${step.id}`} className={LABEL}>قبل موعد التسليم (دقيقة)</label>
                    <input id={`tpl-due-${step.id}`} type="number" min={-43200} max={43200} inputMode="numeric" value={step.dueOffsetMinutes ?? ''} onChange={(e) => patch(step.id, { dueOffsetMinutes: e.target.value === '' ? undefined : Math.round(Number(e.target.value)) })} placeholder="بلا موعد" className={INPUT} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label htmlFor={`tpl-cx-${step.id}`} className={LABEL}>التعقيد</label>
                      <select id={`tpl-cx-${step.id}`} value={step.complexity} onChange={(e) => patch(step.id, { complexity: Number(e.target.value) as 1 | 2 | 3 })} className={INPUT}>
                        {COMPLEXITIES.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor={`tpl-est-${step.id}`} className={LABEL}>الوقت المقدر (دقيقة)</label>
                      <input id={`tpl-est-${step.id}`} type="number" min={0} max={100000} inputMode="numeric" value={step.estimateMinutes ?? ''} onChange={(e) => patch(step.id, { estimateMinutes: e.target.value === '' ? undefined : Math.max(0, Math.round(Number(e.target.value))) })} className={INPUT} />
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label htmlFor={`tpl-title-${step.id}`} className={LABEL}>تفصيل المهمة (اختياري)</label>
                    <input id={`tpl-title-${step.id}`} maxLength={200} value={step.title || ''} onChange={(e) => patch(step.id, { title: e.target.value })} className={INPUT} />
                  </div>
                  <div>
                    <label htmlFor={`tpl-check-${step.id}`} className={LABEL}>قائمة التحقق (بند في كل سطر)</label>
                    <textarea id={`tpl-check-${step.id}`} rows={2} value={(step.checklist || []).join('\n')} onChange={(e) => patch(step.id, { checklist: e.target.value.split('\n').map((l) => l.slice(0, 200)) })} className={INPUT} />
                  </div>
                </div>
              </li>
            ))}
          </ol>
          {steps.length < MAX_CARD_STEPS && (
            <button type="button" onClick={() => setSteps((list) => [...list, newStep(stepTypes[0]?.id || 'edit')])} className="inline-flex items-center gap-1.5 min-h-11 px-3 py-2 rounded-xl border border-dashed border-slate-300 font-bold text-slate-700 hover:bg-slate-50">
              <Plus className="w-4 h-4" />
              إضافة مهمة
            </button>
          )}
        </fieldset>

        {error && <p role="alert" className="p-2 rounded-lg bg-rose-50 text-rose-700 font-bold">{error}</p>}
        <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
          <button type="button" onClick={onClose} className="min-h-11 px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl">إلغاء</button>
          <button type="submit" className="min-h-11 px-5 py-2 font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl">{editing ? 'حفظ القالب' : 'إنشاء القالب'}</button>
        </div>
      </form>
    </FormPage>
  );
};
