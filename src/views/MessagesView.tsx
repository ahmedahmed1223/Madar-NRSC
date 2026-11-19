import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, AtSign, Download, FileText, Hash, Link2, MessagesSquare, Paperclip, Plus, Send, Settings2, Users, X } from 'lucide-react';
import type { User } from '../types';
import { apiService } from '../services/api';
import { dataStore } from '../services/dataStore';
import { RbacService } from '../services/rbacService';
import { uploadFile } from '../services/mediaUpload';
import { confirmDialog } from '../services/dialogs';
import { Avatar } from '../components/common/Avatar';
import { FormPage } from '../components/common/FormPage';
import { stationDay, timeOnly } from '../components/cards/cardUi';
import { formatDay } from '../shared/dateFormat';
import { DEPARTMENTS, departmentIdOf, departmentName } from '../shared/departments';
import { matchesQuery } from '../shared/search';
import { stationName, stationsOf } from '../shared/stations';
import {
  CHAT_REF_KINDS,
  CHAT_UPLOAD_TYPES,
  MAX_ATTACHMENTS,
  MAX_MESSAGE_CHARS,
  chatFileUrl,
  chatRefLink,
  dmChannel,
  groupChannel,
  isPrivateChannel,
  parseChannel,
  stationChannel,
  unreadByChannel,
  type ChatAttachment,
  type ChatMessage,
  type ChatRef,
  type Conversation,
} from '../shared/chat';

interface MessagesViewProps {
  currentUser: User;
  users: User[];
  /** Conversation in the address (/messages/<channel>). */
  channel?: string | null;
  onChannel: (channel: string | null) => void;
  /** Opens a record a message points at. */
  onOpenLink: (path: string) => void;
}

interface Thread {
  channel: string;
  name: string;
  /** Second line: role, member count or what the channel is for. */
  hint: string;
  kind: 'dm' | 'group' | 'channel';
  avatar?: { src?: string; name: string };
  last?: ChatMessage;
}

