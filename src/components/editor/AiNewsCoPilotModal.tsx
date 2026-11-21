import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Copy, Sparkles } from 'lucide-react';
import { Modal } from '../common/Modal';
import { apiFetch, ApiError } from '../../services/http';
import { plainText } from '../../shared/newsWorkflow';
import { proofreadHtml } from '../../shared/proofread';
import { sanitizeHtml } from '../../utils/sanitizeHtml';
import { buildCopilotRequest, type AiEditorPatch } from '../../shared/aiReview';
import { AiEditComparison } from './AiEditComparison';

const TEXT_MODES = [
  { id: 'TV_REWRITE', label: 'الصياغة التلفزيونية' },
  { id: 'HEADLINES', label: 'توليد العناوين والشارات' },
  { id: 'ANCHOR_LEAD', label: 'مقدمة المذيع' },
  { id: 'PROOFREAD', label: 'التدقيق الأسلوبي' },
] as const;
const PLANNING_MODES = [
  { id: 'IDEAS', label: 'أفكار وزوايا' },
  { id: 'QUESTIONS', label: 'أسئلة المقابلة' },
  { id: 'GUESTS', label: 'ضيوف مقترحون' },
] as const;
type TextMode = typeof TEXT_MODES[number]['id'];
type PlanningMode = typeof PLANNING_MODES[number]['id'];
type Mode = TextMode | PlanningMode;
type Provider = 'gemini' | 'openai' | 'openrouter';
type Budget = { limit: number; remaining: number; resetsAt: string };
type ProviderStatus = { defaultProvider: Provider | null; providers: { id: Provider; model: string }[]; budget?: Budget };
type Suggestion = { title: string; reason: string };
type Result =
  | { type: 'TV_REWRITE'; title: string; summary: string; content: string }
  | { type: 'HEADLINES'; headlines: { title: string; type: string; strap: string }[] }
  | { type: 'ANCHOR_LEAD'; lead1: string; lead2: string }
  | { type: 'PROOFREAD'; notes: string[]; polishedContent: string }
  | { type: PlanningMode; suggestions: Suggestion[] };
type EditorPatch = AiEditorPatch;

const PROVIDER_NAMES: Record<Provider, string> = { gemini: 'Gemini', openai: 'OpenAI', openrouter: 'OpenRouter' };
const control = 'min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 disabled:opacity-50';
const action = 'min-h-11 rounded-lg bg-blue-700 px-3 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50 aria-disabled:opacity-50';
const resultPanel = 'space-y-3 rounded-xl border border-slate-200 p-3';
const isPlanning = (mode: Mode): mode is PlanningMode => PLANNING_MODES.some(option => option.id === mode);

interface Props {
  isOpen: boolean;
  onClose: () => void;
  currentTitle: string;
  currentShortTitle?: string;
  currentSummary?: string;
  currentContent?: string;
  planningOnly?: boolean;
  initialMode?: Mode;
  onApplyChanges?: (data: EditorPatch) => void;
  onUseQuestion?: (question: string) => void;
}

function localResult(mode: TextMode, title: string, summary: string, html: string): Result {
  const excerpt = (summary.trim() || plainText(html) || title).slice(0, 300);
  if (mode === 'PROOFREAD') {
    const result = proofreadHtml(html);
    return { type: mode, notes: result.issues.map(issue => issue.message), polishedContent: result.fixAll() };
  }
  if (mode === 'HEADLINES') return { type: mode, headlines: [{ title: (title.trim() || excerpt).slice(0, 90), type: 'من النص', strap: excerpt }] };
  if (mode === 'ANCHOR_LEAD') return { type: mode, lead1: excerpt, lead2: title.trim() !== excerpt ? title.trim() : '' };
  return { type: mode, title, summary: excerpt, content: html };
}

export function AiNewsCoPilotModal({ isOpen, ...props }: Props) {
  return isOpen ? <OpenCopilot {...props} /> : null;
}

