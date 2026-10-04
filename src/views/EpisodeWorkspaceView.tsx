import { arabicDate } from '../shared/dates';
import { appLocale, zoneOptions } from '../shared/dateFormat';
import { alertDialog, confirmDialog } from '../services/dialogs';
import { notify } from '../services/notify';
import { ExportMenu, docContext } from '../components/common/ExportMenu';
import { episodeFileDoc, episodeRundownDoc, guestSheetDoc, presenterSheetDoc } from '../services/documents/builders';
import { CommentThread } from '../components/comments/CommentThread';
import { apiService } from '../services/api';
import { episodeReadiness } from '../shared/production';
import { departmentName } from '../shared/departments';
import { FormPage } from '../components/common/FormPage';
import { BookingForm } from '../components/planning/BookingForm';
import { LongTextField } from '../components/common/TextSizeControls';
import type { Booking } from '../shared/planning';
import { Avatar } from '../components/common/Avatar';
import { RbacService } from '../services/rbacService';
import React, { useState , useRef, useEffect} from 'react';
import { CalendarPlus, ArrowRight, ListOrdered, HelpCircle, Users, FileText, Clock, Tv, Save, X, Copy, Check, Lock, MessageSquareText, Layers } from 'lucide-react';
import { EpisodePlanner } from '../components/episodes/EpisodePlanner';
import { EpisodeGuestsPanel } from '../components/episodes/EpisodeGuestsPanel';
import { EpisodeQuestionsPanel } from '../components/episodes/EpisodeQuestionsPanel';
import { episodeGuestList } from '../shared/episodePlan';
import { Episode, RundownSegment, Guest, NewsItem, User, EpisodeStatus } from '../types';
import { useEditLock } from '../hooks/useNewsEditLock';
import { RundownTable } from '../components/rundown/RundownTable';
import { Badge } from '../components/common/Badge';
import { Modal } from '../components/common/Modal';
import { Breadcrumbs } from '../components/layout/Breadcrumbs';

interface EpisodeWorkspaceViewProps {
  episode: Episode;
  allGuests: Guest[];
  allNews: NewsItem[];
  currentUser: User;
  onUpdateRundown: (segments: RundownSegment[]) => void;
  onSaveEpisode: (episodeData: Partial<Episode>) => void;
  onBack: () => void;
  onOpenNews?: (id: string) => void;
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
  useEffect(() => {
    const incoming = episode.introScript || '';
    if (introScript === loadedScriptRef.current) setIntroScript(incoming);
    loadedScriptRef.current = incoming;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episode.introScript]);
  const [copiedScript, setCopiedScript] = useState(false);

  const handleCopyScript = () => {
    if (!introScript) return;
    navigator.clipboard.writeText(introScript);
    setCopiedScript(true);
    setTimeout(() => setCopiedScript(false), 2000);
  };

  // Status updates
  const readiness = episodeReadiness(episode, { requests: apiService.getRequests(), media: apiService.getMedia() as any[] });
  // Timing plan is separate from material readiness: planned rundown vs the slot.
  const slotSeconds = (Number(episode.durationMinutes) || 0) * 60;
  const plannedSeconds = (episode.rundown || []).reduce((sum, seg: any) => sum + (Number(seg.durationSeconds) || 0), 0);
  const timingGap = plannedSeconds - slotSeconds; // negative = under, positive = over
  const timingOk = slotSeconds === 0 || Math.abs(timingGap) <= Math.max(60, slotSeconds * 0.05);
  const mmssOf = (sec: number) => `${Math.floor(Math.abs(sec) / 60)}:${String(Math.abs(sec) % 60).padStart(2, '0')}`;
  const [showBlockers, setShowBlockers] = useState(false);
  const [booking, setBooking] = useState<Partial<Booking> | null>(null);
  const canBook = RbacService.hasPermission(currentUser, 'resources.book') || RbacService.hasPermission(currentUser, 'resources.manage');
  const episodeBookings = apiService.getBookings().filter((b) => b.link?.kind === 'episode' && b.link.id === episode.id && b.status !== 'CANCELLED');
  const bookStudio = () => {
    const day = (episode.recordingDate || episode.broadcastDate || '').slice(0, 10);
    const [y, m, d] = (day || new Date().toISOString().slice(0, 10)).split('-').map(Number);
    const [hh, mm] = (episode.startTime || '09:00').split(':').map(Number);
    const start = new Date(y, m - 1, d, hh || 9, mm || 0);
    // Studio time: an hour of preparation before air, and the programme's length after.
    const from = new Date(start.getTime() - 60 * 60_000);
    const to = new Date(start.getTime() + Math.max(episode.durationMinutes || 60, 30) * 60_000);
    setBooking({ title: `${episode.programName} — ${episode.title}`, start: from.toISOString(), end: to.toISOString(), link: { kind: 'episode', id: episode.id, title: `${episode.programName} — ${episode.title}` } });
  };

