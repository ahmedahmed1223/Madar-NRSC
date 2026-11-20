import { arabicDate } from '../shared/dates';
import { minutesGap, minutesLabel, minutesOf } from '../shared/durations';
import { countLabel } from '../shared/arabicPlural';
import { EP_NOUNS } from '../shared/episodeNouns';
import { appLocale, zoneOptions } from '../shared/dateFormat';
import { alertDialog, confirmDialog } from '../services/dialogs';
import { ExportMenu, docContext } from '../components/common/ExportMenu';
import { episodeFileDoc, episodeRundownDoc, guestSheetDoc, presenterSheetDoc } from '../services/documents/builders';
import { CommentThread } from '../components/comments/CommentThread';
import { apiService } from '../services/api';
import { dataStore } from '../services/dataStore';
import { episodeReadiness } from '../shared/production';
import { episodeStudioBookings } from '../shared/productionWorkQueues';
import { ENTITY_ID_PATTERN } from '../shared/collections';
import { departmentName } from '../shared/departments';
import { BookingForm } from '../components/planning/BookingForm';
import { ProductionFollowUp } from '../components/common/ProductionFollowUp';
import { ProductionAssignmentForm } from '../components/bulletins/AssignmentForm';
import { LongTextField } from '../components/common/TextSizeControls';
import { bookingStatusOf, type Booking } from '../shared/planning';
import { RbacService } from '../services/rbacService';
import React, { useState , useRef, useEffect} from 'react';
import { CalendarPlus, ArrowRight, ListOrdered, HelpCircle, Users, FileText, Clock, Tv, Save, X, Copy, Check, Lock, MessageSquareText, Layers, Edit2 } from 'lucide-react';
import { EpisodePlanner } from '../components/episodes/EpisodePlanner';
import { EpisodeGuestsPanel } from '../components/episodes/EpisodeGuestsPanel';
import { EpisodeQuestionsPanel } from '../components/episodes/EpisodeQuestionsPanel';
import { EpisodeDetailsEditor } from '../components/episodes/EpisodeDetailsEditor';
import { EPISODE_STATUS_INFO, episodeStatusInfo } from '../components/episodes/episodeDetails';
import { episodeGuestList, segmentGuests } from '../shared/episodePlan';
import { Episode, RundownSegment, Guest, NewsItem, User, EpisodeStatus } from '../types';
import { useEditLock } from '../hooks/useNewsEditLock';
import { useFormDraft } from '../hooks/useFormDraft';
import { DraftStatus } from '../components/common/DraftStatus';
import { RundownTable } from '../components/rundown/RundownTable';
import { Breadcrumbs } from '../components/layout/Breadcrumbs';
import { PronunciationPanel } from '../components/rundown/PronunciationPanel';
import { matchingPronunciations } from '../shared/pronunciation';
import { saveFeedback, type SaveState } from '../shared/saveFeedback';

interface EpisodeWorkspaceViewProps {
  episode: Episode;
  allGuests: Guest[];
  allNews: NewsItem[];
  currentUser: User;
  onUpdateRundown: (segments: RundownSegment[]) => void;
  onSaveEpisode: (episodeData: Partial<Episode>) => boolean | Promise<boolean>;
  onBack: () => void;
  onOpenNews?: (id: string) => void;
  onOpenRequests?: (segmentId: string) => void;
  initialSegmentId?: string;
}

