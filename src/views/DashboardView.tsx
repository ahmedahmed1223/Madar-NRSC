import { countLabel } from '../shared/labels';
import { StationClock } from '../components/common/StationClock';
import { appLocale, validZone, zoneOptions } from '../shared/dateFormat';
import { arabicDate, localDateString } from '../shared/dates';
import { Avatar } from '../components/common/Avatar';
import React, { useState } from 'react';
import { useLiveData } from '../hooks/useLiveData';
import { stationWorkDay, stationWorkTime } from '../shared/myWork';
import { Newspaper, Flame, Video, CheckSquare, ClipboardList, Users, ArrowUpRight, Plus, Radio, FileCheck, Calendar as CalendarIcon, AlertTriangle, Filter } from 'lucide-react';
import { Badge } from '../components/common/Badge';
import { RbacService } from '../services/rbacService';
import { NewsItem, Program, Episode, EditorialTask, Guest, BreakingNews, User, Category } from '../types';
import { AppView } from '../components/layout/Sidebar';

import { MyWorkPanel } from '../components/dashboard/MyWorkPanel';
import { TodayStatusPanel } from '../components/dashboard/TodayStatusPanel';
import { DashboardMetrics } from '../components/dashboard/DashboardMetrics';
import { isManagerRole, issuesInScope, managerScope, reviewableNews, stationGroupsOf } from '../shared/managerToday';
import { stationsOf } from '../shared/stations';
import { awaitsMyReview } from '../shared/newsWorkflow';
import { apiService } from '../services/api';
import { useSetupReminder } from '../components/setup/SetupWizard';
import { sectionOrderFor } from '../shared/navigation';
import { setupCommand } from '../services/uiEvents';
import { AdminExceptionSummary, ApprovedMaterialSummary } from '../components/dashboard/DailyDashboardSummaries';
import { canShowAdminExceptions, canShowApprovedMaterial, isApprovedMaterial } from '../shared/dailyDashboardSummaries';
interface DashboardViewProps {
  newsList: NewsItem[];
  breakingNews?: BreakingNews[];
  programs?: Program[];
  episodes: Episode[];
  tasks: EditorialTask[];
  guests: Guest[];
  categories?: Category[];
  currentUser: User;
  onNavigate: (view: string) => void;
  onSelectEpisode?: (episodeId: string) => void;
  onSelectNews?: (newsId: string) => void;
  onCreateNews?: () => void;
  onCreateEpisode?: () => void;
  onCreateTask?: () => void;
  onOpenBulletin?: (id: string) => void;
}

const TASK_PRIORITY_LABELS: Record<string, string> = {
  CRITICAL: 'حرجة',
  URGENT: 'عاجلة',
  HIGH: 'عالية',
  MEDIUM: 'متوسطة',
  NORMAL: 'عادية',
  LOW: 'منخفضة',
};