  const handleUpdateStatus = async (newStatus: EpisodeStatus) => {
    if (!canEditEpisode) return;
    if (newStatus === 'READY_FOR_BROADCAST' && episode.status !== 'READY_FOR_BROADCAST' && !readiness.ready) {
      setShowBlockers(true);
      void alertDialog({ title: 'الحلقة غير جاهزة للبث', message:
        readiness.total === 0
          ? 'لا يمكن اعتماد حلقة بلا فقرات للبث.'
          : `لا يمكن اعتماد الحلقة للبث بعد: ${readiness.blockers.length} عنصر غير جاهز.\n\n` +
              readiness.blockers.slice(0, 6).map((b) => `• ${b.segmentTitle}: ${b.detail} (${departmentName(b.departmentId)})`).join('\n')
       });
      return;
    }
    if (newStatus === 'READY_FOR_BROADCAST' && episode.status !== 'READY_FOR_BROADCAST' && !timingOk) {
      const msg =
        timingGap < 0
          ? `الرانداون أقصر من مدة الحلقة بـ ${mmssOf(timingGap)} دقيقة (المخطط ${mmssOf(plannedSeconds)} من ${mmssOf(slotSeconds)}).`
          : `الرانداون أطول من مدة الحلقة بـ ${mmssOf(timingGap)} دقيقة.`;
      if (!(await confirmDialog(`${msg}\n\nاعتماد الحلقة للبث رغم ذلك؟`))) return;
    }
    onSaveEpisode({ id: episode.id, status: newStatus });
  };

  const handleSaveIntroScript = () => {
    onSaveEpisode({ id: episode.id, introScript });
    loadedScriptRef.current = introScript;
  };

