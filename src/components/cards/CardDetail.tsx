import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, Copy, ExternalLink, FileText, Gavel, LayoutTemplate, Link2, Paperclip, Pencil, Play, Send, Sparkles, Undo2, UserPlus, Users, X } from 'lucide-react';
import { apiService } from '../../services/api';
import { createDepartmentLabeler } from '../../services/departmentLabels';
import { CardBriefReview } from './CardBriefReview';
import { CardTimingValues } from './CardTimingValues';
import { MessageOriginLabel } from '../messages/MessageOriginLabel';
import { stepLaborMinutes } from '../../shared/cardExecutionTiming';
import { confirmDialog } from '../../services/dialogs';
import { confirmSaved } from '../../services/confirmSave';
import { notify } from '../../services/notify';
import { navigateTo } from '../../services/uiEvents';
import { copyTextToClipboard } from '../../services/clipboard';
import {
  CARD_STATE_NAMES,
  REVIEW_STEP_TYPES,
  canClaimStep,
  canGovernCard,
  canSendBack,
  cardContributions,
  cardHoldReason,
  cardKindName,
  cardProgress,
  cardState,
  complexityName,
  isCardLate,
  isStepOpen,
  isStepOwnLate,
  openStepsBefore,
  sendBackTargets,
  stepAssigneeLabel,
  stepStatusName,
  stepTypeName,
  stepTypesOf,
  type CardStep,
  type ProductionCard,
} from '../../shared/productionCards';
import { stationName, stationScope, stationsOf } from '../../shared/stations';
import { assignmentScope } from '../../shared/assignmentScope';
import { minutesLabel } from '../../shared/workload';
import { AR, countLabel } from '../../shared/arabicPlural';
import { CARD_STATE_STYLE, INPUT, LABEL, STEP_STATUS_STYLE, candidateLabel, cardCandidates, when } from './cardUi';

interface CardDetailProps {
  card: ProductionCard;
  /** Back to the list of cards. */
  onClose: () => void;
  onEdit: (card: ProductionCard) => void;
  onOpenTarget?: (card: ProductionCard) => void;
  /** «حفظ كقالب»: turns this assignment's chain of steps into a reusable workflow template. */
  onSaveAsTemplate?: (card: ProductionCard) => void;
  now?: number;
}

const BTN = 'inline-flex items-center gap-1.5 min-h-11 px-3 py-2 rounded-lg text-xs font-bold';
const MEDIA_TYPE_NAMES: Record<string, string> = { IMAGE: 'صورة', VIDEO: 'فيديو', AUDIO: 'صوت', DOCUMENT: 'وثيقة', PDF: 'PDF' };

/** The open panel under a step: finishing it, reporting a blocker, sending work back, or handing it to someone else. */
type Panel = { stepId: string; kind: 'done' | 'block' | 'back' | 'reassign' } | null;

