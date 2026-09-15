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

interface IntercomMessage {
  id: string;
  senderName: string;
  senderRole: string;
  channel: 'STUDIO_PCR' | 'NEWSROOM' | 'FIELD';
  text: string;
  isUrgent: boolean;
  time: string;
}

const INITIAL_MESSAGES: IntercomMessage[] = [
  {
    id: 'msg-1',
    senderName: 'مخرج البث (PCR Director)',
    senderRole: 'مخرج النشرة',
    channel: 'STUDIO_PCR',
    text: 'تنبيه للأوتوكيو: تم تمديد الفقرة الثانية 30 ثانية لتغطية المؤتمر الصحفي.',
    isUrgent: true,
    time: '14:30',
  },
  {
    id: 'msg-2',
    senderName: 'رئيس التحرير المناوب',
    senderRole: 'رئيس التحرير',
    channel: 'STUDIO_PCR',
    text: 'الضيف د. خالد وصل لغرفة الميك أب وسيكون جاهزاً للفقرة الحوارية.',
    isUrgent: false,
    time: '14:32',
  },
  {
    id: 'msg-3',
    senderName: 'معد الأخبار السياسية',
    senderRole: 'صحفي ومعد',
    channel: 'NEWSROOM',
    text: 'تم نشر خبر القمة الدولية على الموقع وتحديث الرانداون بنسخة VT المعتمدة.',
    isUrgent: false,
    time: '14:35',
  },
  {
    id: 'msg-4',
    senderName: 'المراسل في لندن',
    senderRole: 'مراسل ميداني',
    channel: 'FIELD',
    text: 'رابط البث المباشر عبر SNG جاهز والصوت والصورة مستقران تماماً.',
    isUrgent: false,
    time: '14:36',
  },
];

interface NewsroomIntercomDrawerProps {
  currentUser?: UserType | null;
}

export const NewsroomIntercomDrawer: React.FC<NewsroomIntercomDrawerProps> = ({
  currentUser,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeChannel, setActiveChannel] = useState<'STUDIO_PCR' | 'NEWSROOM' | 'FIELD'>('STUDIO_PCR');
  const [messages, setMessages] = useState<IntercomMessage[]>(INITIAL_MESSAGES);
  const [inputText, setInputText] = useState('');
  const [isUrgentCue, setIsUrgentCue] = useState(false);
  const [unreadCount, setUnreadCount] = useState(1);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setUnreadCount(0);
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [isOpen, activeChannel, messages]);

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    const newMsg: IntercomMessage = {
      id: `msg-${Date.now()}`,
      senderName: currentUser?.fullName || 'منتج النشرة',
      senderRole: currentUser?.role || 'فريق التحرير',
      channel: activeChannel,
      text: inputText.trim(),
      isUrgent: isUrgentCue,
      time: new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, newMsg]);
    setInputText('');
    setIsUrgentCue(false);
  };

  const channelFilteredMessages = messages.filter((m) => m.channel === activeChannel);

  return (
    <>
      {/* Floating Trigger Button on Bottom-Left */}
      <div className="fixed bottom-5 left-5 z-40">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 px-4 py-3 bg-slate-900 hover:bg-slate-800 text-white rounded-2xl shadow-xl border border-slate-700 font-bold text-xs transition-all hover:scale-105"
        >
          <div className="relative">
            <Radio className="w-4 h-4 text-emerald-400 animate-pulse" />
            {unreadCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-red-600 rounded-full border-2 border-slate-900" />
            )}
          </div>
          <span>اتصال الاستوديو الداخلي (Intercom)</span>
        </button>
      </div>

      {/* Slide-out Drawer */}
      {isOpen && (
        <div className="fixed inset-y-0 left-0 z-50 w-full max-w-sm sm:max-w-md bg-slate-950 text-white shadow-2xl border-r border-slate-800 flex flex-col animate-in slide-in-from-left duration-200" dir="rtl">
          {/* Drawer Header */}
          <div className="h-16 px-4 bg-slate-900 border-b border-slate-800 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-emerald-500/20 text-emerald-400 rounded-xl">
                <Radio className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-xs font-black text-white">اتصال غرفة الأخبار الداخلي (Intercom Desk)</h3>
                <span className="text-[10px] text-slate-400">تواصل فوري بين فريق التحرير وغرفة التحكم (PCR)</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Channels Selector */}
          <div className="p-2 bg-slate-900/60 border-b border-slate-800 grid grid-cols-3 gap-1 text-[11px]">
            <button
              type="button"
              onClick={() => setActiveChannel('STUDIO_PCR')}
              className={`py-1.5 px-2 rounded-lg font-bold flex items-center justify-center gap-1 transition-all ${
                activeChannel === 'STUDIO_PCR'
                  ? 'bg-red-600 text-white shadow-xs'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              <Tv className="w-3 h-3" />
              الاستوديو والبث
            </button>

            <button
              type="button"
              onClick={() => setActiveChannel('NEWSROOM')}
              className={`py-1.5 px-2 rounded-lg font-bold flex items-center justify-center gap-1 transition-all ${
                activeChannel === 'NEWSROOM'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              <Users className="w-3 h-3" />
              صالة التحرير
            </button>

            <button
              type="button"
              onClick={() => setActiveChannel('FIELD')}
              className={`py-1.5 px-2 rounded-lg font-bold flex items-center justify-center gap-1 transition-all ${
                activeChannel === 'FIELD'
                  ? 'bg-amber-600 text-white shadow-xs'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              <Radio className="w-3 h-3" />
              المراسلون SNG
            </button>
          </div>

          {/* Messages Stream */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
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
                      <span className="px-1.5 py-0.2 bg-red-600 text-white font-black rounded text-[9px] animate-pulse">
                        عاجل للمذيع CUE
                      </span>
                    )}
                    <span className="font-bold text-white">{msg.senderName}</span>
                    <span className="text-slate-500">({msg.senderRole})</span>
                  </div>
                  <span className="font-mono text-slate-500">{msg.time}</span>
                </div>

                <p className="text-xs leading-relaxed">{msg.text}</p>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Message Input & Urgent On-Air Trigger */}
          <form onSubmit={handleSendMessage} className="p-3 bg-slate-900 border-t border-slate-800 space-y-2">
            <div className="flex items-center justify-between text-[11px] px-1">
              <label className="flex items-center gap-1.5 text-red-400 cursor-pointer select-none font-bold">
                <input
                  type="checkbox"
                  checked={isUrgentCue}
                  onChange={(e) => setIsUrgentCue(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-950 text-red-600 focus:ring-red-500"
                />
                <span>تنبيه عاجل على الهواء (Direct On-Air Cue)</span>
              </label>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder={`أرسل رسالة في قنوات ${
                  activeChannel === 'STUDIO_PCR' ? 'استوديو البث' : activeChannel === 'NEWSROOM' ? 'التحرير' : 'المراسلين'
                }...`}
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
