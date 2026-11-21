import { appLocale, zoneOptions } from '../../shared/dateFormat';
import { DEPARTMENTS, departmentIdOf } from '../../shared/departments';
import React, { useState, useEffect, useRef } from 'react';
import { Hash, MessagesSquare, Send, X } from 'lucide-react';
import { User as UserType } from '../../types';
import { apiService } from '../../services/api';
import { dataStore } from '../../services/dataStore';
import { intercomCommand, intercomState, navigateTo, routeChanged } from '../../services/uiEvents';
import { canonicalMessageChannel, isPrivateChannel, MAX_MESSAGE_CHARS, parseChannel, unreadByChannel } from '../../shared/chat';
import { clearSentMessageDraft, messagePosition, rememberMessagePosition, saveMessageDraft, scrollToMessage, selectPublicMessageChannel, useMessageWorkspace } from '../../services/messageWorkspace';
import { useLiveData } from '../../hooks/useLiveData';
import { PinnedAnnouncement, usePinnedAnnouncement } from '../messages/PinnedAnnouncement';
import { RbacService } from '../../services/rbacService';

/** The quick drawer carries the open channels; private conversations live on the «المراسلات» screen. */
const openChannelMessages = () => apiService.getMessages().filter((m) => ['general', 'department', 'legacy'].includes(parseChannel(m.channel)?.kind || ''));

interface NewsroomIntercomDrawerProps {
  currentUser?: UserType | null;
}

const lastSeenKey = (userId: string) => `nrcs_intercom_seen_${userId}`;

function readLastSeen(userId: string): string {
  try {
    return localStorage.getItem(lastSeenKey(userId)) || '';
  } catch {
    return '';
  }
}

/**
 * Newsroom chat shared by every signed-in user (stored on the server, delivered live).
 * Messages are append-only; the server stamps author and time.
 */