export const DashboardView: React.FC<DashboardViewProps> = ({
  newsList = [],
  breakingNews = [],
  programs = [],
  episodes = [],
  tasks = [],
  guests = [],
  categories = [],
  currentUser,
  onNavigate,
  onSelectEpisode = (_id: string) => {},
  onSelectNews = (_id: string) => {},
  onCreateNews = () => {},
  onCreateEpisode = () => {},
  onCreateTask = () => {},
  onOpenBulletin,
}) => {
  useLiveData(['settings', 'roles', 'productionCards'], 60_000);
  const referenceTime = Date.now();
  const stationZone = apiService.getSettings().defaultTimezone;
  const [activeQueueTab, setActiveQueueTab] = useState<'DRAFT' | 'UNDER_REVIEW' | 'APPROVED' | 'PUBLISHED'>('UNDER_REVIEW');
  const [selectedDashboardCategory, setSelectedDashboardCategory] = useState<string>('ALL');

  const underReviewCount = (newsList || []).filter((n) => n.status === 'UNDER_REVIEW').length;
  // Only what this colleague can act on: others' stories, and for a branch manager their stations' writers.
  const canReview = RbacService.hasPermission(currentUser, 'news.review') || RbacService.hasPermission(currentUser, 'news.approve');
  const stationOfUser = new Map(apiService.getUsers().map((u) => [u.id, u.stationId]));
  const stations = stationsOf(apiService.getSettings());
  const reviewQueue = reviewableNews(newsList, currentUser, { canReview, stations, stationOf: (id) => stationOfUser.get(id) });
  const pendingReviewNewsCount = reviewQueue.length;
  const isManager = isManagerRole(currentUser.role);
  const activeBreakingCount = (breakingNews || []).filter((b) => b.isActive).length;
  const todayKey = stationWorkDay(new Date(referenceTime), stationZone);
  // Upcoming = on air now, or scheduled from today on and not yet aired; earliest first.
  const nowKey = `${todayKey} ${stationWorkTime(new Date(referenceTime), stationZone)}`;
  const upcomingEpisodes = (episodes || [])
    .filter((e) => e.status === 'ON_AIR' || (!['CANCELLED', 'ARCHIVED', 'BROADCASTED'].includes(e.status) && `${(e.broadcastDate || '').slice(0, 10)} ${e.endTime || e.startTime || ''}` >= nowKey))
    .sort((a, b) => `${a.broadcastDate} ${a.startTime}`.localeCompare(`${b.broadcastDate} ${b.startTime}`));
  const todayEpisodes = (episodes || []).filter(
    (e) => e.status === 'ON_AIR' || ((e.broadcastDate || '').slice(0, 10) === todayKey && !['CANCELLED', 'ARCHIVED', 'BROADCASTED'].includes(e.status))
  );
  const openTasks = (tasks || []).filter((t) => !['COMPLETED', 'DONE', 'CANCELLED'].includes(t.status));
  const overdueTasks = openTasks.filter((t) => t.dueDate && Date.parse(t.dueDate) < referenceTime).length;
  const stationDate = new Intl.DateTimeFormat('en-CA', { timeZone: validZone(stationZone), year: 'numeric', month: '2-digit', day: '2-digit' });
  const dayOf = (iso?: string) => (iso && Number.isFinite(Date.parse(iso)) ? stationDate.format(new Date(iso)) : '');
  const newsToday = (newsList || []).filter((n) => dayOf(n.createdAt) === todayKey).length;
  const publishedToday = (newsList || []).filter((n) => n.status === 'PUBLISHED' && dayOf(n.publishDate || n.updatedAt) === todayKey).length;

  // CRITICAL Priority News
  const criticalNews = (newsList || []).filter((n) => n.priority === 'CRITICAL' && n.status !== 'ARCHIVED' && n.status !== 'UNPUBLISHED');

  const queuedNews = (newsList || []).filter((n) => {
    if (n.status !== activeQueueTab) return false;
    if (selectedDashboardCategory !== 'ALL') {
      const matchId = n.categoryId === selectedDashboardCategory;
      const matchName = categories.find((c) => c.id === selectedDashboardCategory)?.nameAr === n.categoryName;
      if (!matchId && !matchName) return false;
    }
    return true;
  });

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'DRAFT': return 'مسودات قيد العمل';
      case 'UNDER_REVIEW': return 'بانتظار المراجعة';
      case 'APPROVED': return 'معتمد للنشر';
      case 'PUBLISHED': return 'تم النشر';
      default: return status;
    }
  };

  const canSetup = RbacService.hasPermission(currentUser, 'system.settings');
  // Each role sees the panels of its job: the news queues for writers and editors, the broadcast
  // schedule for programme and air staff and for managers, the guest directory for those who book guests.
  const can = (permission: string) => RbacService.hasPermission(currentUser, permission);
  const canOpen = (screen: string) => RbacService.canOpenScreen(currentUser, screen);
  const domain = sectionOrderFor(currentUser)[1];
  const inPreparation = upcomingEpisodes.filter(episode => !episode.deletedAt && !['ON_AIR', 'READY_FOR_BROADCAST'].includes(episode.status));
  const nextEpisode = inPreparation.find(episode => episode.producerId === currentUser.id) || inPreparation[0];
  const nextReview = reviewQueue.find(item => awaitsMyReview(can, currentUser.id, item, referenceTime));
  const canCreateNews = canOpen('news') && can('news.create');
  const canCreateEpisode = canOpen('episodes') && can('episodes.create');
  const canTrackCards = isManager && canOpen('cards') && can('cards.view');
  const nextIssue = canTrackCards
    ? issuesInScope(apiService.getCards(), managerScope(currentUser, stations, can('workload.view_all'), stationGroupsOf(apiService.getSettings())), referenceTime)[0]
    : undefined;
  const primaryAction = canTrackCards
    ? nextIssue
      ? { label: nextIssue.blocked ? 'متابعة تكليف متعطل' : 'متابعة تكليف متأخر', Icon: AlertTriangle, run: () => onNavigate(`/cards/${encodeURIComponent(nextIssue.card.id)}`) }
      : { label: 'متابعة التكليفات', Icon: ClipboardList, run: () => onNavigate('cards') }
    : domain === 'programs' && canOpen('episodes')
      ? nextEpisode && canOpen('episode-workspace')
        ? { label: 'متابعة تجهيز الحلقة', Icon: Video, run: () => onSelectEpisode(nextEpisode.id) }
        : canCreateEpisode
          ? { label: 'إعداد حلقة جديدة', Icon: Video, run: onCreateEpisode }
          : { label: 'فتح الحلقات', Icon: Video, run: () => onNavigate('episodes') }
      : canOpen('news') && nextReview
        ? { label: 'مراجعة خبر ينتظر قرارك', Icon: FileCheck, run: () => onSelectNews(nextReview.id) }
        : canCreateNews
          ? { label: 'خبر صحفي جديد', Icon: Plus, run: onCreateNews }
          : canCreateEpisode
            ? { label: 'إعداد حلقة جديدة', Icon: Video, run: onCreateEpisode }
            : null;
  const showQueues = canOpen('news') && (can('news.create') || canReview);
  const showSchedule = canOpen('episodes') && (domain === 'programs' || domain === 'air' || domain === 'admin' || can('episodes.create'));
  const showGuests = canOpen('guests') && (domain === 'programs' || domain === 'admin' || can('guests.manage'));
  const setup = useSetupReminder(currentUser);
  const sideOnly = !showSchedule && !showQueues;
  const metrics = [
    { screen: 'news', label: 'أخبار', period: 'اليوم', value: newsToday, note: `${publishedToday} نُشر اليوم · ${underReviewCount} قيد المراجعة الآن`, tone: 'text-slate-900' },
    { screen: 'breaking', label: 'العاجل على الشريط', period: 'الآن', value: activeBreakingCount, note: `من ${breakingNews.length} عاجل مسجل`, tone: activeBreakingCount ? 'text-red-700' : 'text-slate-900' },
    { screen: 'episodes', label: 'حلقات', period: 'اليوم', value: todayEpisodes.length, note: `${countLabel(upcomingEpisodes.length, { zero: 'لا حلقات قادمة', one: 'حلقة قادمة واحدة', two: 'حلقتان قادمتان', few: 'حلقات قادمة', many: 'حلقة قادمة' })} · ${countLabel(programs.length, { zero: 'لا برامج', one: 'برنامج واحد', two: 'برنامجان', few: 'برامج', many: 'برنامجاً' })}`, tone: 'text-slate-900' },
    { screen: 'tasks', label: 'مهام مفتوحة', period: 'الآن', value: openTasks.length, note: `${overdueTasks} متأخرة · من ${tasks.length} في كل الفترات`, tone: overdueTasks ? 'text-amber-700' : 'text-slate-900' },
  ].filter(metric => canOpen(metric.screen)).map(metric => ({ ...metric, onSelect: () => onNavigate(metric.screen) }));
  const todaySummary = [
    canOpen('episodes') && countLabel(todayEpisodes.length, { zero: 'لا حلقات مجدولة', one: 'حلقة واحدة مجدولة', two: 'حلقتان مجدولتان', few: 'حلقات مجدولة', many: 'حلقة مجدولة' }),
    canOpen('news') && canReview && countLabel(pendingReviewNewsCount, { zero: 'لا أخبار تنتظر مراجعتك', one: 'خبر واحد ينتظر مراجعتك', two: 'خبران ينتظران مراجعتك', few: 'أخبار تنتظر مراجعتك', many: 'خبراً ينتظر مراجعتك' }),
  ].filter(Boolean).join(' · ');
  const openApprovedMaterial = (id: string) => {
    const viewer = apiService.getCurrentUser();
    if (viewer.id !== currentUser.id || !canShowApprovedMaterial((permission) => RbacService.hasPermission(viewer, permission), (screen) => RbacService.canOpenScreen(viewer, screen))) return false;
    const item = apiService.getNewsById(id);
    if (!item || !isApprovedMaterial(item)) return false;
    onSelectNews(id);
    return true;
  };

  return (
    <div className="space-y-7 lg:space-y-8">
      <header className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-4 md:flex-row md:items-end">
        <div className="space-y-2 min-w-0">
          <h1>
            مرحباً، {currentUser.fullName}
          </h1>
          {todaySummary && <p className="max-w-2xl text-sm leading-relaxed text-slate-600">{todaySummary}</p>}
          <div className="lg:hidden">
            <StationClock className="flex-wrap" />
          </div>
        </div>

        {primaryAction && <button type="button" onClick={primaryAction.run} className="min-h-11 self-start inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-4 text-xs font-bold text-white hover:bg-blue-700 md:self-end">
          <primaryAction.Icon className="size-4" aria-hidden="true" />
          {primaryAction.label}
        </button>}
      </header>

      {canOpen('news') && criticalNews.length > 0 && (
        <section aria-labelledby="dashboard-critical-title" className="rounded-xl border border-red-200 bg-red-50">
          <h2 id="dashboard-critical-title" className="flex items-center gap-2 px-4 pt-3 pb-2 text-sm font-bold text-red-800">
            <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
            مواد بأولوية حرجة <span className="font-mono tabular-nums">{criticalNews.length}</span>
          </h2>
          <ul className="divide-y divide-red-200 border-t border-red-200">
            {criticalNews.slice(0, 2).map(item => (
              <li key={item.id}>
                <button type="button" onClick={() => onSelectNews(item.id)} className="flex min-h-11 w-full flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 py-2 text-start hover:bg-red-100 focus-visible:outline-offset-[-2px]">
                  <span className="min-w-0 text-xs font-bold text-red-900 [overflow-wrap:anywhere]">{item.title}</span>
                  <span className="text-2xs font-semibold text-red-800">{getStatusLabel(item.status)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {canSetup && setup.pending && (
        <section data-tour="setup-wizard" aria-label="الإعداد السريع" className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-lg border border-blue-200 bg-blue-50">
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-bold text-slate-900">أكمل إعداد «مدار» لفريقك</h2>
            <p className="text-xs text-slate-700 mt-0.5">{setup.done} من {setup.total} خطوات مكتملة</p>
          </div>
          <div className="h-1.5 sm:w-32 rounded-full bg-white overflow-hidden" aria-hidden="true">
            <div className="h-full bg-blue-600" style={{ width: `${(setup.done / setup.total) * 100}%` }} />
          </div>
          <button type="button" onClick={() => setupCommand.emit('open')} className="min-h-10 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shrink-0">
            {setup.done ? 'متابعة الإعداد' : 'بدء الإعداد السريع'}
          </button>
        </section>
      )}

      {/* Managers first see whether tonight is on track; everyone else starts with their own work. */}
      {isManager && (
        <TodayStatusPanel
          currentUser={currentUser}
          episodes={episodes}
          onOpenEpisode={onSelectEpisode}
          onOpenBulletin={onOpenBulletin}
          onNavigate={(v) => onNavigate(v as AppView)}
        />
      )}

      <MyWorkPanel
        referenceTime={referenceTime}
        currentUser={currentUser}
        newsList={newsList}
        episodes={episodes}
        tasks={tasks}
        onOpenNews={onSelectNews}
        onOpenEpisode={onSelectEpisode}
        onNavigate={(v) => onNavigate(v as AppView)}
        onOpenBulletin={onOpenBulletin}
      />

      <DashboardMetrics label="مؤشرات غرفة الأخبار اليوم" metrics={metrics} />
      {canShowAdminExceptions(can, canOpen) && <AdminExceptionSummary key={currentUser.id} onOpenMonitor={() => onNavigate('/settings/monitor')} />}
      {canShowApprovedMaterial(can, canOpen) && <ApprovedMaterialSummary key={currentUser.id} items={newsList} now={referenceTime} onOpen={openApprovedMaterial} />}

      {/* Main Two-Column Operational Layout */}
      <div className={`grid grid-cols-1 gap-6 ${sideOnly ? '' : 'xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]'}`}>
        {/* Left Column (2 Cols in Arabic RTL): Upcoming Broadcast Schedule & News Flow */}
        {(showSchedule || showQueues) && <div className="min-w-0 space-y-6">
          {/* Upcoming Episodes / Playout */}
          {showSchedule && (
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <CalendarIcon className="w-5 h-5 text-blue-600" />
                <h3 className="font-bold text-slate-800 text-sm sm:text-base">
                  جدول البث المباشر والحلقات القادمة
                </h3>
              </div>
              <button
                onClick={() => onNavigate('EPISODES')}
                className="text-xs font-semibold text-blue-600 hover:underline flex items-center gap-1"
              >
                عرض كل الحلقات <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="space-y-3">
              {upcomingEpisodes.length === 0 && <p className="text-xs text-slate-500 text-center py-6">لا حلقات قادمة مجدولة.</p>}
              {upcomingEpisodes.slice(0, 3).map((ep) => (
                <button
                  key={ep.id}
                  type="button"
                  onClick={() => onSelectEpisode(ep.id)}
                  className="w-full text-start p-4 rounded-xl border border-slate-200/80 hover:border-blue-300 hover:bg-blue-50/20 focus-visible:ring-2 focus-visible:ring-blue-500 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <span className="block space-y-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-bold text-slate-800 text-sm">{ep.title}</span>
                      <Badge variant="primary" size="sm">
                        {ep.programName}
                      </Badge>
                      <span className="text-xs text-slate-500 whitespace-nowrap">الحلقة <span className="font-mono tabular-nums">{ep.episodeNumber}</span></span>
                    </span>
                    <span className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                      <span>تقديم: <strong className="text-slate-700">{ep.presenterName}</strong></span>
                      <span>•</span>
                      <span>إنتاج: <strong className="text-slate-700">{ep.producerName}</strong></span>
                      <span>•</span>
                      <span>الاستوديو: <strong className="text-slate-700">{ep.studioName}</strong></span>
                    </span>
                  </span>

                  <span className="flex items-center gap-4 self-end sm:self-center shrink-0">
                    <span className="text-left text-xs">
                      <span className="text-slate-500 block text-2xs whitespace-nowrap">{arabicDate((ep.broadcastDate || '').slice(0, 10))}</span>
                      <strong className="text-slate-800 font-bold font-mono tabular-nums whitespace-nowrap" dir="ltr">{ep.startTime}–{ep.endTime}</strong>
                    </span>
                    <span className="px-3 py-1 text-xs font-bold rounded-lg bg-blue-50 text-blue-700 whitespace-nowrap">
                      فتح الرانداون
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
          )}

          {/* Workflow Queues (Editorial Flow) */}
          {showQueues && (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="p-4 sm:px-5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <div className="flex items-center gap-2">
                <Newspaper className="size-5 shrink-0 text-blue-700" aria-hidden="true" />
                <h3 className="font-bold text-slate-800 text-sm sm:text-base">
                  طوابير سير العمل التحريري
                </h3>
              </div>
              <button
                onClick={() => onNavigate('NEWS_LIST')}
                className="flex min-h-11 items-center gap-1 text-xs font-semibold text-blue-700 hover:underline"
              >
                غرفة الأخبار كاملة <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Queue Tabs */}
            <div role="group" aria-label="حالة الخبر" className="flex flex-wrap items-center gap-1 border-b border-slate-200 bg-slate-50 p-2.5">
              {(['DRAFT', 'UNDER_REVIEW', 'APPROVED', 'PUBLISHED'] as const).map((tab) => {
                const count = (newsList || []).filter(n => n.status === tab).length;
                const isActive = activeQueueTab === tab;
                return (
                  <button
                    key={tab}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => setActiveQueueTab(tab)}
                    className={`flex min-h-11 items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-bold transition-colors ${
                      isActive ? 'border-blue-200 bg-blue-50 text-blue-800' : 'border-transparent text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {getStatusLabel(tab)}
                    <span className={`rounded-md px-1.5 py-0.5 font-mono text-2xs tabular-nums ${isActive ? 'bg-white' : 'bg-slate-200 text-slate-600'}`}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Category Filter Bar for Dashboard Queues */}
            {categories.length > 0 && (
              <div className="border-b border-slate-200 px-4 py-2.5">
                <label className="grid gap-1 text-xs font-semibold text-slate-700 sm:hidden">
                  تصنيف الخبر
                  <select className="min-h-11 min-w-0 w-full rounded-lg border border-slate-300 bg-white px-3" value={selectedDashboardCategory} onChange={event => setSelectedDashboardCategory(event.target.value)}>
                    <option value="ALL">كل التصنيفات</option>
                    {categories.map(category => <option key={category.id} value={category.id}>{category.nameAr}</option>)}
                  </select>
                </label>
                <div role="group" aria-label="تصنيف الخبر" className="hidden flex-wrap items-center gap-1.5 sm:flex">
                  <Filter className="size-3.5 shrink-0 text-slate-600" aria-hidden="true" />
                <button
                  type="button"
                  aria-pressed={selectedDashboardCategory === 'ALL'}
                  onClick={() => setSelectedDashboardCategory('ALL')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold whitespace-nowrap transition-all flex items-center gap-1.5 shrink-0 ${
                    selectedDashboardCategory === 'ALL'
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                  }`}
                >
                  <span>كل التصنيفات</span>
                  <span
                    className={`text-2xs px-1.5 py-px rounded-full font-mono ${
                      selectedDashboardCategory === 'ALL' ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {(newsList || []).filter((n) => n.status === activeQueueTab).length}
                  </span>
                </button>

                {categories.map((cat) => {
                  const color = cat.colorCode || cat.color || '#2563eb';
                  const isSelected = selectedDashboardCategory === cat.id;
                  const countInQueue = (newsList || []).filter(
                    (n) => n.status === activeQueueTab && (n.categoryId === cat.id || n.categoryName === cat.nameAr)
                  ).length;

                  return (
                    <button
                      key={cat.id}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => setSelectedDashboardCategory(isSelected ? 'ALL' : cat.id)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold whitespace-nowrap transition-all flex items-center gap-1.5 border shrink-0 ${
                        isSelected ? 'shadow-xs text-white' : 'bg-white hover:opacity-90'
                      }`}
                      style={{
                          backgroundColor: isSelected ? 'var(--color-blue-600)' : 'var(--color-slate-50)',
                          borderColor: isSelected ? 'var(--color-blue-600)' : `${color}35`,
                          color: isSelected ? '#ffffff' : 'var(--color-slate-800)',
                      }}
                    >
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: isSelected ? '#ffffff' : color }}
                      />
                      <span>{cat.nameAr}</span>
                      <span
                        className="text-2xs px-1.5 py-px rounded-full font-mono font-bold"
                        style={{
                            backgroundColor: isSelected ? 'rgba(255,255,255,0.15)' : 'var(--color-slate-100)',
                            color: isSelected ? '#ffffff' : 'var(--color-slate-800)',
                        }}
                      >
                        {countInQueue}
                      </span>
                    </button>
                  );
                })}

                </div>
              </div>
            )}

            <div className="divide-y divide-slate-100 p-3">
              {queuedNews.length > 0 ? (
                queuedNews.map((news) => {
                  const cat = categories.find((c) => c.id === news.categoryId || c.nameAr === news.categoryName);
                  const catColor = cat?.colorCode || cat?.color || '#2563eb';

                  return (
                    <button
                      key={news.id}
                      type="button"
                      onClick={() => onSelectNews(news.id)}
                      className="w-full text-start p-3 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-500 rounded-xl transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4 group"
                    >
                      <span className="block space-y-1.5 truncate">
                        <span className="flex items-center gap-2">
                          {news.priority === 'CRITICAL' && (
                            <Badge variant="danger" size="sm" dot>خطير</Badge>
                          )}
                          {news.priority === 'URGENT' && (
                            <Badge variant="danger" size="sm">عاجل</Badge>
                          )}
                          <span className="text-sm font-bold text-slate-800 truncate group-hover:text-blue-700 transition-colors">{news.title}</span>
                        </span>
                        <span className="text-2xs text-slate-500 flex items-center gap-2 flex-wrap">
                          <span
                            className="px-2 py-0.5 rounded-md text-2xs font-bold border flex items-center gap-1.5 shrink-0"
                            style={{
                                backgroundColor: 'var(--color-slate-50)',
                                color: 'var(--color-slate-800)',
                              borderColor: `${catColor}30`,
                            }}
                          >
                            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: catColor }} />
                            <span>{news.categoryName || cat?.nameAr || 'عام'}</span>
                          </span>
                          <span>•</span>
                          <span>بواسطة: <strong className="text-slate-700">{news.authorName}</strong></span>
                          <span>•</span>
                          <span>آخر تحديث {new Date(news.updatedAt).toLocaleTimeString(appLocale(), { ...zoneOptions(), hour: '2-digit', minute: '2-digit' })}</span>
                        </span>
                      </span>

                      <span className="shrink-0 self-end sm:self-center">
                         <ArrowUpRight className="w-4 h-4 text-slate-500 group-hover:text-blue-600 transition-colors" />
                      </span>
                    </button>
                  );
                })
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-slate-500 text-center">
                  <FileCheck className="w-8 h-8 mb-2 text-slate-300" aria-hidden="true" />
                  <p className="text-sm font-medium">الطابور فارغ حالياً</p>
                  <p className="text-xs">
                    {selectedDashboardCategory !== 'ALL'
                      ? `لا مواد في تصنيف «${categories.find((c) => c.id === selectedDashboardCategory)?.nameAr || 'المحدد'}» بحالة «${getStatusLabel(activeQueueTab)}»`
                      : `لا مواد بحالة «${getStatusLabel(activeQueueTab)}»`}
                  </p>
                </div>
              )}
            </div>
          </div>
          )}
        </div>}

        {/* Right Column: Editorial Tasks & Guest Directory Preview (side by side when they are all there is) */}
        <div className={sideOnly ? `grid grid-cols-1 gap-6 items-start ${showGuests ? 'lg:grid-cols-2' : ''}` : 'space-y-6'}>
          {/* Urgent Editorial Tasks */}
          {canOpen('tasks') && <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <CheckSquare className="w-5 h-5 text-amber-700" />
                <h3 className="font-bold text-slate-800 text-sm">مهام تحريرية مستعجلة</h3>
              </div>
              <button
                onClick={() => onNavigate('TASKS')}
                className="text-xs font-semibold text-blue-600 hover:underline"
              >
                إدارة المهام
              </button>
            </div>

            <div className={sideOnly && !showGuests ? 'grid gap-2.5 lg:grid-cols-2' : 'space-y-2.5'}>
              {openTasks.length === 0 && (
                <p className="text-xs text-slate-500 text-center py-4">لا توجد مهام مفتوحة</p>
              )}
              {[...openTasks]
                .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
                .slice(0, 4)
                .map((task) => (
                <div
                  key={task.id}
                  className="p-3 rounded-xl bg-slate-50/70 border border-slate-200/60 space-y-1.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-bold text-slate-800 leading-snug">
                      {task.title}
                    </span>
                    <Badge
                      variant={['CRITICAL', 'URGENT'].includes(task.priority) ? 'danger' : task.priority === 'HIGH' ? 'warning' : 'default'}
                      size="sm"
                    >
                      {TASK_PRIORITY_LABELS[task.priority] || task.priority}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-2xs text-slate-500">
                    <span className="min-w-0 truncate">المسند إليه: {task.assigneeName || task.assignedToName || '—'}</span>
                    <span className="text-2xs shrink-0">
                      {task.dueDate && Date.parse(task.dueDate) < Date.now() && !['DONE', 'COMPLETED', 'CANCELLED'].includes(task.status) ? (
                        <span className="text-rose-700 font-bold">
                          متأخرة {countLabel(Math.max(1, Math.floor((Date.now() - Date.parse(task.dueDate)) / 86_400_000)), { zero: '', one: 'يوماً واحداً', two: 'يومين', few: 'أيام', many: 'يوماً' })}
                        </span>
                      ) : (
                        <>استحقاق: {task.dueDate ? arabicDate(localDateString(new Date(task.dueDate))) : '—'}</>
                      )}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>}

          {/* Quick Guests Directory Access */}
          {showGuests && (
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-purple-600" />
                <h3 className="font-bold text-slate-800 text-sm">بنك الضيوف والخبراء</h3>
              </div>
              <button
                onClick={() => onNavigate('GUESTS')}
                className="text-xs font-semibold text-blue-600 hover:underline"
              >
                تصفح البنك
              </button>
            </div>

            <div className="space-y-3">
              {guests.slice(0, 3).map((guest) => (
                <div key={guest.id} className="flex items-center gap-3">
                  <Avatar src={guest.avatarUrl} name={guest.fullName} className="w-10 h-10 rounded-full ring-1 ring-slate-200" />
                  <div className="truncate flex-1">
                    <span className="text-xs font-bold text-slate-800 block truncate">
                      {guest.fullName}
                    </span>
                    <span className="text-2xs text-slate-500 block truncate">
                      {guest.jobTitle} - {guest.organization}
                    </span>
                  </div>
                  <span className="text-2xs text-slate-500 shrink-0">
                    {guest.totalAppearances ? `${guest.totalAppearances} ظهور` : 'جديد'}
                  </span>
                </div>
              ))}
            </div>
          </div>
          )}
        </div>
      </div>
    </div>
  );
};
