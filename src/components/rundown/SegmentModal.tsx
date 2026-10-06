import { fromLocalInputValue, toLocalInputValue } from '../../shared/dates';
import { notify } from '../../services/notify';
import { LongTextField } from '../common/TextSizeControls';
import { AttachmentsPanel } from '../media/AttachmentsPanel';
import { FormPage } from '../common/FormPage';
import React, { useState, useEffect, useMemo } from 'react';
import {
  RundownSegment,
  RundownSegmentType,
  Guest,
  NewsItem,
} from '../../types';
import { Modal } from '../common/Modal';
import { formatSecondsToTime, parseTimeToSeconds, apiService } from '../../services/api';
import { newId } from '../../shared/ids';
import { departmentIdOf } from '../../shared/departments';
import { isRequestClosed } from '../../shared/production';
import {
  EpisodeTopic,
  GUEST_ROLES,
  GuestRole,
  REPORT_SOURCES,
  ReportBrief,
  reportBriefError,
  reportSourceOf,
  SegmentGuest,
  segmentGuests,
  withSegmentGuests,
} from '../../shared/episodePlan';
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
  episodeId?: string;
  topics?: EpisodeTopic[];
  /** Topic preselected for a new segment. */
  defaultTopicId?: string;
  /** Segment type preselected for a new segment. */
  defaultType?: RundownSegmentType;
  focusField?: string;
}

/** ISO time → value for a datetime-local input (station time under unified time). */
const toLocalInput = (iso?: string) => (iso ? toLocalInputValue(iso) : '');

/** A report whose source has not been chosen yet (no brief, no request). */
const NO_SOURCE = { source: '' } as unknown as ReportBrief;

const mmss = (secs?: number) =>
  secs ? `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}` : '';

