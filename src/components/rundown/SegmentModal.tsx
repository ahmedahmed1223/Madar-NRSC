import React, { useState, useEffect } from 'react';
import { RundownSegment, RundownSegmentType, Guest, NewsItem } from '../../types';
import { Modal } from '../common/Modal';
import { formatSecondsToTime, parseTimeToSeconds } from '../../services/api';

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

  const segmentTypeLabels: Record<RundownSegmentType, string> = {
    INTRO: 'مقدمة الاستوديو / شارة',
    REPORT: 'تقرير مصور / VT',
    LIVE_INTERVIEW: 'مقابلة حية / حوار',
    NEWS_ITEM: 'خبر قارئ / Reader',
    DISCUSSION: 'حلقة نقاش / طاولة مستديرة',
    BREAK: 'فاصل إعلاني / برومو',
    OUTRO: 'خاتمة وتتر النهاية',
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={segment ? 'تعديل فقرة الرانداون' : 'إضافة فقرة جديدة للرانداون'}
      subtitle="جدول التسلسل الزمني للبث التلفزيوني والإذاعي"
      maxWidth="xl"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Title */}
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1">اسم أو موضوع الفقرة *</label>
          <input
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="مثال: التقرير الافتتاحي للقمة الاقتصادية"
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Type & Duration */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">نوع الفقرة</label>
            <select
              value={segmentType}
              onChange={(e) => setSegmentType(e.target.value as RundownSegmentType)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 bg-white"
            >
              {Object.entries(segmentTypeLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">المدة المقررة (دقيقة:ثانية) *</label>
            <input
              type="text"
              required
              value={durationInput}
              onChange={(e) => setDurationInput(e.target.value)}
              placeholder="03:00"
              pattern="^[0-9]{1,2}:[0-9]{2}$"
              title="أدخل الوقت بصيغة MM:SS مثل 03:30"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-center font-mono focus:ring-2 focus:ring-blue-500"
              dir="ltr"
            />
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
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">الضيف المرتبط (إن وجد)</label>
            <select
              value={guestId}
              onChange={(e) => setGuestId(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 bg-white"
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
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 bg-white"
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
            <label className="block text-xs font-bold text-slate-700 mb-1">رابط ملف الفيديو أو السيرفر</label>
            <input
              type="text"
              value={videoAssetUrl}
              onChange={(e) => setVideoAssetUrl(e.target.value)}
              placeholder="Playout Server ID أو رابط MP4"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-left focus:ring-2 focus:ring-blue-500"
              dir="ltr"
            />
          </div>
        </div>

        {/* Autocue / Script Text */}
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1">نص الأوتوكيو / القراءة للمذيع</label>
          <textarea
            rows={3}
            value={scriptText}
            onChange={(e) => setScriptText(e.target.value)}
            placeholder="النص الذي سيظهر على شاشة المذيع أو التوجيه الصوتي..."
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Notes */}
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1">ملاحظات المخرج وغرفة التحكم (MCR)</label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="مثال: استخدام كاميرا 2، نزول أسماء الضيوف، فاصل صوتي"
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Buttons */}
        <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
          >
            إلغاء
          </button>
          <button
            type="submit"
            className="px-5 py-2 text-sm font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-xs"
          >
            {segment ? 'حفظ التعديلات' : 'إضافة إلى الرانداون'}
          </button>
        </div>
      </form>
    </Modal>
  );
};
