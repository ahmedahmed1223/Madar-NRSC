import { DEPARTMENTS, departmentIdOf } from '../../shared/departments';
import React, { useState, useEffect, useRef } from 'react';
import {
  MessageSquare,
  Radio,
  Send,
  X,
  AlertTriangle,
  User,
  Tv,
  Users,
  Bell,
  CheckCheck,
} from 'lucide-react';
import { User as UserType } from '../../types';
import { apiService } from '../../services/api';
import { dataStore } from '../../services/dataStore';
import { intercomCommand, intercomState, routeChanged } from '../../services/uiEvents';
import type { ChatMessage } from '../../shared/collections';

type Channel = string;

/** Messages from the three original channels live on in the matching departments. */
const LEGACY_CHANNELS: Record<string, string> = { STUDIO_PCR: 'control', NEWSROOM: 'newsroom', FIELD: 'field' };
const channelOf = (m: { channel: string }) => LEGACY_CHANNELS[m.channel] || m.channel;

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
  const myDept = currentUser ? departmentIdOf(currentUser) : 'newsroom';
  const [activeChannel, setActiveChannel] = useState<Channel>(myDept);
  const channels = [
    { id: 'general', name: 'عام' },
    ...DEPARTMENTS.filter((d) => d.id === myDept),
    ...DEPARTMENTS.filter((d) => d.id !== myDept),
  ];
  const [messages, setMessages] = useState<(ChatMessage & { isUrgent?: boolean })[]>(() => apiService.getMessages());
  const [inputText, setInputText] = useState('');
  const [isUrgentCue, setIsUrgentCue] = useState(false);
  const [lastSeen, setLastSeen] = useState(() => (currentUser ? readLastSeen(currentUser.id) : ''));
  const [sendError, setSendError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(
    () =>
      dataStore.subscribe((evt) => {
        if (evt.type === 'data-changed' && evt.collections.includes('messages')) setMessages(apiService.getMessages());
      }),
    []
  );

  const newestTimestamp = messages.reduce((max, m) => ((m.timestamp || '') > max ? m.timestamp || '' : max), '');

  useEffect(() => {
    if (!isOpen || !currentUser) return;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    if (newestTimestamp && newestTimestamp !== lastSeen) {
      setLastSeen(newestTimestamp);
      try {
        localStorage.setItem(lastSeenKey(currentUser.id), newestTimestamp);
      } catch {
        // storage unavailable: unread badge just resets on reload
      }
    }
  }, [isOpen, activeChannel, messages.length, newestTimestamp, currentUser, lastSeen]);

  const unreadCount = messages.filter((m) => m.userId !== currentUser?.id && (m.timestamp || '') > lastSeen).length;

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
    const t = window.setTimeout(() => drawerRef.current?.querySelector<HTMLElement>('textarea, input, button')?.focus(), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('[role=alertdialog]')) setIsOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
  }, [isOpen]);

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    try {
      apiService.sendMessage(activeChannel, inputText.trim(), isUrgentCue);
      setMessages(apiService.getMessages());
      setInputText('');
      setIsUrgentCue(false);
      setSendError(null);
    } catch (err: any) {
      setSendError(err?.message || 'تعذر إرسال الرسالة');
    }
  };

  const channelFilteredMessages = messages.filter((m) => channelOf(m) === activeChannel);
  const unreadIn = (id: string) => messages.filter((m) => channelOf(m) === id && m.userId !== currentUser?.id && (m.timestamp || '') > lastSeen).length;

  return (
    <>
      {/* Slide-out Drawer */}
      {isOpen && (
        <div ref={drawerRef} role="dialog" aria-modal="false" aria-label="المحادثة الداخلية بين الأقسام" className="theme-fixed fixed inset-y-0 left-0 z-50 w-full max-w-sm sm:max-w-md bg-slate-950 text-white shadow-2xl border-r border-slate-800 flex flex-col animate-in slide-in-from-left duration-200" dir="rtl">
          {/* Drawer Header */}
          <div className="h-16 px-4 bg-slate-900 border-b border-slate-800 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-emerald-500/20 text-emerald-400 rounded-xl">
                <Radio className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-xs font-black text-white">المحادثة الداخلية بين الأقسام</h3>
                <span className="text-[10px] text-slate-400">رسائل فورية تصل لكل الزملاء المتصلين</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setIsOpen(false)}
              aria-label="إغلاق المحادثة"
              className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Channels: general + one per department (yours first) */}
          <div className="p-2 bg-slate-900/60 border-b border-slate-800 flex gap-1 overflow-x-auto text-[11px]" role="tablist" aria-label="قنوات المحادثة">
            {channels.map((c) => (
              <button
                key={c.id}
                type="button"
                role="tab"
                aria-selected={activeChannel === c.id}
                onClick={() => setActiveChannel(c.id)}
                className={`py-1.5 px-2.5 rounded-lg font-bold whitespace-nowrap transition-all ${
                  activeChannel === c.id ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`}
              >
                {c.name}
                {c.id === myDept ? ' (قسمي)' : ''}
                {unreadIn(c.id) > 0 && activeChannel !== c.id && <span className="mr-1 px-1 rounded bg-red-600 text-white">{unreadIn(c.id)}</span>}
              </button>
            ))}
          </div>

          {/* Messages Stream */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {channelFilteredMessages.length === 0 && (
              <p className="text-center text-xs text-slate-500 py-10">لا توجد رسائل في هذه القناة بعد.</p>
            )}
            {channelFilteredMessages.map((msg) => (
              <div
                key={msg.id}
                className={`p-3 rounded-2xl border text-xs space-y-1.5 ${
                  msg.isUrgent
                    ? 'bg-red-950/70 border-red-500/80 text-red-100 shadow-md ring-1 ring-red-500/40'
                    : 'bg-slate-900 border-slate-800 text-slate-200'
                }`}
              >
                <div className="flex items-center justify-between text-[10px]">
                  <div className="flex items-center gap-1.5">
                    {msg.isUrgent && (
                      <span className="px-1.5 py-0.2 bg-red-600 text-white font-black rounded text-[9px]">
                        عاجل
                      </span>
                    )}
                    <span className="font-bold text-white">{msg.userName}</span>
                  </div>
                  <span className="font-mono text-slate-500">
                    {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' }) : '...'}
                  </span>
                </div>

                <p className="text-xs leading-relaxed">{msg.text}</p>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Message Input & Urgent On-Air Trigger */}
          <form onSubmit={handleSendMessage} className="p-3 bg-slate-900 border-t border-slate-800 space-y-2">
            {sendError && <p className="text-[11px] text-red-400 font-bold px-1">{sendError}</p>}
            <div className="flex items-center justify-between text-[11px] px-1">
              <label className="flex items-center gap-1.5 text-red-400 cursor-pointer select-none font-bold">
                <input
                  type="checkbox"
                  checked={isUrgentCue}
                  onChange={(e) => setIsUrgentCue(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-950 text-red-600 focus:ring-red-500"
                />
                <span>تمييز الرسالة كعاجلة</span>
              </label>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                maxLength={2000}
                placeholder={`رسالة إلى قناة ${channels.find((c) => c.id === activeChannel)?.name || ''}...`}
                className="flex-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:ring-2 focus:ring-blue-500"
              />

              <button
                type="submit"
                disabled={!inputText.trim()}
                className="p-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-xl transition-colors shadow-xs"
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