const INPUT = 'w-full px-3 py-2 border border-slate-300 rounded-xl bg-white text-sm text-slate-900';
const ICON_BTN = 'min-h-11 min-w-11 inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50';
const sizeLabel = (bytes: number) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} م.ب` : `${Math.max(1, Math.round(bytes / 1024))} ك.ب`);
const preview = (m?: ChatMessage) => (!m ? '' : m.text || (m.attachments?.length ? `مرفق: ${m.attachments[0].name}` : m.ref ? m.ref.title : ''));

/** Messaging: direct conversations, groups, and the open channels of the newsroom, stations and departments. */
export const MessagesView: React.FC<MessagesViewProps> = ({ currentUser, users, channel, onChannel, onOpenLink }) => {
  const me = currentUser.id;
  const [version, setVersion] = useState(0);
  const [query, setQuery] = useState('');
  const [picking, setPicking] = useState(false);
  const [groupForm, setGroupForm] = useState<Conversation | 'new' | null>(null);
  const [showAllChannels, setShowAllChannels] = useState(false);

  useEffect(
    () =>
      dataStore.subscribe((evt) => {
        if (evt.type === 'data-changed' && evt.collections.some((c) => ['messages', 'conversations', 'chatReads', 'users', 'settings'].includes(c))) setVersion((v) => v + 1);
      }),
    []
  );

  const messages = useMemo(() => apiService.getMessages(), [version]);
  const conversations = useMemo(() => apiService.getConversations(), [version]);
  const reads = useMemo(() => apiService.getChatReads(), [version]);
  const stations = useMemo(() => stationsOf(apiService.getSettings()), [version]);
  const userById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const unread = useMemo(() => unreadByChannel(messages, reads, me), [messages, reads, me]);
  const lastByChannel = useMemo(() => {
    const map = new Map<string, ChatMessage>();
    for (const m of messages) map.set(m.channel, m);
    return map;
  }, [messages]);

  const myDept = departmentIdOf(currentUser);
  const threads = useMemo(() => {
    const dms = new Map<string, Thread>();
    const addDm = (id: string) => {
      const other = userById.get(id);
      const ch = dmChannel(me, id);
      if (id !== me && !dms.has(ch)) dms.set(ch, { channel: ch, kind: 'dm', name: other?.fullName || 'زميل سابق', hint: other?.jobTitle || '', avatar: { src: other?.avatarUrl, name: other?.fullName || '' }, last: lastByChannel.get(ch) });
    };
    for (const m of messages) {
      const parsed = parseChannel(m.channel);
      if (parsed?.kind === 'dm') addDm(parsed.userIds.find((id) => id !== me) || '');
    }
    // A conversation opened from the address or the picker shows up before its first message.
    const open = parseChannel(channel);
    if (open?.kind === 'dm' && open.userIds.includes(me)) addDm(open.userIds.find((id) => id !== me) || '');
    const groups: Thread[] = conversations.map((c) => ({ channel: groupChannel(c.id), kind: 'group', name: c.name, hint: `${c.memberIds.length} أعضاء`, last: lastByChannel.get(groupChannel(c.id)) }));
    const byRecent = (a: Thread, b: Thread) => (b.last?.timestamp || '').localeCompare(a.last?.timestamp || '') || a.name.localeCompare(b.name, 'ar');
    const priv = [...dms.values(), ...groups].sort(byRecent);

    const channelThread = (id: string, name: string, hint: string): Thread => ({ channel: id, kind: 'channel', name, hint, last: lastByChannel.get(id) });
    const mine: Thread[] = [
      channelThread('general', 'عام', 'كل الزملاء في كل المحطات'),
      ...(stations.some((s) => s.id === currentUser.stationId) ? [channelThread(stationChannel(currentUser.stationId!), `محطة ${stationName(stations, currentUser.stationId)}`, 'قناة محطتي')] : []),
      channelThread(myDept, departmentName(myDept), 'قناة قسمي'),
    ];
    const others: Thread[] = [
      ...stations.filter((s) => s.id !== currentUser.stationId).map((s) => channelThread(stationChannel(s.id), `محطة ${s.name}`, 'قناة محطة')),
      ...DEPARTMENTS.filter((d) => d.id !== myDept).map((d) => channelThread(d.id, d.name, 'قناة قسم')),
    ];
    return { priv, mine, others };
  }, [messages, conversations, lastByChannel, userById, stations, currentUser.stationId, myDept, me, channel]);

  const all = [...threads.priv, ...threads.mine, ...threads.others];
  const active = channel ? all.find((t) => t.channel === channel) : undefined;
  const activeGroup = active?.kind === 'group' ? conversations.find((c) => groupChannel(c.id) === active.channel) : undefined;
  const filter = (list: Thread[]) => list.filter((t) => matchesQuery(query, t.name, t.hint));
  const othersOpen = showAllChannels || !!query.trim() || threads.others.some((t) => t.channel === channel);

  const threadButton = (t: Thread) => {
    const count = unread.get(t.channel) || 0;
    return (
      <li key={t.channel}>
        <button type="button" onClick={() => onChannel(t.channel)} aria-current={t.channel === channel ? 'page' : undefined} className={`w-full text-right flex items-center gap-3 px-3 py-2.5 rounded-xl ${t.channel === channel ? 'bg-blue-50 border border-blue-200' : 'border border-transparent hover:bg-slate-50'}`}>
          {t.kind === 'dm' ? (
            <Avatar src={t.avatar?.src} name={t.avatar?.name} className="w-9 h-9 rounded-full shrink-0 text-xs" />
          ) : (
            <span className={`w-9 h-9 rounded-full shrink-0 flex items-center justify-center ${t.kind === 'group' ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-600'}`}>{t.kind === 'group' ? <Users className="w-4 h-4" /> : <Hash className="w-4 h-4" />}</span>
          )}
          <span className="min-w-0 flex-1">
            <span className="flex items-center justify-between gap-2">
              <span className={`text-sm truncate ${count ? 'font-bold text-slate-900' : 'font-bold text-slate-800'}`}>{t.name}</span>
              {t.last?.timestamp && <span className="text-2xs text-slate-500 shrink-0 tabular-nums">{stationDay(t.last.timestamp) === stationDay(Date.now()) ? timeOnly(t.last.timestamp) : formatDay(stationDay(t.last.timestamp))}</span>}
            </span>
            <span className="flex items-center justify-between gap-2">
              <span className="text-xs text-slate-600 truncate">{t.last ? `${t.last.userId === me ? 'أنت: ' : t.kind === 'dm' ? '' : `${t.last.userName || ''}: `}${preview(t.last)}` : t.hint}</span>
              {count > 0 && <span className="shrink-0 min-w-5 h-5 px-1.5 rounded-full bg-blue-600 text-white text-2xs font-bold flex items-center justify-center tabular-nums">{count > 99 ? '99+' : count}</span>}
            </span>
          </span>
        </button>
      </li>
    );
  };

  const section = (title: string, list: Thread[], empty?: string) => {
    const shown = filter(list);
    if (!shown.length && !empty) return null;
    return (
      <div>
        <h2 className="px-3 pt-3 pb-1 text-2xs font-bold text-slate-500">{title}</h2>
        {shown.length ? <ul className="space-y-0.5">{shown.map(threadButton)}</ul> : <p className="px-3 py-2 text-xs text-slate-500">{empty}</p>}
      </div>
    );
  };

  return (
    <div className="@container space-y-3">
      <div className={`${channel ? 'hidden @4xl:flex' : 'flex'} flex-col justify-between gap-3`}>
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <MessagesSquare className="w-5 h-5 text-blue-600" />
            المراسلات
          </h1>
          <p className="text-xs text-slate-500 mt-1">رسائل مباشرة ومجموعات وقنوات مفتوحة للمحطات والأقسام، مع الملفات والإشارة إلى مواد النظام.</p>
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] @4xl:grid-cols-[20rem_minmax(0,1fr)] bg-white border border-slate-200 rounded-2xl overflow-hidden @4xl:h-[calc(100dvh-13rem)] @4xl:min-h-[30rem]">
        <nav aria-label="المحادثات" className={`${channel ? 'hidden @4xl:flex' : 'flex'} flex-col min-w-0 min-h-0 @4xl:border-l border-slate-200`}>
          <div className="p-3 space-y-2 border-b border-slate-200">
            <div className="flex gap-2">
              <button type="button" data-tour="message-new" onClick={() => setPicking(true)} className="flex-1 min-h-11 inline-flex items-center justify-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold">
                <Plus className="w-4 h-4" />
                رسالة جديدة
              </button>
              {RbacService.hasPermission(currentUser, 'messages.groups') && (
                <button type="button" data-tour="group-new" onClick={() => setGroupForm('new')} className="flex-1 min-h-11 inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white text-slate-700 text-xs font-bold hover:bg-slate-50">
                  <Users className="w-4 h-4" />
                  مجموعة جديدة
                </button>
              )}
            </div>
            <input type="search" aria-label="بحث في المحادثات" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="بحث باسم زميل أو مجموعة أو قناة…" className={INPUT} />
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-1.5 pb-4">
            {section('الرسائل المباشرة والمجموعات', threads.priv, query ? 'لا نتائج.' : 'لا محادثات بعد. ابدأ من «رسالة جديدة».')}
            {section('قنواتي', threads.mine)}
            {othersOpen ? (
              section('قنوات المحطات والأقسام', threads.others)
            ) : (
              <button type="button" onClick={() => setShowAllChannels(true)} className="mx-3 mt-3 min-h-9 text-xs font-bold text-blue-700 hover:underline">
                عرض قنوات باقي المحطات والأقسام ({threads.others.length})
              </button>
            )}
          </div>
        </nav>

        {active ? (
          <ThreadPane
            key={active.channel}
            thread={active}
            group={activeGroup}
            currentUser={currentUser}
            userById={userById}
            messages={messages}
            seen={reads?.seen?.[active.channel]}
            onBack={() => onChannel(null)}
            onOpenLink={onOpenLink}
            onGroupSettings={activeGroup ? () => setGroupForm(activeGroup) : undefined}
          />
        ) : (
          <div className="hidden @4xl:flex flex-col items-center justify-center gap-2 text-center p-8">
            <MessagesSquare className="w-10 h-10 text-slate-300" />
            <p className="text-sm font-bold text-slate-700">{channel ? 'هذه المحادثة غير متاحة لك.' : 'اختر محادثة أو ابدأ رسالة جديدة.'}</p>
            <p className="text-xs text-slate-500 max-w-sm">الرسائل المباشرة يقرؤها طرفاها فقط، ورسائل المجموعة أعضاؤها. القنوات مفتوحة لكل الزملاء.</p>
          </div>
        )}
      </div>

      <PersonPicker
        isOpen={picking}
        onClose={() => setPicking(false)}
        users={users.filter((u) => u.id !== me && u.isActive !== false && !u.deletedAt)}
        stations={stations}
        onPick={(id) => {
          setPicking(false);
          onChannel(dmChannel(me, id));
        }}
      />
      <GroupForm
        group={groupForm}
        onClose={() => setGroupForm(null)}
        currentUser={currentUser}
        users={users.filter((u) => u.isActive !== false && !u.deletedAt)}
        stations={stations}
        onSaved={(group) => onChannel(groupChannel(group.id))}
        onGone={() => onChannel(null)}
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// One conversation
// ---------------------------------------------------------------------------

