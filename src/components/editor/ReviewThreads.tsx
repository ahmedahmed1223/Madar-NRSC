import React, { useRef, useState } from 'react';
import { MessageSquare, Check, RotateCcw, Send } from 'lucide-react';
import { apiService } from '../../services/api';
import { dataStore } from '../../services/dataStore';
import { useLiveData } from '../../hooks/useLiveData';
import { anchorStatus, type ReviewThread } from '../../shared/reviewThreads';
import { plainText } from '../../shared/bulletins';
import { RbacService } from '../../services/rbacService';

export function ReviewThreads({ collection, entityId, text, version, canPost }: { collection: ReviewThread['collection']; entityId: string; text: string; version: string; canPost: boolean }) {
  useLiveData(['reviewThreads', 'comments']);
  const [quote, setQuote] = useState('');
  const [note, setNote] = useState('');
  const [reply, setReply] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef<{ threadId: string; commentId: string; quote: string; version: string } | null>(null);
  const pendingReplies = useRef<Record<string, string>>({});
  const threads = apiService.getReviewThreads(collection, entityId);
  const currentUser = apiService.getCurrentUser();
  const target = { kind: collection === 'news' ? 'news' as const : 'bulletinStory' as const, id: entityId, title: 'مراجعة النص' };
  const wait = async (c: 'comments' | 'reviewThreads', id: string) => { const outcome = await dataStore.awaitWrite(c, id); if (!outcome.ok) throw new Error(outcome.message || 'لم يؤكد الخادم حفظ المراجعة'); };
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); } catch (e: any) { setError(e.message || 'تعذر حفظ المراجعة'); } finally { setBusy(false); }
  };
  const content = plainText(text);
  const sendReply = (threadId: string) => run(async () => {
    if (!reply[threadId]?.trim()) return;
    const id = pendingReplies.current[threadId] ||= crypto.randomUUID();
    const comment = apiService.addComment(target, reply[threadId], [], threadId, id);
    await wait('comments', comment.id);
    delete pendingReplies.current[threadId];
    setReply(current => ({ ...current, [threadId]: '' }));
  });
  return <section aria-label="ملاحظات مراجعة النص" className="border-y border-slate-200 py-3 space-y-3">
    <h3 className="font-bold flex items-center gap-2"><MessageSquare className="w-4 h-4" />ملاحظات مراجعة النص ({threads.filter(t => !t.resolved).length})</h3>
    {error && <p role="alert" className="text-rose-700">{error}</p>}
    <fieldset disabled={busy} className="space-y-3">
      {canPost && <details><summary className="min-h-11 flex items-center cursor-pointer">إضافة ملاحظة على مقتطف</summary>
        <label className="block">مقتطف من النص<textarea aria-label="مقتطف من النص" maxLength={2000} value={quote} onChange={e => setQuote(e.target.value)} className="block w-full border rounded-lg p-2" /></label>
        <label className="block">ملاحظة المراجعة<textarea aria-label="ملاحظة المراجعة" maxLength={2000} value={note} onChange={e => setNote(e.target.value)} className="block w-full border rounded-lg p-2" /></label>
        <button type="button" disabled={!quote.trim() || !note.trim()} className="min-h-11 px-3 flex items-center gap-2 text-blue-700" onClick={() => void run(async () => {
          const at = content.indexOf(quote);
          if (at < 0) throw new Error('المقتطف غير موجود في النص الحالي');
          if (!pending.current || pending.current.quote !== quote || pending.current.version !== version) pending.current = { threadId: crypto.randomUUID(), commentId: crypto.randomUUID(), quote, version };
          const thread = apiService.createReviewThread({ collection, entityId, field: collection === 'news' ? 'content' : 'script', baseVersion: version, quote, contextBefore: content.slice(Math.max(0, at - 200), at), contextAfter: content.slice(at + quote.length, at + quote.length + 200) }, pending.current.threadId);
          await wait('reviewThreads', thread.id);
          const comment = apiService.addComment(target, note, [], thread.id, pending.current.commentId); await wait('comments', comment.id);
          pending.current = null;
          setQuote(''); setNote('');
        })}><Send className="w-4 h-4" />إضافة الملاحظة</button>
      </details>}
      <ul className="divide-y divide-slate-200">{threads.map(t => {
        const status = anchorStatus(content, t.quote);
        const material = collection === 'news' ? apiService.getNews().find(n => n.id === entityId) : apiService.getBulletinStories().find(s => s.id === entityId);
        const owner = collection === 'news' ? (material as any)?.authorId : (material as any)?.writerId;
        const mayResolve = owner !== currentUser.id && canPost && (t.createdById === currentUser.id || RbacService.hasPermission(currentUser, collection === 'news' ? 'news.review' : 'bulletins.approve') || (collection === 'news' && RbacService.hasPermission(currentUser, 'news.edit_any')));
        return <li key={t.id} className="py-3 space-y-2">
          <blockquote className="whitespace-pre-wrap break-words border-r-2 border-blue-500 pr-2">{t.quote}</blockquote>
          <p className="text-sm text-slate-600">{t.resolved ? 'معالجة' : 'مفتوحة'}{status === 'stale' ? ' (المقتطف لم يعد موجوداً)' : status === 'ambiguous' ? ' (المقتطف مكرر؛ موضعه غير مؤكد)' : t.baseVersion !== version ? ' (تغيرت نسخة النص)' : ''}</p>
          <ul>{apiService.getComments(target).filter(c => c.threadId === t.id).map(c => <li key={c.id} className="py-1"><strong className="text-sm">{c.authorName}: </strong><span className="whitespace-pre-wrap break-words">{c.text}</span></li>)}</ul>
          {canPost && <div className="flex gap-2">
            <input aria-label={`رد على مراجعة ${t.quote.slice(0, 30)}`} aria-keyshortcuts="Control+Enter Meta+Enter" maxLength={2000} className="min-h-11 border rounded-lg px-2 min-w-0 flex-1" value={reply[t.id] || ''} onChange={e => setReply({ ...reply, [t.id]: e.target.value })} onKeyDown={e => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.altKey && !e.repeat && !e.nativeEvent.isComposing) { e.preventDefault(); e.stopPropagation(); void sendReply(t.id); }
            }} />
            <button type="button" title="إرسال الرد" aria-label="إرسال الرد" disabled={!reply[t.id]?.trim()} className="min-h-11 min-w-11" onClick={() => void sendReply(t.id)}><Send className="w-4 h-4" /></button>
          </div>}
          {mayResolve && <button type="button" className="min-h-11 flex items-center gap-2 text-blue-700" onClick={() => void run(async () => { apiService.setReviewThreadResolved(t.id, !t.resolved); await wait('reviewThreads', t.id); })}>{t.resolved ? <RotateCcw className="w-4 h-4" /> : <Check className="w-4 h-4" />}{t.resolved ? 'إعادة فتح المراجعة' : 'تمت معالجة الملاحظة'}</button>}
        </li>;
      })}</ul>
    </fieldset>
  </section>;
}