  return (
    <div className="space-y-6">
      {/* Contextual Navigation Breadcrumbs */}
      <Breadcrumbs
        items={[
          { label: 'دليل الحلقات', onClick: onBack },
          { label: episode.programName },
          { label: `حلقة #${episode.episodeNumber}: ${episode.title}` },
        ]}
        statusBadge={{
          label:
            episode.status === 'ON_AIR'
              ? 'على الهواء الآن'
              : episode.status === 'READY_FOR_BROADCAST'
              ? 'جاهزة للبث'
              : episode.status === 'IN_PREPARATION'
              ? 'قيد الإعداد'
              : 'مرحلة التخطيط',
          variant:
            episode.status === 'ON_AIR'
              ? 'danger'
              : episode.status === 'READY_FOR_BROADCAST'
              ? 'success'
              : episode.status === 'IN_PREPARATION'
              ? 'warning'
              : 'default',
        }}
        onBack={onBack}
        backLabel="العودة للحلقات"
      />

      {lockedByOther && lock.holder && (
        <div role="alert" className="bg-amber-50 border border-amber-300 p-4 rounded-2xl flex flex-wrap items-center justify-between gap-3 text-amber-900">
          <div className="flex items-center gap-2.5">
            <Lock className="w-5 h-5 text-amber-700 shrink-0" />
            <div>
              <strong className="text-xs font-bold block">هذه الحلقة قيد التحرير الآن لدى {lock.holder.userName}</strong>
              <span className="text-[11px] text-amber-700">يمكنك المتابعة للقراءة فقط، وستُتاح الكتابة تلقائياً عند إغلاقه لمساحة العمل.</span>
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

      {/* On-air readiness across departments */}
      <section aria-label="جاهزية الحلقة للبث" className={`p-4 rounded-2xl border ${readiness.ready && timingOk ? 'bg-emerald-50/60 border-emerald-200' : 'bg-white border-slate-200'}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-slate-800">
              جاهزية البث: {readiness.readySegments} من {readiness.total} فقرة جاهزة
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {readiness.ready
                ? 'كل الأقسام سلّمت المواد المطلوبة.'
                : readiness.total === 0
                ? 'أضف فقرات الرانداون أولاً.'
                : `${readiness.blockers.length} عنصر ينتظر التحرير أو المونتاج أو الأقسام الأخرى.`}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-40 h-2 rounded-full bg-slate-200 overflow-hidden" aria-hidden>
              <div className={`h-full ${readiness.ready ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: `${readiness.total ? (readiness.readySegments / readiness.total) * 100 : 0}%` }} />
            </div>
            {readiness.blockers.length > 0 && (
              <button type="button" onClick={() => setShowBlockers((v) => !v)} aria-expanded={showBlockers} className="text-xs font-bold text-blue-700 hover:underline">
                {showBlockers ? 'إخفاء النواقص' : 'عرض النواقص'}
              </button>
            )}
          </div>
        </div>
        {slotSeconds > 0 && readiness.total > 0 && (
          <p
            role={timingOk ? undefined : 'status'}
            className={`mt-2 text-[11px] font-bold ${timingOk ? 'text-emerald-700' : 'text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 inline-block'}`}
          >
            خطة الوقت: {mmssOf(plannedSeconds)} مخطط من {mmssOf(slotSeconds)}
            {timingOk ? ' — مكتملة' : timingGap < 0 ? ` — ينقص ${mmssOf(timingGap)} دقيقة` : ` — يزيد ${mmssOf(timingGap)} دقيقة`}
          </p>
        )}
        {showBlockers && readiness.blockers.length > 0 && (
          <ul className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-1.5 text-xs">
            {readiness.blockers.map((b, i) => (
              <li key={i} className="flex items-center gap-2 p-2 rounded-lg bg-amber-50/70 border border-amber-200">
                <span className="font-bold text-slate-800 truncate">{b.segmentTitle}</span>
                <span className="text-amber-800">{b.detail}</span>
                <span className="mr-auto text-[10px] text-slate-500 shrink-0">{departmentName(b.departmentId)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Top Episode Banner */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-2xs space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onBack}
              className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors"
              title="العودة للحلقات"
            >
              <ArrowRight className="w-5 h-5" />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded-md">
                  {episode.programName}
                </span>
                <span className="text-xs text-slate-500 font-mono">
                  حلقة #{episode.episodeNumber} (الموسم {episode.seasonNumber})
                </span>
              </div>
              <h1 className="text-xl sm:text-2xl font-black text-slate-800 mt-1">
                {episode.title}
              </h1>
            </div>
          </div>

          {/* Episode Live Status Controller */}
          <div className="flex flex-wrap items-center gap-2 self-start md:self-center">
            {canBook && (
              <button
                type="button"
                onClick={bookStudio}
                title={episodeBookings.length ? episodeBookings.map((b) => `${apiService.getResources().find((r) => r.id === b.resourceId)?.name || ''} ${new Date(b.start).toLocaleTimeString(appLocale(), { ...zoneOptions(), hour: '2-digit', minute: '2-digit' })}`).join('، ') : 'حجز استوديو أو معدات للحلقة'}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700"
              >
                <CalendarPlus className="w-4 h-4" />
                {episodeBookings.length ? `محجوز (${episodeBookings.length})` : 'حجز استوديو'}
              </button>
            )}
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
                disabled={!canEditEpisode}
                className="px-3 py-1.5 border border-slate-300 rounded-xl text-xs font-bold bg-white focus:ring-2 focus:ring-blue-500"
              >
                <option value="PLANNING">مرحلة التخطيط</option>
                <option value="IN_PREPARATION">قيد الإعداد والتحرير</option>
                <option value="READY_FOR_BROADCAST">جاهز للبث المباشر</option>
                <option value="ON_AIR">على الهواء الآن</option>
                <option value="BROADCASTED">تم البث</option>
                <option value="ARCHIVED">مؤرشفة</option>
              </select>
            </div>
          </div>
        </div>

        {booking && <BookingForm isOpen onClose={() => setBooking(null)} currentUser={currentUser} users={apiService.getUsers()} booking={booking} />}

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

      {/* Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto border-b border-slate-200 pb-2 text-xs font-bold">
        <button
          type="button"
          onClick={() => setActiveTab('PLAN')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all ${
            activeTab === 'PLAN' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>تحضير الحلقة ({(episode.topics || []).length} محور)</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('RUNDOWN')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all ${
            activeTab === 'RUNDOWN'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <ListOrdered className="w-4 h-4" />
          <span>مخطط الرانداون التلفزيوني ({episode.rundown?.length || 0})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('QUESTIONS')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all ${
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
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all ${
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
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all ${
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
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all ${
            activeTab === 'NOTES' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <MessageSquareText className="w-4 h-4" />
          <span>ملاحظات الفريق ({apiService.getComments({ kind: 'episode', id: episode.id }).length})</span>
        </button>
      </div>

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
          segments={episode.rundown || []}
          plannedDurationMinutes={episode.durationMinutes}
          onUpdateRundown={onUpdateRundown}
          guests={allGuests}
          newsList={allNews}
          defaultPresenter={episode.presenterName}
          canEdit={canEditRundown}
          episodeId={episode.id}
          topics={episode.topics || []}
        />
      )}

      {activeTab === 'QUESTIONS' && <EpisodeQuestionsPanel episode={episode} canEdit={canEditQuestions} onSaveEpisode={onSaveEpisode} />}

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
                  onClick={() => setIntroScript('')}
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
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs"
              >
                <Save className="w-4 h-4" />
                حفظ السكريبت
              </button>
              )}
            </div>
          </div>

          {/* Quick Script Presets */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-bold text-slate-500 ml-1">قوالب جاهزة:</span>
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
                onClick={() => setIntroScript(preset.text)}
                className="text-[10px] bg-slate-100 hover:bg-blue-50 text-slate-600 hover:text-blue-700 px-2.5 py-1 rounded-lg transition-colors font-medium"
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
