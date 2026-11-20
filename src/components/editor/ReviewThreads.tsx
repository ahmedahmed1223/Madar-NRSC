import { useEffect, useRef, useState } from 'react';
import { MessageSquare, Check, RotateCcw, Send, Quote } from 'lucide-react';
import { apiService } from '../../services/api';
import { dataStore } from '../../services/dataStore';
import { useLiveData } from '../../hooks/useLiveData';
import { anchorStatus, type ReviewThread } from '../../shared/reviewThreads';
import { plainText } from '../../shared/bulletins';
import { RbacService } from '../../services/rbacService';
import { countLabel } from '../../shared/arabicPlural';

/** A quote (and optionally a note) handed in from the text: a selection or a proofreading finding. */
export interface ReviewSeed {
  quote: string;
  note?: string;
  /** Changes on every hand-in so the same quote can be offered twice. */
  key: number;
}

/** Closest quote the saved text really contains (selections may carry extra spaces or line breaks). */
export function normalizeQuote(raw: string, text: string): string {
  const quote = raw.replace(/\s+/g, ' ').trim().slice(0, 2000);
  if (!quote || text.includes(quote)) return quote;
  // Trim punctuation a selection may have caught at its edges.
  const trimmed = quote.replace(/^[\s،؛.,:«»"'()]+|[\s،؛.,:«»"'()]+$/g, '');
  return trimmed && text.includes(trimmed) ? trimmed : quote;
}

export function ReviewThreads({
  collection,
  entityId,
  text,
  version,
  canPost,
  title,
  seed,
}: {
  collection: ReviewThread['collection'];
  entityId: string;
  text: string;
  version: string;
  canPost: boolean;
  /** The material's title: what the writer's notification names. */
  title?: string;
  seed?: ReviewSeed | null;
}) {
  useLiveData(['reviewThreads', 'comments']);
  const [quote, setQuote] = useState('');
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(false);
  const [reply, setReply] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sectionRef = useRef<HTMLElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const pending = useRef<{ threadId: string; commentId: string; quote: string; version: string } | null>(null);
  const pendingReplies = useRef<Record<string, string>>({});
  const threads = apiService.getReviewThreads(collection, entityId);
  const currentUser = apiService.getCurrentUser();
  const target = { kind: collection === 'news' ? ('news' as const) : ('bulletinStory' as const), id: entityId, title: (title || '').trim().slice(0, 200) || 'مراجعة النص' };
  const content = plainText(text);

  // A quote handed in from the text opens the form with it, ready for the note.
  useEffect(() => {
    if (!seed || !canPost) return;
    setQuote(normalizeQuote(seed.quote, content));
    if (seed.note !== undefined) setNote(seed.note);
    setError('');
    setOpen(true);
    requestAnimationFrame(() => {
      sectionRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      noteRef.current?.focus();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed?.key]);

  const wait = async (c: 'comments' | 'reviewThreads', id: string) => {
    const outcome = await dataStore.awaitWrite(c, id);
    if (!outcome.ok) throw new Error(outcome.message || 'لم يؤكد الخادم حفظ المراجعة');
  };
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e: any) {
      setError(e.message || 'تعذر حفظ المراجعة');
    } finally {
      setBusy(false);
    }
  };
  const sendReply = (threadId: string) =>
    run(async () => {
      if (!reply[threadId]?.trim()) return;
      const id = (pendingReplies.current[threadId] ||= crypto.randomUUID());
      const comment = apiService.addComment(target, reply[threadId], [], threadId, id);
      await wait('comments', comment.id);
      delete pendingReplies.current[threadId];
      setReply((current) => ({ ...current, [threadId]: '' }));
    });
  const addNote = () =>
    run(async () => {
      const at = content.indexOf(quote);
      if (at < 0) throw new Error('المقتطف غير موجود في النص المحفوظ؛ حدّد مقطعاً من النص كما هو');
      if (!pending.current || pending.current.quote !== quote || pending.current.version !== version) pending.current = { threadId: crypto.randomUUID(), commentId: crypto.randomUUID(), quote, version };
      const thread = apiService.createReviewThread(
        {
          collection,
          entityId,
          field: collection === 'news' ? 'content' : 'script',
          baseVersion: version,
          quote,
          contextBefore: content.slice(Math.max(0, at - 200), at),
          contextAfter: content.slice(at + quote.length, at + quote.length + 200),
        },
        pending.current.threadId
      );
      await wait('reviewThreads', thread.id);
      const comment = apiService.addComment(target, note, [], thread.id, pending.current.commentId);
      await wait('comments', comment.id);
      pending.current = null;
      setQuote('');
      setNote('');
    });
  const openCount = threads.filter((t) => !t.resolved).length;
  const field = 'block w-full mt-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500';

  return (
    <section ref={sectionRef} aria-label="ملاحظات مراجعة النص" className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-3">
      <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
        <MessageSquare className="w-4 h-4 text-blue-600" />
        ملاحظات مراجعة النص
        <span className="text-xs font-semibold text-slate-500">({openCount ? countLabel(openCount, { one: 'ملاحظة مفتوحة', two: 'ملاحظتان مفتوحتان', few: 'ملاحظات مفتوحة', many: 'ملاحظة مفتوحة' }) : 'لا ملاحظات مفتوحة'})</span>
      </h3>
      {error && <p role="alert" className="text-sm font-semibold text-rose-700">{error}</p>}
      <fieldset disabled={busy} className="space-y-3">
        {canPost && (
          <details open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)} className="rounded-xl border border-slate-200 bg-slate-50/60 px-3">
            <summary className="min-h-11 flex items-center gap-2 cursor-pointer text-sm font-semibold text-blue-700">إضافة ملاحظة على مقتطف</summary>
            <p className="text-xs text-slate-600 pb-2">حدّد جملة في النص ثم اضغط «ملاحظة على المقطع المحدد»، أو اكتب المقتطف هنا كما هو في النص.</p>
            <label className="block text-xs font-bold text-slate-700">
              مقتطف من النص
              <textarea aria-label="مقتطف من النص" rows={2} maxLength={2000} value={quote} onChange={(e) => setQuote(e.target.value)} className={field} />
            </label>
            <label className="block text-xs font-bold text-slate-700 mt-2">
              ملاحظة المراجعة
              <textarea ref={noteRef} aria-label="ملاحظة المراجعة" rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} className={field} />
            </label>
            <div className="py-2">
              <button type="button" disabled={!quote.trim() || !note.trim()} className="min-h-11 px-4 inline-flex items-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold disabled:opacity-50" onClick={() => void addNote()}>
                <Send className="w-4 h-4" />
                إضافة الملاحظة
              </button>
            </div>
          </details>
        )}
        {threads.length === 0 && !canPost && <p className="text-xs text-slate-500">لا توجد ملاحظات على هذا النص.</p>}
        <ul className="divide-y divide-slate-200">
          {threads.map((t) => {
            const status = anchorStatus(content, t.quote);
            const material = collection === 'news' ? apiService.getNews().find((n) => n.id === entityId) : apiService.getBulletinStories().find((s) => s.id === entityId);
            const owner = collection === 'news' ? (material as any)?.authorId : (material as any)?.writerId;
            const mayResolve =
              owner !== currentUser.id &&
              canPost &&
              (t.createdById === currentUser.id ||
                RbacService.hasPermission(currentUser, collection === 'news' ? 'news.review' : 'bulletins.approve') ||
                (collection === 'news' && RbacService.hasPermission(currentUser, 'news.edit_any')));
            const comments = apiService.getComments(target).filter((c) => c.threadId === t.id);
            return (
              <li key={t.id} className={`py-3 space-y-2 ${t.resolved ? 'opacity-70' : ''}`}>
                <blockquote className="flex gap-2 whitespace-pre-wrap break-words border-r-4 border-blue-500 bg-blue-50/50 rounded-lg px-3 py-2 text-sm text-slate-800">
                  <Quote className="w-3.5 h-3.5 text-blue-500 shrink-0 mt-1" />
                  {t.quote}
                </blockquote>
                <p className="text-xs text-slate-600">
                  <span className={`font-bold ${t.resolved ? 'text-emerald-700' : 'text-amber-700'}`}>{t.resolved ? 'معالجة' : 'مفتوحة'}</span>
                  {status === 'stale' ? ' (المقتطف لم يعد موجوداً)' : status === 'ambiguous' ? ' (المقتطف مكرر؛ موضعه غير مؤكد)' : t.baseVersion !== version ? ' (تغيرت نسخة النص)' : ''}
                  {comments.length > 1 ? ` · ${countLabel(comments.length, { one: 'رد واحد', two: 'ردان', few: 'ردود', many: 'رداً' })}` : ''}
                </p>
                <ul className="space-y-1">
                  {comments.map((c) => (
                    <li key={c.id} className="text-sm">
                      <strong className="text-slate-800">{c.authorName}: </strong>
                      <span className="whitespace-pre-wrap break-words text-slate-700">{c.text}</span>
                    </li>
                  ))}
                </ul>
                {canPost && (
                  <div className="flex gap-2">
                    <input
                      aria-label={`رد على مراجعة ${t.quote.slice(0, 30)}`}
                      aria-keyshortcuts="Control+Enter Meta+Enter"
                      maxLength={2000}
                      placeholder="رد (Ctrl+Enter للإرسال)"
                      className="min-h-11 border border-slate-300 rounded-lg px-3 min-w-0 flex-1 text-sm"
                      value={reply[t.id] || ''}
                      onChange={(e) => setReply({ ...reply, [t.id]: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.altKey && !e.repeat && !e.nativeEvent.isComposing) {
                          e.preventDefault();
                          e.stopPropagation();
                          void sendReply(t.id);
                        }
                      }}
                    />
                    <button type="button" title="إرسال الرد" aria-label="إرسال الرد" disabled={!reply[t.id]?.trim()} className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-lg border border-slate-300 text-blue-700 disabled:opacity-40" onClick={() => void sendReply(t.id)}>
                      <Send className="w-4 h-4" />
                    </button>
                  </div>
                )}
                {mayResolve && (
                  <button
                    type="button"
                    className="min-h-11 flex items-center gap-2 text-sm font-semibold text-blue-700"
                    onClick={() =>
                      void run(async () => {
                        apiService.setReviewThreadResolved(t.id, !t.resolved);
                        await wait('reviewThreads', t.id);
                      })
                    }
                  >
                    {t.resolved ? <RotateCcw className="w-4 h-4" /> : <Check className="w-4 h-4" />}
                    {t.resolved ? 'إعادة فتح المراجعة' : 'تمت معالجة الملاحظة'}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </fieldset>
    </section>
  );
}
