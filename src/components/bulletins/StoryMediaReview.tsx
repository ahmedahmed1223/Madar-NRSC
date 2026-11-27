import { useEffect, useRef, useState } from 'react';
import { useLiveData } from '../../hooks/useLiveData';
import { apiService } from '../../services/api';
import { dataStore } from '../../services/dataStore';
import { apiFetch } from '../../services/http';
import { bulletinClipSource, bulletinClipUploadId, type BulletinMediaAction, type BulletinMediaReview } from '../../shared/bulletinMediaReview';
import { mmss } from '../../shared/bulletins';

function PreviewCountdown({ until }: { until: string }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return <time dateTime={until} className="tabular-nums" aria-label="الوقت المتبقي للمعاينة" dir="ltr">{mmss(Math.max(0, Math.ceil((Date.parse(until) - now) / 1000)))}</time>;
}

interface Props {
  bulletinId: string;
  storyId: string;
  clipMediaId: string;
  allowed: boolean;
}

export function StoryMediaReview(props: Props) {
  useLiveData(['bulletinStories', 'media'], 0);
  const story = apiService.getBulletinStories(props.bulletinId).find(row => row.id === props.storyId);
  const review = story?.mediaReview;
  const clip = apiService.getMedia().find(row => row.id === props.clipMediaId);
  if (!review || review.mediaId !== props.clipMediaId || story?.clipMediaId !== props.clipMediaId) return null;
  if (clip && bulletinClipUploadId(clip) !== review.uploadId) return <p role="status" className="text-sm text-amber-800">تغيّر ملف المادة. احفظ القصة لبدء مراجعة الملف الجديد.</p>;
  const url = bulletinClipSource(clip);
  return <ReviewControls key={JSON.stringify([review.id, url])} {...props} review={review} url={url} />;
}

function ReviewControls({ bulletinId, storyId, review, allowed, url }: Props & { review: BulletinMediaReview; url?: string }) {
  const [accepted, setAccepted] = useState<BulletinMediaReview>();
  const [preview, setPreview] = useState(false);
  const [playable, setPlayable] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const current = review.state === 'PREVIEW' || review.state === 'REPLACEMENT' ? accepted ?? review : review;
  const mayDecide = allowed && (current.state === 'PREVIEW' || current.state === 'REPLACEMENT');
  const decide = async (action: BulletinMediaAction) => {
    if (pending.current || !mayDecide) return;
    pending.current = true;
    setBusy(true); setError('');
    try {
      const result = await apiFetch<{ data: BulletinMediaReview }>(`/api/v1/bulletins/${encodeURIComponent(bulletinId)}/stories/${encodeURIComponent(storyId)}/media-review`, {
        method: 'POST', json: { action, reviewId: review.id },
      });
      setAccepted(result.data);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'تعذر حفظ قرار المعاينة');
    } finally {
      pending.current = false;
      setBusy(false);
      void dataStore.pull();
    }
  };
  const label = current.state === 'PREVIEW' ? 'المادة الأولى قيد المعاينة'
    : current.state === 'REPLACEMENT' ? 'المادة تحتاج إلى معاينة واعتماد يدوي'
    : current.state === 'REJECTED' ? 'أُوقفت المادة وطُلب بديل'
    : current.decision === 'AUTOMATIC' ? 'اعتُمدت المادة بعد مهلة المعاينة' : 'اعتُمدت المادة يدويًا';
  return <section aria-label="معاينة مادة القصة" className="space-y-2 border-t border-slate-200 pt-2 text-sm">
    <div className="flex flex-wrap items-center gap-2">
      <span role="status" className="font-semibold">{label}</span>
      {current.state === 'PREVIEW' && current.deadlineAt && <PreviewCountdown until={current.deadlineAt} />}
    </div>
    {url && <button type="button" aria-expanded={preview} onClick={() => setPreview(open => !open)} className="min-h-11 px-2 font-semibold text-blue-700">
      {preview ? 'إخفاء المعاينة' : 'معاينة الفيديو'}
    </button>}
    {preview && url && <video key={url} src={url} controls preload="metadata" playsInline aria-label="فيديو مادة النشرة"
      onLoadedData={() => { setPlayable(true); setPreviewError(false); }}
      onError={() => { setPlayable(false); setPreviewError(true); }}
      className="theme-fixed w-full max-h-72 rounded-lg bg-slate-950" />}
    {preview && previewError && <p role="alert" className="text-rose-700">تعذر تشغيل الفيديو على هذا الجهاز.</p>}
    {mayDecide && <div className="flex flex-wrap gap-2">
      <button type="button" disabled={busy || !playable} onClick={() => void decide('APPROVE')} className="min-h-11 rounded-lg bg-emerald-700 px-3 font-semibold text-white disabled:opacity-50">اعتماد المادة</button>
      <button type="button" disabled={busy} onClick={() => void decide('REQUEST_REPLACEMENT')} className="min-h-11 rounded-lg border border-rose-300 px-3 font-semibold text-rose-700 disabled:opacity-50">إيقاف المعاينة وطلب بديل</button>
    </div>}
    {error && <p role="alert" className="text-rose-700">{error}</p>}
  </section>;
}