function OpenCopilot({
  onClose, currentTitle, currentShortTitle = '', currentSummary = '', currentContent = '', planningOnly,
  initialMode = planningOnly ? 'QUESTIONS' : 'TV_REWRITE', onApplyChanges, onUseQuestion,
}: Omit<Props, 'isOpen'>) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const [statusError, setStatusError] = useState(false);
  const [reload, setReload] = useState(0);
  const [provider, setProvider] = useState<Provider | ''>('');
  const [tone, setTone] = useState('NEUTRAL_FORMAL');
  const [briefTitle, setBriefTitle] = useState(currentTitle);
  const [brief, setBrief] = useState('');
  const [instruction, setInstruction] = useState('');
  const [localOnly, setLocalOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [local, setLocal] = useState(false);
  const [error, setError] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const [verifiedGuests, setVerifiedGuests] = useState<Set<number>>(() => new Set());
  const request = useRef<AbortController | null>(null);
  const snapshot = useRef({ title: '', shortTitle: '', summary: '', content: '' });
  const planning = isPlanning(mode);
  const canSendExternally = !localOnly && !!provider;
  const budgetExhausted = canSendExternally && status?.budget?.remaining === 0;
  const validInput = planning ? !!(brief.trim() || briefTitle.trim()) : mode === 'PROOFREAD'
    ? !!plainText(currentContent) : !!(currentTitle.trim() || currentSummary.trim() || plainText(currentContent));
  const canGenerate = validInput && (localOnly || !!status) && (!planning || canSendExternally) && !budgetExhausted;

  useEffect(() => {
    const abort = new AbortController();
    setStatusError(false);
    setStatus(null);
    void apiFetch<ProviderStatus>('/api/v1/ai/status', { signal: abort.signal }).then(data => {
      if (abort.signal.aborted) return;
      setStatus(data);
      setProvider(data.defaultProvider || '');
    }).catch(() => {
      if (!abort.signal.aborted) setStatusError(true);
    });
    return () => abort.abort();
  }, [reload]);

  useEffect(() => () => request.current?.abort(), []);

  const clearResult = () => { setResult(null); setError(''); setCopyStatus(''); setVerifiedGuests(new Set()); };

  const generate = async () => {
    if (request.current || !canGenerate) return;
    clearResult();
    snapshot.current = { title: currentTitle, shortTitle: currentShortTitle, summary: currentSummary, content: currentContent };
    const payload = buildCopilotRequest({ mode, provider, localOnly, ...(planning
      ? { title: briefTitle, content: brief }
      : { title: currentTitle, summary: currentSummary, content: currentContent, instruction, tone }) });
    if (!payload) {
      if (!isPlanning(mode)) {
        setResult(localResult(mode, currentTitle, currentSummary, currentContent));
        setLocal(true);
      }
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setLocal(false);
    try {
      const response = await apiFetch<{ data: Result; budget?: Budget }>('/api/v1/ai/copilot', {
        method: 'POST', signal: controller.signal, json: payload,
      });
      if (controller.signal.aborted) return;
      if (response.data?.type !== mode) throw new Error('تعذر قراءة المقترح');
      if (response.budget) setStatus(current => current ? { ...current, budget: response.budget } : current);
      setResult(response.data);
    } catch (cause) {
      if (!controller.signal.aborted) {
        if (cause instanceof ApiError && cause.code === 'AI_DAILY_BUDGET') {
          setStatus(current => current?.budget ? { ...current, budget: { ...current.budget, remaining: 0 } } : current);
        }
        setError(cause instanceof Error ? cause.message : 'تعذر توليد المقترحات');
      }
    } finally {
      if (!controller.signal.aborted) { request.current = null; setBusy(false); }
    }
  };

  const stale = result && !isPlanning(result.type) && (
    snapshot.current.title !== currentTitle || snapshot.current.shortTitle !== currentShortTitle || snapshot.current.summary !== currentSummary || snapshot.current.content !== currentContent
  );
  const apply = (patch: EditorPatch) => {
    if (stale || !onApplyChanges) return;
    onApplyChanges(patch.content === undefined ? patch : { ...patch, content: sanitizeHtml(patch.content) });
    onClose();
  };
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyStatus('نُسخ المقترح.');
    } catch {
      setCopyStatus('تعذر النسخ. يمكنك تحديد النص ونسخه.');
    }
  };

  return <Modal isOpen onClose={onClose} title={planningOnly ? 'المساعد الذكي لإعداد الحلقة' : 'المساعد التحريري الذكي لغرفة الأخبار'} maxWidth="2xl">
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="خيارات المساعد">
        {(planningOnly ? PLANNING_MODES : [...TEXT_MODES, ...PLANNING_MODES]).map(option =>
          <button key={option.id} type="button" disabled={busy} aria-pressed={mode === option.id} className={mode === option.id ? action : control}
            onClick={() => { setMode(option.id); clearResult(); }}>{option.label}</button>)}
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm font-bold text-slate-800">
        <input type="checkbox" className="size-4 accent-blue-700" checked={localOnly} disabled={busy}
          onChange={event => { setLocalOnly(event.target.checked); clearResult(); }} />
        إبقاء المحتوى الحساس على هذا الجهاز
      </label>
      {localOnly && <p role="status" className="text-sm text-slate-700">يعمل التدقيق والقالب المحلي في المحرر. إعداد الأفكار والأسئلة والضيوف يتطلب الإرسال إلى مزوّد.</p>}
      {status && status.providers.length > 0 && <label className="block space-y-1 text-sm font-semibold">
        <span>مزوّد الذكاء الاصطناعي</span>
        <select aria-label="مزوّد الذكاء الاصطناعي" className={control + ' block max-w-full'} value={provider} disabled={busy || localOnly}
          onChange={event => { setProvider(event.target.value as Provider); clearResult(); }}>
          {status.providers.map(item => <option key={item.id} value={item.id}>{PROVIDER_NAMES[item.id]} · {item.model}</option>)}
        </select>
      </label>}
      {status?.providers.length === 0 && <p role="status" className="text-sm text-slate-600">
        يحتاج الاقتراح عبر الإنترنت إلى مزوّد مفعّل على الخادم. يبقى التدقيق والقالب المحلي متاحين في محرر الأخبار.
      </p>}
      {statusError && <div className="flex flex-wrap items-center gap-2 text-sm">
        <p role="alert">تعذر تحميل المزوّدين.</p>
        <button type="button" className={control} onClick={() => setReload(value => value + 1)}>إعادة المحاولة</button>
      </div>}
      {!status && !statusError && <p role="status" className="text-sm text-slate-600">جارٍ تحميل المزوّدين…</p>}
      {canSendExternally && status?.budget && <p role="status" className="text-xs text-slate-600">
        طلبات هذا الحساب المتبقية اليوم: <b>{status.budget.remaining} من {status.budget.limit}</b>. يتجدد الحد عند منتصف الليل بالتوقيت العالمي.
      </p>}
      {planning ? <>
        <label className="block space-y-1 text-sm font-semibold">
          <span>عنوان الموضوع للمساعد</span>
          <input aria-label="عنوان الموضوع للمساعد" value={briefTitle} disabled={busy} maxLength={500} className={control + ' block w-full'}
            onChange={event => { setBriefTitle(event.target.value); clearResult(); }} />
        </label>
        <label className="block space-y-1 text-sm font-semibold">
          <span>موجز الموضوع للمساعد</span>
          <textarea aria-label="موجز الموضوع للمساعد" value={brief} disabled={busy} maxLength={8000} rows={4} className={control + ' block w-full py-2'}
            onChange={event => { setBrief(event.target.value); clearResult(); }} placeholder="مثلاً زاوية التغطية أو تخصص الضيف المطلوب" />
        </label>
      </> : <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1 text-sm font-semibold">
          <span>نبرة التحرير</span>
          <select aria-label="نبرة التحرير" disabled={busy || !canSendExternally || mode === 'PROOFREAD'} className={control + ' block w-full'} value={tone} onChange={event => { setTone(event.target.value); clearResult(); }}>
            <option value="NEUTRAL_FORMAL">أسلوب إخباري رصين</option>
            <option value="URGENT">تغطية عاجلة وميدانية</option>
            <option value="ANALYTICAL">قراءة تحليلية معمقة</option>
            <option value="HUMAN_INTEREST">قصة إنسانية مشوقة</option>
          </select>
        </label>
        <label className="block space-y-1 text-sm font-semibold">
          <span>توجيه تحريري اختياري</span>
          <input aria-label="توجيه تحريري اختياري" className={control + ' block w-full'} value={instruction} maxLength={800} disabled={busy || !canSendExternally}
            onChange={event => { setInstruction(event.target.value); clearResult(); }} placeholder="مثلاً اختصر الجمل الطويلة" />
        </label>
      </div>}
      {canSendExternally && provider && <p className="text-xs text-slate-700">
        عند التوليد يُرسل إلى {PROVIDER_NAMES[provider]} {planning ? 'عنوان الموضوع والموجز المدخلان.' : mode === 'PROOFREAD'
          ? 'متن الخبر كنص والتوجيه الاختياري.' : mode === 'TV_REWRITE'
            ? 'العنوان والملخص والمتن كنص والنبرة والتوجيه الاختياري.'
            : 'العنوان والملخص أو مقتطف موجز من المتن عند غياب الملخص، والنبرة والتوجيه الاختياري.'}
      </p>}
      <button type="button" aria-disabled={busy || undefined} disabled={!busy && !canGenerate} onClick={() => void generate()} className={action + ' inline-flex items-center gap-2'}>
        <Sparkles size={16} aria-hidden="true" />{busy ? 'جارٍ توليد المقترحات…' : 'توليد المقترحات'}
      </button>
      {error && <p role="alert" className="flex gap-2 text-sm text-rose-700"><AlertCircle size={16} aria-hidden="true" />{error}</p>}
      {copyStatus && <p role="status" className="text-sm text-slate-600">{copyStatus}</p>}
      {local && result && <p className="text-sm text-amber-800">الناتج محلي ويعتمد على النص الموجود.</p>}
      {stale && <p role="status" className="text-sm text-amber-800">تغير النص في المحرر. أعد التوليد لتراجعه مع أحدث نسخة.</p>}
      {result?.type === 'TV_REWRITE' && <section className={resultPanel} aria-label="المسودة التلفزيونية المقترحة">
        <h3 className="font-bold">{result.title}</h3><p className="text-sm">{result.summary}</p>
        <div className="rich-content text-sm" dangerouslySetInnerHTML={{ __html: sanitizeHtml(result.content) }} />
        <AiEditComparison before={snapshot.current} patch={result} />
        <button type="button" className={action} disabled={!!stale || !onApplyChanges} onClick={() => apply({ title: result.title, summary: result.summary, content: result.content })}>استخدام في محرر الخبر</button>
      </section>}
      {result?.type === 'HEADLINES' && <ul className="space-y-2">
        {result.headlines.map((headline, index) => <li key={index} className={resultPanel}>
          <h3 className="font-bold">{headline.title}</h3><p className="text-sm">{headline.type} · {headline.strap}</p>
          <AiEditComparison before={snapshot.current} patch={{ title: headline.title, shortTitle: headline.title }} />
          <div className="flex flex-wrap gap-2">
            <button type="button" className={control} onClick={() => void copy(headline.title)}>نسخ العنوان</button>
            <button type="button" className={action} disabled={!!stale || !onApplyChanges} onClick={() => apply({ title: headline.title, shortTitle: headline.title })}>استخدام العنوان</button>
          </div>
        </li>)}
      </ul>}
      {result?.type === 'ANCHOR_LEAD' && <ul className="space-y-2">
        {[result.lead1, result.lead2].filter(Boolean).map((lead, index) => <li key={index} className={resultPanel}>
          <p className="text-sm">{lead}</p>
          <AiEditComparison before={snapshot.current} patch={{ summary: lead }} />
          <button type="button" className={action} disabled={!!stale || !onApplyChanges} onClick={() => apply({ summary: lead })}>استخدام كملخص</button>
        </li>)}
      </ul>}
      {result?.type === 'PROOFREAD' && <section className={resultPanel} aria-label="نتيجة التدقيق">
        {result.notes.length > 0 && <ul className="list-disc ps-5 text-sm">{result.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>}
        <div className="rich-content text-sm" dangerouslySetInnerHTML={{ __html: sanitizeHtml(result.polishedContent) }} />
        <AiEditComparison before={snapshot.current} patch={{ content: result.polishedContent }} />
        <button type="button" className={action} disabled={!!stale || !onApplyChanges || !plainText(result.polishedContent)} onClick={() => apply({ content: result.polishedContent })}>تطبيق النص المصوب</button>
      </section>}
      {result && 'suggestions' in result && <section className="space-y-3" aria-label="المقترحات">
        <p className="text-sm text-amber-800">{result.type === 'GUESTS' ? 'تحقّق من الهوية والصفة الحالية من مصدر موثوق قبل نسخ الاقتراح أو إدراجه في دليل الضيوف.' : 'راجع كل مقترح تحريرياً قبل استخدامه.'}</p>
        {result.suggestions.length === 0 && <p className="text-sm text-slate-600">لم تُرجع الخدمة مقترحات لهذا الموجز. جرّب تحديد الموضوع أو المطلوب أكثر.</p>}
        <ul className="space-y-2">{result.suggestions.map((suggestion, index) => <li key={index} className={resultPanel}>
          <h3 className="font-bold break-words">{suggestion.title}</h3><p className="text-sm break-words">{suggestion.reason}</p>
          {result.type === 'GUESTS' && <label className="flex min-h-11 items-center gap-2 text-xs text-slate-700">
            <input type="checkbox" className="size-4 accent-blue-700" checked={verifiedGuests.has(index)} onChange={event => {
              const checked = event.target.checked;
              setVerifiedGuests(current => { const next = new Set(current); if (checked) next.add(index); else next.delete(index); return next; });
            }} /> راجعت الاسم أو الصفة من مصدر موثوق
          </label>}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={result.type === 'GUESTS' && !verifiedGuests.has(index)} className={control + ' inline-flex items-center gap-2'} onClick={() => void copy(suggestion.title)}><Copy size={16} aria-hidden="true" />نسخ المقترح</button>
            {result.type === 'QUESTIONS' && onUseQuestion && <button type="button" className={action} onClick={() => { onClose(); onUseQuestion(suggestion.title); }}>فتح مسودة سؤال</button>}
          </div>
        </li>)}</ul>
      </section>}
    </div>
  </Modal>;
}
