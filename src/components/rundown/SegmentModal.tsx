import React, { useState, useEffect, useMemo } from 'react';
import {
  RundownSegment,
  RundownSegmentType,
  Guest,
  NewsItem,
} from '../../types';
import { Modal } from '../common/Modal';
import { formatSecondsToTime, parseTimeToSeconds } from '../../services/api';
import {
  Clock,
  Video,
  Mic,
  Tv,
  Users,
  Film,
  Sparkles,
  Volume2,
  X,
  Plus,
  Play,
  Check,
} from 'lucide-react';

interface SegmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (segment: Partial<RundownSegment>) => void;
  segment?: RundownSegment | null;
  guests: Guest[];
  newsList: NewsItem[];
  defaultPresenter?: string;
}

export const SegmentModal: React.FC<SegmentModalProps> = ({
  isOpen,
  onClose,
  onSave,
  segment,
  guests,
  newsList,
  defaultPresenter = '',
}) => {
  const [title, setTitle] = useState('');
  const [segmentType, setSegmentType] = useState<RundownSegmentType>('REPORT');
  const [durationInput, setDurationInput] = useState('03:00'); // MM:SS
  const [presenterName, setPresenterName] = useState(defaultPresenter);
  const [guestId, setGuestId] = useState('');
  const [newsId, setNewsId] = useState('');
  const [scriptText, setScriptText] = useState('');
  const [videoAssetUrl, setVideoAssetUrl] = useState('');
  const [notes, setNotes] = useState('');

  const DURATION_PRESETS = [
    { label: '+15ث', seconds: 15, isAdd: true },
    { label: '+30ث', seconds: 30, isAdd: true },
    { label: '01:00', seconds: 60, isAdd: false },
    { label: '02:00', seconds: 120, isAdd: false },
    { label: '03:00', seconds: 180, isAdd: false },
    { label: '05:00', seconds: 300, isAdd: false },
    { label: '10:00', seconds: 600, isAdd: false },
  ];

  const VIDEO_PRESETS = ['MCR-VTR-01', 'MCR-VTR-02', 'SNG-LIVE-FEED', 'GRAPHICS-PKG-01'];

  useEffect(() => {
    if (segment) {
      setTitle(segment.title);
      setSegmentType(segment.segmentType);
      const mins = Math.floor(segment.durationSeconds / 60);
      const secs = segment.durationSeconds % 60;
      setDurationInput(`${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`);
      setPresenterName(segment.presenterName || defaultPresenter);
      setGuestId(segment.guestId || '');
      setNewsId(segment.newsId || '');
      setScriptText(segment.scriptText || '');
      setVideoAssetUrl(segment.videoAssetUrl || '');
      setNotes(segment.notes || '');
    } else {
      setTitle('');
      setSegmentType('REPORT');
      setDurationInput('03:00');
      setPresenterName(defaultPresenter);
      setGuestId('');
      setNewsId('');
      setScriptText('');
      setVideoAssetUrl('');
      setNotes('');
    }
  }, [segment, defaultPresenter, isOpen]);

  // Speech pace calculation from Script Text
  const scriptSpeechPace = useMemo(() => {
    if (!scriptText.trim()) return null;
    const words = (scriptText.trim().match(/\S+/g) || []).length;
    // Standard Arabic TV broadcast speech rate: 130 words / minute = 2.16 words/sec
    const totalSecs = Math.max(5, Math.ceil(words / 2.16));
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    const formatted = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    return { words, totalSecs, formatted };
  }, [scriptText]);

  const handleApplySpeechDuration = () => {
    if (scriptSpeechPace) {
      setDurationInput(scriptSpeechPace.formatted);
    }
  };

  const handleApplyDurationPreset = (preset: { label: string; seconds: number; isAdd: boolean }) => {
    if (preset.isAdd) {
      const currentSecs = parseTimeToSeconds(durationInput) || 0;
      const newSecs = currentSecs + preset.seconds;
      const mins = Math.floor(newSecs / 60);
      const secs = newSecs % 60;
      setDurationInput(`${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`);
    } else {
      const mins = Math.floor(preset.seconds / 60);
      const secs = preset.seconds % 60;
      setDurationInput(`${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const durationSeconds = parseTimeToSeconds(durationInput) || 180;
    const selectedGuest = guests.find((g) => g.id === guestId);
    const selectedNews = newsList.find((n) => n.id === newsId);

    onSave({
      id: segment?.id,
      title,
      segmentType,
      durationSeconds,
      presenterName,
      guestId: guestId || undefined,
      guestName: selectedGuest?.fullName,
      newsId: newsId || undefined,
      newsTitle: selectedNews?.shortTitle || selectedNews?.title,
      scriptText,
      videoAssetUrl: videoAssetUrl || undefined,
      notes,
    });
    onClose();
  };

  const segmentTypes: { type: RundownSegmentType; label: string; icon: any; color: string }[] = [
    { type: 'INTRO', label: 'مقدمة / شارة', icon: Sparkles, color: 'text-amber-600 bg-amber-50 border-amber-200' },
    { type: 'REPORT', label: 'تقرير مصور / VT', icon: Film, color: 'text-blue-600 bg-blue-50 border-blue-200' },
    { type: 'NEWS_ITEM', label: 'خبر قارئ / Reader', icon: Tv, color: 'text-indigo-600 bg-indigo-50 border-indigo-200' },
    { type: 'LIVE_INTERVIEW', label: 'مقابلة حية / Live', icon: Mic, color: 'text-purple-600 bg-purple-50 border-purple-200' },
    { type: 'DISCUSSION', label: 'حلقة نقاش / طاولة', icon: Users, color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
    { type: 'BREAK', label: 'فاصل إعلاني', icon: Clock, color: 'text-slate-600 bg-slate-100 border-slate-300' },
    { type: 'OUTRO', label: 'خاتمة وتتر', icon: Volume2, color: 'text-rose-600 bg-rose-50 border-rose-200' },
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={segment ? 'تعديل فقرة الرانداون' : 'إضافة فقرة جديدة للرانداون'}
      subtitle="جدول التسلسل الزمني للبث التلفزيوني والإذاعي المباشر"
      maxWidth="xl"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Title */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-xs font-bold text-slate-700">اسم أو موضوع الفقرة *</label>
            {title && (
              <button
                type="button"
                onClick={() => setTitle('')}
                className="text-[10px] text-slate-400 hover:text-rose-500"
              >
                مسح
              </button>
            )}
          </div>
          <div className="relative">
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="مثال: التقرير الافتتاحي للقمة الاقتصادية"
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm font-bold focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Type Picker Cards */}
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">نوع الفقرة وقالب البث *</label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            {segmentTypes.map((item) => {
              const Icon = item.icon;
              const isSelected = segmentType === item.type;
              return (
                <button
                  key={item.type}
                  type="button"
                  onClick={() => setSegmentType(item.type)}
                  className={`p-2 rounded-xl text-right flex items-center gap-2 border transition-all text-xs font-bold ${
                    isSelected
                      ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                      : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200'
                  }`}
                >
                  <Icon className={`w-4 h-4 shrink-0 ${isSelected ? 'text-white' : 'text-slate-500'}`} />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Duration Input & Quick Presets */}
        <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-2">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <label className="block text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-blue-600" />
                المدة المقررة للبث (دقيقة : ثانية) *
              </label>
              <span className="text-[10px] text-slate-400">تنسيق MM:SS (مثلاً 02:30)</span>
            </div>

            <input
              type="text"
              required
              value={durationInput}
              onChange={(e) => setDurationInput(e.target.value)}
              placeholder="03:00"
              pattern="^[0-9]{1,2}:[0-9]{2}$"
              title="أدخل الوقت بصيغة MM:SS مثل 03:30"
              className="w-28 px-3 py-1.5 border border-slate-300 rounded-lg text-base font-black text-center font-mono focus:ring-2 focus:ring-blue-500 bg-white"
              dir="ltr"
            />
          </div>

          {/* Quick Preset Buttons */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-[10px] text-slate-400 font-bold">تحديد سريع:</span>
            {DURATION_PRESETS.map((p, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleApplyDurationPreset(p)}
                className="text-[10px] font-mono font-bold bg-white hover:bg-blue-50 text-slate-700 hover:text-blue-700 px-2 py-0.5 rounded-md border border-slate-200 shadow-2xs transition-colors"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Presenter & Guest */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">المذيع / القارئ</label>
            <input
              type="text"
              value={presenterName}
              onChange={(e) => setPresenterName(e.target.value)}
              placeholder="اسم المذيع أو المعلق"
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-medium focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">الضيف المرتبط (إن وجد)</label>
            <select
              value={guestId}
              onChange={(e) => setGuestId(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">-- بدون ضيف لهذه الفقرة --</option>
              {guests.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.fullName} ({g.organization})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Related News & Video URL */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">ربط بخبر من غرفة الأخبار</label>
            <select
              value={newsId}
              onChange={(e) => setNewsId(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">-- بدون ربط بخبر --</option>
              {newsList.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.shortTitle || n.title}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-bold text-slate-700">رابط الفيديو أو معرف السيرفر</label>
              {videoAssetUrl && (
                <button
                  type="button"
                  onClick={() => setVideoAssetUrl('')}
                  className="text-[10px] text-slate-400 hover:text-rose-500"
                >
                  مسح
                </button>
              )}
            </div>
            <input
              type="text"
              value={videoAssetUrl}
              onChange={(e) => setVideoAssetUrl(e.target.value)}
              placeholder="Playout Server ID أو رابط MP4"
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs text-left font-mono focus:ring-2 focus:ring-blue-500"
              dir="ltr"
            />
            {/* Quick Server Presets */}
            <div className="mt-1 flex flex-wrap gap-1">
              {VIDEO_PRESETS.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setVideoAssetUrl(v)}
                  className="text-[9px] font-mono bg-slate-100 hover:bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded"
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Autocue / Script Text with Live Reading Pace Calculator */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-xs font-bold text-slate-700">نص الأوتوكيو / القراءة للمذيع</label>
            {scriptSpeechPace && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono font-semibold text-purple-700 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded-md">
                  {scriptSpeechPace.words} كلمة ~ {scriptSpeechPace.formatted} دقيقة
                </span>
                <button
                  type="button"
                  onClick={handleApplySpeechDuration}
                  className="text-[10px] font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 px-2 py-0.5 rounded-md transition-colors"
                  title="تحديث حقل المدة المقررة وفق زمن قراءة هذا النص"
                >
                  تطبيق كمدة للفقرة
                </button>
              </div>
            )}
          </div>
          <textarea
            rows={3}
            value={scriptText}
            onChange={(e) => setScriptText(e.target.value)}
            placeholder="النص الذي سيظهر على شاشة المذيع أو التوجيه الصوتي على الهواء..."
            className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs leading-relaxed focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Notes */}
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1">ملاحظات المخرج وغرفة التحكم (MCR)</label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="مثال: استخدام كاميرا 2، نزول شارة الضيف، خفض الصوت تدريجياً"
            className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Buttons */}
        <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
          >
            إلغاء
          </button>
          <button
            type="submit"
            className="px-5 py-2 text-xs font-bold bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors shadow-xs"
          >
            {segment ? 'حفظ التعديلات' : 'إضافة إلى الرانداون'}
          </button>
        </div>
      </form>
    </Modal>
  );
};
