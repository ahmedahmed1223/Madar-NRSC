import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, AtSign, Download, FileText, Link2, Paperclip, Send, Settings2, X } from 'lucide-react';
import type { User } from '../../types';
import { apiService } from '../../services/api';
import { RbacService } from '../../services/rbacService';
import { uploadFile } from '../../services/mediaUpload';
import { FormPage } from '../common/FormPage';
import { stationDay, timeOnly } from '../cards/cardUi';
import { formatDay } from '../../shared/dateFormat';
import { matchesQuery } from '../../shared/search';
import {
  CHAT_REF_KINDS, CHAT_UPLOAD_TYPES, MAX_ATTACHMENTS, MAX_MESSAGE_CHARS,
  chatFileUrl, chatRefLink, isPrivateChannel, type ChatAttachment, type ChatMessage,
  type ChatRef, type Conversation,
} from '../../shared/chat';

const INPUT = 'w-full px-3 py-2 border border-slate-300 rounded-xl bg-white text-sm text-slate-900';
const ICON_BTN = 'min-h-11 min-w-11 inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50';
const sizeLabel = (bytes: number) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} م.ب` : `${Math.max(1, Math.round(bytes / 1024))} ك.ب`);

/**
 * Height that keeps an element's bottom on screen above a phone's on-screen keyboard.
 * The keyboard shrinks the visual viewport, not the layout one, so `dvh` alone does not see it.
 * Returns null while no keyboard is open (or the page is pinch-zoomed): CSS sizing applies then.
 */
function useKeyboardSafeHeight(ref: React.RefObject<HTMLElement | null>, onOpen: () => void) {
  const [height, setHeight] = useState<number | null>(null);
  const openRef = useRef(onOpen);
  openRef.current = onOpen;
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const el = ref.current;
        const keyboard = vv.scale < 1.01 && window.innerHeight - vv.height > 120;
        if (!el || !keyboard) {
          setHeight(null);
          return;
        }
        const top = Math.max(el.getBoundingClientRect().top, vv.offsetTop);
        const next = Math.max(180, Math.round(vv.offsetTop + vv.height - top));
        setHeight((prev) => {
          if (prev === null) openRef.current();
          return prev === next ? prev : next;
        });
      });
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, [ref]);
  return height;
}

export interface MessageThread {
  channel: string;
  name: string;
  hint: string;
  kind: 'dm' | 'group' | 'channel';
  avatar?: { src?: string; name: string };
  last?: ChatMessage;
}

interface ThreadPaneProps {
  thread: MessageThread;
  group?: Conversation;
  currentUser: User;
  userById: Map<string, User>;
  messages: ChatMessage[];
  seen?: string;
  draftText: string;
  onDraftText: (text: string) => void;
  onBack: () => void;
  onOpenLink: (path: string) => void;
  onGroupSettings?: () => void;
}

interface Pending {
  key: string;
  name: string;
  file: File;
  percent: number;
  attachment?: ChatAttachment;
  error?: string;
  abort?: () => void;
}

export const ThreadPane: React.FC<ThreadPaneProps> = ({ thread, group, currentUser, userById, messages, seen, draftText, onDraftText, onBack, onOpenLink, onGroupSettings }) => {
  const me = currentUser.id;
  const [text, setText] = useState(draftText);
  const updateDraft = (value: string) => {
    setText(value);
    onDraftText(value);
  };
  const [urgent, setUrgent] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]);
  const [ref, setRef] = useState<ChatRef | null>(null);
  const [refOpen, setRefOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [older, setOlder] = useState<ChatMessage[]>([]);
  const [olderState, setOlderState] = useState<'idle' | 'loading' | 'done'>('idle');
  const [atLatest, setAtLatest] = useState(true);
  const runningUploads = useRef(new Map<string, () => void>());
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  // With the keyboard open the conversation fits above it, and the newest message stays in view.
  const keyboardHeight = useKeyboardSafeHeight(sectionRef, () =>
    requestAnimationFrame(() => {
      const list = listRef.current;
      if (list) list.scrollTop = list.scrollHeight;
    })
  );

  const recent = useMemo(() => messages.filter((m) => m.channel === thread.channel), [messages, thread.channel]);
  const shown = useMemo(() => {
    const ids = new Set(recent.map((m) => m.id));
    return [...older.filter((m) => !ids.has(m.id)), ...recent];
  }, [older, recent]);
  const newest = recent[recent.length - 1]?.timestamp;

  // Keep the reader's place when a new message arrives while they are reading older messages.
  useEffect(() => {
    if (!atLatest) return;
    if (newest && newest > (seen || '')) apiService.markChannelRead(thread.channel, newest);
    else if (!newest && seen === undefined && !isPrivateChannel(thread.channel)) apiService.markChannelRead(thread.channel, new Date(0).toISOString());
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [atLatest, newest, seen, thread.channel]);

  useEffect(() => {
    const uploads = runningUploads.current;
    return () => { for (const abort of uploads.values()) abort(); uploads.clear(); };
  }, []);

  const uploadAttachment = (key: string, file: File) => {
    const upload = uploadFile<ChatAttachment>('/api/v1/chat/upload', file, (percent) => setPending((list) => list.map((p) => (p.key === key ? { ...p, percent } : p))));
    runningUploads.current.set(key, upload.abort);
    upload.promise
      .then((attachment) => setPending((list) => list.map((p) => (p.key === key ? { ...p, percent: 100, attachment } : p))))
      .catch((err) => setPending((list) => list.map((p) => (p.key === key ? { ...p, error: err?.message || 'فشل الرفع' } : p))))
      .finally(() => runningUploads.current.delete(key));
    return upload.abort;
  };

  const loadOlder = async () => {
    const first = shown[0]?.timestamp;
    if (!first) return;
    setOlderState('loading');
    try {
      const rows = await apiService.loadOlderMessages(thread.channel, first);
      const list = listRef.current;
      const height = list?.scrollHeight || 0;
      setOlder((current) => [...rows, ...current]);
      setOlderState(rows.length ? 'idle' : 'done');
      // Stay on the message the reader was looking at.
      requestAnimationFrame(() => list && (list.scrollTop = list.scrollHeight - height));
    } catch (err: any) {
      setError(err?.message || 'تعذر تحميل الرسائل الأقدم');
      setOlderState('idle');
    }
  };

  const addFiles = (files: FileList | null) => {
    setError(null);
    let slots = MAX_ATTACHMENTS - pending.length;
    for (const file of Array.from(files || [])) {
      if (slots === 0) {
        setError(`الحد الأقصى ${MAX_ATTACHMENTS} مرفقات في الرسالة`);
        break;
      }
      if (!Object.prototype.hasOwnProperty.call(CHAT_UPLOAD_TYPES, file.type)) {
        setError(`نوع الملف «${file.name}» غير مدعوم. المدعوم: صور، فيديو، صوت، PDF ومستندات Office.`);
        continue;
      }
      const key = `${file.name}:${file.size}:${Date.now()}:${Math.random()}`;
      const abort = uploadAttachment(key, file);
      setPending((list) => [...list, { key, file, name: file.name, percent: 0, abort }]);
      slots--;
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const ready = pending.filter((p) => p.attachment).map((p) => p.attachment!);
  const canSend = ready.length === pending.length && (!!text.trim() || ready.length > 0 || !!ref);

  const send = () => {
    if (!canSend) return;
    try {
      apiService.sendMessage(thread.channel, text.trim() || (ref && !ready.length ? ref.title : ''), urgent, { attachments: ready, ref: ref || undefined });
      updateDraft('');
      setUrgent(false);
      setPending([]);
      setRef(null);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'تعذر إرسال الرسالة');
    }
  };

  let lastDay = '';
  return (
    <section
      ref={sectionRef}
      aria-label={`محادثة ${thread.name}`}
      className="flex flex-col min-w-0 min-h-0 h-[calc(100dvh-9rem)] @4xl:h-auto"
      style={keyboardHeight !== null ? { height: keyboardHeight } : undefined}
    >
      <header className="shrink-0 flex items-center gap-3 px-3 py-2.5 border-b border-slate-200">
        <button type="button" onClick={onBack} aria-label="العودة إلى المحادثات" className={`${ICON_BTN} @4xl:hidden`}>
          <ArrowRight className="w-4 h-4" />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold text-slate-900 truncate">{thread.name}</h2>
          <p className="text-xs text-slate-600 truncate">
            {group ? group.memberIds.map((id) => userById.get(id)?.fullName).filter(Boolean).join('، ') : thread.kind === 'dm' ? thread.hint || 'رسالة مباشرة' : `${thread.hint} — مفتوحة لكل الزملاء`}
          </p>
        </div>
        {onGroupSettings && (
          <button type="button" onClick={onGroupSettings} aria-label="إعدادات المجموعة وأعضاؤها" className={ICON_BTN}>
            <Settings2 className="w-4 h-4" />
          </button>
        )}
      </header>

      <div ref={listRef} role="log" aria-live={atLatest ? 'polite' : 'off'} aria-label="الرسائل" tabIndex={0}
        onScroll={(e) => {
          const list = e.currentTarget;
          setAtLatest(list.scrollHeight - list.scrollTop - list.clientHeight < 48);
        }}
        className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-2 bg-slate-50">
        {shown.length > 0 && olderState !== 'done' && (
          <div className="text-center">
            <button type="button" disabled={olderState === 'loading'} onClick={loadOlder} className="min-h-9 px-3 rounded-lg text-xs font-bold text-blue-700 hover:bg-blue-50 disabled:opacity-50">
              {olderState === 'loading' ? 'جارٍ التحميل…' : 'تحميل رسائل أقدم'}
            </button>
          </div>
        )}
        {shown.length === 0 && <p className="text-center text-xs text-slate-500 py-10">لا رسائل بعد. اكتب أول رسالة.</p>}
        {shown.map((m) => {
          const mine = m.userId === me;
          const day = m.timestamp ? stationDay(m.timestamp) : '';
          const newDay = day !== lastDay;
          lastDay = day;
          return (
            <React.Fragment key={m.id}>
              {newDay && day && (
                <p className="text-center text-2xs font-bold text-slate-500 py-1">{formatDay(day)}</p>
              )}
              <div className={`flex ${mine ? 'justify-start' : 'justify-end'}`}>
                <div className={`max-w-[85%] sm:max-w-[70%] rounded-2xl px-3 py-2 space-y-1.5 border ${mine ? 'bg-blue-600 border-blue-600 text-white' : m.isUrgent ? 'bg-red-50 border-red-300 text-slate-900' : 'bg-white border-slate-200 text-slate-900'}`}>
                  {!mine && thread.kind !== 'dm' && <p className="text-2xs font-bold text-slate-600">{m.userName}</p>}
                  {m.isUrgent && <span className={`inline-block px-1.5 py-0.5 rounded text-3xs font-bold ${mine ? 'bg-white text-red-700' : 'bg-red-600 text-white'}`}>عاجل</span>}
                  {m.text && <p className="text-sm whitespace-pre-wrap break-words leading-6">{m.text}</p>}
                  {m.ref && (
                    <button type="button" onClick={() => onOpenLink(chatRefLink(m.ref!))} className={`w-full text-right flex items-center gap-2 px-2.5 py-2 rounded-xl border text-xs font-bold ${mine ? 'bg-blue-700 border-blue-500 text-white' : 'bg-slate-50 border-slate-200 text-blue-700'}`}>
                      <Link2 className="w-3.5 h-3.5 shrink-0" />
                      <span className="min-w-0">
                        <span className={`block text-2xs font-normal ${mine ? 'text-white' : 'text-slate-600'}`}>{CHAT_REF_KINDS.find((k) => k.id === m.ref!.kind)?.name}</span>
                        <span className="block truncate">{m.ref.title}</span>
                      </span>
                    </button>
                  )}
                  {(m.attachments || []).map((a) =>
                    a.mimeType.startsWith('image/') ? (
                      <a key={a.id} href={chatFileUrl(a)} target="_blank" rel="noopener noreferrer" className="block">
                        <img src={chatFileUrl(a)} alt={a.name} loading="lazy" className="max-h-64 w-auto rounded-xl border border-black/10" />
                      </a>
                    ) : (
                      <a key={a.id} href={chatFileUrl(a)} target="_blank" rel="noopener noreferrer" className={`flex items-center gap-2 px-2.5 py-2 rounded-xl border text-xs ${mine ? 'bg-blue-700 border-blue-500 text-white' : 'bg-slate-50 border-slate-200 text-slate-800'}`}>
                        <FileText className="w-4 h-4 shrink-0" />
                        <span className="min-w-0 flex-1">
                          <span className="block font-bold truncate">{a.name}</span>
                          <span className={mine ? 'text-white' : 'text-slate-600'}>{sizeLabel(a.size)}</span>
                        </span>
                        <Download className="w-4 h-4 shrink-0" />
                      </a>
                    )
                  )}
                  <p className={`text-2xs tabular-nums ${mine ? 'text-white' : 'text-slate-500'}`}>{timeOnly(m.timestamp)}</p>
                </div>
              </div>
            </React.Fragment>
          );
        })}
      </div>
      {!atLatest && <button type="button" className="min-h-10 self-center px-4 text-xs font-bold text-blue-700 hover:underline" onClick={() => {
        if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
        setAtLatest(true);
      }}>الانتقال إلى أحدث الرسائل</button>}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="shrink-0 border-t border-slate-200 p-3 space-y-2 bg-white"
      >
        {error && <p role="alert" className="text-xs font-bold text-rose-700">{error}</p>}
        {(pending.length > 0 || ref) && (
          // Many attachments scroll inside this strip instead of pushing the text box off screen.
          <ul aria-label="المرفقات" className="flex flex-wrap gap-2 max-h-20 overflow-y-auto overscroll-contain">
            {ref && (
              <li className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-blue-200 bg-blue-50 text-xs text-blue-800 max-w-full">
                <Link2 className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{ref.title}</span>
                <button type="button" onClick={() => setRef(null)} aria-label="إزالة الإشارة" className="p-0.5"><X className="w-3.5 h-3.5" /></button>
              </li>
            )}
            {pending.map((p) => (
              <li key={p.key} className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs max-w-full ${p.error ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>
                <Paperclip className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{p.name}</span>
                <span className="shrink-0 tabular-nums">{p.error || (p.attachment ? 'جاهز' : `${p.percent}%`)}</span>
                {p.error && <button type="button" aria-label={`إعادة رفع ${p.name}`} className="min-h-8 px-1 font-bold underline" onClick={() => {
                  const abort = uploadAttachment(p.key, p.file);
                  setPending((list) => list.map((entry) => entry.key === p.key ? { ...entry, error: undefined, percent: 0, abort } : entry));
                }}>إعادة الرفع</button>}
                <button
                  type="button"
                  onClick={() => {
                    if (!p.attachment && !p.error) p.abort?.();
                    setPending((list) => list.filter((x) => x.key !== p.key));
                  }}
                  aria-label={`إزالة ${p.name}`}
                  className="p-0.5"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-end gap-2">
          <input ref={fileRef} type="file" multiple hidden accept={Object.keys(CHAT_UPLOAD_TYPES).join(',')} onChange={(e) => addFiles(e.target.files)} />
          <button type="button" onClick={() => fileRef.current?.click()} aria-label="إرفاق ملف" className={ICON_BTN}>
            <Paperclip className="w-4 h-4" />
          </button>
          <button type="button" onClick={() => setRefOpen(true)} aria-label="إشارة إلى خبر أو مادة" className={ICON_BTN}>
            <AtSign className="w-4 h-4" />
          </button>
          <label htmlFor="chat-text" className="sr-only">نص الرسالة</label>
          <textarea
            id="chat-text"
            rows={1}
            value={text}
            maxLength={MAX_MESSAGE_CHARS}
            onChange={(e) => updateDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="اكتب رسالة…"
            className={`${INPUT} resize-none max-h-32 min-h-11`}
          />
          <button type="submit" disabled={!canSend} aria-label="إرسال" className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-xl bg-blue-600 text-white disabled:opacity-50">
            <Send className="w-4 h-4" />
          </button>
        </div>
        <div className={`flex flex-wrap items-center justify-between gap-x-4 ${keyboardHeight !== null && !urgent ? 'hidden' : ''}`}>
          <label className="inline-flex items-center gap-2 min-h-11 text-xs text-slate-700">
            <input type="checkbox" className="w-4 h-4" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} />
            رسالة عاجلة (تصل حتى في ساعات الهدوء)
          </label>
          <span className="hidden sm:inline text-2xs text-slate-500">Enter للإرسال، Shift+Enter لسطر جديد</span>
        </div>
      </form>

      <RefPicker isOpen={refOpen} onClose={() => setRefOpen(false)} onPick={(picked) => (setRef(picked), setRefOpen(false))} canSeeCards={RbacService.hasPermission(currentUser, 'cards.view')} />
    </section>
  );
};

const RefPicker: React.FC<{ isOpen: boolean; onClose: () => void; onPick: (ref: ChatRef) => void; canSeeCards: boolean }> = ({ isOpen, onClose, onPick, canSeeCards }) => {
  const [query, setQuery] = useState('');
  useEffect(() => setQuery(''), [isOpen]);
  const results = useMemo(() => {
    if (!isOpen) return [];
    const rows: ChatRef[] = [
      ...apiService.getNews().filter((n) => !n.deletedAt).map((n) => ({ kind: 'news' as const, id: n.id, title: n.title || 'خبر بلا عنوان' })),
      ...(canSeeCards ? apiService.getCards().map((c) => ({ kind: 'card' as const, id: c.id, title: c.title })) : []),
      ...apiService.getBulletins().map((b) => ({ kind: 'bulletin' as const, id: b.id, title: `${b.title} ${b.date || ''}`.trim() })),
      ...apiService.getEpisodes().filter((e) => !e.deletedAt).map((e) => ({ kind: 'episode' as const, id: e.id, title: `${e.programName ? `${e.programName} — ` : ''}${e.title}` })),
    ];
    return rows.filter((r) => matchesQuery(query, r.title)).slice(0, 30);
  }, [isOpen, query, canSeeCards]);
  return (
    <FormPage isOpen={isOpen} onClose={onClose} title="إشارة إلى مادة" subtitle="يظهر في الرسالة رابط يفتح المادة مباشرة لمن يملك صلاحية رؤيتها" maxWidth="md">
      <div className="space-y-3">
        <input type="search" data-autofocus aria-label="بحث في الأخبار والبطاقات والنشرات والحلقات" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="عنوان الخبر أو البطاقة أو النشرة أو الحلقة…" className={INPUT} />
        {results.length === 0 && <p className="text-xs text-slate-500 py-6 text-center">لا مواد تطابق البحث.</p>}
        <ul className="space-y-1">
          {results.map((r) => (
            <li key={`${r.kind}:${r.id}`}>
              <button type="button" onClick={() => onPick(r)} className="w-full text-right flex items-center gap-3 px-3 py-2 rounded-xl border border-transparent hover:bg-slate-50 hover:border-slate-200">
                <span className="shrink-0 px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-2xs font-bold">{CHAT_REF_KINDS.find((k) => k.id === r.kind)?.name}</span>
                <span className="text-sm font-bold text-slate-900 truncate">{r.title}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </FormPage>
  );
};