export const EpisodeWorkspaceView: React.FC<EpisodeWorkspaceViewProps> = ({
  episode,
  allGuests,
  allNews,
  currentUser,
  onUpdateRundown,
  onSaveEpisode,
  onBack,
  onOpenNews,
  onOpenRequests,
  initialSegmentId,
}) => {
  const [activeTab, setActiveTab] = useState<'PLAN' | 'RUNDOWN' | 'QUESTIONS' | 'GUESTS' | 'SCRIPT' | 'NOTES'>('PLAN');

  // What this user may change (mirrors the server's episodesPolicy).
  const can = (perm: string) => RbacService.hasPermission(currentUser, perm);
  const mayEditEpisode = can('episodes.edit');
  const mayEditRundown = mayEditEpisode || can('rundown.edit') || can('rundown.reorder');
  const mayEditQuestions = mayEditEpisode || can('rundown.presenter_teleprompter');

  // Hold the episode's edit lock while this workspace is open so colleagues cannot save over it.
  const lock = useEditLock('episodes', episode.id, mayEditRundown || mayEditQuestions);
  const lockedByOther = lock.status === 'locked';
  const canEditEpisode = mayEditEpisode && !lockedByOther;
  const canEditRundown = mayEditRundown && !lockedByOther;
  const canEditQuestions = mayEditQuestions && !lockedByOther;

  // Script state (follows the server copy unless the user has unsaved edits)
  const [introScript, setIntroScript] = useState(episode.introScript || '');
  const loadedScriptRef = useRef(episode.introScript || '');
  const scriptDraft = useFormDraft(`episode-script:${currentUser.id}:${episode.id}`, mayEditEpisode, introScript, setIntroScript);
  const [undoScript, setUndoScript] = useState<string | null>(null);
  const changeScript = (next: string) => {
    setUndoScript(introScript);
    setIntroScript(next);
  };
  useEffect(() => {
    const incoming = episode.introScript || '';
    if (incoming !== loadedScriptRef.current && introScript === loadedScriptRef.current) {
      setIntroScript(incoming);
      loadedScriptRef.current = incoming;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episode.introScript]);
  const [copiedScript, setCopiedScript] = useState(false);
  const [editingDetails, setEditingDetails] = useState(false);
  const statusInfo = episodeStatusInfo(episode.status);

  const handleCopyScript = () => {
    if (!introScript) return;
    navigator.clipboard.writeText(introScript);
    setCopiedScript(true);
    setTimeout(() => setCopiedScript(false), 2000);
  };

  // Status updates
  const [, refreshPreparation] = useState(0);
  useEffect(() => dataStore.subscribe(event => {
    if (event.type === 'sync-status' || (event.type === 'data-changed' && event.collections.some(collection => ['requests', 'media', 'bookings', 'resources'].includes(collection)))) {
      refreshPreparation(revision => revision + 1);
    }
  }), []);
  const requests = apiService.getRequests();
  const readiness = episodeReadiness(episode, { requests, media: apiService.getMedia() });
  // Timing plan is separate from material readiness: planned rundown vs the slot.
  const slotSeconds = (Number(episode.durationMinutes) || 0) * 60;
  const plannedSeconds = (episode.rundown || []).reduce((sum, seg: any) => sum + (Number(seg.durationSeconds) || 0), 0);
  const timingGap = plannedSeconds - slotSeconds; // negative = under, positive = over
  const timingOk = slotSeconds === 0 || Math.abs(timingGap) <= Math.max(60, slotSeconds * 0.05);
  const gap = minutesGap(plannedSeconds, slotSeconds);
  const [showBlockers, setShowBlockers] = useState(false);
  const [focusSegment, setFocusSegment] = useState<{ id: string; key: string; sequence: number } | undefined>();
  const linkedSegment = initialSegmentId && ENTITY_ID_PATTERN.test(initialSegmentId) ? episode.rundown?.find(segment => segment.id === initialSegmentId) : undefined;
  useEffect(() => {
    if (!initialSegmentId || !linkedSegment) {
      setFocusSegment(previous => previous?.key === 'link' ? undefined : previous);
      return;
    }
    setActiveTab('RUNDOWN');
    setFocusSegment({ id: initialSegmentId, key: 'link', sequence: Date.now() });
  }, [episode.id, initialSegmentId, !!linkedSegment]);
  const resolveBlocker = (blocker: typeof readiness.blockers[number]) => {
    if (blocker.key.startsWith('req:')) { onOpenRequests?.(blocker.segmentId); return; }
    setFocusSegment({ id: blocker.segmentId, key: blocker.key, sequence: Date.now() });
    setActiveTab(blocker.key === 'guest' ? 'GUESTS' : blocker.key === 'questions' ? 'QUESTIONS' : 'RUNDOWN');
  };
  useEffect(() => {
    if (!focusSegment || activeTab !== 'GUESTS') return;
    const segment = episode.rundown.find(s => s.id === focusSegment.id);
    const guestId = segmentGuests(segment)[0]?.guestId;
    const frame = requestAnimationFrame(() => {
      const target = guestId ? document.getElementById(`episode-guest-${guestId}`) : document.querySelector('[data-testid="episode-guests"]');
      target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      (target as HTMLElement | null)?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusSegment, activeTab]);
  const [booking, setBooking] = useState<{ data: Partial<Booking>; studioOnly: boolean } | null>(null);
  const canBook = RbacService.hasPermission(currentUser, 'resources.book') || RbacService.hasPermission(currentUser, 'resources.manage');
  const canSeeBookings = canBook || RbacService.canOpenScreen(currentUser, 'bookings');
  const resources = canSeeBookings ? apiService.getResources() : [];
  const studioBookings = canSeeBookings ? episodeStudioBookings(episode.id, apiService.getBookings(), resources) : [];
  const openBooking = (studioOnly: boolean) => {
    const day = (episode.recordingDate || episode.broadcastDate || '').slice(0, 10);
    const [y, m, d] = (day || new Date().toISOString().slice(0, 10)).split('-').map(Number);
    const [hh, mm] = (episode.startTime || '09:00').split(':').map(Number);
    const start = new Date(y, m - 1, d, hh || 9, mm || 0);
    // Studio time: an hour of preparation before air, and the programme's length after.
    const from = new Date(start.getTime() - 60 * 60_000);
    const to = new Date(start.getTime() + Math.max(episode.durationMinutes || 60, 30) * 60_000);
    const studio = resources.find(resource => resource.kind === 'STUDIO' && resource.isActive !== false && resource.name === episode.studioName)
      || resources.find(resource => resource.kind === 'STUDIO' && resource.isActive !== false);
    const title = `${episode.programName} — ${episode.title}`;
    setBooking({ studioOnly, data: { resourceId: studioOnly ? studio?.id : undefined, title, start: from.toISOString(), end: to.toISOString(), link: { kind: 'episode', id: episode.id, title } } });
  };
  const guestCount = episodeGuestList(episode).length;
  const guestWait = readiness.blockers.some(blocker => blocker.key === 'guest');
  const openPreparationTab = (tab: 'RUNDOWN' | 'GUESTS') => {
    setActiveTab(tab);
    requestAnimationFrame(() => document.getElementById(`episode-tab-${tab}`)?.focus());
  };

  const [savingStatus, setSavingStatus] = useState(false);
  const savingStatusRef = useRef(false);
  const handleUpdateStatus = async (newStatus: EpisodeStatus) => {
    if (!canEditEpisode || lock.status === 'acquiring' || savingStatusRef.current) return;
    if (newStatus === 'READY_FOR_BROADCAST' && episode.status !== 'READY_FOR_BROADCAST' && !readiness.ready) {
      setShowBlockers(true);
      void alertDialog({ title: 'الحلقة غير جاهزة للبث', message:
        readiness.total === 0
          ? 'لا يمكن اعتماد حلقة بلا فقرات للبث.'
          : `لا يمكن اعتماد الحلقة للبث بعد. النواقص: ${countLabel(readiness.blockers.length, EP_NOUNS.item)}.\n\n` +
              readiness.blockers.slice(0, 6).map((b) => `• ${b.segmentTitle}: ${b.detail} (${departmentName(b.departmentId)})`).join('\n')
       });
      return;
    }
    if (newStatus === 'READY_FOR_BROADCAST' && episode.status !== 'READY_FOR_BROADCAST' && !timingOk) {
      const msg =
        timingGap < 0
          ? `الرانداون أقصر من مدة الحلقة بـ ${minutesLabel(timingGap)} (المخطط ${minutesOf(plannedSeconds, slotSeconds)}).`
          : `الرانداون أطول من مدة الحلقة بـ ${minutesLabel(timingGap)} (المخطط ${minutesOf(plannedSeconds, slotSeconds)}).`;
      if (!(await confirmDialog(`${msg}\n\nاعتماد الحلقة للبث رغم ذلك؟`))) return;
    }
    savingStatusRef.current = true;
    setSavingStatus(true);
    try {
      await onSaveEpisode({ id: episode.id, status: newStatus });
    } finally {
      savingStatusRef.current = false;
      setSavingStatus(false);
    }
  };

  const [savingScript, setSavingScript] = useState(false);
  const [scriptSaveState, setScriptSaveState] = useState<SaveState>('idle');
  const savingScriptRef = useRef(false);
  const handleSaveIntroScript = async () => {
    if (savingScriptRef.current || !canEditEpisode || lock.status === 'acquiring') return;
    savingScriptRef.current = true;
    const savedText = introScript;
    setSavingScript(true);
    try {
      if (await onSaveEpisode({ id: episode.id, introScript: savedText })) {
        loadedScriptRef.current = savedText;
        scriptDraft.clearDraft();
        setScriptSaveState('saved');
      } else {
        setScriptSaveState('failed');
      }
    } catch {
      setScriptSaveState('failed');
    } finally { savingScriptRef.current = false; setSavingScript(false); }
  };

  return (
    <div className="space-y-6">
      {/* Contextual Navigation Breadcrumbs */}
      <div className="hidden sm:block">
      <Breadcrumbs
        items={[
          { label: 'دليل الحلقات', onClick: onBack },
          { label: episode.programName },
          { label: `حلقة ${episode.episodeNumber}` },
        ]}
        statusBadge={{
          label: statusInfo.label,
          variant: statusInfo.variant === 'purple' || statusInfo.variant === 'info' ? 'primary' : statusInfo.variant,
        }}
        onBack={onBack}
        backLabel="العودة للحلقات"
      />
      </div>

      {lockedByOther && lock.holder && (
        <div role="alert" className="bg-amber-50 border border-amber-300 p-4 rounded-2xl flex flex-wrap items-center justify-between gap-3 text-amber-900">
          <div className="flex items-center gap-2.5">
            <Lock className="w-5 h-5 text-amber-700 shrink-0" />
            <div>
              <strong className="text-xs font-bold block">هذه الحلقة قيد التحرير الآن لدى {lock.holder.userName}</strong>
              <span className="text-2xs text-amber-700">يمكنك المتابعة للقراءة فقط، وستُتاح الكتابة تلقائياً عند إغلاقه لمساحة العمل.</span>
            </div>
          </div>
          {can('rundown.lock_override') && (
            <button
              type="button"
              onClick={async () => {
                if ((await confirmDialog(`سيفقد ${lock.holder?.userName} أي تعديلات غير محفوظة. تولي تحرير الحلقة؟`))) void lock.takeOver();
              }}
              className="px-3 py-1.5 bg-amber-700 hover:bg-amber-800 text-white rounded-lg text-xs font-bold"
            >
              تولي التحرير
            </button>
          )}
        </div>
      )}

      {/* Top Episode Banner */}
      <div className="border-b border-slate-200 pb-4 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onBack}
              className="sm:hidden min-h-11 min-w-11 inline-flex items-center justify-center shrink-0 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors"
              aria-label="العودة للحلقات"
              title="العودة للحلقات"
            >
              <ArrowRight className="w-5 h-5" aria-hidden />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded-md">
                  {episode.programName}
                </span>
                <span className="text-xs text-slate-500 tabular-nums">
                  حلقة {episode.episodeNumber} · الموسم {episode.seasonNumber}
                </span>
              </div>
              <h1 className="text-lg sm:text-xl font-bold text-slate-800 mt-1 break-words">
                {episode.title}
              </h1>
            </div>
          </div>

          {/* Episode Live Status Controller */}
          <div className="flex flex-wrap items-center gap-2 self-start md:self-center">
            {mayEditEpisode && (
              <button
                type="button"
                onClick={() => setEditingDetails(true)}
                disabled={!canEditEpisode || lock.status === 'acquiring'}
                title={lockedByOther ? `الحلقة قيد التحرير لدى ${lock.holder?.userName || 'زميل آخر'}` : 'تعديل العنوان والرقم وموعد البث والطاقم'}
                className="min-h-11 inline-flex items-center gap-1.5 px-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700 disabled:opacity-50"
              >
                <Edit2 className="w-4 h-4" />
                تعديل بيانات الحلقة
              </button>
            )}
            {canBook && <button type="button" onClick={() => openBooking(false)} className="min-h-11 inline-flex items-center gap-1.5 px-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700"><CalendarPlus className="w-4 h-4" />حجز مورد</button>}
            <ExportMenu
              items={[
                { id: 'file', label: 'ملف الحلقة الكامل', hint: 'الملخص والرانداون حسب المحاور والضيوف والأسئلة', build: () => episodeFileDoc(episode, allGuests, docContext()) },
                { id: 'rundown', label: 'رانداون الحلقة', hint: 'للمخرج والكنترول', build: () => episodeRundownDoc(episode, docContext()) },
                { id: 'presenter', label: 'ورقة المذيع', hint: 'المقدمة ونصوص الفقرات والأسئلة', build: () => presenterSheetDoc(episode, docContext()) },
                { id: 'guests', label: 'ورقة الضيوف والشارات', hint: 'الحجز والهواتف ونصوص الشارات', build: () => guestSheetDoc(episode, allGuests, docContext()) },
              ]}
            />
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-slate-500 font-semibold">حالة الحلقة:</span>
              <select
                aria-label="حالة الحلقة"
                value={episode.status}
                onChange={(e) => handleUpdateStatus(e.target.value as EpisodeStatus)}
                aria-busy={savingStatus}
                disabled={!canEditEpisode || lock.status === 'acquiring' || savingStatus}
                className="min-h-11 px-3 border border-slate-300 rounded-lg text-xs font-bold bg-white focus:ring-2 focus:ring-blue-500"
              >
                {EPISODE_STATUS_INFO.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {editingDetails && (
          <EpisodeDetailsEditor
            episode={episode}
            episodes={apiService.getEpisodes()}
            currentUser={currentUser}
            onClose={() => setEditingDetails(false)}
            onSaveEpisode={onSaveEpisode}
            lock={{ status: lock.status, holderName: lock.holder?.userName }}
          />
        )}
        {booking && <BookingForm isOpen confirmOnSave reconfirmOnReschedule={booking.studioOnly} resourceKind={booking.studioOnly ? 'STUDIO' : undefined} onClose={() => setBooking(null)} currentUser={currentUser} users={apiService.getUsers()} booking={booking.data} />}

        {/* Episode Info Bar */}
        <div className="flex flex-wrap items-center gap-4 sm:gap-8 pt-3 border-t border-slate-100 text-xs text-slate-600">
          <div className="flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-slate-500" />
            <span>موعد البث:</span>
            <strong className="text-slate-800 tabular-nums">
              {arabicDate(episode.broadcastDate)} ({episode.startTime} - {episode.endTime})
            </strong>
          </div>
          <div className="flex items-center gap-1.5">
            <Tv className="w-4 h-4 text-slate-500" />
            <span>الاستوديو:</span>
            <strong className="text-slate-800">{episode.studioName}</strong>
          </div>
          <div className="flex items-center gap-1.5">
            <span>المقدم:</span>
            <strong className="text-slate-800">{episode.presenterName}</strong>
          </div>
          <div className="flex items-center gap-1.5">
            <span>المنتج:</span>
            <strong className="text-slate-800">{episode.producerName}</strong>
          </div>
        </div>
      </div>

      {initialSegmentId && !linkedSegment && <p role="status" className="text-sm text-slate-600">الفقرة المطلوبة غير متاحة؛ يمكنك متابعة العمل من الحلقة.</p>}
      <section aria-label="قائمة تحضير الحلقة" className="p-4 rounded-2xl border bg-white border-slate-200">
        <h2 className="text-sm font-bold text-slate-900 mb-3">قائمة تحضير الحلقة</h2>
        <ul className="divide-y divide-slate-200 text-sm">
        <li className="py-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-slate-800">
              جاهزية البث: {readiness.readySegments} من {countLabel(readiness.total, EP_NOUNS.segment)} جاهزة
            </h3>
            <p className="text-2xs text-slate-500 mt-0.5">
              {readiness.ready
                ? 'كل الأقسام سلّمت المواد المطلوبة.'
                : readiness.total === 0
                ? 'أضف فقرات الرانداون أولاً.'
                : `بانتظار التحرير أو المونتاج أو الأقسام الأخرى: ${countLabel(readiness.blockers.length, EP_NOUNS.item)}.`}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-40 h-2 rounded-full bg-slate-200 overflow-hidden" aria-hidden>
              <div className={`h-full ${readiness.ready ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: `${readiness.total ? (readiness.readySegments / readiness.total) * 100 : 0}%` }} />
            </div>
            {readiness.blockers.length > 0 && (
              <button type="button" onClick={() => setShowBlockers((v) => !v)} aria-expanded={showBlockers} className="min-h-11 text-xs font-bold text-blue-700 hover:underline">
                {showBlockers ? 'إخفاء النواقص' : 'عرض النواقص'}
              </button>
            )}
          </div>
        </div>
        {showBlockers && readiness.blockers.length > 0 && (
          <ul className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-1.5 text-xs">
            {readiness.blockers.map((b, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 p-2 rounded-lg bg-amber-50/70 border border-amber-200">
                <span className="font-bold text-slate-800 break-words min-w-0">{b.segmentTitle}</span>
                <span className="text-amber-800">{b.detail}</span>
                <span className="text-xs text-slate-600">المسؤول: {departmentName(b.departmentId)}{requests.filter(r => r.link?.segmentId === b.segmentId && r.departmentId === b.departmentId && ['OPEN', 'ACCEPTED'].includes(r.status)).map(r => r.assigneeName || r.addressedToName).filter(Boolean).filter((name, i, all) => all.indexOf(name) === i).map(name => `، ${name}`).join('')}</span>
                <button type="button" aria-label={`معالجة النقص: ${b.segmentTitle} - ${b.label}`} onClick={() => resolveBlocker(b)} className="min-h-11 mr-auto px-3 text-blue-700 font-semibold hover:underline">معالجة النقص</button>
              </li>
            ))}
          </ul>
        )}
        </li>
        <li className="py-2 flex flex-wrap items-center justify-between gap-x-3">
          <div>
            <h3 className="font-bold text-slate-800">خطة الوقت</h3>
            <p className="text-xs text-slate-600">{slotSeconds > 0 && readiness.total > 0 ? `${minutesOf(plannedSeconds, slotSeconds)} · ${timingOk ? 'ضمن المدة المخططة' : gap.text}` : 'بانتظار تحديد مدة الحلقة وإضافة الفقرات'}</p>
          </div>
          <button type="button" onClick={() => openPreparationTab('RUNDOWN')} className="min-h-11 text-xs font-bold text-blue-700 hover:underline">مراجعة الرانداون</button>
        </li>
        <li className="py-2 flex flex-wrap items-center justify-between gap-x-3">
          <div className="min-w-0">
            <h3 className="font-bold text-slate-800">الضيوف</h3>
            <p className="text-xs text-slate-600">{!guestCount ? 'لا يوجد ضيوف مدرجون' : guestWait || readiness.warnings.length ? 'توجد حجوزات أو تجهيزات تحتاج متابعة' : 'لا توجد متابعة معلّقة للضيوف'}</p>
            {readiness.warnings.length > 0 && <ul className="mt-1 space-y-1 text-xs text-amber-800 break-words">{readiness.warnings.map((warning, index) => <li key={index}>{warning.guestName}: {warning.detail}</li>)}</ul>}
          </div>
          <button type="button" onClick={() => openPreparationTab('GUESTS')} className="min-h-11 text-xs font-bold text-blue-700 hover:underline">متابعة الضيوف</button>
        </li>
        <li className="py-2 flex flex-wrap items-center justify-between gap-x-3">
          <div className="min-w-0">
            <h3 className="font-bold text-slate-800">حجز الاستوديو</h3>
            {!canSeeBookings ? <p className="text-xs text-slate-600">تحتاج صلاحية عرض الحجوزات.</p> : studioBookings.length === 0 ? <p className="text-xs text-slate-600">لا يوجد حجز استوديو مرتبط بالحلقة.</p> : (
              <ul className="mt-1 space-y-1 text-xs text-slate-600">
                {studioBookings.map(item => {
                  const owner = apiService.getUsers().find(user => user.id === (item.assigneeId || item.bookedById))?.fullName || item.bookedByName;
                  const canEditBooking = canBook && (RbacService.hasPermission(currentUser, 'resources.manage') || item.bookedById === currentUser.id);
                  return (
                    <li key={item.id} className="flex flex-wrap items-center gap-x-2 break-words">
                      <span>{resources.find(resource => resource.id === item.resourceId)?.name} · {new Date(item.start).toLocaleString(appLocale(), { ...zoneOptions(), dateStyle: 'short', timeStyle: 'short' })} · {dataStore.hasPendingWrite('bookings', item.id) ? 'بانتظار تأكيد الخادم' : bookingStatusOf(item.status).name}{owner ? ` · ${owner}` : ''}</span>
                      {canEditBooking && <button type="button" className="min-h-11 font-bold text-blue-700 hover:underline" onClick={() => setBooking({ data: item, studioOnly: true })}>تعديل حجز الاستديو</button>}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {canBook && <button type="button" onClick={() => openBooking(true)} className="min-h-11 inline-flex items-center gap-1.5 text-xs font-bold text-blue-700 hover:underline"><CalendarPlus className="w-4 h-4" />حجز استوديو</button>}
        </li>
        </ul>
      </section>

      <div className="space-y-2">
        <ProductionAssignmentForm target={{ kind: 'EPISODE', id: episode.id, title: episode.title }} />
        <ProductionFollowUp entityId={episode.id} kind="EPISODE" user={currentUser} />
      </div>

      {/* Tabs */}
      <nav aria-label="خطوات إعداد الحلقة" className="grid grid-cols-2 sm:flex sm:flex-wrap items-stretch gap-2 border-b border-slate-200 pb-3 text-xs font-bold">
        <button
          type="button"
          onClick={() => setActiveTab('PLAN')}
          aria-pressed={activeTab === 'PLAN'}
          className={`min-h-11 flex items-center gap-2 px-3 rounded-xl transition-all ${
            activeTab === 'PLAN' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>تحضير الحلقة ({countLabel((episode.topics || []).length, EP_NOUNS.topic)})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('RUNDOWN')}
          id="episode-tab-RUNDOWN"
          aria-pressed={activeTab === 'RUNDOWN'}
          className={`min-h-11 flex items-center gap-2 px-3 rounded-xl transition-all ${
            activeTab === 'RUNDOWN'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <ListOrdered className="w-4 h-4" />
          <span>الرانداون ({episode.rundown?.length || 0})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('QUESTIONS')}
          aria-pressed={activeTab === 'QUESTIONS'}
          className={`min-h-11 flex items-center gap-2 px-3 rounded-xl transition-all ${
            activeTab === 'QUESTIONS'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <HelpCircle className="w-4 h-4" />
          <span>أسئلة الحوارات ({episode.questions?.length || 0})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('GUESTS')}
          id="episode-tab-GUESTS"
          aria-pressed={activeTab === 'GUESTS'}
          className={`min-h-11 flex items-center gap-2 px-3 rounded-xl transition-all ${
            activeTab === 'GUESTS'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>الضيوف والحجز ({episodeGuestList(episode).length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('SCRIPT')}
          aria-pressed={activeTab === 'SCRIPT'}
          className={`min-h-11 flex items-center gap-2 px-3 rounded-xl transition-all ${
            activeTab === 'SCRIPT'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>سكريبت المقدمة والأوتوكيو</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('NOTES')}
          aria-pressed={activeTab === 'NOTES'}
          className={`min-h-11 flex items-center gap-2 px-3 rounded-xl transition-all ${
            activeTab === 'NOTES' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <MessageSquareText className="w-4 h-4" />
          <span>ملاحظات الفريق ({apiService.getComments({ kind: 'episode', id: episode.id }).length})</span>
        </button>
      </nav>

      {activeTab === 'NOTES' && (
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs">
          <CommentThread target={{ kind: 'episode', id: episode.id, title: `${episode.programName} — ${episode.title}` }} currentUser={currentUser} />
        </div>
      )}

      {activeTab === 'PLAN' && (
        <EpisodePlanner
          episode={episode}
          allGuests={allGuests}
          allNews={allNews}
          currentUser={currentUser}
          canEditEpisode={canEditEpisode}
          canEditRundown={canEditRundown}
          onSaveEpisode={onSaveEpisode}
          onUpdateRundown={onUpdateRundown}
          onOpenNews={onOpenNews}
        />
      )}

      {/* TAB 1: RUNDOWN */}
      {activeTab === 'RUNDOWN' && (
        <RundownTable
          userId={currentUser.id}
          segments={episode.rundown || []}
          plannedDurationMinutes={episode.durationMinutes}
          onUpdateRundown={onUpdateRundown}
          guests={allGuests}
          newsList={allNews}
          defaultPresenter={episode.presenterName}
          canEdit={canEditRundown}
          episodeId={episode.id}
          topics={episode.topics || []}
          focusSegment={focusSegment}
        />
      )}

      {activeTab === 'QUESTIONS' && <EpisodeQuestionsPanel episode={episode} canEdit={canEditQuestions} onSaveEpisode={onSaveEpisode} focusSegment={focusSegment} />}

      {activeTab === 'GUESTS' && (
        <EpisodeGuestsPanel
          episode={episode}
          allGuests={allGuests}
          currentUser={currentUser}
          canEditEpisode={canEditEpisode}
          canEditRundown={canEditRundown}
          onSaveEpisode={onSaveEpisode}
          onUpdateRundown={onUpdateRundown}
        />
      )}

      {/* TAB 4: SCRIPT & AUTOCUE */}
      {activeTab === 'SCRIPT' && (
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-100 pb-3 gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-800">
                سكريبت المقدمة الترحيبية
              </h3>
              <p className="text-xs text-slate-500">
                النص الكامل لقراءة المذيع في افتتاحية الحلقة على شاشة الأوتوكيو
              </p>
            </div>
            <div className="flex items-center gap-2">
              {introScript && (
                <button
                  type="button"
                  onClick={handleCopyScript}
                  className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all"
                  title="نسخ السكريبت"
                >
                  {copiedScript ? (
                    <>
                      <Check className="w-4 h-4 text-emerald-700" />
                      <span className="text-emerald-700">تم النسخ</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      <span>نسخ النص</span>
                    </>
                  )}
                </button>
              )}
              {introScript && (
                <button
                  type="button"
                  disabled={!canEditEpisode || savingScript}
                  onClick={() => changeScript('')}
                  className="flex items-center gap-1 px-3 py-2 bg-slate-50 hover:bg-rose-50 text-slate-500 hover:text-rose-600 rounded-xl text-xs font-bold transition-all"
                  title="مسح النص"
                >
                  <X className="w-4 h-4" />
                  <span>مسح</span>
                </button>
              )}
              {canEditEpisode && (
              <button
                type="button"
                onClick={handleSaveIntroScript}
                disabled={savingScript || lock.status === 'acquiring'}
                className="min-h-11 flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {savingScript ? 'جارٍ حفظ السكريبت...' : scriptSaveState === 'failed' ? 'إعادة محاولة حفظ السكريبت' : 'حفظ السكريبت'}
              </button>
              )}
            </div>
          </div>

          <DraftStatus draft={scriptDraft} />
          <PronunciationPanel notes={matchingPronunciations(introScript, apiService.getPronunciationTerms())} />
          <p role="status" aria-label="حالة حفظ السكريبت" aria-live="polite" className="text-xs text-slate-700">
            {saveFeedback(savingScript, scriptSaveState, introScript !== loadedScriptRef.current)}
          </p>
          {canEditEpisode && undoScript !== null && (
            <button type="button" disabled={savingScript} onClick={() => { setIntroScript(undoScript); setUndoScript(null); }}
              className="min-h-11 px-3 text-sm text-blue-700 font-semibold">
              تراجع عن تعديل النص
            </button>
          )}

          {/* Quick Script Presets */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-2xs font-bold text-slate-500 ml-1">قوالب جاهزة:</span>
            {[
              {
                label: 'نشرة الأخبار الرئيسية',
                text: `أهلاً بكم مشاهدينا الكرام في هذه النشرة الإخبارية الرئيسية من برنامج ${episode.programName}، نسلط الضوء الليلة على أبرز الملفات والتطورات السياسية والاقتصادية على الساحتين الإقليمية والدولية. نبدأ معكم بأبرز العناوين...`,
              },
              {
                label: 'تغطية خاصة وعاجلة',
                text: `مشاهدونا الأعزاء، نرحب بكم في هذه التغطية المباشرة والمفتوحة لمواكبة التطورات المتسارعة، حيث نتابع مع شبكة مراسلينا وضيوفنا تفاصيل المشهد والقرارات الحاسمة الصادرة للتو...`,
              },
              {
                label: 'برنامج حواري مسائي',
                text: `مساء الخير وأهلاً بكم في حلقة جديدة من ${episode.programName}. ملفات ساخنة وقراءة في كواليس الأحداث نناقشها الليلة مع ضيوفنا في الاستوديو وعبر الأقمار الصناعية...`,
              },
            ].map((preset) => (
              <button
                key={preset.label}
                type="button"
                disabled={!canEditEpisode || savingScript}
                onClick={() => changeScript(introScript ? `${introScript}\n\n${preset.text}` : preset.text)}
                title={`إضافة ${preset.label} إلى النص`}
                className="text-2xs bg-slate-100 hover:bg-blue-50 text-slate-600 hover:text-blue-700 px-2.5 py-1 rounded-lg transition-colors font-medium"
              >
                +{preset.label}
              </button>
            ))}
          </div>

          <LongTextField
            id="intro-script-textarea"
            name="مقدمة الحلقة"
            sizeKey="anchor-script"
            label="نص مقدمة الحلقة للمذيع"
            rows={10}
            value={introScript}
            readOnly={!canEditEpisode || savingScript}
            onChange={(e) => setIntroScript(e.target.value)}
            placeholder="أهلاً بكم مشاهدينا الكرام في حلقة جديدة ومباشرة من برنامج..."
            className="p-4 bg-white border border-slate-300 rounded-xl text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />

          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between text-xs text-slate-500">
            <span>الكلمات: <strong>{introScript.split(/\s+/).filter(Boolean).length}</strong></span>
            <span>الزمن التقديري للإلقاء: <strong>{Math.ceil(introScript.split(/\s+/).filter(Boolean).length / 2.5)} ثانية</strong></span>
          </div>
        </div>
      )}

    </div>
  );
};
