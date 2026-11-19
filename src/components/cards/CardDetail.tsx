import React, { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, ExternalLink, Link2, Pencil, Play, Send, Sparkles, UserPlus } from 'lucide-react';
import { apiService } from '../../services/api';
import { apiFetch } from '../../services/http';
import { confirmDialog, promptDialog } from '../../services/dialogs';
import {
  CARD_STATE_NAMES,
  canClaimStep,
  cardContributions,
  cardHoldReason,
  cardKindName,
  cardProgress,
  cardState,
  complexityName,
  isStepLate,
  stepStatusName,
  stepTypeName,
  stepTypesOf,
  type CardStep,
  type ProductionCard,
} from '../../shared/productionCards';
import { stationName, stationsOf } from '../../shared/stations';
import { minutesLabel } from '../../shared/workload';
import { CARD_STATE_STYLE, INPUT, LABEL, STEP_STATUS_STYLE, when } from './cardUi';

interface CardDetailProps {
  card: ProductionCard;
  /** Back to the list of cards. */
  onClose: () => void;
  onEdit: (card: ProductionCard) => void;
  onOpenTarget?: (card: ProductionCard) => void;
}

const BTN = 'inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold';

/** One production card: its steps and handoffs, the script, the links and the documented trail. */
export const CardDetail: React.FC<CardDetailProps> = ({ card, onClose, onEdit, onOpenTarget }) => {
  const settings = apiService.getSettings();
  const stations = stationsOf(settings);
  const stepTypes = stepTypesOf(settings);
  const actor = apiService.cardActor();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [doneFor, setDoneFor] = useState<string | null>(null);
  const [doneNote, setDoneNote] = useState('');
  const [doneMinutes, setDoneMinutes] = useState('');
  const [script, setScript] = useState('');
  const [note, setNote] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [gaps, setGaps] = useState<string[]>([]);

  useEffect(() => {
    setDoneFor(null);
    setMessage(null);
    setNote('');
    setGaps([]);
  }, [card.id]);
  // The editable copy follows the stored script (a colleague may have saved a newer one).
  useEffect(() => setScript(card.script || ''), [card.id, card.script]);

  const open = card.status === 'OPEN';
  const state = cardState(card);
  const progress = cardProgress(card);
  const hold = cardHoldReason(card, stepTypes);
  const worksOnCard = card.steps.some((s) => s.assigneeId === actor.id);
  const canEditScript = open && (actor.canManage || (actor.canWork && worksOnCard));
  const contributions = cardContributions(card, stepTypes);

  const act = (fn: () => void, ok: string) => {
    try {
      fn();
      setMessage({ ok: true, text: ok });
    } catch (err: any) {
      setMessage({ ok: false, text: err?.message || 'تعذر تنفيذ الإجراء' });
    }
  };
  const setStep = (step: CardStep, changes: Partial<CardStep>, ok: string) => act(() => apiService.updateCardStep(card.id, step.id, changes), ok);

  const finish = (step: CardStep) => {
    const minutes = doneMinutes === '' ? undefined : Math.max(0, Math.round(Number(doneMinutes)));
    setStep(step, { status: 'DONE', note: doneNote.trim() || undefined, spentMinutes: minutes }, 'سُجّل الإنجاز ووصل التنبيه لصاحب المهمة التالية');
    setDoneFor(null);
  };

  /** Asks the server's assistant for a brief from what the card documents; nothing is saved until a person saves it. */
  const suggestBrief = async () => {
    setDrafting(true);
    setGaps([]);
    try {
      const material = [script, ...card.steps.map((s) => s.note || ''), ...(card.log || []).filter((e) => e.kind === 'NOTE').map((e) => e.text)].filter(Boolean).join('\n');
      const res = await apiFetch<{ data: { brief: string; gaps: string[] } }>('/api/v1/ai/copilot', { method: 'POST', json: { mode: 'BRIEF', title: card.title, summary: card.brief || '', content: material } });
      if (!res.data.brief.trim()) throw new Error('لم يُرجع المساعد نصاً؛ أضف معلومات أكثر إلى البطاقة');
      setScript(res.data.brief);
      setGaps(res.data.gaps || []);
      setMessage({ ok: true, text: 'مسودة مقترحة في خانة النص: راجعها وعدّلها ثم احفظها. الاعتماد يبقى للمحرر المسؤول.' });
    } catch (err: any) {
      setMessage({ ok: false, text: err?.message || 'تعذر اقتراح المسودة' });
    } finally {
      setDrafting(false);
    }
  };

  const block = async (step: CardStep) => {
    const reason = await promptDialog({ title: 'المهمة متعطلة', label: 'ما سبب التعطل وما المطلوب لحله؟', required: true, multiline: true });
    if (reason?.trim()) setStep(step, { status: 'BLOCKED', blockedReason: reason.trim() }, `سُجّل التعطل ووصل التنبيه إلى ${card.ownerName || 'صاحب القرار'}`);
  };

  return (
    <article className="max-w-5xl mx-auto space-y-4">
      <header className="flex items-start gap-3">
        <button type="button" onClick={onClose} className="shrink-0 inline-flex items-center gap-1.5 min-h-11 px-3 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-700 hover:bg-slate-50">
          <ArrowRight className="w-4 h-4" />
          البطاقات
        </button>
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-slate-900 leading-8">{card.title}</h1>
          <p className="text-xs text-slate-500">بطاقة إنتاج — {cardKindName(card.kind)}</p>
        </div>
      </header>
      <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 space-y-5 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`px-2 py-0.5 rounded-md border font-bold ${CARD_STATE_STYLE[state]}`}>{CARD_STATE_NAMES[state]}</span>
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
          <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden" role="progressbar" aria-label="تقدم البطاقة" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
            <div className="h-full bg-emerald-500" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
          </div>
        )}

        {hold && open && (
          <p role="status" className="flex items-start gap-2 p-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 font-bold">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{hold}</span>
          </p>
        )}

        {message && (
          <p role="status" className={`p-3 rounded-xl font-bold border ${message.ok ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200'}`}>{message.text}</p>
        )}

        {card.brief && (
          <section>
            <h2 className="font-bold text-slate-800 text-sm mb-1">المطلوب إنجازه</h2>
            <p className="text-slate-700 whitespace-pre-line leading-6">{card.brief}</p>
          </section>
        )}

        <section>
          <h2 className="font-bold text-slate-800 text-sm mb-2">المهام والتسليم</h2>
          {card.steps.length === 0 && <p className="text-slate-500">لم تُضف مهام لهذه البطاقة بعد.</p>}
          <ol className="space-y-2">
            {card.steps.map((step, index) => {
              const mine = step.assigneeId === actor.id;
              const may = open && (actor.canManage || (mine && actor.canWork));
              const late = isStepLate(step);
              // Filled buttons are for my own work; a supervisor acting on a colleague's step gets quieter ones.
              const start = mine ? 'bg-blue-600 text-white' : 'border border-blue-200 text-blue-700';
              const finishStyle = mine ? 'bg-emerald-700 text-white' : 'border border-emerald-300 text-emerald-800';
              return (
                <li key={step.id} className={`border rounded-2xl p-3 space-y-2 ${mine && open && step.status !== 'DONE' ? 'border-blue-300 bg-blue-50/40' : 'border-slate-200 bg-slate-50/60'}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="w-6 h-6 shrink-0 rounded-full bg-slate-100 text-slate-700 font-bold flex items-center justify-center tabular-nums">{index + 1}</span>
                    <h3 className="font-bold text-slate-900 text-sm">{stepTypeName(stepTypes, step.type)}</h3>
                    <span className={`px-2 py-0.5 rounded-md border font-bold ${STEP_STATUS_STYLE[step.status]}`}>{stepStatusName(step.status)}</span>
                    {late && <span className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200 font-bold">متأخرة</span>}
                    {mine && <span className="px-2 py-0.5 rounded-md bg-blue-600 text-white font-bold">مهمتي</span>}
                  </div>
                  {step.title && <p className="text-slate-700">{step.title}</p>}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-600">
                    <span>المكلف: {step.assigneeName || (step.stationId ? `أي زميل في ${stationName(stations, step.stationId)}` : 'لم تُسند بعد')}</span>
                    {step.stationId && <span>المحطة: {stationName(stations, step.stationId)}</span>}
                    {step.dueAt && <span>التسليم: {when(step.dueAt)}</span>}
                    <span>التعقيد: {complexityName(step.complexity)}</span>
                    {step.estimateMinutes ? <span>المقدر: {minutesLabel(step.estimateMinutes)}</span> : null}
                    {step.spentMinutes ? <span>الفعلي: {minutesLabel(step.spentMinutes)}</span> : null}
                    {step.doneAt && <span>أنجزها {step.doneByName} — {when(step.doneAt)}</span>}
                  </div>
                  {step.status === 'BLOCKED' && step.blockedReason && <p className="text-rose-700 font-bold">سبب التعطل: {step.blockedReason}</p>}
                  {step.note && <p className="p-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-700 whitespace-pre-line">ملاحظة التسليم: {step.note}</p>}

                  {doneFor === step.id ? (
                    <div className="space-y-2 p-3 rounded-xl border border-emerald-200 bg-emerald-50/60">
                      <div>
                        <label htmlFor={`done-note-${step.id}`} className={LABEL}>ملاحظة التسليم: ما اكتمل وما ينقص؟</label>
                        <textarea id={`done-note-${step.id}`} rows={3} maxLength={3000} value={doneNote} onChange={(e) => setDoneNote(e.target.value)} placeholder="مثال: رُفعت الشهادة (4 دقائق) مع صور الموقع. ينقص تأكيد اسم الشاهد." className={INPUT} />
                      </div>
                      <div className="max-w-48">
                        <label htmlFor={`done-min-${step.id}`} className={LABEL}>الوقت الفعلي (دقيقة)</label>
                        <input id={`done-min-${step.id}`} type="number" min={0} max={100000} inputMode="numeric" value={doneMinutes} onChange={(e) => setDoneMinutes(e.target.value)} className={INPUT} />
                      </div>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => finish(step)} className={`${BTN} bg-emerald-700 text-white`}>
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          تأكيد الإنجاز والتسليم
                        </button>
                        <button type="button" onClick={() => setDoneFor(null)} className={`${BTN} border border-slate-200 text-slate-600`}>تراجع</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {open && canClaimStep(step, actor) && step.status !== 'DONE' && step.status !== 'SKIPPED' && (
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
                        <button
                          type="button"
                          onClick={() => {
                            setDoneNote(step.note || '');
                            setDoneMinutes(step.spentMinutes ? String(step.spentMinutes) : '');
                            setDoneFor(step.id);
                          }}
                          className={`${BTN} ${finishStyle}`}
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          تم الإنجاز
                        </button>
                      )}
                      {may && (step.status === 'TODO' || step.status === 'IN_PROGRESS') && (
                        <button type="button" onClick={() => block(step)} className={`${BTN} border border-rose-200 text-rose-700`}>متعطلة</button>
                      )}
                      {may && step.status === 'BLOCKED' && (
                        <button type="button" onClick={() => setStep(step, { status: 'IN_PROGRESS', blockedReason: undefined }, 'استؤنف العمل')} className={`${BTN} border border-slate-200 text-slate-700`}>استئناف العمل</button>
                      )}
                      {may && step.status === 'DONE' && (
                        <button type="button" onClick={() => setStep(step, { status: 'IN_PROGRESS' }, 'أُعيد فتح المهمة')} className={`${BTN} border border-slate-200 text-slate-700`}>إعادة فتح</button>
                      )}
                      {open && actor.canManage && step.status !== 'DONE' && step.status !== 'SKIPPED' && (
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
                <button type="button" disabled={script === (card.script || '')} onClick={() => act(() => apiService.updateCard(card.id, (c) => ({ ...c, script })), card.scriptApproved && !actor.canManage ? 'حُفظ النص؛ يحتاج اعتماداً جديداً' : 'حُفظ النص')} className={`${BTN} bg-blue-600 text-white disabled:opacity-50`}>حفظ النص</button>
                {actor.canManage && !card.scriptApproved && (
                  <button type="button" disabled={!script.trim()} onClick={() => act(() => apiService.updateCard(card.id, (c) => ({ ...c, script, scriptApproved: true })), 'اعتُمد النص')} className={`${BTN} bg-emerald-700 text-white disabled:opacity-50`}>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    اعتماد النص
                  </button>
                )}
                <button type="button" disabled={drafting} onClick={suggestBrief} className={`${BTN} border border-slate-200 text-slate-700 disabled:opacity-50`}>
                  <Sparkles className="w-3.5 h-3.5" />
                  {drafting ? 'جارٍ إعداد المسودة…' : 'اقتراح مسودة موجز'}
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

        {card.links && card.links.length > 0 && (
          <section>
            <h2 className="font-bold text-slate-800 text-sm mb-1">روابط الصور والمقابلات</h2>
            <ul className="space-y-1">
              {card.links.map((link, index) => (
                <li key={index}>
                  <a href={link.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-blue-700 hover:underline">
                    <ExternalLink className="w-3.5 h-3.5" />
                    {link.label || link.url}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        {contributions.length > 0 && (
          <section>
            <h2 className="font-bold text-slate-800 text-sm mb-1">إسهام المحطات</h2>
            <p className="text-[11px] text-slate-500 mb-2">تُحتسب المادة مرة واحدة في إجمالي الإنتاج، ويُسجَّل لكل محطة ما أنجزته فيها.</p>
            <div className="flex flex-wrap gap-2">
              {contributions.map((part) => (
                <span key={part.stationId || 'none'} className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-slate-700">
                  <b>{stationName(stations, part.stationId)}</b>: {part.done} من {part.steps} مهمة{part.points ? ` — ${part.points} نقطة` : ''}
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
                act(() => apiService.addCardNote(card.id, note), 'وُثّقت الملاحظة');
                setNote('');
              }}
              className="flex flex-col sm:flex-row gap-2"
            >
              <label htmlFor="card-note" className="sr-only">توثيق ما أنجزته</label>
              <input id="card-note" maxLength={3000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="وثّق ما أنجزته أو ما يحتاجه الزميل التالي…" className={INPUT} />
              <button type="submit" disabled={!note.trim()} className={`${BTN} bg-blue-600 text-white disabled:opacity-50 shrink-0 justify-center`}>
                <Send className="w-3.5 h-3.5" />
                توثيق
              </button>
            </form>
          )}
          {(card.log || []).length === 0 && <p className="text-slate-500">لا شيء موثّق بعد.</p>}
          <ol className="space-y-1.5">
            {[...(card.log || [])].reverse().map((entry) => (
              <li key={entry.id} className={`p-2 rounded-lg border ${entry.kind === 'NOTE' ? 'bg-white border-slate-200' : 'bg-slate-50 border-slate-100'}`}>
                <p className="text-slate-800 whitespace-pre-line">{entry.text}</p>
                <p className="text-[11px] text-slate-500 mt-0.5">
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
                تعديل البطاقة والمهام
              </button>
            )}
            {open && (
              <button
                type="button"
                onClick={async () => {
                  if (state !== 'READY' && !(await confirmDialog({ title: 'إغلاق بطاقة لم تكتمل', message: 'ما زالت في البطاقة مهام لم تُنجز. إغلاقها يخرجها من أعباء الفريق ولا يحتسبها إنتاجاً مكتملاً.', confirmLabel: 'إغلاق على أي حال', cancelLabel: 'تراجع' }))) return;
                  act(() => apiService.updateCard(card.id, (c) => ({ ...c, status: 'CLOSED' })), 'أُغلقت البطاقة وأُرشفت');
                }}
                className={`${BTN} bg-emerald-700 text-white`}
              >
                إغلاق بعد البث
              </button>
            )}
            {open && (
              <button
                type="button"
                onClick={async () => (await confirmDialog({ title: 'إلغاء البطاقة', message: 'تتوقف المهام المفتوحة ولا تُحتسب البطاقة في الإنتاج.', confirmLabel: 'إلغاء البطاقة', cancelLabel: 'تراجع', danger: true })) && act(() => apiService.updateCard(card.id, (c) => ({ ...c, status: 'CANCELLED' })), 'أُلغيت البطاقة')}
                className={`${BTN} border border-slate-200 text-slate-700`}
              >
                إلغاء البطاقة
              </button>
            )}
            {!open && (
              <button type="button" onClick={() => act(() => apiService.updateCard(card.id, (c) => ({ ...c, status: 'OPEN' })), 'أُعيد فتح البطاقة')} className={`${BTN} border border-slate-200 text-slate-700`}>إعادة فتح البطاقة</button>
            )}
            <button
              type="button"
              onClick={async () => {
                if (!(await confirmDialog({ title: 'حذف البطاقة', message: `حذف «${card.title}» مع مهامها وسجلها؟`, confirmLabel: 'حذف', cancelLabel: 'تراجع', danger: true }))) return;
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
          </div>
        )}
      </div>
    </article>
  );
};
