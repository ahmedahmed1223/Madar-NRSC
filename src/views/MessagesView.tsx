import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Hash, MessagesSquare, Plus, Users } from 'lucide-react';
import type { User } from '../types';
import { apiService } from '../services/api';
import { dataStore } from '../services/dataStore';
import { RbacService } from '../services/rbacService';
import { confirmDialog } from '../services/dialogs';
import { Avatar } from '../components/common/Avatar';
import { FormPage } from '../components/common/FormPage';
import { ThreadPane, type MessageThread as Thread } from '../components/messages/ThreadPane';
import { stationDay, timeOnly } from '../components/cards/cardUi';
import { formatDay } from '../shared/dateFormat';
import { DEPARTMENTS, departmentIdOf, departmentName } from '../shared/departments';
import { matchesQuery } from '../shared/search';
import { stationName, stationsOf } from '../shared/stations';
import {
  dmChannel,
  groupChannel,
  parseChannel,
  stationChannel,
  unreadByChannel,
  type ChatMessage,
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

const INPUT = 'w-full px-3 py-2 border border-slate-300 rounded-xl bg-white text-sm text-slate-900';
const preview = (m?: ChatMessage) => (!m ? '' : m.text || (m.attachments?.length ? `مرفق: ${m.attachments[0].name}` : m.ref ? m.ref.title : ''));

/** Messaging: direct conversations, groups, and the open channels of the newsroom, stations and departments. */
export const MessagesView: React.FC<MessagesViewProps> = ({ currentUser, users, channel, onChannel, onOpenLink }) => {
  const me = currentUser.id;
  const [version, setVersion] = useState(0);
  const [query, setQuery] = useState('');
  const [picking, setPicking] = useState(false);
  const [groupForm, setGroupForm] = useState<Conversation | 'new' | null>(null);
  const [showAllChannels, setShowAllChannels] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const drafts = useRef(new Map<string, string>());
  const [draftChannels, setDraftChannels] = useState<string[]>([]);

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
    for (const id of new Set([...lastByChannel.keys(), ...draftChannels])) {
      const parsed = parseChannel(id);
      if (parsed?.kind === 'dm' && parsed.userIds.includes(me)) addDm(parsed.userIds.find((id) => id !== me) || '');
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
  }, [conversations, lastByChannel, draftChannels, userById, stations, currentUser.stationId, myDept, me, channel]);

  const all = [...threads.priv, ...threads.mine, ...threads.others];
  const active = channel ? all.find((t) => t.channel === channel) : undefined;
  const activeGroup = active?.kind === 'group' ? conversations.find((c) => groupChannel(c.id) === active.channel) : undefined;
  const filter = (list: Thread[]) => list.filter((t) => (!unreadOnly || !!unread.get(t.channel)) && matchesQuery(query, t.name, t.hint));
  const unreadThreads = all.filter((t) => unread.get(t.channel)).length;
  const othersOpen = showAllChannels || unreadOnly || !!query.trim() || threads.others.some((t) => t.channel === channel);

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
              <span className="text-xs text-slate-600 truncate">{draftChannels.includes(t.channel) ? 'مسودة' : t.last ? `${t.last.userId === me ? 'أنت: ' : t.kind === 'dm' ? '' : `${t.last.userName || ''}: `}${preview(t.last)}` : t.hint}</span>
              {count > 0 && <span className="shrink-0 min-w-5 h-5 px-1.5 rounded-full bg-blue-600 text-white text-2xs font-bold flex items-center justify-center tabular-nums"><span className="sr-only">رسائل غير مقروءة </span>{count > 99 ? '99+' : count}</span>}
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
      <div className={`${active ? 'hidden @4xl:flex' : 'flex'} flex-col justify-between gap-3`}>
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <MessagesSquare className="w-5 h-5 text-blue-600" />
            المراسلات
          </h1>
          <p className="text-xs text-slate-500 mt-1">رسائل مباشرة ومجموعات وقنوات مفتوحة للمحطات والأقسام، مع الملفات والإشارة إلى مواد النظام.</p>
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] @4xl:grid-cols-[20rem_minmax(0,1fr)] bg-white border border-slate-200 rounded-2xl overflow-hidden @4xl:h-[calc(100dvh-13rem)] @4xl:min-h-[30rem]">
        <nav aria-label="المحادثات" className={`${active ? 'hidden @4xl:flex' : 'flex'} flex-col min-w-0 min-h-0 @4xl:border-l border-slate-200`}>
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
            <div role="group" aria-label="تصفية المحادثات" className="flex gap-2">
              <button type="button" aria-pressed={!unreadOnly} onClick={() => setUnreadOnly(false)} className="min-h-10 rounded-lg border border-slate-200 px-3 text-xs font-bold aria-pressed:bg-blue-50 aria-pressed:text-blue-800">الكل</button>
              <button type="button" aria-pressed={unreadOnly} onClick={() => setUnreadOnly(true)} className="min-h-10 rounded-lg border border-slate-200 px-3 text-xs font-bold aria-pressed:bg-blue-50 aria-pressed:text-blue-800">غير مقروءة ({unreadThreads})</button>
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-1.5 pb-4">
            {unreadOnly && filter(all).length === 0 && <p role="status" className="px-3 py-4 text-xs text-slate-600">لا توجد محادثات غير مقروءة تطابق العرض.</p>}
            {section('الرسائل المباشرة والمجموعات', threads.priv, unreadOnly ? undefined : query ? 'لا نتائج.' : 'لا محادثات بعد. ابدأ من «رسالة جديدة».')}
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
            key={`${me}:${active.channel}`}
            thread={active}
            group={activeGroup}
            currentUser={currentUser}
            userById={userById}
            messages={messages}
            seen={reads?.seen?.[active.channel]}
            draftText={drafts.current.get(`${me}:${active.channel}`) || ''}
            onDraftText={(text) => {
              const key = `${me}:${active.channel}`;
              const hasDraft = drafts.current.has(key);
              if (text) drafts.current.set(key, text);
              else drafts.current.delete(key);
              if (hasDraft !== !!text) {
                setDraftChannels((list) => text ? [...list, active.channel] : list.filter((item) => item !== active.channel));
              }
            }}
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
