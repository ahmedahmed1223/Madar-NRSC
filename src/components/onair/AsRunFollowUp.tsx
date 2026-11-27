import { useRef, useState, type FormEvent } from 'react';
import type { User } from '../../types';
import { apiService } from '../../services/api';
import { dataStore } from '../../services/dataStore';
import { apiFetch } from '../../services/http';
import { RbacService } from '../../services/rbacService';
import { AIR_OUTCOME_LABELS, broadcastOutcomes, type BroadcastWithArchive } from '../../shared/broadcastArchive';
import { newId } from '../../shared/ids';
import { canControlOnAir } from '../../shared/onair';

export function AsRunFollowUp({ state, user, formatTime }: { state: BroadcastWithArchive; user: User; formatTime: (value: string) => string }) {
  const outcomes = broadcastOutcomes(state);
  const omitted = outcomes.filter(item => item.status !== 'AIRED');
  const airedIds = new Set(outcomes.filter(item => item.status === 'AIRED').map(item => item.id));
  const aired = (state.archivedPlan || []).filter(item => airedIds.has(item.id));
  const records = (state.correctionRequests || []).filter(item => item.startedAt === state.startedAt);
  const can = (permission: string) => RbacService.hasPermission(user, permission);
  const canRequest = canControlOnAir(user, can) || can('news.review') || can('news.edit_any');
  const [selectedId, setSelectedId] = useState('');
  const [reason, setReason] = useState('');
  const [correctionId, setCorrectionId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string }>();
  const request = useRef<{ fingerprint: string; id: string } | null>(null);
  const segment = aired.find(item => item.id === selectedId) || aired[0];
  const sourceId = segment?.newsId;
  const corrections = sourceId ? apiService.getNewsCorrections().filter(item => item.newsId === sourceId) : [];
  const linkedId = corrections.some(item => item.id === correctionId) ? correctionId : undefined;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!segment || !reason.trim() || submitting) return;
    setSubmitting(true);
    setMessage(undefined);
    const note = { startedAt: state.startedAt, segmentId: segment.id, reason: reason.trim(), correctionId: linkedId };
    const fingerprint = JSON.stringify(note);
    if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, id: newId('air-correction') };
    try {
      await apiFetch(`/api/v1/onair/${encodeURIComponent(state.episodeId)}/correction-requests`, {
        method: 'POST', json: { ...note, requestId: request.current.id }, signal: AbortSignal.timeout(10_000),
      });
      request.current = null;
      setReason('');
      setCorrectionId('');
      setMessage({ error: false, text: 'سُجّل طلب التصحيح في أرشيف البث.' });
      void dataStore.pull();
    } catch (error) {
      setMessage({ error: true, text: error instanceof Error ? error.message : 'تعذّر تسجيل طلب التصحيح.' });
    } finally {
      setSubmitting(false);
    }
  }

  if (!state.archivedPlan || (!omitted.length && !records.length && (!canRequest || !aired.length))) return null;

  return (
    <div className="space-y-3 border-t border-slate-200 px-3 py-3">
      {omitted.length > 0 && (
        <section aria-label="مواد لم تُذع">
          <h3 className="mb-2 text-sm font-bold">مواد لم تُذع</h3>
          <ul className="divide-y divide-slate-100 text-sm">
            {omitted.map(item => (
              <li key={item.id} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2">
                <span className="min-w-0 break-words">{item.title}</span>
                <span className="shrink-0 font-semibold">{AIR_OUTCOME_LABELS[item.status]}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {records.length > 0 && (
        <section aria-label="طلبات التصحيح على الهواء">
          <h3 className="mb-2 text-sm font-bold">طلبات التصحيح على الهواء</h3>
          <ul className="space-y-2 text-sm">
            {records.map(item => (
              <li key={item.id} className="rounded-lg border border-slate-200 p-3">
                <p className="font-semibold">{item.segmentTitle}</p>
                <p className="mt-1 whitespace-pre-wrap break-words">{item.reason}</p>
                <p className="mt-1 text-xs text-slate-600">{item.actorName} · {formatTime(item.createdAt)}{item.correctionId ? ' · مرتبط بتصحيح تحريري' : ''}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
      {canRequest && aired.length > 0 && (
        <details>
          <summary className="min-h-11 w-fit cursor-pointer rounded-md border border-slate-300 px-3 py-2.5 text-sm font-semibold">يلزم تصحيح على الهواء</summary>
          <form className="mt-3 grid max-w-2xl gap-3" onSubmit={submit}>
            <label className="grid gap-1.5 text-sm font-medium">
              الفقرة المذاعة
              <select className="min-h-11 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2" value={segment?.id || ''} disabled={submitting} onChange={event => { setSelectedId(event.target.value); setCorrectionId(''); }}>
                {aired.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
              </select>
            </label>
            {corrections.length > 0 && (
              <label className="grid gap-1.5 text-sm font-medium">
                ربط بتصحيح تحريري (اختياري)
                <select className="min-h-11 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2" value={linkedId || ''} disabled={submitting} onChange={event => setCorrectionId(event.target.value)}>
                  <option value="">اختر تصحيحاً</option>
                  {corrections.map(item => <option key={item.id} value={item.id}>{item.summary}</option>)}
                </select>
              </label>
            )}
            <label className="grid gap-1.5 text-sm font-medium">
              سبب طلب التصحيح
              <textarea className="min-h-20 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5" required maxLength={1000} disabled={submitting} value={reason} onChange={event => setReason(event.target.value)} />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" disabled={submitting || !reason.trim()} className="min-h-11 rounded-md bg-blue-700 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60">
                {submitting ? 'جارٍ التسجيل…' : 'سجّل طلب التصحيح'}
              </button>
              {message && <p role={message.error ? 'alert' : 'status'} className={message.error ? 'text-sm text-rose-700' : 'text-sm text-emerald-700'}>{message.text}</p>}
            </div>
          </form>
        </details>
      )}
    </div>
  );
}
