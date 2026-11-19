import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { FormPage } from '../common/FormPage';
import { apiService } from '../../services/api';
import { newId } from '../../shared/ids';
import { fromLocalInputValue, toLocalInputValue } from '../../shared/dates';
import { CARD_KINDS, CARD_STEP_PRESETS, COMPLEXITIES, MAX_CARD_STEPS, stepTypesOf, type CardKind, type CardLink, type CardStep, type CardTarget, type ProductionCard } from '../../shared/productionCards';
import { stationScope, stationsOf } from '../../shared/stations';
import type { User } from '../../types';
import { INPUT, LABEL } from './cardUi';

interface CardFormPageProps {
  isOpen: boolean;
  onClose: () => void;
  /** Card being edited; absent for a new card. */
  card?: ProductionCard | null;
  users: User[];
  currentUser: User;
  onSaved: (card: ProductionCard, message: string) => void;
}

const localInput = (iso?: string) => (iso ? toLocalInputValue(iso) : '');
const fromInput = (value: string) => (value ? fromLocalInputValue(value) : undefined);

/** Who a step goes to: a person (`u:<id>`), a station for anyone there to pick up (`s:<id>`), or nobody yet. */
const targetOf = (step: CardStep) => (step.assigneeId ? `u:${step.assigneeId}` : step.stationId ? `s:${step.stationId}` : '');