export const NewsroomIntercomDrawer: React.FC<NewsroomIntercomDrawerProps> = ({
  currentUser,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const userId = currentUser?.id || '';
  const myDept = currentUser ? departmentIdOf(currentUser) : 'newsroom';
  const { publicChannel, drafts } = useMessageWorkspace(userId);
  const channels = [
    { id: 'general', name: 'عام' },
    ...DEPARTMENTS.filter((d) => d.id === myDept),
    ...DEPARTMENTS.filter((d) => d.id !== myDept),
  ];
  const currentChannel = channels.find(channel => channel.id === (publicChannel ?? myDept)) || channels[0];
  const activeChannel = currentChannel.id;
  const pin = usePinnedAnnouncement(activeChannel);
  useLiveData(['messages', 'chatReads', 'settings']);
  const messages = openChannelMessages();
  const reads = currentUser ? apiService.getChatReads() : undefined;
  const legacySeen = currentUser ? readLastSeen(currentUser.id) : '';
  const { text: inputText, urgent: isUrgentCue } = drafts.get(activeChannel) ?? { text: '', urgent: false };
  const updateDraft = (text: string, urgent: boolean) => saveMessageDraft(userId, activeChannel, { text, urgent });
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendStatus, setSendStatus] = useState('');
  const [sending, setSending] = useState(false);
  const streamRef = useRef<HTMLDivElement>(null);
  const previousChannel = useRef('');
  const followLatest = useRef(true);
  const channelFilteredMessages = messages.filter(message => canonicalMessageChannel(message.channel) === activeChannel)
    .sort((left, right) => (left.timestamp || '').localeCompare(right.timestamp || '') || left.id.localeCompare(right.id));
  const newestTimestamp = channelFilteredMessages[channelFilteredMessages.length - 1]?.timestamp || '';
  const unreadByDepartment = new Map<string, number>();
  for (const message of messages) {
    if (message.userId === currentUser?.id || !message.timestamp) continue;
    const channel = canonicalMessageChannel(message.channel);
    const seen = reads?.seen?.[channel] ?? legacySeen;
    if (message.timestamp > seen) unreadByDepartment.set(channel, (unreadByDepartment.get(channel) || 0) + 1);
  }
  const unreadCount = channels.reduce((count, channel) => count + (unreadByDepartment.get(channel.id) || 0), 0);

  useEffect(() => {
    if (!isOpen || !streamRef.current) { previousChannel.current = ''; return; }
    const scope = `${userId}:${activeChannel}`;
    if (previousChannel.current !== scope) {
      const saved = messagePosition(userId, activeChannel);
      followLatest.current = !saved || !scrollToMessage(streamRef.current, saved);
    }
    previousChannel.current = scope;
    if (followLatest.current) streamRef.current.scrollTop = streamRef.current.scrollHeight;
    if (followLatest.current && currentUser && newestTimestamp) apiService.markChannelRead(activeChannel, newestTimestamp);
  }, [isOpen, activeChannel, newestTimestamp, userId]);

  // Opened from the top bar; closes on Esc and when the screen changes; focus goes in and back.
  const drawerRef = useRef<HTMLDivElement>(null);
  useEffect(
    () =>
      intercomCommand.on((cmd) => setIsOpen((open) => (cmd === 'toggle' ? !open : cmd === 'open'))),
    []
  );
  useEffect(() => routeChanged.on(() => setIsOpen(false)), []);
  useEffect(() => intercomState.emit({ open: isOpen, unread: unreadCount }), [isOpen, unreadCount]);
  useEffect(() => {
    if (!isOpen) return;
    const opener = document.activeElement as HTMLElement | null;
    const drawer = drawerRef.current;
    drawer?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('[role=alertdialog]')) setIsOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (opener?.isConnected && (drawer?.contains(document.activeElement) || document.activeElement === document.body)) opener.focus();
    };
  }, [isOpen]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || sending) return;
    setSending(true);
    setSendError(null);
    setSendStatus('');
    try {
      followLatest.current = true;
      const id = apiService.sendMessage(activeChannel, inputText.trim(), isUrgentCue);
      const result = await dataStore.awaitWrite('messages', id);
      if (result.ok || result.pending) {
        clearSentMessageDraft(userId, activeChannel, { text: inputText, urgent: isUrgentCue });
        setSendStatus(result.ok ? 'أُرسلت الرسالة' : 'الرسالة محفوظة بانتظار المزامنة');
      } else {
        setSendError(result.message || 'لم يؤكد الخادم إرسال الرسالة. أعد المحاولة.');
      }
    } catch (err: any) {
      setSendError(err?.message || 'تعذر إرسال الرسالة');
    } finally {
      setSending(false);
    }
  };

  // Direct and group conversations live on the «المراسلات» screen; the drawer points at what waits there.
  const privateUnread = currentUser ? [...unreadByChannel(apiService.getMessages(), apiService.getChatReads(), currentUser.id)].filter(([channel]) => isPrivateChannel(channel)).reduce((sum, [, n]) => sum + n, 0) : 0;
  const canOpenMessages = currentUser && RbacService.canOpenScreen(currentUser, 'messages');

  return (
    <>
      {/* Slide-out Drawer */}
      {isOpen && (
        <div ref={drawerRef} tabIndex={-1} role="dialog" aria-modal="false" aria-label="المحادثة الداخلية بين الأقسام" className="fixed inset-y-0 left-0 z-50 flex w-full max-w-md flex-col bg-slate-50 text-slate-900 shadow-xl outline-none" dir="rtl">
          {/* Drawer Header */}
          <div className="theme-fixed min-h-16 px-3 py-2 bg-slate-900 border-b border-slate-800 flex items-center gap-2 justify-between shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <div className="p-2 bg-blue-500/20 text-blue-300 rounded-xl shrink-0">
                <MessagesSquare className="w-5 h-5" aria-hidden="true" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">محادثة الأقسام</h3>
              </div>
            </div>

            {canOpenMessages && <button type="button" onClick={() => navigateTo.emit('/messages')} className="min-h-11 inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap px-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-bold text-white">
              الرسائل الخاصة
              {privateUnread > 0 && <span className="rounded bg-blue-600 px-1.5 text-white tabular-nums">{privateUnread}</span>}
            </button>}

            <button
              type="button"
              onClick={() => setIsOpen(false)}
              aria-label="إغلاق المحادثة"
              className="min-h-11 min-w-11 grid place-items-center hover:bg-slate-800 rounded-lg text-slate-300 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="px-3 py-2 bg-white border-b border-slate-200 flex flex-wrap items-end gap-2">
            <label className="flex-1 min-w-0 text-xs font-semibold text-slate-700">
              قناة المحادثة
              <select value={activeChannel} disabled={sending} onChange={event => {
                selectPublicMessageChannel(userId, event.target.value); setSendStatus(''); setSendError(null);
              }} className="mt-1 block w-full min-h-11 px-3 rounded-lg border border-slate-300 bg-white text-slate-900 focus-visible:ring-2 focus-visible:ring-blue-600">
                {channels.map(channel => {
                  const unread = unreadByDepartment.get(channel.id) || 0;
                  return <option key={channel.id} value={channel.id}>
                    {channel.name}{channel.id === myDept ? ' (قسمي)' : ''}{unread ? ` · غير مقروء (${unread})` : ''}
                  </option>;
                })}
              </select>
            </label>
            {canOpenMessages && <button type="button" disabled={sending} onClick={() => {
              setIsOpen(false);
              navigateTo.emit(`/messages/${encodeURIComponent(activeChannel)}`);
            }} className="min-h-11 inline-flex items-center gap-1 px-2 rounded-lg border border-slate-300 text-xs font-semibold text-blue-700 hover:bg-blue-50">
              <Hash className="size-4" aria-hidden="true" /> فتح القناة
            </button>}
          </div>

          {pin && <PinnedAnnouncement pin={pin} onOpen={path => {
            if (canOpenMessages) { setIsOpen(false); navigateTo.emit(path); }
            else if (streamRef.current) scrollToMessage(streamRef.current, pin.messageId);
          }} />}
          {/* Messages Stream */}
          <div ref={streamRef} role="log" aria-label={`رسائل ${currentChannel.name}`} className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3 sm:p-4 space-y-2" onScroll={event => {
            const stream = event.currentTarget;
            followLatest.current = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 48;
            rememberMessagePosition(userId, activeChannel, stream, followLatest.current);
            if (followLatest.current && currentUser && newestTimestamp) apiService.markChannelRead(activeChannel, newestTimestamp);
          }}>
            {channelFilteredMessages.length === 0 && (
              <p className="text-center text-sm text-slate-600 py-10">لا توجد رسائل في قناة {currentChannel.name} بعد.</p>
            )}
            {channelFilteredMessages.map((msg) => (
              <div
                key={msg.id}
                data-chat-message={msg.id}
                className={`px-3 py-2.5 rounded-xl border text-xs space-y-1.5 ${
                  msg.isUrgent
                    ? 'bg-rose-50 border-rose-200 text-rose-900'
                    : msg.userId === currentUser?.id ? 'bg-blue-50 border-blue-200 text-blue-900' : 'bg-white border-slate-200 text-slate-900'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-1.5">
                    {msg.isUrgent && (
                      <span className="px-1.5 py-0.5 bg-rose-100 text-rose-800 font-bold rounded text-2xs">
                        عاجل
                      </span>
                    )}
                    <span className="font-bold">{msg.userName}</span>
                  </div>
                  <span className="font-mono text-slate-600">
                    {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString(appLocale(), { ...zoneOptions(), hour: '2-digit', minute: '2-digit' }) : '...'}
                  </span>
                </div>

                <p className="text-sm leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">{msg.text}</p>
              </div>
            ))}
          </div>

          {/* Message Input & Urgent On-Air Trigger */}
          <form onSubmit={handleSendMessage} aria-busy={sending} className="shrink-0 p-3 bg-white border-t border-slate-200 space-y-2">
            {sendError && <p role="alert" className="text-xs text-rose-800 font-bold px-1">{sendError}</p>}
            {sendStatus && <p role="status" className="text-xs text-slate-600 px-1">{sendStatus}</p>}
            <div className="flex items-center justify-between text-2xs px-1">
              <label className="flex items-center min-h-11 gap-1.5 text-slate-700 cursor-pointer select-none font-semibold">
                <input
                  type="checkbox"
                  checked={isUrgentCue}
                  disabled={sending}
                  onChange={(e) => updateDraft(inputText, e.target.checked)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                />
                <span>تمييز الرسالة كعاجلة</span>
              </label>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={inputText}
                readOnly={sending}
                onChange={(e) => updateDraft(e.target.value, isUrgentCue)}
                maxLength={MAX_MESSAGE_CHARS}
                aria-label="نص الرسالة"
                placeholder={`رسالة إلى قناة ${currentChannel.name}…`}
                className="flex-1 min-w-0 min-h-11 px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm text-slate-900 placeholder-slate-500 focus:ring-2 focus:ring-blue-600"
              />

              <button
                type="submit"
                aria-label="إرسال الرسالة"
                disabled={sending || !inputText.trim()}
                className="min-h-11 min-w-11 grid place-items-center bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-xl transition-colors shadow-xs"
              >
                <Send className="w-4 h-4 rotate-180" />
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
};
