import { apiFetch } from '../../services/http';
import { dataStore } from '../../services/dataStore';
import { mayManageTemplate, publishedWorkflow, templateScope, type PublishedWorkflow, type TemplateScope } from '../../shared/workflowPublication';
import { stepExecutionRulesError } from '../../shared/cardExecution';
import { WorkflowDiagram } from './WorkflowDiagram';
import { WORKFLOW_TRACKS } from '../../shared/workflowTracks';
import { StepExecutionFields } from './StepExecutionFields';
import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { FormPage } from '../common/FormPage';
import { apiService } from '../../services/api';
import { notify } from '../../services/notify';
import { RbacService } from '../../services/rbacService';
import { newId } from '../../shared/ids';
import { CARD_KINDS, COMPLEXITIES, MAX_CARD_STEPS, MAX_CHECKLIST, stepTypeName, stepTypesOf, type CardKind } from '../../shared/productionCards';
import { RULE_KINDS, type AssigneeRule, type TemplateStep, type WorkflowTemplate } from '../../shared/workflowTemplates';
import { DEPARTMENTS } from '../../shared/departments';
import { createDepartmentLabeler } from '../../services/departmentLabels';
import { stationsOf } from '../../shared/stations';
import { INPUT, LABEL, cardCandidates } from './cardUi';
import { buildTemplateWorkflowGraph, type WorkflowGraphNode } from '../../shared/workflowGraph';
import { WorkflowFlowchart } from '../workflow/WorkflowFlowchart';

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
  const [graphError, setGraphError] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [track, setTrack] = useState<TemplateScope>('news');
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<PublishedWorkflow[]>();
  const scopeLabels = { news: 'الأخبار', programmes: 'البرامج', shared: 'مشترك' } as const;
  const actor = apiService.getCurrentUser();
  const legacyManage = RbacService.hasPermission(actor, 'cards.manage');
  const allowedTracks = (Object.keys(scopeLabels) as TemplateScope[]).filter(scope => mayManageTemplate(actor, { track: scope } as WorkflowTemplate, legacyManage));
  const editing = !!template && apiService.getWorkflowTemplates().some((t) => t.id === template.id);

  useEffect(() => {
    if (!isOpen) return;
    setName(template?.name || '');
    setHistory(undefined);
    setTrack(template ? templateScope(template) : allowedTracks[0] ?? 'news');
    setKind(template?.kind || 'REPORT');
    setDescription(template?.description || '');
    setUrgent(template?.priority === 'URGENT');
    setSteps(template?.steps?.length ? template.steps : [newStep(stepTypes[0]?.id || 'edit')]);
    setError(null);
    setGraphError('');
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

  const graphChoices = steps.map(step => ({ id: step.id, label: step.title || stepTypeName(stepTypes, step.type) }));
  const executionTracks = WORKFLOW_TRACKS.filter(scope => apiService.cardActor({ kind: scope === 'news' ? 'NEWS' : 'PROGRAM' }, false).canManage);
  const withDependencies = steps.map((step, index) => ({
    ...step,
    dependencies: step.dependencies ?? steps.slice(0, index).map(previous => ({ stepId: previous.id, threshold: 'DONE' as const })),
  }));
  const changeGraphStep = (id: string, changes: Partial<TemplateStep>) => {
    const next = (changes.dependencies ? withDependencies : steps).map(step => step.id === id ? { ...step, ...changes } : step);
    const problem = changes.dependencies ? stepExecutionRulesError(next) : null;
    setGraphError(problem || '');
    if (!problem) setSteps(next);
  };
  const connectSteps = (source: string, target: string) => {
    const prerequisite = source.slice('step:'.length);
    const step = withDependencies.find(item => `step:${item.id}` === target);
    if (!step || !steps.some(item => item.id === prerequisite) || step.dependencies.some(dep => dep.stepId === prerequisite)) return;
    changeGraphStep(step.id, { dependencies: [...step.dependencies, { stepId: prerequisite, threshold: 'DONE' }] });
  };

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

  const loadHistory = async () => {
    if (!template) return;
    try {
      const result = await apiFetch<{ data: PublishedWorkflow[] }>(`/api/v1/workflow-templates/${encodeURIComponent(template.id)}/publications`);
      setHistory(result.data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'تعذر فتح سجل إصدارات القالب');
    }
  };

  const loadVersionIntoDraft = (version: PublishedWorkflow) => {
    setName(version.name);
    setKind(version.kind);
    setDescription(version.description || '');
    setUrgent(version.priority === 'URGENT');
    setSteps(version.steps);
    setError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const publish = (e.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'publish';
    setSaving(true);
    setError(null);
    try {
      const saved = apiService.saveWorkflowTemplate({
        ...(editing ? template! : { id: template?.id || newId('wft') }),
        name: name.trim(),
        kind,
        track,
        drafting: true,
        publishRequested: publish,
        description: description.trim() || undefined,
        priority: urgent ? 'URGENT' : 'NORMAL',
        steps: steps.map((s) => ({ ...s, title: s.title?.trim() || undefined, checklist: s.checklist?.map((c) => c.trim()).filter(Boolean).slice(0, MAX_CHECKLIST) })),
      } as WorkflowTemplate);
      const result = await dataStore.awaitWrite('workflowTemplates', saved.id);
      if (!result.ok) throw new Error(result.message || 'لم يؤكد الخادم حفظ القالب');
      notify({ type: 'success', message: publish ? 'نُشر إصدار القالب' : 'حُفظت مسودة القالب' });
      onSaved(saved);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'تعذر حفظ القالب');
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormPage isOpen={isOpen} onClose={onClose} title={editing ? 'تعديل قالب سير العمل' : 'قالب سير عمل جديد'} subtitle="سلسلة مهام تُنشأ منها التكليفات" maxWidth="4xl">
      <form onSubmit={submit} className="space-y-5 text-xs">
        <div className="grid gap-2 sm:max-w-sm">
          <label htmlFor="tpl-track" className={LABEL}>مسار القالب</label>
          <select id="tpl-track" className={INPUT} value={track} disabled={editing || saving} onChange={e => setTrack(e.target.value as TemplateScope)}>
            {allowedTracks.map(scope => <option key={scope} value={scope}>{scopeLabels[scope]}</option>)}
          </select>
          {template && publishedWorkflow(template) && <p className="text-slate-600">الإصدار المنشور {publishedWorkflow(template)?.version}</p>}
        </div>
        {editing && <section aria-label="سجل إصدارات القالب" className="space-y-2">
          <button type="button" className="min-h-11 rounded-lg border border-slate-300 px-3 font-semibold" onClick={() => void loadHistory()}>سجل الإصدارات</button>
          {history && <ul className="space-y-1">{history.map(version => <li key={version.version} className="flex flex-wrap items-center gap-2">
            <span>الإصدار {version.version} · {version.name}</span>
            <button type="button" className="min-h-11 rounded-lg px-3 font-bold text-blue-800" onClick={() => loadVersionIntoDraft(version)}>تحميل الإصدار {version.version} إلى المسودة</button>
          </li>)}</ul>}
        </section>}
        <WorkflowDiagram nodes={steps.map(step => ({ ...step, label: step.title || stepTypes.find(type => type.id === step.type)?.name || step.type }))}
          onMove={(id, target) => { const from = steps.findIndex(step => step.id === id); if (from >= 0) move(from, target - from); }} />
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
          onConnectSteps={saving ? undefined : connectSteps}
          renderStepEditor={node => {
            const step = withDependencies.find(item => `step:${item.id}` === node.id);
            if (!step) return null;
            return <fieldset aria-label="تحرير الخطوة في المخطط" disabled={saving} className="space-y-3">
              <label className="block">
                <span className={LABEL}>اسم الخطوة في المخطط</span>
                <input className={INPUT} maxLength={200} value={step.title || ''} placeholder={node.label}
                  onChange={event => changeGraphStep(step.id, { title: event.target.value })} />
              </label>
              <StepExecutionFields step={step} tracks={executionTracks} choices={graphChoices} expanded
                onChange={changes => changeGraphStep(step.id, changes)} />
            </fieldset>;
          }}
          controls={graphError ? <p role="alert" className="font-semibold text-rose-700">{graphError}</p> : undefined}
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
                  <button type="button" disabled={steps.length === 1} onClick={() => setSteps((list) => list.filter(s => s.id !== step.id).map(s => ({ ...s, dependencies: s.dependencies?.filter(dep => dep.stepId !== step.id) })))} aria-label="حذف المهمة" className="w-11 h-11 shrink-0 inline-flex items-center justify-center rounded-lg border border-rose-200 text-rose-700 disabled:opacity-40"><Trash2 className="w-4 h-4" /></button>
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
                  <div>
                    <label htmlFor={`tpl-reviewer-${step.id}`} className={LABEL}>مراجع الخطوة</label>
                    <select id={`tpl-reviewer-${step.id}`} value={step.reviewerId || ''} onChange={event => patch(step.id, { reviewerId: event.target.value || undefined })} className={INPUT}>
                      <option value="">بلا مراجعة مستقلة</option>
                      {step.reviewerId && !people.some(person => person.id === step.reviewerId) && <option value={step.reviewerId}>المراجع غير متاح حاليًا</option>}
                      {people.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
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
                    <label htmlFor={`tpl-due-basis-${step.id}`} className={LABEL}>مرجع الموعد</label>
                    <select id={`tpl-due-basis-${step.id}`} value={step.dueBasis || 'DELIVERY'} className={INPUT} onChange={e => patch(step.id, { dueBasis: e.target.value as TemplateStep['dueBasis'] })}>
                      <option value="DELIVERY">موعد التسليم</option>
                      <option value="AIR">موعد البث</option>
                      <option value="CREATION">إنشاء التكليف</option>
                    </select>
                    <label htmlFor={`tpl-due-${step.id}`} className={LABEL}>{step.dueBasis === 'CREATION' ? 'بعد الإنشاء (دقيقة)' : 'قبل الموعد (دقيقة)'}</label>
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
                  <StepExecutionFields step={step} tracks={executionTracks} choices={graphChoices} onChange={changes => patch(step.id, changes)} />
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
          <button type="submit" value="draft" disabled={saving} className="min-h-11 px-4 font-bold border border-slate-300 rounded-xl disabled:opacity-60">حفظ المسودة</button>
          <button type="submit" value="publish" disabled={saving} className="min-h-11 px-5 py-2 font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl disabled:opacity-60">نشر إصدار القالب</button>
        </div>
      </form>
    </FormPage>
  );
};
