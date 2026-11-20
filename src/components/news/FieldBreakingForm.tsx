import React, { useMemo, useState } from 'react';
import { ArrowRight, Flame, MapPin, Send, FileText } from 'lucide-react';
import type { NewsItem, User } from '../../types';
import { AttachmentsPanel } from '../media/AttachmentsPanel';
import { apiService } from '../../services/api';
import { dataStore, QUEUED_MESSAGE } from '../../services/dataStore';
import { notify } from '../../services/notify';
import { sendFieldBreaking } from '../../services/newsReview';
import { stationName, stationsOf } from '../../shared/stations';

interface FieldBreakingFormProps {
  currentUser: User;
  onCancel: () => void;
  /** Switches to the full story editor (keeps nothing typed here). */
  onOpenFullEditor: () => void;
  onSent?: (item: NewsItem) => void;
}

/**
 * «خبر عاجل» from the field, short enough for a phone: headline, place, one line and an
 * optional photo. It goes to review as urgent and alerts whoever may put it on air; the
 * decision to air it stays with them.
 */
export const FieldBreakingForm: React.FC<FieldBreakingFormProps> = ({ currentUser, onCancel, onOpenFullEditor, onSent }) => {
  const station = useMemo(() => stationName(stationsOf(apiService.getSettings() as any), currentUser.stationId) || '', [currentUser.stationId]);
  const [title, setTitle] = useState('');
  const [locationName, setLocationName] = useState(station);
  const [line, setLine] = useState('');
  const [mediaIds, setMediaIds] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending) return;
    setError(null);
    setSending(true);
    try {
      const item = sendFieldBreaking({ title, locationName, line, mediaIds });
      const outcome = await dataStore.awaitWrite('news', item.id);
      if (outcome.ok) notify({ type: 'success', title: 'أُرسل العاجل إلى الديسك', message: 'وصل التنبيه إلى من يقرر بثه؛ ستصلك النتيجة.' });
      else if (outcome.queued) notify({ type: 'warning', title: 'غير متصل: سيُرسل عند عودة الاتصال', message: QUEUED_MESSAGE });
      else if (outcome.pending) notify({ type: 'warning', title: 'لم يؤكد الخادم الإرسال بعد', message: outcome.message || '' });
      else {
        setError(outcome.message || 'رفض الخادم الإرسال');
        return;
      }
      onSent?.(item);
      onCancel();
    } catch (err: any) {
      setError(err?.message || 'تعذر إرسال العاجل');
    } finally {
      setSending(false);
    }
  };

  const field = 'w-full px-3.5 py-3 bg-white border border-slate-300 rounded-xl text-base text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-red-500';

  return (
    <form onSubmit={submit} className="max-w-xl mx-auto space-y-4" aria-labelledby="field-breaking-title">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onCancel} title="العودة لقائمة الأخبار" aria-label="العودة لقائمة الأخبار" className="min-h-11 min-w-11 flex items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100">
          <ArrowRight className="w-5 h-5" />
        </button>
        <h1 id="field-breaking-title" className="text-lg font-bold text-slate-900 flex items-center gap-2">
          <Flame className="w-5 h-5 text-red-600" />
          خبر عاجل
        </h1>
      </div>
      <p className="text-sm text-slate-600">يصل إلى الديسك ورئيس التحرير فوراً للمراجعة؛ قرار بثه على شريط العاجل لهم.</p>

      {error && (
        <p role="alert" className="text-sm font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">
          {error}
        </p>
      )}

      <label className="block text-sm font-bold text-slate-700">
        العنوان
        <input value={title} onChange={(e) => setTitle(e.target.value)} required minLength={5} maxLength={200} autoFocus enterKeyHint="next" className={`${field} mt-1 font-bold`} placeholder="ما الذي حدث؟" />
      </label>

      <label className="block text-sm font-bold text-slate-700">
        <span className="inline-flex items-center gap-1">
          <MapPin className="w-4 h-4 text-slate-500" /> المكان
        </span>
        <input value={locationName} onChange={(e) => setLocationName(e.target.value)} maxLength={120} enterKeyHint="next" className={`${field} mt-1`} placeholder="المدينة أو الحي" />
      </label>

      <label className="block text-sm font-bold text-slate-700">
        سطر واحد
        <textarea value={line} onChange={(e) => setLine(e.target.value)} required rows={2} maxLength={400} className={`${field} mt-1`} placeholder="من، ماذا، متى — بجملة واحدة" />
      </label>

      <div className="rounded-xl border border-slate-200 p-3">
        <AttachmentsPanel mediaIds={mediaIds} onChange={setMediaIds} currentUser={currentUser} title="وسائط (اختيارية)" directUpload readOnly={sending} />
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button type="submit" disabled={sending || title.trim().length < 5 || !line.trim()} className="min-h-12 flex-1 inline-flex items-center justify-center gap-2 px-5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-base font-bold disabled:opacity-50">
          <Send className="w-5 h-5" />
          {sending ? 'جارٍ الإرسال...' : 'إرسال العاجل للمراجعة'}
        </button>
        <button type="button" onClick={onOpenFullEditor} className="min-h-12 inline-flex items-center gap-1.5 px-4 rounded-xl border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          <FileText className="w-4 h-4" />
          المحرر الكامل
        </button>
      </div>
    </form>
  );
};
