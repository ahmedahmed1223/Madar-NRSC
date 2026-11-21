import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../services/http';
import { Modal } from '../common/Modal';
import { AiEditComparison } from '../editor/AiEditComparison';

const field = 'mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';
const button = 'min-h-11 rounded-lg bg-blue-700 px-3 text-sm font-bold text-white disabled:opacity-50';
type Brief = { brief: string; gaps: string[] };

export function CardBriefReview({ title, script, onClose, onUse }: { title: string; script: string; onClose: () => void; onUse: (result: Brief) => void }) {
  const [sharedTitle, setSharedTitle] = useState(title.slice(0, 500));
  const [source, setSource] = useState('');
  const [allowed, setAllowed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [review, setReview] = useState<{ before: string; result: Brief } | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  const generate = async () => {
    if (request.current || !allowed || !source.trim()) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError('');
    setReview(null);
    try {
      const { data } = await apiFetch<{ data: Brief }>('/api/v1/ai/copilot', {
        method: 'POST', signal: controller.signal,
        json: { mode: 'BRIEF', title: sharedTitle.trim(), content: source.trim() },
      });
      if (controller.signal.aborted) return;
      if (!data.brief.trim()) throw new Error('لم يُرجع المساعد نصاً صالحاً للمراجعة.');
      setReview({ before: script, result: data });
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'تعذر اقتراح المسودة.');
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  };

  const stale = !!review && review.before !== script;
  return <Modal isOpen onClose={onClose} title="اقتراح مسودة موجز" maxWidth="xl">
    <div className="space-y-4">
      <label className="block text-sm font-bold">العنوان المسموح بمشاركته<input className={field} value={sharedTitle} maxLength={500} disabled={busy}
        onChange={event => { setSharedTitle(event.target.value); setAllowed(false); setReview(null); }} /></label>
      <label className="block text-sm font-bold">المعلومات المسموح بمشاركتها<textarea className={field} value={source} rows={4} maxLength={8000} disabled={busy}
        onChange={event => { setSource(event.target.value); setAllowed(false); setReview(null); }} /></label>
      <p className="text-sm text-slate-600">يرسل مدار الحقلين أعلاه إلى المزوّد الافتراضي الذي حدده مدير النظام. اختر المعلومات التي يمكنك مشاركتها.</p>
      <label className="flex min-h-11 items-center gap-2 text-sm font-bold">
        <input type="checkbox" checked={allowed} disabled={busy} className="size-4 accent-blue-700"
          onChange={event => { setAllowed(event.target.checked); setReview(null); }} /> أوافق على إرسال النص المحدد إلى المزوّد
      </label>
      <button type="button" className={button} disabled={!allowed || !source.trim() || busy} onClick={() => void generate()}>{busy ? 'جارٍ إعداد المقترح…' : 'توليد مسودة للمراجعة'}</button>
      {error && <p role="alert" className="text-sm text-rose-800">{error}</p>}
      {review && <section aria-label="مسودة الموجز المقترحة" className="space-y-3">
        <AiEditComparison before={{ summary: review.before }} patch={{ summary: review.result.brief }} />
        {review.result.gaps.length > 0 && <ul className="list-disc space-y-1 ps-5 text-xs text-amber-800">{review.result.gaps.map(gap => <li key={gap}>{gap}</li>)}</ul>}
        {stale && <p role="status" className="text-sm text-amber-800">تغيّرت خانة النص. أعد التوليد لمراجعة أحدث نسخة.</p>}
        <button type="button" className={button} disabled={stale} onClick={() => { if (!stale) onUse(review.result); }}>استخدام في مسودة التكليف</button>
      </section>}
    </div>
  </Modal>;
}