/** One production card: its steps and handoffs, the script, the material and the documented trail. */
export const CardDetail: React.FC<CardDetailProps> = ({ card, onClose, onEdit, onOpenTarget, onSaveAsTemplate, now = Date.now() }) => {
  const settings = apiService.getSettings();
  const labelDepartment = useMemo(createDepartmentLabeler, [settings]);
  const stations = stationsOf(settings);
  const stepTypes = stepTypesOf(settings);
  const actor = apiService.cardActor();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const messageRef = useRef<HTMLParagraphElement>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [doneNote, setDoneNote] = useState('');
  const [doneMinutes, setDoneMinutes] = useState('');
  const [reason, setReason] = useState('');
  const [waitingOn, setWaitingOn] = useState('');
  const [backTo, setBackTo] = useState('');
  const [reassignTo, setReassignTo] = useState('');
  const [script, setScript] = useState('');
  const [note, setNote] = useState('');
  const [decision, setDecision] = useState(false);
  const [briefReviewOpen, setBriefReviewOpen] = useState(false);
  const [gaps, setGaps] = useState<string[]>([]);
  const [linkLabel, setLinkLabel] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [mediaQuery, setMediaQuery] = useState('');
  const [mediaPick, setMediaPick] = useState('');

  useEffect(() => {
    setPanel(null);
    setMessage(null);
    setNote('');
    setDecision(false);
    setGaps([]);
    setBriefReviewOpen(false);
  }, [card.id]);
  // The editable copy follows the stored script (a colleague may have saved a newer one).
  useEffect(() => setScript(card.script || ''), [card.id, card.script]);
  // A message on the card is brought into view, wherever the action was taken.
  useEffect(() => {
    if (message) messageRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [message]);

  const open = card.status === 'OPEN';
  const state = cardState(card);
  const late = isCardLate(card);
  const progress = cardProgress(card);
  const hold = cardHoldReason(card, stepTypes, Date.now(), stations);
  const isOwner = card.ownerId === actor.id;
  const worksOnCard = card.steps.some((s) => s.assigneeId === actor.id);
  const canEditScript = open && (actor.canManage || (actor.canWork && (worksOnCard || isOwner)));
  const canEditMaterial = canEditScript;
  const canReassign = open && (actor.canManage || (isOwner && actor.canWork));
  const canDecide = actor.canManage || isOwner;
  const governs = canGovernCard(card, actor, stations);
  const contributions = cardContributions(card, stepTypes);
  const latestDecision = [...(card.log || [])].reverse().find((e) => e.decision);

  // Colleagues a supervisor can hand work to (in the stations they follow), with how much open work each already holds.
  const people = useMemo(() => {
    if (!open) return [];
    const scope = stationScope(stations, actor);
    return cardCandidates().filter((p) => !p.stationId || scope.has(p.stationId));
    // The list is rebuilt when the card changes; colleagues and settings rarely change meanwhile.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card, open, actor.stationId]);
  const personLabel = (p: (typeof people)[number]) => candidateLabel(p, stations);
  const eligibility = assignmentScope(apiService.getCurrentUser(), settings);
  const eligiblePeople = new Set(apiService.getUsers().filter(user => !eligibility.errorFor(user)).map(user => user.id));

  const library = useMemo(() => apiService.getMedia().filter((m: any) => !m.deletedAt), [card.mediaIds]);
  const attached = (card.mediaIds || []).map((id) => ({ id, item: library.find((m) => m.id === id) }));
  const mediaMatches = useMemo(() => {
    const q = mediaQuery.trim().toLowerCase();
    return library
      .filter((m) => !(card.mediaIds || []).includes(m.id))
      .filter((m) => !q || [m.title, m.originalName, m.fileName, ...(m.tags || [])].some((v) => (v || '').toLowerCase().includes(q)))
      .slice(0, 40);
  }, [library, mediaQuery, card.mediaIds]);

  /** Saves locally, then tells the user once the server confirmed (an offline write says so instead). */
  const act = (fn: () => void, ok: string): boolean => {
    try {
      fn();
      setMessage(null);
      void confirmSaved('productionCards', card.id, ok);
      return true;
    } catch (err: any) {
      const text = err?.message || 'تعذر تنفيذ الإجراء';
      setMessage({ ok: false, text });
      notify({ type: 'error', message: text });
      return false;
    }
  };
  const setStep = (step: CardStep, changes: Partial<CardStep>, ok: string) => act(() => apiService.updateCardStep(card.id, step.id, changes), ok);

  const openPanel = (step: CardStep, kind: NonNullable<Panel>['kind']) => {
    setReason('');
    if (kind === 'done') {
      setDoneNote(step.note || '');
      setDoneMinutes('');
    }
    if (kind === 'block') {
      const index = card.steps.findIndex((s) => s.id === step.id);
      const earlier = card.steps.slice(0, index).reverse().find((s) => s.status !== 'SKIPPED');
      setWaitingOn(earlier?.assigneeId && earlier.assigneeId !== actor.id ? earlier.assigneeId : '');
    }
    if (kind === 'back') setBackTo(sendBackTargets(card, step.id).at(-1)?.id || '');
    if (kind === 'reassign') setReassignTo('');
    setPanel({ stepId: step.id, kind });
  };

  /** What happens next once this step is done, said only after the server confirmed it. */
  const handoffText = (step: CardStep) => {
    const pending = openStepsBefore(card, step.id);
    if (pending.length) return `سُجّل الإنجاز؛ لا يصل التسليم قبل اكتمال «${stepTypeName(stepTypes, pending[0].type)}»`;
    const index = card.steps.findIndex((s) => s.id === step.id);
    const next = card.steps.slice(index + 1).find(isStepOpen);
    if (!next) return `سُجّل الإنجاز؛ التكليف جاهز ووصل التنبيه إلى ${card.ownerName || 'صاحب القرار'}`;
    if (next.assigneeId) return `سُجّل الإنجاز ووصل التنبيه إلى ${next.assigneeName || 'صاحب المهمة التالية'}`;
    if (next.stationId) return `سُجّل الإنجاز ووصل التنبيه إلى زملاء محطة ${stationName(stations, next.stationId)}`;
    return 'سُجّل الإنجاز؛ المهمة التالية لم تُسند بعد';
  };

  const finish = async (step: CardStep) => {
    const pending = openStepsBefore(card, step.id);
    if (pending.length) {
      const names = pending.map((s) => `«${stepTypeName(stepTypes, s.type)}» (${stepAssigneeLabel(s, stations, labelDepartment)})`).join('، ');
      const go = await confirmDialog({ title: 'الخطوة السابقة لم تكتمل', message: `${names} لم تكتمل بعد. يُسجَّل إنجازك، ولا يصل التسليم إلى الخطوة التالية حتى تكتمل.`, confirmLabel: 'تسجيل الإنجاز', cancelLabel: 'تراجع' });
      if (!go) return;
    }
    const parsedMinutes = doneMinutes.trim() === '' ? undefined : Number(doneMinutes);
    if (parsedMinutes !== undefined && !Number.isFinite(parsedMinutes)) {
      setMessage({ ok: false, text: 'أدخل عدداً صحيحاً من دقائق العمل.' });
      return;
    }
    const minutes = parsedMinutes === undefined ? undefined : Math.max(0, Math.round(parsedMinutes));
    if (act(() => apiService.finishCardStep(card.id, step.id, doneNote, minutes), handoffText(step))) setPanel(null);
  };

  const copy = async (text: string, success: string) => {
    const copied = await copyTextToClipboard(text);
    notify({ type: copied ? 'success' : 'error', message: copied ? success : 'تعذّر النسخ إلى الحافظة.' });
  };
  const copyAssignmentText = () => {
    const text = [
      card.title,
      card.brief,
      `الحالة: ${CARD_STATE_NAMES[state]}`,
      `الأولوية: ${card.priority === 'URGENT' ? 'عاجل' : 'عادي'}`,
      card.dueAt ? `موعد التسليم: ${when(card.dueAt)}` : '',
      ...card.steps.map((step, index) => `${index + 1}. ${stepTypeName(stepTypes, step.type)} — ${stepAssigneeLabel(step, stations, labelDepartment)} — ${stepStatusName(step.status)}${step.dueAt ? ` — ${when(step.dueAt)}` : ''}`),
    ].filter(Boolean).join('\n');
    void copy(text, 'نُسخ نص التكليف.');
  };

  const block = (step: CardStep) => {
    if (!reason.trim()) return;
    const who = people.find((p) => p.id === waitingOn)?.name;
    const ok = `سُجّل التعطل ووصل التنبيه إلى ${[card.ownerName || 'صاحب القرار', who].filter(Boolean).join(' و')}`;
    if (setStep(step, { status: 'BLOCKED', blockedReason: reason.trim(), waitingOnId: waitingOn || undefined }, ok)) setPanel(null);
  };

  const sendBack = (step: CardStep) => {
    const target = card.steps.find((s) => s.id === backTo);
    if (!target || !reason.trim()) return;
    const ok = `أُعيدت «${stepTypeName(stepTypes, target.type)}» ووصل السبب إلى ${stepAssigneeLabel(target, stations, labelDepartment)}`;
    if (act(() => apiService.sendBackCardStep(card.id, target.id, reason, step.id), ok)) setPanel(null);
  };

  const reassign = (step: CardStep) => {
    if (!reassignTo) return;
    let changes: Partial<CardStep>;
    let ok: string;
    if (reassignTo.startsWith('s:')) {
      changes = { assigneeId: undefined, assigneeName: undefined, departmentId: undefined, stationId: reassignTo.slice(2) };
      ok = `صارت «${stepTypeName(stepTypes, step.type)}» متاحة لمحطة ${stationName(stations, reassignTo.slice(2))}`;
    } else {
      // The server takes the station from the new assignee.
      changes = {
        assigneeId: reassignTo,
        assigneeName: undefined,
        ...(actor.canManage ? { departmentId: undefined, stationId: undefined } : {}),
        status: step.status === 'BLOCKED' ? 'IN_PROGRESS' : step.status,
        blockedReason: undefined,
        waitingOnId: undefined,
      };
      ok = `أُسندت «${stepTypeName(stepTypes, step.type)}» إلى ${people.find((p) => p.id === reassignTo)?.name || 'الزميل'}${step.assigneeName ? ` ووصل التنبيه إلى ${step.assigneeName}` : ''}`;
    }
    if (setStep(step, changes, ok)) setPanel(null);
  };

  const saveScript = async () => {
    // An approved script loses its approval when someone other than a supervisor changes it.
    if (card.scriptApproved && !actor.canManage) {
      const go = await confirmDialog({ title: 'النص معتمد', message: `تعديل النص يسحب اعتماده، ويصل تنبيه إلى ${card.ownerName || 'صاحب القرار'} ليعتمده من جديد.`, confirmLabel: 'حفظ وسحب الاعتماد', cancelLabel: 'تراجع' });
      if (!go) return;
    }
    act(() => apiService.updateCard(card.id, (c) => ({ ...c, script })), card.scriptApproved && !actor.canManage ? 'حُفظ النص وسُحب اعتماده؛ وصل التنبيه لصاحب القرار' : 'حُفظ النص');
  };

  const addLink = (e: React.FormEvent) => {
    e.preventDefault();
    const url = linkUrl.trim();
    if (!/^https?:\/\/\S+$/i.test(url)) {
      setMessage({ ok: false, text: 'الرابط يبدأ بـ http أو https' });
      return;
    }
    if (act(() => apiService.updateCard(card.id, (c) => ({ ...c, links: [...(c.links || []), { label: linkLabel.trim() || url, url }] })), 'أُضيف الرابط')) {
      setLinkLabel('');
      setLinkUrl('');
    }
  };
  const attachMedia = () => {
    if (!mediaPick) return;
    if (act(() => apiService.updateCard(card.id, (c) => ({ ...c, mediaIds: [...new Set([...(c.mediaIds || []), mediaPick])] })), 'أُرفق الملف بالتكليف')) {
      setMediaPick('');
      setMediaQuery('');
    }
  };

  const reasonField = (id: string, label: string, placeholder: string) => (
    <div>
      <label htmlFor={id} className={LABEL}>{label}</label>
      <textarea id={id} rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={placeholder} className={INPUT} />
    </div>
  );
  const cancelButton = (
    <button type="button" onClick={() => setPanel(null)} className={`${BTN} border border-slate-200 text-slate-600`}>تراجع</button>
  );

  return (
    <article className="max-w-5xl mx-auto space-y-4">
      {briefReviewOpen && canEditScript && <CardBriefReview key={card.id} title={card.title} script={script}
        onClose={() => setBriefReviewOpen(false)} onUse={result => {
          setScript(result.brief);
          setGaps(result.gaps);
          setBriefReviewOpen(false);
          setMessage({ ok: true, text: 'أُدرج المقترح في مسودة النص. احفظه بعد المراجعة. الاعتماد يبقى للمحرر المسؤول.' });
        }} />}
      <header className="flex flex-wrap items-start gap-3">
        <button type="button" onClick={onClose} className="shrink-0 inline-flex items-center gap-1.5 min-h-11 px-3 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-700 hover:bg-slate-50">
          <ArrowRight className="w-4 h-4" />
          التكليفات
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold text-slate-900 leading-8">{card.title}</h1>
          <MessageOriginLabel origin={card.messageOrigin} />
          <p className="text-xs text-slate-500">تكليف — {cardKindName(card.kind)}{card.ownerStationId ? ` — محطة ${stationName(stations, card.ownerStationId)}` : ''}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void copy(new URL(`/cards/${encodeURIComponent(card.id)}`, window.location.origin).toString(), 'نُسخ رابط التكليف.')} className={`${BTN} border border-slate-200 text-slate-700`}>
            <Link2 className="w-3.5 h-3.5" />نسخ الرابط
          </button>
          <button type="button" onClick={copyAssignmentText} className={`${BTN} border border-slate-200 text-slate-700`}>
            <Copy className="w-3.5 h-3.5" />نسخ النص
          </button>
        </div>
      </header>
      <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 space-y-5 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`px-2 py-0.5 rounded-md border font-bold ${CARD_STATE_STYLE[state]}`}>{CARD_STATE_NAMES[state]}</span>
          {state === 'BLOCKED' && late && <span className={`px-2 py-0.5 rounded-md border font-bold ${CARD_STATE_STYLE.LATE}`}>{CARD_STATE_NAMES.LATE}</span>}
          {card.priority === 'URGENT' && <span className="px-2 py-0.5 rounded-md bg-red-600 text-white font-bold">عاجل</span>}
          <span className="text-slate-600">أُنجز {progress.done} من {progress.total}</span>
          {card.dueAt && <span className="text-slate-600">التسليم: {when(card.dueAt)}</span>}
          {card.airAt && <span className="text-slate-600">البث: {when(card.airAt)}</span>}
          <span className="text-slate-600">صاحب القرار: {card.ownerName || '—'}</span>
          {card.target && onOpenTarget && card.target.kind !== 'bulletin' && (
            <button type="button" onClick={() => onOpenTarget(card)} className="inline-flex items-center gap-1 text-blue-700 hover:underline">
              <Link2 className="w-3 h-3" />
              {card.target.title}
            </button>
          )}
        </div>

        {progress.total > 0 && (
          <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden" role="progressbar" aria-label="تقدم التكليف" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
            <div className="h-full bg-emerald-500" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
          </div>
        )}

        {hold && open && (
          <p role="status" className="flex items-start gap-2 p-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 font-bold">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{hold}</span>
          </p>
        )}

        {latestDecision && open && (
          <p className="flex items-start gap-2 p-3 rounded-xl border border-blue-200 bg-blue-50 text-blue-900">
            <Gavel className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              <b>آخر قرار:</b> {latestDecision.text} <span className="text-2xs text-blue-700">— {latestDecision.byName} {when(latestDecision.at)}</span>
            </span>
          </p>
        )}

        {message && (
          <p ref={messageRef} role="status" className={`p-3 rounded-xl font-bold border ${message.ok ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200'}`}>{message.text}</p>
        )}

        {card.brief && (
          <section>
            <h2 className="font-bold text-slate-800 text-sm mb-1">المطلوب إنجازه</h2>
            <p className="text-slate-700 whitespace-pre-line leading-6">{card.brief}</p>
          </section>
        )}

        <section aria-label="توقيت تنفيذ التكليف" className="space-y-2 border-y border-slate-200 py-3">
          <h2 className="text-sm font-bold text-slate-900">توقيت تنفيذ التكليف</h2>
          <CardTimingValues card={card} now={now} />
          <p className="text-xs text-slate-700">العمل المسجل يجمع جلسات الفريق. الزمن منذ أول بدء يشمل التوقفات حتى اكتمال المهام. الانتظار المرصود يجمع الانتظار قبل البدء وفترات التعطل الموثقة، ويُحسب الوقت المتداخل مرة واحدة.</p>
        </section>

        <section>
          <h2 className="font-bold text-slate-800 text-sm mb-2">المهام والتسليم</h2>
          {card.steps.length === 0 && <p className="text-slate-500">لم تُضف مهام لهذا التكليف بعد.</p>}
          <ol className="space-y-2">
            {card.steps.map((step, index) => {
              const mine = step.assigneeId === actor.id;
              const may = open && (actor.canManage || (mine && actor.canWork));
              const stepLate = isStepOwnLate(card, step);
              const stepOpen = isStepOpen(step);
              const labor = stepLaborMinutes(step);
              const backTargets = sendBackTargets(card, step.id);
              // On a review step its holder sends work back; the owner or a supervisor may do it from the step the card waits on.
              const reviewing = REVIEW_STEP_TYPES.includes(step.type) && canSendBack(card, actor, mine ? step.id : undefined) && (mine || canDecide);
              const offerBack = open && stepOpen && backTargets.length > 0 && (reviewing || (canDecide && card.steps.find(isStepOpen)?.id === step.id));
              const panelHere = panel?.stepId === step.id ? panel.kind : null;
              // Filled buttons are for my own work; a supervisor acting on a colleague's step gets quieter ones.
              const start = mine ? 'bg-blue-600 text-white' : 'border border-blue-200 text-blue-700';
              const finishStyle = mine ? 'bg-emerald-700 text-white' : 'border border-emerald-300 text-emerald-800';
              return (
                <li key={step.id} className={`border rounded-2xl p-3 space-y-2 ${mine && open && step.status !== 'DONE' ? 'border-blue-300 bg-blue-50/40' : 'border-slate-200 bg-slate-50/60'}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="w-6 h-6 shrink-0 rounded-full bg-slate-100 text-slate-700 font-bold flex items-center justify-center tabular-nums">{index + 1}</span>
                    <h3 className="font-bold text-slate-900 text-sm">{stepTypeName(stepTypes, step.type)}</h3>
                    <span className={`px-2 py-0.5 rounded-md border font-bold ${STEP_STATUS_STYLE[step.status]}`}>{stepStatusName(step.status)}</span>
                    {step.returnedReason && stepOpen && <span className="px-2 py-0.5 rounded-md bg-violet-50 text-violet-800 border border-violet-200 font-bold">معادة للتعديل</span>}
                    {stepLate && <span className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200 font-bold">متأخرة</span>}
                    {mine && <span className="px-2 py-0.5 rounded-md bg-blue-600 text-white font-bold">مهمتي</span>}
                  </div>
                  {step.title && <p className="text-slate-700">{step.title}</p>}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-2xs text-slate-600">
                    <span>المكلف: {stepAssigneeLabel(step, stations, labelDepartment)}</span>
                    {step.assigneeId && step.stationId && <span>المحطة: {stationName(stations, step.stationId)}</span>}
                    {step.dueAt && <span>التسليم: {when(step.dueAt)}</span>}
                    <span>التعقيد: {complexityName(step.complexity)}</span>
                    {step.estimateMinutes ? <span>المقدر: {minutesLabel(step.estimateMinutes)}</span> : null}
                    {labor !== null && <span>العمل المسجل {labor === 0 ? '0 د' : minutesLabel(labor)}</span>}
                    {step.doneAt && <span>أنجزها {step.doneByName} — {when(step.doneAt)}</span>}
                  </div>
                  {!!step.timeLog?.length && <details className="border-y border-slate-200 text-xs text-slate-700">
                    <summary className="min-h-11 py-2.5 cursor-pointer font-semibold text-blue-700">جلسات العمل ({step.timeLog.length})</summary>
                    <ul className="divide-y divide-slate-200">
                      {step.timeLog.map(entry => <li key={entry.id} className="flex flex-wrap items-center gap-x-3 py-2">
                        <strong>{minutesLabel(entry.minutes)}</strong>
                        {entry.byName && <span>{entry.byName}</span>}
                        {entry.at && <time dateTime={entry.at}>{when(entry.at)}</time>}
                      </li>)}
                    </ul>
                  </details>}
                  {step.returnedReason && stepOpen && (
                    <p className="p-2 rounded-lg bg-violet-50 border border-violet-200 text-violet-900 font-bold">
                      أعادها {step.returnedByName || 'زميل'}: {step.returnedReason}
                    </p>
                  )}
                  {step.status === 'BLOCKED' && step.blockedReason && (
                    <p className="text-rose-700 font-bold">
                      سبب التعطل: {step.blockedReason}
                      {step.waitingOnName ? ` — بانتظار ${step.waitingOnName}` : ''}
                    </p>
                  )}
                  {step.note && <p className="p-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-700 whitespace-pre-line">ملاحظة التسليم: {step.note}</p>}
                  {step.checklist && step.checklist.length > 0 && (
                    <fieldset className="space-y-0.5">
                      <legend className="font-bold text-slate-700 mb-1">قائمة التحقق ({step.checklist.filter((c) => c.done).length}/{step.checklist.length})</legend>
                      {step.checklist.map((item, i) => (
                        <label key={i} className="flex items-center gap-2 min-h-11 text-slate-700">
                          <input
                            type="checkbox"
                            className="w-4 h-4"
                            checked={!!item.done}
                            disabled={!may || !stepOpen}
                            onChange={(e) => setStep(step, { checklist: step.checklist!.map((c, j) => (j === i ? { ...c, done: e.target.checked } : c)) }, e.target.checked ? `تم: ${item.text}` : `أُلغي التأشير: ${item.text}`)}
                          />
                          <span className={item.done ? 'line-through text-slate-500' : ''}>{item.text}</span>
                        </label>
                      ))}
                    </fieldset>
                  )}

                  {panelHere === 'done' && (
                    <div className="space-y-2 p-3 rounded-xl border border-emerald-200 bg-emerald-50/60">
                      <div>
                        <label htmlFor={`done-note-${step.id}`} className={LABEL}>ملاحظة التسليم: ما اكتمل وما ينقص؟</label>
                        <textarea id={`done-note-${step.id}`} rows={3} maxLength={3000} value={doneNote} onChange={(e) => setDoneNote(e.target.value)} placeholder="مثال: رُفعت الشهادة (4 دقائق) مع صور الموقع. ينقص تأكيد اسم الشاهد." className={INPUT} />
                      </div>
                      <div className="max-w-64">
                        <label htmlFor={`done-min-${step.id}`} className={LABEL}>وقت هذه الجلسة (دقيقة)</label>
                        <input id={`done-min-${step.id}`} type="number" min={0} max={1440} inputMode="numeric" value={doneMinutes} onChange={(e) => setDoneMinutes(e.target.value)} aria-describedby={`done-min-hint-${step.id}`} className={INPUT} />
                        <p id={`done-min-hint-${step.id}`} className="text-2xs text-slate-600 mt-1">
                          {step.spentMinutes ? `المسجّل حتى الآن ${minutesLabel(step.spentMinutes)}؛ يُضاف إليه ما تكتبه.` : 'يُجمع وقت كل جلسة عمل على هذه المهمة.'}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => finish(step)} className={`${BTN} bg-emerald-700 text-white`}>
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          تأكيد الإنجاز والتسليم
                        </button>
                        {cancelButton}
                      </div>
                    </div>
                  )}

                  {panelHere === 'block' && (
                    <div className="space-y-2 p-3 rounded-xl border border-rose-200 bg-rose-50/60">
                      {reasonField(`block-reason-${step.id}`, 'ما سبب التعطل وما المطلوب لحله؟', 'مثال: اللقطات الأصلية لم تصل من المراسل.')}
                      <div>
                        <label htmlFor={`block-who-${step.id}`} className={LABEL}>من يستطيع حلها؟</label>
                        <select id={`block-who-${step.id}`} value={waitingOn} onChange={(e) => setWaitingOn(e.target.value)} className={INPUT}>
                          <option value="">صاحب القرار وحده</option>
                          {people.filter((p) => p.id !== actor.id).map((p) => (
                            <option key={p.id} value={p.id}>{p.name} — {stationName(stations, p.stationId)}</option>
                          ))}
                        </select>
                        <p className="text-2xs text-slate-600 mt-1">يصل التنبيه إلى {card.ownerName || 'صاحب القرار'} وإلى من تختاره ومديري المحطة.</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" disabled={!reason.trim()} onClick={() => block(step)} className={`${BTN} bg-rose-700 text-white disabled:opacity-50`}>تسجيل التعطل</button>
                        {cancelButton}
                      </div>
                    </div>
                  )}

                  {panelHere === 'back' && (
                    <div className="space-y-2 p-3 rounded-xl border border-violet-200 bg-violet-50/60">
                      <div>
                        <label htmlFor={`back-to-${step.id}`} className={LABEL}>إلى أي خطوة؟</label>
                        <select id={`back-to-${step.id}`} value={backTo} onChange={(e) => setBackTo(e.target.value)} className={INPUT}>
                          {backTargets.map((s) => (
                            <option key={s.id} value={s.id}>{stepTypeName(stepTypes, s.type)} — {stepAssigneeLabel(s, stations, labelDepartment)}</option>
                          ))}
                        </select>
                      </div>
                      {reasonField(`back-reason-${step.id}`, 'سبب الإعادة وما المطلوب تعديله', 'مثال: اسم الشاهد الثاني غير مثبت؛ أضفه وأعد التسليم.')}
                      <p className="text-2xs text-slate-600">تعود الخطوة إلى «قيد التنفيذ» ويبقى سجلها، وتنتظر الخطوات المكتملة بعدها من جديد. يصل السبب إلى صاحبها وإلى صاحب القرار.</p>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" disabled={!reason.trim() || !backTo} onClick={() => sendBack(step)} className={`${BTN} bg-violet-700 text-white disabled:opacity-50`}>
                          <Undo2 className="w-3.5 h-3.5" />
                          إعادة مع السبب
                        </button>
                        {cancelButton}
                      </div>
                    </div>
                  )}

                  {panelHere === 'reassign' && (
                    <div className="space-y-2 p-3 rounded-xl border border-blue-200 bg-blue-50/60">
                      <div>
                        <label htmlFor={`reassign-${step.id}`} className={LABEL}>إسناد «{stepTypeName(stepTypes, step.type)}» إلى</label>
                        <select id={`reassign-${step.id}`} value={reassignTo} onChange={(e) => setReassignTo(e.target.value)} className={INPUT}>
                          <option value="">اختر زميلاً…</option>
                          {people.filter(p => p.id !== step.assigneeId && eligiblePeople.has(p.id)).map((p) => (
                            <option key={p.id} value={p.id}>{personLabel(p)}</option>
                          ))}
                          {actor.canManage && (
                            <optgroup label="أو اتركها لمحطة">
                              {stations.filter((s) => stationScope(stations, actor).has(s.id)).map((s) => (
                                <option key={s.id} value={`s:${s.id}`}>متاحة لمحطة {s.name}</option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                        {step.assigneeName && <p className="text-2xs text-slate-600 mt-1">يصل تنبيه إلى {step.assigneeName} بأنها سُحبت منه، وإلى المكلف الجديد.</p>}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" disabled={!reassignTo} onClick={() => reassign(step)} className={`${BTN} bg-blue-600 text-white disabled:opacity-50`}>
                          <Users className="w-3.5 h-3.5" />
                          تأكيد الإسناد
                        </button>
                        {cancelButton}
                      </div>
                    </div>
                  )}

                  {!panelHere && (
                    <div className="flex flex-wrap gap-2">
                      {open && canClaimStep(step, actor) && stepOpen && (
                        <button type="button" onClick={() => setStep(step, { assigneeId: actor.id, status: step.status === 'TODO' ? 'IN_PROGRESS' : step.status }, 'استلمت المهمة')} className={`${BTN} bg-blue-600 text-white`}>
                          <UserPlus className="w-3.5 h-3.5" />
                          استلام المهمة
                        </button>
                      )}
                      {may && step.status === 'TODO' && (
                        <button type="button" onClick={() => setStep(step, { status: 'IN_PROGRESS' }, 'بدأ العمل على المهمة')} className={`${BTN} ${start}`}>
                          <Play className="w-3.5 h-3.5" />
                          بدء العمل
                        </button>
                      )}
                      {may && (step.status === 'TODO' || step.status === 'IN_PROGRESS' || step.status === 'BLOCKED') && (
                        <button type="button" onClick={() => openPanel(step, 'done')} className={`${BTN} ${finishStyle}`}>
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          تم الإنجاز
                        </button>
                      )}
                      {offerBack && (
                        <button type="button" onClick={() => openPanel(step, 'back')} className={`${BTN} border border-violet-300 text-violet-800`}>
                          <Undo2 className="w-3.5 h-3.5" />
                          إعادة إلى خطوة سابقة
                        </button>
                      )}
                      {may && (step.status === 'TODO' || step.status === 'IN_PROGRESS') && (
                        <button type="button" onClick={() => openPanel(step, 'block')} className={`${BTN} border border-rose-200 text-rose-700`}>متعطلة</button>
                      )}
                      {may && step.status === 'BLOCKED' && (
                        <button type="button" onClick={() => setStep(step, { status: 'IN_PROGRESS', blockedReason: undefined, waitingOnId: undefined }, 'استؤنف العمل')} className={`${BTN} border border-slate-200 text-slate-700`}>استئناف العمل</button>
                      )}
                      {may && step.status === 'DONE' && (
                        <button type="button" onClick={() => setStep(step, { status: 'IN_PROGRESS' }, 'أُعيد فتح المهمة')} className={`${BTN} border border-slate-200 text-slate-700`}>إعادة فتح</button>
                      )}
                      {canReassign && stepOpen && (
                        <button type="button" onClick={() => openPanel(step, 'reassign')} className={`${BTN} border border-slate-200 text-slate-700`}>
                          <Users className="w-3.5 h-3.5" />
                          إعادة الإسناد
                        </button>
                      )}
                      {open && actor.canManage && stepOpen && (
                        <button type="button" onClick={() => setStep(step, { status: 'SKIPPED', blockedReason: undefined }, 'عُدّت المهمة غير مطلوبة')} className={`${BTN} border border-slate-200 text-slate-600`}>غير مطلوبة</button>
                      )}
                      {open && actor.canManage && step.status === 'SKIPPED' && (
                        <button type="button" onClick={() => setStep(step, { status: 'TODO' }, 'أُعيدت المهمة')} className={`${BTN} border border-slate-200 text-slate-600`}>إعادتها للمطلوب</button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </section>

        <section className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-bold text-slate-800 text-sm">النص</h2>
            {card.scriptApproved ? (
              <span className="px-2 py-0.5 rounded-md border bg-emerald-50 text-emerald-700 border-emerald-200 font-bold">معتمد — {card.scriptApprovedByName} {when(card.scriptApprovedAt)}</span>
            ) : (
              <span className="px-2 py-0.5 rounded-md border bg-white text-slate-600 border-slate-300 font-bold">غير معتمد بعد</span>
            )}
          </div>
          {canEditScript ? (
            <>
              <label htmlFor="card-script" className="sr-only">نص المادة</label>
              <textarea id="card-script" rows={8} maxLength={60000} value={script} onChange={(e) => setScript(e.target.value)} placeholder="اكتب النص هنا. الاعتماد النهائي يبقى بيد المحرر المسؤول." className={`${INPUT} leading-7 text-sm`} />
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={script === (card.script || '')} onClick={saveScript} className={`${BTN} bg-blue-600 text-white disabled:opacity-50`}>حفظ النص</button>
                {actor.canManage && !card.scriptApproved && (
                  <button type="button" disabled={!script.trim()} onClick={() => act(() => apiService.updateCard(card.id, (c) => ({ ...c, script, scriptApproved: true })), 'اعتُمد النص')} className={`${BTN} bg-emerald-700 text-white disabled:opacity-50`}>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    اعتماد النص
                  </button>
                )}
                <button type="button" onClick={() => setBriefReviewOpen(true)} className={`${BTN} border border-slate-200 text-slate-700`}>
                  <Sparkles className="w-3.5 h-3.5" />
                  اقتراح مسودة موجز
                </button>
                {actor.canManage && card.scriptApproved && (
                  <button type="button" onClick={() => act(() => apiService.updateCard(card.id, (c) => ({ ...c, scriptApproved: false })), 'سُحب اعتماد النص')} className={`${BTN} border border-slate-200 text-slate-700`}>سحب الاعتماد</button>
                )}
              </div>
              {gaps.length > 0 && (
                <div className="p-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-900">
                  <p className="font-bold mb-1">ينقص للتحقق قبل البث:</p>
                  <ul className="list-disc pr-5 space-y-0.5">
                    {gaps.map((gap, index) => (
                      <li key={index}>{gap}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : card.script ? (
            <p className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-800 whitespace-pre-line leading-7 text-sm">{card.script}</p>
          ) : (
            <p className="text-slate-500">لم يُكتب النص بعد.</p>
          )}
        </section>

        <section className="space-y-2" aria-labelledby="card-material">
          <h2 id="card-material" className="font-bold text-slate-800 text-sm">المواد والروابط</h2>
          {attached.length === 0 && !(card.links || []).length && <p className="text-slate-500">لا مواد مرفقة بعد.{canEditMaterial ? ' أرفق ملفاً من المكتبة أو أضف رابطاً للقطات والمقابلات.' : ''}</p>}
          {attached.length > 0 && (
            <ul className="space-y-1.5">
              {attached.map(({ id, item }) => (
                <li key={id} className="flex flex-wrap items-center gap-2 p-2 rounded-lg border border-slate-200 bg-white">
                  <FileText className="w-4 h-4 text-slate-500 shrink-0" />
                  <bdi className="font-bold text-slate-800 min-w-0 break-all">{item ? item.title || item.originalName || item.fileName : 'ملف لم يعد في المكتبة'}</bdi>
                  {item && <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700">{MEDIA_TYPE_NAMES[item.mediaType] || 'ملف'}</span>}
                  {item && (item.fileUrl || item.url) && (
                    <a href={item.fileUrl || item.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 min-h-11 px-2 text-blue-700 hover:underline">
                      <ExternalLink className="w-3.5 h-3.5" />
                      فتح الملف
                    </a>
                  )}
                  {item && (
                    <button type="button" onClick={() => navigateTo.emit(`/media/${encodeURIComponent(id)}`)} className="inline-flex items-center gap-1 min-h-11 px-2 text-blue-700 hover:underline">
                      في المكتبة
                    </button>
                  )}
                  {canEditMaterial && (
                    <button type="button" aria-label="إزالة الملف من التكليف" onClick={() => act(() => apiService.updateCard(card.id, (c) => ({ ...c, mediaIds: (c.mediaIds || []).filter((m) => m !== id) })), 'أُزيل الملف من التكليف')} className="mr-auto inline-flex items-center justify-center w-11 h-11 rounded-lg text-slate-500 hover:bg-slate-100">
                      <X className="w-4 h-4" />
                    </button>
                  )}
                  {!!item?.editRanges?.length && <div className="basis-full ps-6"><MediaEditRanges ranges={item.editRanges} /></div>}
                </li>
              ))}
            </ul>
          )}
          {(card.links || []).length > 0 && (
            <ul className="space-y-1">
              {(card.links || []).map((link, index) => (
                <li key={`${link.url}-${index}`} className="flex items-center gap-2">
                  <a href={link.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 min-h-11 text-blue-700 hover:underline break-all">
                    <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                    {link.label || link.url}
                  </a>
                  {canEditMaterial && (
                    <button type="button" aria-label={`إزالة الرابط ${link.label || ''}`} onClick={() => act(() => apiService.updateCard(card.id, (c) => ({ ...c, links: (c.links || []).filter((_, i) => i !== index) })), 'أُزيل الرابط')} className="inline-flex items-center justify-center w-11 h-11 rounded-lg text-slate-500 hover:bg-slate-100">
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canEditMaterial && (
            <div className="grid gap-3 md:grid-cols-2">
              <form onSubmit={addLink} className="space-y-2 p-3 rounded-xl border border-slate-200 bg-slate-50/60">
                <p className="font-bold text-slate-700 flex items-center gap-1.5"><Link2 className="w-3.5 h-3.5" />إضافة رابط</p>
                <label htmlFor="card-link-label" className="sr-only">عنوان الرابط</label>
                <input id="card-link-label" maxLength={160} value={linkLabel} onChange={(e) => setLinkLabel(e.target.value)} placeholder="مثال: لقطات الشهادات الخام" className={INPUT} />
                <label htmlFor="card-link-url" className="sr-only">الرابط</label>
                <input id="card-link-url" type="url" dir="ltr" maxLength={2000} value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://" className={INPUT} />
                <button type="submit" disabled={!linkUrl.trim()} className={`${BTN} bg-blue-600 text-white disabled:opacity-50`}>إضافة الرابط</button>
              </form>
              <div className="space-y-2 p-3 rounded-xl border border-slate-200 bg-slate-50/60">
                <p className="font-bold text-slate-700 flex items-center gap-1.5"><Paperclip className="w-3.5 h-3.5" />إرفاق من مكتبة الوسائط</p>
                <label htmlFor="card-media-search" className="sr-only">بحث في المكتبة</label>
                <input id="card-media-search" type="search" value={mediaQuery} onChange={(e) => setMediaQuery(e.target.value)} placeholder="ابحث بالعنوان أو الوسم…" className={INPUT} />
                <label htmlFor="card-media-pick" className="sr-only">الملف</label>
                <select id="card-media-pick" value={mediaPick} onChange={(e) => setMediaPick(e.target.value)} className={INPUT}>
                  <option value="">{mediaMatches.length ? 'اختر ملفاً…' : 'لا ملفات مطابقة'}</option>
                  {mediaMatches.map((m) => (
                    <option key={m.id} value={m.id}>{m.title || m.originalName || m.fileName} — {MEDIA_TYPE_NAMES[m.mediaType] || 'ملف'}</option>
                  ))}
                </select>
                <button type="button" disabled={!mediaPick} onClick={attachMedia} className={`${BTN} bg-blue-600 text-white disabled:opacity-50`}>إرفاق بالتكليف</button>
              </div>
            </div>
          )}
        </section>

        {contributions.length > 0 && (
          <section>
            <h2 className="font-bold text-slate-800 text-sm mb-1">إسهام المحطات</h2>
            <p className="text-2xs text-slate-500 mb-2">تُحتسب المادة مرة واحدة في إجمالي الإنتاج، ويُسجَّل لكل محطة ما أنجزته فيها.</p>
            <div className="flex flex-wrap gap-2">
              {contributions.map((part) => (
                <span key={part.stationId || 'none'} className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-slate-700">
                  <b>{stationName(stations, part.stationId)}</b>: أُنجز {part.done} من {part.steps}{part.points ? ` — ${countLabel(part.points, AR.point)}` : ''}
                </span>
              ))}
            </div>
          </section>
        )}

        <section className="space-y-2">
          <h2 className="font-bold text-slate-800 text-sm">سجل العمل</h2>
          {actor.canWork && open && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!note.trim()) return;
                const text = note;
                if (act(() => apiService.addCardNote(card.id, text, undefined, decision && canDecide), decision && canDecide ? 'سُجّل القرار ووصل إلى كل من في التكليف' : 'وُثّقت الملاحظة ووصلت إلى صاحب القرار وصاحب المهمة الحالية')) {
                  setNote('');
                  setDecision(false);
                }
              }}
              className="space-y-2"
            >
              <div className="flex flex-col sm:flex-row gap-2">
                <label htmlFor="card-note" className="sr-only">توثيق ما أنجزته</label>
                <input id="card-note" maxLength={3000} value={note} onChange={(e) => setNote(e.target.value)} placeholder={decision ? 'اكتب القرار: سحب من البث، تمديد الموعد، تخطي مهمة…' : 'وثّق ما أنجزته أو ما يحتاجه الزميل التالي…'} className={INPUT} />
                <button type="submit" disabled={!note.trim()} className={`${BTN} bg-blue-600 text-white disabled:opacity-50 shrink-0 justify-center`}>
                  {decision ? <Gavel className="w-3.5 h-3.5" /> : <Send className="w-3.5 h-3.5" />}
                  {decision ? 'تسجيل القرار' : 'توثيق'}
                </button>
              </div>
              {canDecide && (
                <label className="inline-flex items-center gap-2 min-h-11 text-slate-700 cursor-pointer">
                  <input type="checkbox" checked={decision} onChange={(e) => setDecision(e.target.checked)} className="w-4 h-4" />
                  قرار يصل إلى كل من في التكليف
                </label>
              )}
            </form>
          )}
          {(card.log || []).length === 0 && <p className="text-slate-500">لا شيء موثّق بعد.</p>}
          <ol className="space-y-1.5">
            {[...(card.log || [])].reverse().map((entry) => (
              <li key={entry.id} className={`p-2 rounded-lg border ${entry.decision ? 'bg-blue-50 border-blue-200' : entry.kind === 'NOTE' ? 'bg-white border-slate-200' : 'bg-slate-50 border-slate-100'}`}>
                <p className="text-slate-800 whitespace-pre-line">
                  {entry.decision && <span className="px-1.5 py-0.5 ml-1 rounded-md bg-blue-600 text-white font-bold text-2xs">قرار</span>}
                  {entry.text}
                </p>
                <p className="text-2xs text-slate-500 mt-0.5">
                  {entry.byName}
                  {entry.stationId ? ` — ${stationName(stations, entry.stationId)}` : ''} • {when(entry.at)}
                </p>
              </li>
            ))}
          </ol>
        </section>

        {actor.canManage && (
          <div className="flex flex-wrap gap-2 pt-3 border-t border-slate-100">
            {open && (
              <button type="button" onClick={() => onEdit(card)} className={`${BTN} border border-slate-200 text-slate-700`}>
                <Pencil className="w-3.5 h-3.5" />
                تعديل التكليف والمهام
              </button>
            )}
            {onSaveAsTemplate && (
              <button type="button" onClick={() => onSaveAsTemplate(card)} className={`${BTN} border border-slate-200 text-slate-700`}>
                <LayoutTemplate className="w-3.5 h-3.5" />
                حفظ كقالب
              </button>
            )}
            {open && governs && (
              <button
                type="button"
                onClick={async () => {
                  if (state !== 'READY' && !(await confirmDialog({ title: 'إغلاق تكليف لم يكتمل', message: 'ما زالت في التكليف مهام لم تُنجز. إغلاقه يخرجه من أعباء الفريق ولا يحتسبها إنتاجاً مكتملاً.', confirmLabel: 'إغلاق على أي حال', cancelLabel: 'تراجع' }))) return;
                  act(() => apiService.updateCard(card.id, (c) => ({ ...c, status: 'CLOSED' })), 'أُغلق التكليف وأُرشف');
                }}
                // Closing is the obvious next step only once everything is done.
                className={`${BTN} ${state === 'READY' ? 'bg-emerald-700 text-white' : 'border border-slate-200 text-slate-700'}`}
              >
                إغلاق بعد البث
              </button>
            )}
            {open && governs && (
              <button
                type="button"
                onClick={async () => (await confirmDialog({ title: 'إلغاء التكليف', message: 'تتوقف المهام المفتوحة ولا يُحتسب التكليف في الإنتاج.', confirmLabel: 'إلغاء التكليف', cancelLabel: 'تراجع', danger: true })) && act(() => apiService.updateCard(card.id, (c) => ({ ...c, status: 'CANCELLED' })), 'أُلغي التكليف')}
                className={`${BTN} border border-slate-200 text-slate-700`}
              >
                إلغاء التكليف
              </button>
            )}
            {!open && governs && (
              <button type="button" onClick={() => act(() => apiService.updateCard(card.id, (c) => ({ ...c, status: 'OPEN' })), 'أُعيد فتح التكليف')} className={`${BTN} border border-slate-200 text-slate-700`}>إعادة فتح التكليف</button>
            )}
            {governs ? (
              <button
                type="button"
                onClick={async () => {
                  if (!(await confirmDialog({ title: 'حذف التكليف', message: `حذف «${card.title}» مع مهامها وسجلها؟`, confirmLabel: 'حذف', cancelLabel: 'تراجع', danger: true }))) return;
                  try {
                    apiService.deleteCard(card.id);
                    onClose();
                  } catch (err: any) {
                    setMessage({ ok: false, text: err?.message || 'تعذر الحذف' });
                  }
                }}
                className={`${BTN} border border-rose-200 text-rose-700 mr-auto`}
              >
                حذف
              </button>
            ) : (
              <p className="text-2xs text-slate-500 self-center">الإغلاق والإلغاء والحذف لمحطة {stationName(stations, card.ownerStationId)} أو المحطة الرئيسية.</p>
            )}
          </div>
        )}
      </div>
    </article>
  );
};
import { MediaEditRanges } from '../media/MediaEditorialPanel';
