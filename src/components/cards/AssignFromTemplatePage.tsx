import React, { useEffect, useMemo, useState } from 'react';
import { FormPage } from '../common/FormPage';
import { apiService } from '../../services/api';
import { notify } from '../../services/notify';
import { fromLocalInputValue } from '../../shared/dates';
import { cardKindName, stepAssigneeLabel, stepTypeName, stepTypesOf, type ProductionCard } from '../../shared/productionCards';
import { cardFromTemplate, defaultPick, ruleCandidates, RULE_KINDS, type WorkflowTemplate } from '../../shared/workflowTemplates';
import { departmentName } from '../../shared/departments';
import { stationName, stationScope, stationsOf } from '../../shared/stations';
import type { User } from '../../types';
import { INPUT, LABEL, candidateLabel, cardCandidates, when } from './cardUi';
import { useConfirmedCardSave } from './useConfirmedCardSave';

interface AssignFromTemplatePageProps {
  isOpen: boolean;
  onClose: () => void;
  /** Template chosen beforehand (from the templates tab); the manager can switch it here. */
  templateId?: string | null;
  currentUser: User;
  onCreated: (card: ProductionCard) => void;
}

const fromInput = (value: string) => (value ? fromLocalInputValue(value) : undefined);

/** «تكليف من قالب»: pick a workflow, fill in the details, resolve who does each step, preview, create. */
export const AssignFromTemplatePage: React.FC<AssignFromTemplatePageProps> = ({ isOpen, onClose, templateId, currentUser, onCreated }) => {
  const settings = apiService.getSettings();
  const stations = stationsOf(settings);
  const stepTypes = stepTypesOf(settings);
  const templates = useMemo(() => (isOpen ? apiService.getWorkflowTemplates().filter((t) => !t.archived) : []), [isOpen]);
  const scope = useMemo(() => stationScope(stations, currentUser.stationId), [stations, currentUser.stationId]);
  // Managers hand work to colleagues in the stations they follow.
  const people = useMemo(() => (isOpen ? cardCandidates().filter((p) => !p.stationId || scope.has(p.stationId)) : []), [isOpen, scope]);
  const [chosen, setChosen] = useState('');
  const [title, setTitle] = useState('');
  const [brief, setBrief] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [airAt, setAirAt] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [stationId, setStationId] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const { save, saving, error, reset, pending } = useConfirmedCardSave();
  const template: WorkflowTemplate | undefined = templates.find((t) => t.id === chosen);

  useEffect(() => {
    if (!isOpen) return;
    const first = templateId && templates.some((t) => t.id === templateId) ? templateId : templates[0]?.id || '';
    setChosen(first);
    setTitle('');
    setBrief('');
    setDueAt('');
    setAirAt('');
    setOwnerId(currentUser.id);
    setStationId(currentUser.stationId || '');
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, templateId]);
  // A new template (or station) brings its own defaults.
  useEffect(() => {
    if (!template) return;
    setUrgent(template.priority === 'URGENT');
    setPicks(Object.fromEntries(template.steps.map((s) => [s.id, defaultPick(s, people, stationId || undefined)])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen, stationId]);

  const input = { title: title || template?.name || '', brief, dueAt: fromInput(dueAt), airAt: fromInput(airAt), ownerId: ownerId || undefined, stationId: stationId || undefined, priority: urgent ? ('URGENT' as const) : ('NORMAL' as const), picks };
  let previewSeq = 0;
  const preview = template ? cardFromTemplate(template, input, people, { cardId: 'preview', newStepId: () => `preview-${previewSeq++}` }) : null;
  const named = (card: ProductionCard) => ({ ...card, steps: card.steps.map((s) => ({ ...s, assigneeName: people.find((p) => p.id === s.assigneeId)?.name })) });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!template) return;
    const saved = await save((id) => {
      let stepIndex = 0;
      return cardFromTemplate(template, { ...input, title }, people, {
        cardId: id,
        newStepId: () => `${id}-step-${stepIndex++}`,
      });
    });
    if (saved) {
      notify({ type: 'success', message: 'أُنشئ التكليف ووصل التنبيه للمكلفين' });
      onCreated(saved);
      onClose();
    }
  };

  return (
    <FormPage isOpen={isOpen} onClose={() => { if (pending.current) return false; onClose(); }} title="تكليف من قالب" subtitle="اختر سير العمل ثم حدّد من ينفّذ كل مهمة" maxWidth="4xl">
      {templates.length === 0 ? (
        <p className="text-sm text-slate-600">لا قوالب نشطة. أنشئ قالباً من تبويب «القوالب» أولاً.</p>
      ) : (
        <form onSubmit={submit} className="space-y-5 text-xs">
          <fieldset disabled={saving} className="min-w-0 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label htmlFor="asg-template" className={LABEL}>القالب</label>
              <select id="asg-template" value={chosen} onChange={(e) => setChosen(e.target.value)} className={INPUT}>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name} — {cardKindName(t.kind)}</option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="asg-title" className={LABEL}>عنوان التكليف *</label>
              <input id="asg-title" data-autofocus required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={template ? `مثال: ${template.name} — ${new Date().toLocaleDateString('ar')}` : ''} className={INPUT} />
            </div>
          </div>
          {template?.description && <p className="text-slate-600">{template.description}</p>}
          <div>
            <label htmlFor="asg-brief" className={LABEL}>المطلوب إنجازه (اختياري)</label>
            <textarea id="asg-brief" rows={2} maxLength={5000} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder={template?.description || ''} className={INPUT} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label htmlFor="asg-due" className={LABEL}>موعد التسليم</label>
              <input id="asg-due" type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className={INPUT} />
            </div>
            <div>
              <label htmlFor="asg-air" className={LABEL}>موعد البث</label>
              <input id="asg-air" type="datetime-local" value={airAt} onChange={(e) => setAirAt(e.target.value)} className={INPUT} />
            </div>
            <div>
              <label htmlFor="asg-owner" className={LABEL}>صاحب القرار</label>
              <select id="asg-owner" value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className={INPUT}>
                {people.some((p) => p.id === currentUser.id) ? null : <option value={currentUser.id}>{currentUser.fullName}</option>}
                {people.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} — {stationName(stations, p.stationId)}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="asg-station" className={LABEL}>المحطة المنفّذة</label>
              <select id="asg-station" value={stationId} onChange={(e) => setStationId(e.target.value)} className={INPUT}>
                <option value="">كل المحطات</option>
                {stations.filter((s) => scope.has(s.id)).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          </div>
          <label className="inline-flex items-center gap-2 font-bold text-slate-700 min-h-11">
            <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} />
            تكليف عاجل
          </label>

          {template && (
            <fieldset className="space-y-2">
              <legend className="font-bold text-slate-800 text-sm">من ينفّذ كل مهمة</legend>
              <p className="text-2xs text-slate-500">بجانب كل زميل عدد مهامه المفتوحة الآن. «متاحة للمحطة» أو «للقسم» يعني أن يستلمها أحد أفرادها.</p>
              <ol className="space-y-2">
                {template.steps.map((step, index) => {
                  const candidates = ruleCandidates(step, people, stationId || undefined);
                  const others = people.filter((p) => !candidates.some((c) => c.id === p.id));
                  const resolved = preview?.steps[index];
                  return (
                    <li key={step.id} className="border border-slate-200 rounded-2xl bg-white p-3 grid grid-cols-1 sm:grid-cols-[1fr_1.4fr] gap-2 items-start">
                      <div>
                        <p className="font-bold text-slate-900 text-sm">{index + 1}. {stepTypeName(stepTypes, step.type)}</p>
                        {step.title && <p className="text-slate-600">{step.title}</p>}
                        <p className="text-2xs text-slate-500">
                          {RULE_KINDS.find((r) => r.id === step.rule.kind)?.name}
                          {step.rule.kind === 'DEPARTMENT' ? `: ${departmentName(step.rule.departmentId)}` : step.rule.kind === 'STATION' ? `: ${stationName(stations, step.rule.stationId)}` : ''}
                          {resolved?.dueAt ? ` — التسليم ${when(resolved.dueAt)}` : ''}
                        </p>
                      </div>
                      <div>
                        <label htmlFor={`asg-pick-${step.id}`} className="sr-only">منفّذ {stepTypeName(stepTypes, step.type)}</label>
                        <select id={`asg-pick-${step.id}`} value={picks[step.id] ?? ''} onChange={(e) => setPicks((p) => ({ ...p, [step.id]: e.target.value }))} className={INPUT}>
                          <option value="">لم تُسند بعد</option>
                          {candidates.length > 0 && (
                            <optgroup label="المطابقون للقاعدة">
                              {candidates.map((c) => (
                                <option key={c.id} value={c.id}>{candidateLabel(c, stations)}</option>
                              ))}
                            </optgroup>
                          )}
                          <optgroup label="اتركها مفتوحة">
                            {step.rule.kind === 'DEPARTMENT' && <option value={`d:${step.rule.departmentId}`}>متاحة لقسم {departmentName(step.rule.departmentId)}</option>}
                            {stations.filter((s) => scope.has(s.id)).map((s) => (
                              <option key={s.id} value={`s:${s.id}`}>متاحة لمحطة {s.name}</option>
                            ))}
                          </optgroup>
                          {others.length > 0 && (
                            <optgroup label="زملاء آخرون">
                              {others.map((c) => (
                                <option key={c.id} value={c.id}>{candidateLabel(c, stations)}</option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </fieldset>
          )}

          {preview && (
            <section aria-label="معاينة التكليف" className="p-3 rounded-2xl border border-blue-200 bg-blue-50/50 space-y-1">
              <h3 className="font-bold text-slate-900 text-sm">معاينة: {title || 'تكليف بلا عنوان'}</h3>
              <ol className="list-decimal pr-5 space-y-0.5 text-slate-700">
                {named(preview).steps.map((s) => (
                  <li key={s.id}>
                    {stepTypeName(stepTypes, s.type)} — {stepAssigneeLabel(s, stations)}
                    {s.dueAt ? ` — ${when(s.dueAt)}` : ''}
                  </li>
                ))}
              </ol>
            </section>
          )}

          {error && <p role="alert" className="p-2 rounded-lg bg-rose-50 text-rose-700 font-bold">{error}</p>}
          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <button type="button" onClick={onClose} className="min-h-11 px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl">إلغاء</button>
            <button type="submit" disabled={!template || !title.trim()} className="min-h-11 px-5 py-2 font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl disabled:opacity-50">{saving ? 'جارٍ حفظ التكليف…' : 'إنشاء التكليف'}</button>
          </div>
          </fieldset>
        </form>
      )}
    </FormPage>
  );
};
