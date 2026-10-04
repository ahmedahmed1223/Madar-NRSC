import { appLocale, zoneOptions } from '../../shared/dateFormat';
import { confirmDialog } from '../../services/dialogs';
import React, { useMemo, useRef, useState } from 'react';
import { AtSign, MessageSquareText, Send, Trash2 } from 'lucide-react';
import type { User } from '../../types';
import { apiService } from '../../services/api';
import { useLiveData } from '../../hooks/useLiveData';
import { Avatar } from '../common/Avatar';
import { CommentTarget } from '../../shared/comments';
import { departmentIdOf, departmentName } from '../../shared/departments';

interface CommentThreadProps {
  target: CommentTarget;
  currentUser: User;
  title?: string;
}

/** Team discussion on a story, episode, segment or coverage file. Type @ to mention a colleague. */
export const CommentThread: React.FC<CommentThreadProps> = ({ target, currentUser, title = 'ملاحظات الفريق' }) => {
  useLiveData(['comments']);
  const [text, setText] = useState('');
  const [mentions, setMentions] = useState<{ id: string; name: string }[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const comments = apiService.getComments(target);
  const users = useMemo(() => apiService.getUsers().filter((u) => u.isActive !== false && u.id !== currentUser.id), [currentUser.id]);
  const suggestions = mentionQuery === null ? [] : users.filter((u) => u.fullName.includes(mentionQuery)).slice(0, 6);

  const onChange = (value: string) => {
    setText(value);
    const caret = inputRef.current?.selectionStart ?? value.length;
    const m = /@([^\s@]*)$/.exec(value.slice(0, caret));
    setMentionQuery(m ? m[1] : null);
  };

  const pick = (u: User) => {
    const caret = inputRef.current?.selectionStart ?? text.length;
    const before = text.slice(0, caret).replace(/@([^\s@]*)$/, `@${u.fullName} `);
    setText(before + text.slice(caret));
    setMentions((m) => (m.some((x) => x.id === u.id) ? m : [...m, { id: u.id, name: u.fullName }]));
    setMentionQuery(null);
    inputRef.current?.focus();
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const ids = mentions.filter((m) => text.includes(`@${m.name}`)).map((m) => m.id);
      apiService.addComment(target, text, ids);
      setText('');
      setMentions([]);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'تعذر إضافة التعليق');
    }
  };

  // Highlight @Full Name for every known colleague (longest names first).
  const mentionRe = useMemo(() => {
    const names = [...users, currentUser].map((u) => u.fullName).filter(Boolean).sort((x, y) => y.length - x.length);
    if (!names.length) return null;
    const esc = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return new RegExp(`(@(?:${esc.join('|')}))`, 'g');
  }, [users, currentUser]);

  const render = (body: string) =>
    mentionRe
      ? body.split(mentionRe).map((part, i) =>
          i % 2 === 1 ? (
            <strong key={i} className="text-blue-700">
              {part}
            </strong>
          ) : (
            <React.Fragment key={i}>{part}</React.Fragment>
          )
        )
      : body;

  return (
    <section className="space-y-3" aria-label={title}>
      <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
        <MessageSquareText className="w-4 h-4 text-blue-600" />
        {title} ({comments.length})
      </h3>
      <ul className="space-y-2 max-h-80 overflow-y-auto">
        {comments.length === 0 && <li className="text-[11px] text-slate-500">لا توجد ملاحظات بعد. اكتب @ لإشراك زميل.</li>}
        {comments.map((c) => (
          <li key={c.id} className="flex gap-2">
            <Avatar name={c.authorName} className="w-7 h-7 rounded-full text-[11px]" />
            <div className="flex-1 min-w-0 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
              <div className="flex items-center justify-between gap-2 text-[10px] text-slate-500">
                <strong className="text-slate-800 text-[11px]">{c.authorName}</strong>
                <span>{new Date(c.createdAt).toLocaleString(appLocale(), { ...zoneOptions(), day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              <p className="text-xs text-slate-700 whitespace-pre-line leading-relaxed mt-0.5">{render(c.text)}</p>
            </div>
            {c.authorId === currentUser.id && (
              <button type="button" onClick={async () => (await confirmDialog('حذف التعليق؟')) && apiService.deleteComment(c.id)} aria-label="حذف التعليق" className="self-start p-1 text-slate-300 hover:text-rose-600">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </li>
        ))}
      </ul>
      <form onSubmit={submit} className="relative space-y-1.5">
        <textarea
          ref={inputRef}
          rows={2}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(e as any);
            if (e.key === 'Escape') setMentionQuery(null);
          }}
          maxLength={2000}
          placeholder="اكتب ملاحظة… استخدم @ للإشارة إلى زميل (Ctrl+Enter للإرسال)"
          aria-label="تعليق جديد"
          className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs bg-white"
        />
        {suggestions.length > 0 && (
          <ul className="absolute bottom-full mb-1 right-0 z-10 w-64 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden" role="listbox" aria-label="اقتراحات الإشارة">
            {suggestions.map((u) => (
              <li key={u.id}>
                <button type="button" role="option" aria-selected="false" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(u)} className="w-full text-right px-3 py-2 text-xs hover:bg-blue-50 flex items-center gap-2">
                  <AtSign className="w-3 h-3 text-slate-500" />
                  <span className="font-bold text-slate-800">{u.fullName}</span>
                  <span className="text-[10px] text-slate-500 mr-auto">{departmentName(departmentIdOf(u))}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {error && <p className="text-[11px] text-rose-600 font-bold">{error}</p>}
        <div className="flex justify-end">
          <button type="submit" disabled={!text.trim()} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-bold disabled:opacity-40">
            <Send className="w-3.5 h-3.5 rotate-180" />
            إرسال
          </button>
        </div>
      </form>
    </section>
  );
};