export const SegmentModal: React.FC<SegmentModalProps> = ({
  isOpen,
  onClose,
  onSave,
  segment,
  guests,
  newsList,
  defaultPresenter = '',
  episodeId,
  topics = [],
  defaultTopicId,
  defaultType,
  focusField,
}) => {
  const [title, setTitle] = useState('');
  const [segmentType, setSegmentType] = useState<RundownSegmentType>('REPORT');
  const [durationInput, setDurationInput] = useState('03:00'); // MM:SS
  const [presenterName, setPresenterName] = useState(defaultPresenter);
  const [segGuests, setSegGuests] = useState<SegmentGuest[]>([]);
  const [topicId, setTopicId] = useState('');
  const [report, setReport] = useState<ReportBrief>(NO_SOURCE);
  const [reportTarget, setReportTarget] = useState('');
  const [sendReportRequest, setSendReportRequest] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const reporters = useMemo(
    () => apiService.getUsers().filter((u) => u.isActive !== false && departmentIdOf(u) === 'field'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isOpen]
  );
  const existingReportRequest = segment?.id
    ? apiService.getRequests().find((r) => r.link?.segmentId === segment.id && (r.type === 'FIELD' || r.type === 'ARCHIVE') && !isRequestClosed(r.status))
    : undefined;
  const [newsId, setNewsId] = useState('');
  const [scriptText, setScriptText] = useState('');
  const [videoAssetUrl, setVideoAssetUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [mediaIds, setMediaIds] = useState<string[]>([]);
  useEffect(() => {
    if (!isOpen || !focusField) return;
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(focusField);
      target?.scrollIntoView({ block: 'center' });
      target?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [isOpen, focusField]);
  const currentUser = apiService.getCurrentUser();

  /** Attaching an edited package fills in its real length. */
  const handleMediaChange = (ids: string[]) => {
    const added = ids.filter((id) => !mediaIds.includes(id));
    setMediaIds(ids);
    const video = apiService.getMedia().find((m) => added.includes(m.id) && m.mediaType === 'VIDEO' && (m.durationSeconds || 0) > 0);
    if (video?.durationSeconds) {
      const secs = Math.round(video.durationSeconds);
      setDurationInput(`${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`);
    }
  };

  const DURATION_PRESETS = [
    { label: '+15ث', seconds: 15, isAdd: true },
    { label: '+30ث', seconds: 30, isAdd: true },
    { label: '01:00', seconds: 60, isAdd: false },
    { label: '02:00', seconds: 120, isAdd: false },
    { label: '03:00', seconds: 180, isAdd: false },
    { label: '05:00', seconds: 300, isAdd: false },
    { label: '10:00', seconds: 600, isAdd: false },
  ];


  useEffect(() => {
    if (segment) {
      setTitle(segment.title);
      setSegmentType(segment.segmentType);
      const mins = Math.floor(segment.durationSeconds / 60);
      const secs = segment.durationSeconds % 60;
      setDurationInput(`${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`);
      setPresenterName(segment.presenterName || defaultPresenter);
      setSegGuests(segmentGuests(segment));
      setTopicId(segment.topicId || '');
      setReport(segment.report || NO_SOURCE);
      setReportTarget(mmss(segment.report?.targetSeconds));
      setSendReportRequest(!segment.report);
      setNewsId(segment.newsId || '');
      setScriptText(segment.scriptText || '');
      setVideoAssetUrl(segment.videoAssetUrl || '');
      setNotes(segment.notes || '');
      setMediaIds(segment.mediaIds || []);
    } else {
      setTitle('');
      setSegmentType(defaultType || 'REPORT');
      setDurationInput('03:00');
      setPresenterName(defaultPresenter);
      setSegGuests([]);
      setTopicId(defaultTopicId || '');
      setReport(NO_SOURCE);
      setReportTarget('');
      setSendReportRequest(true);
      setNewsId('');
      setScriptText('');
      setVideoAssetUrl('');
      setNotes('');
      setMediaIds([]);
    }
    setFormError(null);
  }, [segment, defaultPresenter, isOpen, defaultTopicId, defaultType]);

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
    // Empty input means the standard 3 minutes; an explicit value (even 0) is kept.
    const durationSeconds = durationInput.trim() ? parseTimeToSeconds(durationInput) : (apiService.getSettings().defaultSegmentDurationSeconds ?? 180);
    const selectedNews = newsList.find((n) => n.id === newsId);
    const isReport = segmentType === 'REPORT';
    // A brief exists once the producer picks where the report comes from.
    const brief: ReportBrief | undefined = isReport && report.source
      ? {
          ...report,
          reporterName: report.source === 'ASSIGNED' ? reporters.find((u) => u.id === report.reporterId)?.fullName : undefined,
          reporterId: report.source === 'ASSIGNED' ? report.reporterId : undefined,
          targetSeconds: reportTarget.trim() ? parseTimeToSeconds(reportTarget) : undefined,
        }
      : undefined;
    const briefError = reportBriefError(brief);
    if (briefError) {
      setFormError(briefError);
      return;
    }
    const id = segment?.id || newId('seg');

    onSave(
      withSegmentGuests(
        {
          id,
          title,
          segmentType,
          durationSeconds,
          presenterName,
          topicId: topicId || undefined,
          newsId: newsId || undefined,
          newsTitle: selectedNews?.shortTitle || selectedNews?.title,
          scriptText,
          videoAssetUrl: videoAssetUrl || undefined,
          mediaIds,
          notes,
          report: brief,
        } as Partial<RundownSegment>,
        segGuests
      )
    );

    // The brief goes to the department that will produce the material.
    const requestType = brief ? reportSourceOf(brief.source)?.requestType : null;
    if (brief && requestType && episodeId && sendReportRequest && !existingReportRequest) {
      const details = [
        brief.location && `الموقع: ${brief.location}`,
        brief.shots && `اللقطات والمقابلات المطلوبة: ${brief.shots}`,
        brief.soundbites && `التصريحات المطلوبة: ${brief.soundbites}`,
        brief.targetSeconds && `المدة المستهدفة: ${mmss(brief.targetSeconds)}`,
        brief.sourceNote && `ملاحظات: ${brief.sourceNote}`,
      ]
        .filter(Boolean)
        .join('\n');
      try {
        apiService.createRequest({
          type: requestType,
          title: `${requestType === 'ARCHIVE' ? 'مواد أرشيف' : 'تقرير مصور'}: ${title}`,
          details,
          dueAt: brief.dueAt,
          link: { kind: 'segment', episodeId, segmentId: id, title },
          addressedToId: brief.source === 'ASSIGNED' ? brief.reporterId : undefined,
          addressedToName: brief.reporterName,
        });
      } catch (err: any) {
        notify({ type: 'warning', message: `حُفظت الفقرة، لكن تعذر إرسال الطلب: ${err?.message || ''}` });
      }
    }
    onClose();
  };

  const addGuest = (guestId: string) => {
    const g = guests.find((x) => x.id === guestId);
    if (!g || segGuests.some((x) => x.guestId === guestId)) return;
    setSegGuests([...segGuests, { guestId: g.id, guestName: g.fullName, role: segGuests.length ? 'COMMENTATOR' : 'MAIN' }]);
  };

  const segmentTypes: { type: RundownSegmentType; label: string; icon: any; color: string }[] = [
    { type: 'INTRO', label: 'مقدمة / شارة', icon: Sparkles, color: 'text-amber-700 bg-amber-50 border-amber-200' },
    { type: 'REPORT', label: 'تقرير مصور / VT', icon: Film, color: 'text-blue-600 bg-blue-50 border-blue-200' },
    { type: 'NEWS_ITEM', label: 'خبر قارئ / Reader', icon: Tv, color: 'text-indigo-600 bg-indigo-50 border-indigo-200' },
    { type: 'LIVE_INTERVIEW', label: 'مقابلة حية / Live', icon: Mic, color: 'text-purple-600 bg-purple-50 border-purple-200' },
    { type: 'DISCUSSION', label: 'حلقة نقاش / طاولة', icon: Users, color: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
    { type: 'BREAK', label: 'فاصل إعلاني', icon: Clock, color: 'text-slate-600 bg-slate-100 border-slate-300' },
    { type: 'OUTRO', label: 'خاتمة وتتر', icon: Volume2, color: 'text-rose-600 bg-rose-50 border-rose-200' },
  ];

  return (
    <FormPage
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
            <label htmlFor="segment-title-input" className="block text-xs font-bold text-slate-700">اسم أو موضوع الفقرة *</label>
            {title && (
              <button
                type="button"
                onClick={() => setTitle('')}
                className="text-[10px] text-slate-500 hover:text-rose-500"
              >
                مسح
              </button>
            )}
          </div>
          <div className="relative">
            <input
              id="segment-title-input"
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="مثال: التقرير الافتتاحي للقمة الاقتصادية"
              className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-sm font-bold text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
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
              <label htmlFor="segment-duration-input" className="block text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-blue-600" />
                المدة المقررة للبث (دقيقة : ثانية) *
              </label>
              <span className="text-[10px] text-slate-500">تنسيق MM:SS (مثلاً 02:30)</span>
            </div>

            <input
              id="segment-duration-input"
              type="text"
              required
              value={durationInput}
              onChange={(e) => setDurationInput(e.target.value)}
              placeholder="03:00"
              pattern="^[0-9]{1,2}:[0-9]{2}$"
              inputMode="numeric"
              title="أدخل الوقت بصيغة MM:SS مثل 03:30"
              className="w-28 px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-base font-black text-center font-mono text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
              dir="ltr"
            />
          </div>

          {/* Quick Preset Buttons */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-[10px] text-slate-500 font-bold">تحديد سريع:</span>
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
            <label htmlFor="segment-presenter-input" className="block text-xs font-bold text-slate-700 mb-1">المذيع / القارئ</label>
            <input
              id="segment-presenter-input"
              type="text"
              value={presenterName}
              onChange={(e) => setPresenterName(e.target.value)}
              placeholder="اسم المذيع أو المعلق"
              className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs font-medium text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
            />
          </div>

          {topics.length > 0 && (
            <div>
              <label htmlFor="segment-topic-select" className="block text-xs font-bold text-slate-700 mb-1">المحور</label>
              <select
                id="segment-topic-select"
                value={topicId}
                onChange={(e) => setTopicId(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 font-medium"
              >
                <option value="">-- بدون محور (مقدمة، فاصل، ختام) --</option>
                {topics.map((t, i) => (
                  <option key={t.id} value={t.id}>
                    {i + 1}. {t.title}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Guests of the segment */}
        {segmentType !== 'BREAK' && (
          <fieldset className="p-3 rounded-xl border border-slate-200 space-y-2" aria-label="ضيوف الفقرة">
            <legend className="px-1 text-xs font-bold text-slate-700">ضيوف الفقرة ({segGuests.length})</legend>
            {segGuests.map((g, i) => (
              <div key={g.guestId} className="flex flex-wrap items-center gap-2 p-2 rounded-lg bg-slate-50 border border-slate-100">
                <span className="text-xs font-bold text-slate-800 flex-1 min-w-[8rem]">{g.guestName}</span>
                <select
                  aria-label={`دور ${g.guestName}`}
                  value={g.role}
                  onChange={(e) => setSegGuests(segGuests.map((x, j) => (j === i ? { ...x, role: e.target.value as GuestRole } : x)))}
                  className="px-2 py-1 border border-slate-300 rounded-lg text-xs bg-white"
                >
                  {GUEST_ROLES.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={() => setSegGuests(segGuests.filter((_, j) => j !== i))} aria-label={`إزالة ${g.guestName}`} className="p-1 text-slate-500 hover:text-rose-600">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            <select
              id="segment-guest-select"
              aria-label="إضافة ضيف للفقرة"
              value=""
              onChange={(e) => addGuest(e.target.value)}
              className="w-full px-3.5 py-2 bg-white border border-dashed border-slate-300 rounded-xl text-xs text-slate-700"
            >
              <option value="">+ إضافة ضيف من بنك الضيوف…</option>
              {guests
                .filter((g) => !segGuests.some((x) => x.guestId === g.id))
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.fullName} ({g.organization})
                  </option>
                ))}
            </select>
            {segGuests.length > 0 && <p className="text-[10px] text-slate-500">يُضاف الضيوف تلقائياً لقائمة ضيوف الحلقة كمرشحين حتى تأكيد حجزهم.</p>}
          </fieldset>
        )}

        {/* Report brief */}
        {segmentType === 'REPORT' && (
          <fieldset className="p-3.5 rounded-xl border border-blue-200 bg-blue-50/40 space-y-3" aria-label="أمر تكليف التقرير">
            <legend className="px-1 text-xs font-bold text-blue-800">أمر تكليف التقرير المصور</legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5" role="radiogroup" aria-label="مصدر التقرير">
              {REPORT_SOURCES.map((src) => (
                <button
                  key={src.id}
                  type="button"
                  role="radio"
                  aria-checked={report.source === src.id}
                  onClick={() => setReport({ ...report, source: src.id })}
                  className={`p-2 rounded-lg border text-right transition-colors ${
                    report.source === src.id ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <span className="block text-xs font-bold">{src.name}</span>
                  <span className={`block text-[10px] ${report.source === src.id ? 'text-blue-100' : 'text-slate-500'}`}>{src.hint}</span>
                </button>
              ))}
            </div>
            {report.source === 'ASSIGNED' && (
              <div>
                <label htmlFor="report-reporter" className="block text-xs font-bold text-slate-700 mb-1">المراسل المكلف *</label>
                <select
                  id="report-reporter"
                  value={report.reporterId || ''}
                  onChange={(e) => setReport({ ...report, reporterId: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs"
                >
                  <option value="">-- اختر مراسلاً --</option>
                  {reporters.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.fullName}
                    </option>
                  ))}
                </select>
                {reporters.length === 0 && <p className="text-[10px] text-rose-600 mt-1">لا يوجد مستخدمون في قسم المراسلين.</p>}
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div>
                <label htmlFor="report-location" className="block text-[11px] font-bold text-slate-700 mb-1">موقع التصوير</label>
                <input id="report-location" value={report.location || ''} onChange={(e) => setReport({ ...report, location: e.target.value })} className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs" />
              </div>
              <div>
                <label htmlFor="report-target" className="block text-[11px] font-bold text-slate-700 mb-1">المدة المستهدفة (MM:SS)</label>
                <input id="report-target" dir="ltr" placeholder="02:30" value={reportTarget} onChange={(e) => setReportTarget(e.target.value)}
                  onBlur={() => {
                    // A new report is planned at its target length.
                    if (!segment && /^[0-9]{1,2}:[0-9]{2}$/.test(reportTarget)) setDurationInput(reportTarget.padStart(5, '0'));
                  }} pattern="^[0-9]{1,2}:[0-9]{2}$" className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-mono text-center" />
              </div>
              <div>
                <label htmlFor="report-due" className="block text-[11px] font-bold text-slate-700 mb-1">موعد التسليم</label>
                <input id="report-due" type="datetime-local" value={toLocalInput(report.dueAt)} onChange={(e) => setReport({ ...report, dueAt: fromLocalInputValue(e.target.value) || undefined })} className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label htmlFor="report-shots" className="block text-[11px] font-bold text-slate-700 mb-1">اللقطات والمقابلات المطلوبة</label>
                <textarea id="report-shots" rows={2} value={report.shots || ''} onChange={(e) => setReport({ ...report, shots: e.target.value })} className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs" />
              </div>
              <div>
                <label htmlFor="report-soundbites" className="block text-[11px] font-bold text-slate-700 mb-1">التصريحات</label>
                <textarea id="report-soundbites" rows={2} value={report.soundbites || ''} onChange={(e) => setReport({ ...report, soundbites: e.target.value })} className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs" />
              </div>
            </div>
            <div>
              <label htmlFor="report-note" className="block text-[11px] font-bold text-slate-700 mb-1">
                {report.source === 'AGENCY' ? 'الوكالة ورقم المادة' : report.source === 'ARCHIVE' ? 'المواد المطلوبة من الأرشيف' : 'ملاحظات للمنفذ'}
              </label>
              <input id="report-note" value={report.sourceNote || ''} onChange={(e) => setReport({ ...report, sourceNote: e.target.value })} className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs" />
            </div>
            {reportSourceOf(report.source)?.requestType && episodeId && (
              existingReportRequest ? (
                <p className="text-[11px] text-emerald-700 font-bold">أُرسل الطلب للقسم ({existingReportRequest.addressedToName || existingReportRequest.assigneeName || 'بانتظار الاستلام'}).</p>
              ) : (
                <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
                  <input type="checkbox" checked={sendReportRequest} onChange={(e) => setSendReportRequest(e.target.checked)} />
                  إرسال الطلب إلى {report.source === 'ARCHIVE' ? 'قسم الأرشيف' : report.source === 'ASSIGNED' ? 'المراسل المختار' : 'قسم المراسلين'} عند الحفظ
                </label>
              )
            )}
            {!report.source && <p className="text-[11px] font-bold text-amber-800">اختر مصدر التقرير لإنشاء أمر التكليف (اختياري).</p>}
            <p className="text-[10px] text-slate-500">بعد وصول المادة: أرفق الفيديو أدناه أو اطلب المونتاج من الرانداون؛ تتحدث جاهزية الفقرة تلقائياً.</p>
          </fieldset>
        )}

        {/* Related News & Video URL */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="segment-news-select" className="block text-xs font-bold text-slate-700 mb-1">ربط بخبر من غرفة الأخبار</label>
            <select
              id="segment-news-select"
              value={newsId}
              onChange={(e) => setNewsId(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all font-medium"
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
              <label htmlFor="segment-video-input" className="block text-xs font-bold text-slate-700">معرّف سيرفر البث (اختياري)</label>
              {videoAssetUrl && (
                <button
                  type="button"
                  onClick={() => setVideoAssetUrl('')}
                  className="text-[10px] text-slate-500 hover:text-rose-500"
                >
                  مسح
                </button>
              )}
            </div>
            <input
              id="segment-video-input"
              type="text"
              value={videoAssetUrl}
              onChange={(e) => setVideoAssetUrl(e.target.value)}
              placeholder="Playout Server ID أو رابط MP4"
              className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-left font-mono text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
              dir="ltr"
              autoCapitalize="none"
              spellCheck="false"
            />
          </div>
        </div>

        <div className="p-3 rounded-xl border border-slate-200 bg-slate-50/60">
          <AttachmentsPanel mediaIds={mediaIds} onChange={handleMediaChange} currentUser={currentUser} title="فيديو ومواد الفقرة" />
        </div>

        {/* Autocue / Script Text with Live Reading Pace Calculator */}
        <LongTextField
          id="segment-script-textarea"
          name="نص المذيع"
          sizeKey="anchor-script"
          label="نص الأوتوكيو / القراءة للمذيع"
          aside={
            scriptSpeechPace && (
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
            )
          }
          rows={5}
          value={scriptText}
          onChange={(e) => setScriptText(e.target.value)}
          placeholder="النص الذي سيظهر على شاشة المذيع أو التوجيه الصوتي على الهواء..."
          className="px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />

        {/* Notes */}
        <div>
          <label htmlFor="segment-notes-input" className="block text-xs font-bold text-slate-700 mb-1">ملاحظات المخرج وغرفة التحكم (MCR)</label>
          <input
            id="segment-notes-input"
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="مثال: استخدام كاميرا 2، نزول شارة الضيف، خفض الصوت تدريجياً"
            className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
          />
        </div>

        {formError && (
          <p role="alert" className="text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2">
            {formError}
          </p>
        )}

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
    </FormPage>
  );
};