interface ThreadPaneProps {
  thread: Thread;
  group?: Conversation;
  currentUser: User;
  userById: Map<string, User>;
  messages: ChatMessage[];
  seen?: string;
  onBack: () => void;
  onOpenLink: (path: string) => void;
  onGroupSettings?: () => void;
}

interface Pending {
  key: string;
  name: string;
  percent: number;
  attachment?: ChatAttachment;
  error?: string;
  abort?: () => void;
}

const ThreadPane: React.FC<ThreadPaneProps> = ({ thread, group, currentUser, userById, messages, seen, onBack, onOpenLink, onGroupSettings }) => {
  const me = currentUser.id;
  const [text, setText] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]);
  const [ref, setRef] = useState<ChatRef | null>(null);
  const [refOpen, setRefOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [older, setOlder] = useState<ChatMessage[]>([]);
  const [olderState, setOlderState] = useState<'idle' | 'loading' | 'done'>('idle');
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const recent = useMemo(() => messages.filter((m) => m.channel === thread.channel), [messages, thread.channel]);
  const shown = useMemo(() => {
    const ids = new Set(recent.map((m) => m.id));
    return [...older.filter((m) => !ids.has(m.id)), ...recent];
  }, [older, recent]);
  const newest = recent[recent.length - 1]?.timestamp;

  // Reading a conversation moves my marker (shared by my devices) and keeps the newest message in view.
  useEffect(() => {
    if (newest && newest > (seen || '')) apiService.markChannelRead(thread.channel, newest);
    else if (!newest && seen === undefined && !isPrivateChannel(thread.channel)) apiService.markChannelRead(thread.channel, new Date(0).toISOString());
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [newest, seen, thread.channel]);

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
    for (const file of Array.from(files || [])) {
      if (pending.length >= MAX_ATTACHMENTS) {
        setError(`الحد الأقصى ${MAX_ATTACHMENTS} مرفقات في الرسالة`);
        break;
      }
      if (!Object.prototype.hasOwnProperty.call(CHAT_UPLOAD_TYPES, file.type)) {
        setError(`نوع الملف «${file.name}» غير مدعوم. المدعوم: صور، فيديو، صوت، PDF ومستندات Office.`);
        continue;
      }
      const key = `${file.name}:${file.size}:${Date.now()}:${Math.random()}`;
      const upload = uploadFile<ChatAttachment>('/api/v1/chat/upload', file, (percent) => setPending((list) => list.map((p) => (p.key === key ? { ...p, percent } : p))));
      setPending((list) => [...list, { key, name: file.name, percent: 0, abort: upload.abort }]);
      upload.promise
        .then((attachment) => setPending((list) => list.map((p) => (p.key === key ? { ...p, percent: 100, attachment } : p))))
        .catch((err) => setPending((list) => list.map((p) => (p.key === key ? { ...p, error: err?.message || 'فشل الرفع' } : p))));
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const uploading = pending.some((p) => !p.attachment && !p.error);
  const ready = pending.filter((p) => p.attachment).map((p) => p.attachment!);
  const canSend = !uploading && (!!text.trim() || ready.length > 0 || !!ref);

  const send = () => {
    if (!canSend) return;
    try {
      apiService.sendMessage(thread.channel, text.trim() || (ref && !ready.length ? ref.title : ''), urgent, { attachments: ready, ref: ref || undefined });
      setText('');
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
    <section aria-label={`محادثة ${thread.name}`} className="flex flex-col min-w-0 min-h-0 h-[calc(100dvh-9rem)] @4xl:h-auto">
      <header className="flex items-center gap-3 px-3 py-2.5 border-b border-slate-200">
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

      <div ref={listRef} role="log" aria-live="polite" aria-label="الرسائل" tabIndex={0} className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-2 bg-slate-50">
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

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="border-t border-slate-200 p-3 space-y-2"
      >
        {error && <p role="alert" className="text-xs font-bold text-rose-700">{error}</p>}
        {(pending.length > 0 || ref) && (
          <ul className="flex flex-wrap gap-2">
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
            onChange={(e) => setText(e.target.value)}
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
        <div className="flex flex-wrap items-center justify-between gap-x-4">
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

// ---------------------------------------------------------------------------
// Pickers and the group form
// ---------------------------------------------------------------------------

const PersonPicker: React.FC<{ isOpen: boolean; onClose: () => void; users: User[]; stations: { id: string; name: string }[]; onPick: (userId: string) => void }> = ({ isOpen, onClose, users, stations, onPick }) => {
  const [query, setQuery] = useState('');
  useEffect(() => setQuery(''), [isOpen]);
  const list = users.filter((u) => matchesQuery(query, u.fullName, u.fullNameEn, u.jobTitle, stationName(stations, u.stationId))).slice(0, 60);
  return (
    <FormPage isOpen={isOpen} onClose={onClose} title="رسالة جديدة" subtitle="اختر الزميل؛ الرسائل المباشرة يقرؤها طرفاها فقط" maxWidth="md">
      <div className="space-y-3">
        <input type="search" data-autofocus aria-label="بحث عن زميل" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="الاسم، المسمى أو المحطة…" className={INPUT} />
        {list.length === 0 && <p className="text-xs text-slate-500 py-6 text-center">لا زملاء يطابقون البحث.</p>}
        <ul className="space-y-1">
          {list.map((u) => (
            <li key={u.id}>
              <button type="button" onClick={() => onPick(u.id)} className="w-full text-right flex items-center gap-3 px-3 py-2 rounded-xl border border-transparent hover:bg-slate-50 hover:border-slate-200">
                <Avatar src={u.avatarUrl} name={u.fullName} className="w-9 h-9 rounded-full shrink-0 text-xs" />
                <span className="min-w-0">
                  <span className="block text-sm font-bold text-slate-900 truncate">{u.fullName}</span>
                  <span className="block text-xs text-slate-600 truncate">{u.jobTitle}{u.stationId ? ` — ${stationName(stations, u.stationId)}` : ''}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </FormPage>
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

interface GroupFormProps {
  group: Conversation | 'new' | null;
  onClose: () => void;
  currentUser: User;
  users: User[];
  stations: { id: string; name: string }[];
  onSaved: (group: Conversation) => void;
  /** I left the group or deleted it. */
  onGone: () => void;
}

const GroupForm: React.FC<GroupFormProps> = ({ group, onClose, currentUser, users, stations, onSaved, onGone }) => {
  const existing = group && group !== 'new' ? group : null;
  const owner = !existing || existing.ownerId === currentUser.id;
  const [name, setName] = useState('');
  const [members, setMembers] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(existing?.name || '');
    setMembers(existing?.memberIds || [currentUser.id]);
    setQuery('');
    setError(null);
    // Filled when the form opens for a group.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group]);

  const attempt = (fn: () => void) => {
    try {
      fn();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'تعذر الحفظ');
    }
  };
  const list = users.filter((u) => matchesQuery(query, u.fullName, u.jobTitle, stationName(stations, u.stationId)));

  return (
    <FormPage isOpen={!!group} onClose={onClose} title={existing ? (owner ? 'إعدادات المجموعة' : existing.name) : 'مجموعة جديدة'} subtitle="رسائل المجموعة يقرؤها أعضاؤها فقط؛ من يُضاف لاحقاً يرى ما يُرسل بعد انضمامه" maxWidth="lg">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          attempt(() => onSaved(apiService.saveConversation({ id: existing?.id, name, memberIds: members })));
        }}
        className="space-y-4"
      >
        {owner ? (
          <div>
            <label htmlFor="group-name" className="block text-sm font-bold text-slate-700 mb-1">اسم المجموعة *</label>
            <input id="group-name" data-autofocus required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: تغطية غزة — فريق المساء" className={INPUT} />
          </div>
        ) : (
          <p className="text-sm text-slate-700">أنشأها {existing?.ownerName}. يعدّل اسمها وأعضاءها منشئها.</p>
        )}

        <fieldset className="space-y-2">
          <legend className="text-sm font-bold text-slate-700">الأعضاء ({members.length})</legend>
          {owner && <input type="search" aria-label="بحث عن زميل" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="بحث بالاسم أو المحطة…" className={INPUT} />}
          <ul className="max-h-72 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100">
            {(owner ? list : users.filter((u) => members.includes(u.id))).map((u) => (
              <li key={u.id}>
                <label className="flex items-center gap-3 px-3 py-2 min-h-11">
                  {owner && <input type="checkbox" checked={members.includes(u.id)} disabled={u.id === currentUser.id} onChange={() => setMembers((ids) => (ids.includes(u.id) ? ids.filter((x) => x !== u.id) : [...ids, u.id]))} />}
                  <span className="min-w-0">
                    <span className="block text-sm font-bold text-slate-900 truncate">{u.fullName}{u.id === existing?.ownerId ? ' (المنشئ)' : ''}</span>
                    <span className="block text-xs text-slate-600 truncate">{u.jobTitle}{u.stationId ? ` — ${stationName(stations, u.stationId)}` : ''}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>

        {error && <p role="alert" className="text-sm font-bold text-rose-700">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2 pt-3 border-t border-slate-100">
          {existing && owner && (
            <button
              type="button"
              onClick={async () => (await confirmDialog({ title: 'حذف المجموعة', message: `حذف «${existing.name}»؟ تبقى الرسائل السابقة عند من استلمها ولا يمكن الإرسال بعدها.`, confirmLabel: 'حذف المجموعة', cancelLabel: 'تراجع', danger: true })) && attempt(() => (apiService.deleteConversation(existing.id), onGone()))}
              className="min-h-11 px-4 rounded-xl border border-rose-200 text-rose-700 text-sm font-bold ml-auto"
            >
              حذف المجموعة
            </button>
          )}
          {existing && !owner && (
            <button
              type="button"
              onClick={async () => (await confirmDialog({ title: 'مغادرة المجموعة', message: `مغادرة «${existing.name}»؟ لن تصلك رسائلها الجديدة.`, confirmLabel: 'مغادرة', cancelLabel: 'تراجع' })) && attempt(() => (apiService.leaveConversation(existing.id), onGone()))}
              className="min-h-11 px-4 rounded-xl border border-rose-200 text-rose-700 text-sm font-bold ml-auto"
            >
              مغادرة المجموعة
            </button>
          )}
          <button type="button" onClick={onClose} className="min-h-11 px-4 rounded-xl text-sm text-slate-600 hover:bg-slate-100">{owner ? 'إلغاء' : 'إغلاق'}</button>
          {owner && <button type="submit" className="min-h-11 px-5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold">{existing ? 'حفظ' : 'إنشاء المجموعة'}</button>}
        </div>
      </form>
    </FormPage>
  );
};