/** Creates a production card or edits its details, deadlines and steps (supervisors only). */
export const CardFormPage: React.FC<CardFormPageProps> = ({ isOpen, onClose, card, users, currentUser, onSaved }) => {
  const settings = apiService.getSettings();
  const stations = stationsOf(settings);
  const stepTypes = stepTypesOf(settings);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<CardKind>('NEWS');
  const [brief, setBrief] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [ownerId, setOwnerId] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [airAt, setAirAt] = useState('');
  const [steps, setSteps] = useState<CardStep[]>([]);
  const [links, setLinks] = useState<CardLink[]>([]);
  const [target, setTarget] = useState<CardTarget | undefined>();
  const [error, setError] = useState<string | null>(null);

  const newStep = (type: string): CardStep => ({ id: newId('stp'), type, status: 'TODO', complexity: 1 });

  useEffect(() => {
    if (!isOpen) return;
    setTitle(card?.title || '');
    setKind(card?.kind || 'NEWS');
    setTarget(card?.target);
    setBrief(card?.brief || '');
    setUrgent(card?.priority === 'URGENT');
    setOwnerId(card?.ownerId || currentUser.id);
    setDueAt(localInput(card?.dueAt));
    setAirAt(localInput(card?.airAt));
    setSteps(card?.steps || CARD_STEP_PRESETS[1].types.filter((t) => stepTypes.some((x) => x.id === t)).map(newStep));
    setLinks(card?.links || []);
    setError(null);
    // The form is filled once when it opens; later edits belong to the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, card?.id]);

  // Supervisors distribute work inside the stations they follow.
  const scope = useMemo(() => stationScope(stations, currentUser.stationId), [stations, currentUser.stationId]);
  const people = useMemo(() => users.filter((u) => u.isActive !== false && !u.deletedAt && (!u.stationId || scope.has(u.stationId))), [users, scope]);
  const groups = useMemo(
    () => [
      ...stations.filter((s) => scope.has(s.id)).map((s) => ({ station: s, members: people.filter((u) => u.stationId === s.id) })),
      { station: null, members: people.filter((u) => !stations.some((s) => s.id === u.stationId)) },
    ],
    [stations, scope, people]
  );

  // Newsroom records the card can produce: stories still being worked on and upcoming episodes.
  const records = useMemo(() => {
    if (!isOpen) return { news: [], episodes: [] };
    const news = apiService.getNews().filter((n) => !n.deletedAt && !['PUBLISHED', 'ARCHIVED', 'REJECTED', 'UNPUBLISHED'].includes(n.status)).slice(0, 80);
    const episodes = apiService.getEpisodes().filter((e) => !e.deletedAt && !['BROADCASTED', 'ARCHIVED', 'CANCELLED'].includes(e.status)).slice(0, 80);
    return { news, episodes };
  }, [isOpen]);
  const pickTarget = (value: string) => {
    const [recordKind, id] = [value.slice(0, value.indexOf(':')), value.slice(value.indexOf(':') + 1)];
    if (recordKind === 'news') setTarget({ kind: 'news', id, title: records.news.find((n) => n.id === id)?.title || target?.title || '' });
    else if (recordKind === 'episode') setTarget({ kind: 'episode', id, title: records.episodes.find((e) => e.id === id)?.title || target?.title || '' });
    else setTarget(recordKind === 'bulletin' ? card?.target : undefined);
  };

  const patchStep = (id: string, changes: Partial<CardStep>) => setSteps((list) => list.map((s) => (s.id === id ? { ...s, ...changes } : s)));
  const moveStep = (index: number, by: number) =>
    setSteps((list) => {
      const next = [...list];
      const [step] = next.splice(index, 1);
      next.splice(index + by, 0, step);
      return next;
    });
  const setStepTarget = (id: string, value: string) => {
    if (value.startsWith('u:')) patchStep(id, { assigneeId: value.slice(2), stationId: undefined });
    else if (value.startsWith('s:')) patchStep(id, { assigneeId: undefined, assigneeName: undefined, stationId: value.slice(2) });
    else patchStep(id, { assigneeId: undefined, assigneeName: undefined, stationId: undefined });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const saved = apiService.saveCard({
        ...(card || { id: newId('crd'), status: 'OPEN' as const, log: [] }),
        title: title.trim(),
        kind,
        brief: brief.trim() || undefined,
        priority: urgent ? 'URGENT' : 'NORMAL',
        ownerId: ownerId || undefined,
        dueAt: fromInput(dueAt),
        airAt: fromInput(airAt),
        target,
        steps,
        links: links.map((l) => ({ label: l.label.trim(), url: l.url.trim() })).filter((l) => l.url),
      });
      onSaved(saved, card ? 'حُفظ التكليف' : 'أُنشئ التكليف ووصل التنبيه للمعنيين');
      onClose();
    } catch (err: any) {
      setError(err?.message || 'تعذر حفظ التكليف');
    }
  };

  return (
    <FormPage isOpen={isOpen} onClose={onClose} title={card ? 'تعديل التكليف' : 'تكليف حر جديد'} subtitle="تكليف واحد يرافق المادة بين المحطات والأقسام" maxWidth="4xl">
      <form onSubmit={submit} className="space-y-5 text-xs">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2">
            <label htmlFor="card-title" className={LABEL}>عنوان المادة *</label>
            <input id="card-title" data-autofocus required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="مثال: شهادة مصوّرة من مخيم جباليا" className={INPUT} />
          </div>
          <div>
            <label htmlFor="card-kind" className={LABEL}>نوع المادة</label>
            <select id="card-kind" value={kind} onChange={(e) => setKind(e.target.value as CardKind)} className={INPUT}>
              {CARD_KINDS.map((k) => (
                <option key={k.id} value={k.id}>{k.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="card-target" className={LABEL}>المادة في غرفة الأخبار (اختياري)</label>
          <select id="card-target" value={target ? `${target.kind}:${target.id}` : ''} onChange={(e) => pickTarget(e.target.value)} className={INPUT}>
            <option value="">غير مرتبطة بخبر أو حلقة</option>
            {target && target.kind !== 'bulletin' && !(target.kind === 'news' ? records.news : records.episodes).some((r) => r.id === target.id) && <option value={`${target.kind}:${target.id}`}>{target.title}</option>}
            {target?.kind === 'bulletin' && <option value={`bulletin:${target.id}`}>{target.title}</option>}
            {records.news.length > 0 && (
              <optgroup label="أخبار قيد العمل">
                {records.news.map((n) => (
                  <option key={n.id} value={`news:${n.id}`}>{n.title || 'خبر بلا عنوان'}</option>
                ))}
              </optgroup>
            )}
            {records.episodes.length > 0 && (
              <optgroup label="حلقات قادمة">
                {records.episodes.map((e) => (
                  <option key={e.id} value={`episode:${e.id}`}>{e.programName ? `${e.programName} — ` : ''}{e.title}</option>
                ))}
              </optgroup>
            )}
          </select>
        </div>

        <div>
          <label htmlFor="card-brief" className={LABEL}>المطلوب إنجازه</label>
          <textarea id="card-brief" rows={3} maxLength={5000} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="ما الذي نريده من هذه المادة؟ الزاوية، المدة، المصادر المطلوبة…" className={INPUT} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label htmlFor="card-due" className={LABEL}>موعد التسليم</label>
            <input id="card-due" type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className={INPUT} />
          </div>
          <div>
            <label htmlFor="card-air" className={LABEL}>موعد البث</label>
            <input id="card-air" type="datetime-local" value={airAt} onChange={(e) => setAirAt(e.target.value)} className={INPUT} />
          </div>
          <div>
            <label htmlFor="card-owner" className={LABEL}>صاحب القرار عند التعطل</label>
            <select id="card-owner" value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className={INPUT}>
              {people.map((u) => (
                <option key={u.id} value={u.id}>{u.fullName}</option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 font-bold text-slate-700 lg:mt-6 min-h-11">
            <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} />
            مادة عاجلة
          </label>
        </div>

        <fieldset className="space-y-2">
          <legend className="font-bold text-slate-800 text-sm">مهام التكليف بالترتيب</legend>
          <p className="text-2xs text-slate-500">كل مهمة تُسند لزميل بعينه، أو لمحطة ليستلمها أحد أفرادها. عند إنجاز مهمة يصل تنبيه لصاحب المهمة التالية مع ملاحظة التسليم.</p>
          {!card && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-slate-500">ابدأ من مسار جاهز:</span>
              {CARD_STEP_PRESETS.map((preset) => (
                <button key={preset.id} type="button" onClick={() => setSteps(preset.types.filter((t) => stepTypes.some((x) => x.id === t)).map(newStep))} className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white font-bold text-slate-700 hover:bg-slate-50">
                  {preset.name}
                </button>
              ))}
            </div>
          )}

          <ol className="space-y-2">
            {steps.map((step, index) => (
              <li key={step.id} className="border border-slate-200 rounded-2xl bg-white p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 shrink-0 rounded-full bg-slate-100 text-slate-700 font-bold flex items-center justify-center tabular-nums">{index + 1}</span>
                  <select aria-label={`نوع المهمة ${index + 1}`} value={step.type} onChange={(e) => patchStep(step.id, { type: e.target.value })} className={`${INPUT} font-bold`}>
                    {!stepTypes.some((t) => t.id === step.type) && <option value={step.type}>مهمة (نوع محذوف)</option>}
                    {stepTypes.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                  <button type="button" disabled={index === 0} onClick={() => moveStep(index, -1)} aria-label="تقديم المهمة" className="p-2 rounded-lg border border-slate-200 text-slate-600 disabled:opacity-40"><ArrowUp className="w-4 h-4" /></button>
                  <button type="button" disabled={index === steps.length - 1} onClick={() => moveStep(index, 1)} aria-label="تأخير المهمة" className="p-2 rounded-lg border border-slate-200 text-slate-600 disabled:opacity-40"><ArrowDown className="w-4 h-4" /></button>
                  <button type="button" onClick={() => setSteps((list) => list.filter((s) => s.id !== step.id))} aria-label="حذف المهمة" className="p-2 rounded-lg border border-rose-200 text-rose-700"><Trash2 className="w-4 h-4" /></button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
                  <div className="lg:col-span-2">
                    <label htmlFor={`step-to-${step.id}`} className={LABEL}>المكلف</label>
                    <select id={`step-to-${step.id}`} value={targetOf(step)} onChange={(e) => setStepTarget(step.id, e.target.value)} className={INPUT}>
                      <option value="">لم تُسند بعد</option>
                      {step.assigneeId && !people.some((u) => u.id === step.assigneeId) && <option value={`u:${step.assigneeId}`}>{step.assigneeName || 'زميل'}</option>}
                      {groups.map(({ station, members }) =>
                        station ? (
                          <optgroup key={station.id} label={`محطة ${station.name}`}>
                            <option value={`s:${station.id}`}>أي زميل في {station.name}</option>
                            {members.map((u) => (
                              <option key={u.id} value={`u:${u.id}`}>{u.fullName} — {u.jobTitle}</option>
                            ))}
                          </optgroup>
                        ) : members.length ? (
                          <optgroup key="none" label="بدون محطة">
                            {members.map((u) => (
                              <option key={u.id} value={`u:${u.id}`}>{u.fullName} — {u.jobTitle}</option>
                            ))}
                          </optgroup>
                        ) : null
                      )}
                    </select>
                  </div>
                  <div>
                    <label htmlFor={`step-due-${step.id}`} className={LABEL}>التسليم</label>
                    <input id={`step-due-${step.id}`} type="datetime-local" value={localInput(step.dueAt)} onChange={(e) => patchStep(step.id, { dueAt: fromInput(e.target.value) })} className={INPUT} />
                  </div>
                  <div>
                    <label htmlFor={`step-cx-${step.id}`} className={LABEL}>التعقيد</label>
                    <select id={`step-cx-${step.id}`} value={step.complexity} onChange={(e) => patchStep(step.id, { complexity: Number(e.target.value) as 1 | 2 | 3 })} className={INPUT}>
                      {COMPLEXITIES.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor={`step-est-${step.id}`} className={LABEL}>الوقت المقدر (دقيقة)</label>
                    <input id={`step-est-${step.id}`} type="number" min={0} max={100000} inputMode="numeric" value={step.estimateMinutes ?? ''} onChange={(e) => patchStep(step.id, { estimateMinutes: e.target.value === '' ? undefined : Math.max(0, Math.round(Number(e.target.value))) })} className={INPUT} />
                  </div>
                </div>
                <div>
                  <label htmlFor={`step-title-${step.id}`} className={LABEL}>تفصيل المهمة (اختياري)</label>
                  <input id={`step-title-${step.id}`} maxLength={200} value={step.title || ''} onChange={(e) => patchStep(step.id, { title: e.target.value })} placeholder="مثال: مقابلة مع شاهد العيان وصور للموقع" className={INPUT} />
                </div>
              </li>
            ))}
          </ol>
          {steps.length < MAX_CARD_STEPS && (
            <button type="button" onClick={() => setSteps((list) => [...list, newStep(stepTypes[0].id)])} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-dashed border-slate-300 font-bold text-slate-700 hover:bg-slate-50">
              <Plus className="w-4 h-4" />
              إضافة مهمة
            </button>
          )}
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="font-bold text-slate-800 text-sm">روابط الصور والمقابلات</legend>
          {links.map((link, index) => (
            <div key={index} className="grid grid-cols-1 sm:grid-cols-[1fr_2fr_auto] gap-2">
              <input aria-label={`وصف الرابط ${index + 1}`} maxLength={160} value={link.label} onChange={(e) => setLinks((list) => list.map((l, i) => (i === index ? { ...l, label: e.target.value } : l)))} placeholder="الوصف: مقابلة الشاهد" className={INPUT} />
              <input aria-label={`عنوان الرابط ${index + 1}`} type="url" dir="ltr" value={link.url} onChange={(e) => setLinks((list) => list.map((l, i) => (i === index ? { ...l, url: e.target.value } : l)))} placeholder="https://" className={INPUT} />
              <button type="button" onClick={() => setLinks((list) => list.filter((_, i) => i !== index))} aria-label="حذف الرابط" className="p-2 rounded-lg border border-rose-200 text-rose-700 justify-self-start"><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
          <button type="button" onClick={() => setLinks((list) => [...list, { label: '', url: '' }])} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-dashed border-slate-300 font-bold text-slate-700 hover:bg-slate-50">
            <Plus className="w-4 h-4" />
            إضافة رابط
          </button>
        </fieldset>

        {error && <p role="alert" className="p-2 rounded-lg bg-rose-50 text-rose-700 font-bold">{error}</p>}
        <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
          <button type="button" onClick={onClose} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl">إلغاء</button>
          <button type="submit" className="px-5 py-2 font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl">{card ? 'حفظ التكليف' : 'إنشاء التكليف'}</button>
        </div>
      </form>
    </FormPage>
  );
};
