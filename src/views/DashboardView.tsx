import { countLabel } from '../shared/labels';
import { StationClock } from '../components/common/StationClock';
import { appLocale, zoneOptions } from '../shared/dateFormat';
import { arabicDate, localDateString } from '../shared/dates';
import { Avatar } from '../components/common/Avatar';
import React, { useState } from 'react';
import { useLiveData } from '../hooks/useLiveData';
import { stationWorkDay, stationWorkTime } from '../shared/myWork';
import { Newspaper, Flame, Video, CheckSquare, Users, ArrowUpRight, Plus, Radio, FileCheck, Calendar as CalendarIcon, AlertTriangle, Filter } from 'lucide-react';
import { Badge } from '../components/common/Badge';
import { RbacService } from '../services/rbacService';
import { NewsItem, Program, Episode, EditorialTask, Guest, BreakingNews, User, Category } from '../types';
import { AppView } from '../components/layout/Sidebar';

import { MyWorkPanel } from '../components/dashboard/MyWorkPanel';
import { TodayStatusPanel } from '../components/dashboard/TodayStatusPanel';
import { isManagerRole, reviewableNews } from '../shared/managerToday';
import { stationsOf } from '../shared/stations';
import { apiService } from '../services/api';
import { useSetupReminder } from '../components/setup/SetupWizard';
import { sectionOrderFor } from '../shared/navigation';
import { setupCommand } from '../services/uiEvents';
interface DashboardViewProps {
  newsList: NewsItem[];
  breakingNews?: BreakingNews[];
  programs?: Program[];
  episodes: Episode[];
  tasks: EditorialTask[];
  guests: Guest[];
  categories?: Category[];
  currentUser: User;
  onNavigate: (view: AppView) => void;
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
  useLiveData(['settings'], 60_000);
  const referenceTime = Date.now();
  const stationZone = apiService.getSettings().defaultTimezone;
  const [activeQueueTab, setActiveQueueTab] = useState<'DRAFT' | 'UNDER_REVIEW' | 'APPROVED' | 'PUBLISHED'>('UNDER_REVIEW');
  const [selectedDashboardCategory, setSelectedDashboardCategory] = useState<string>('ALL');

  const underReviewCount = (newsList || []).filter((n) => n.status === 'UNDER_REVIEW').length;
  // Only what this colleague can act on: others' stories, and for a branch manager their stations' writers.
  const canReview = RbacService.hasPermission(currentUser, 'news.review') || RbacService.hasPermission(currentUser, 'news.approve');
  const stationOfUser = new Map(apiService.getUsers().map((u) => [u.id, u.stationId]));
  const pendingReviewNewsCount = reviewableNews(newsList || [], currentUser, { canReview, stations: stationsOf(apiService.getSettings()), stationOf: (id) => stationOfUser.get(id) }).length;
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
  const overdueTasks = openTasks.filter((t) => t.dueDate && Date.parse(t.dueDate) < Date.now()).length;
  const dayOf = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('en-CA') : '');
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

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'DRAFT': return 'text-slate-600 bg-slate-100 hover:bg-slate-200';
      case 'UNDER_REVIEW': return 'text-amber-700 bg-amber-50 hover:bg-amber-100';
      case 'APPROVED': return 'text-purple-700 bg-purple-50 hover:bg-purple-100';
      case 'PUBLISHED': return 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100';
      default: return 'text-slate-600 bg-slate-100';
    }
  };

  const canSetup = RbacService.hasPermission(currentUser, 'system.settings');
  // Each role sees the panels of its job: the news queues for writers and editors, the broadcast
  // schedule for programme and air staff and for managers, the guest directory for those who book guests.
  const can = (permission: string) => RbacService.hasPermission(currentUser, permission);
  const domain = sectionOrderFor(currentUser)[1];
  const showQueues = can('news.create') || can('news.review');
  const showSchedule = can('programs.view') && (domain === 'programs' || domain === 'air' || domain === 'admin' || can('episodes.create'));
  const showGuests = can('guests.view') && (domain === 'programs' || domain === 'admin' || can('guests.manage'));
  const setup = useSetupReminder(currentUser);
  const sideOnly = !showSchedule && !showQueues;

  return (
    <div className="space-y-6">
      {/* Greeting: the screen title strap, one line on the day, and the actions this colleague may take */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="space-y-2 min-w-0">
          {/* Its own line on phones and tablets, so the strap below never shares a line with it. */}
          <div className="lg:hidden">
            <StationClock className="px-2.5 py-1 rounded-md bg-white border border-slate-200" />
          </div>
          <h1>
            مرحباً، {currentUser.fullName}
          </h1>
          <p className="text-slate-600 text-sm max-w-2xl leading-relaxed">
            اليوم: {countLabel(todayEpisodes.length, { zero: 'لا حلقات مجدولة', one: 'حلقة واحدة مجدولة', two: 'حلقتان مجدولتان', few: 'حلقات مجدولة', many: 'حلقة مجدولة' })}
            {canReview
              ? <>، و{countLabel(pendingReviewNewsCount, { zero: 'لا أخبار تنتظر مراجعتك', one: 'خبر واحد ينتظر مراجعتك', two: 'خبران ينتظران مراجعتك', few: 'أخبار تنتظر مراجعتك', many: 'خبراً ينتظر مراجعتك' })}.</>
              : '.'}
          </p>
        </div>

        {/* Fast Action Buttons */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {/* Only actions this user may take: a button that answers "not allowed" is noise. */}
          {RbacService.hasPermission(currentUser, 'news.create') && <button
            type="button"
            onClick={onCreateNews}
            className="flex items-center gap-1.5 px-4 min-h-10 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-colors"
          >
            <Plus className="w-4 h-4" />
            خبر صحفي جديد
          </button>}
          {RbacService.hasPermission(currentUser, 'episodes.create') && <button
            type="button"
            onClick={onCreateEpisode}
            className="flex items-center gap-1.5 px-4 min-h-10 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-lg text-xs font-bold transition-colors"
          >
            <Video className="w-4 h-4 text-purple-600" />
            إعداد حلقة جديدة
          </button>}
        </div>
      </div>

      {canSetup && setup.pending && (
        <section data-tour="setup-wizard" aria-label="الإعداد السريع" className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-lg border border-blue-200 bg-blue-50">
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-bold text-slate-900">أكمل إعداد «مدار» لفريقك</h2>
            <p className="text-xs text-slate-700 mt-0.5">{setup.done} من {setup.total} خطوات مكتملة: المؤسسة، المحطات، تصنيفات الأخبار، الفريق، الأمان والنسخ الاحتياطي.</p>
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

      {/* Critical/Breaking News Banner */}
      {criticalNews.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 shadow-sm animate-fade-in flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start md:items-center gap-3">
            <div className="p-2 bg-red-600 rounded-full text-white shadow-sm shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-red-900 font-bold text-sm">تنبيه أحداث خطيرة / أخبار عاجلة ({criticalNews.length})</h3>
              <p className="text-red-700 text-xs mt-0.5">يوجد مواد إخبارية مصنفة كأولوية قصوى تتطلب اتخاذ إجراء فوري.</p>
            </div>
          </div>
          <div className="flex flex-col gap-2 w-full md:w-auto">
            {criticalNews.slice(0, 2).map((crit) => (
              <button 
                key={crit.id} 
                onClick={() => onSelectNews(crit.id)}
                className="text-right text-xs font-bold text-red-700 hover:text-red-800 bg-white/60 hover:bg-white px-3 py-2 rounded-lg border border-red-100 transition-colors flex items-center justify-between gap-4"
              >
                <span className="truncate max-w-[250px]">{crit.title}</span>
                <span className="text-2xs bg-red-100 px-1.5 py-0.5 rounded text-red-600 shrink-0">{getStatusLabel(crit.status)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* The day in four numbers: one ruled strip, each cell says its period and opens its screen */}
      <section aria-label="مؤشرات غرفة الأخبار اليوم" className="grid grid-cols-2 xl:grid-cols-4 bg-white border border-slate-200 rounded-xl divide-y xl:divide-y-0 divide-x divide-x-reverse divide-slate-200 overflow-hidden">
        {[
          { label: 'أخبار', period: 'اليوم', value: newsToday, note: `${publishedToday} نُشر اليوم · ${underReviewCount} قيد المراجعة الآن`, go: 'NEWS_LIST' as AppView, tone: 'text-slate-900' },
          { label: 'العاجل على الشريط', period: 'الآن', value: activeBreakingCount, note: `من ${breakingNews.length} عاجل مسجل`, go: 'BREAKING_NEWS' as AppView, tone: activeBreakingCount ? 'text-red-700' : 'text-slate-900' },
          { label: 'حلقات', period: 'اليوم', value: todayEpisodes.length, note: `${countLabel(upcomingEpisodes.length, { zero: 'لا حلقات قادمة', one: 'حلقة قادمة واحدة', two: 'حلقتان قادمتان', few: 'حلقات قادمة', many: 'حلقة قادمة' })} · ${countLabel(programs.length, { zero: 'لا برامج', one: 'برنامج واحد', two: 'برنامجان', few: 'برامج', many: 'برنامجاً' })}`, go: 'EPISODES' as AppView, tone: 'text-slate-900' },
          { label: 'مهام مفتوحة', period: 'الآن', value: openTasks.length, note: `${overdueTasks} متأخرة · من ${tasks.length} في كل الفترات`, go: 'TASKS' as AppView, tone: overdueTasks ? 'text-amber-700' : 'text-slate-900' },
        ].map((cell) => (
          <button key={cell.label} type="button" onClick={() => onNavigate(cell.go)} className="text-right p-4 hover:bg-slate-50 focus-visible:bg-slate-50 transition-colors min-w-0">
            <span className="block text-xs font-semibold text-slate-600">{cell.label} <span className="font-normal text-slate-500">({cell.period})</span></span>
            <span className={`block font-mono text-3xl font-bold tabular-nums leading-tight mt-1 ${cell.tone}`}>{cell.value}</span>
            <span className="block text-2xs text-slate-500 mt-1 truncate">{cell.note}</span>
          </button>
        ))}
      </section>

      {/* Main Two-Column Operational Layout */}
      <div className={`grid grid-cols-1 gap-6 ${sideOnly ? '' : 'lg:grid-cols-3'}`}>
        {/* Left Column (2 Cols in Arabic RTL): Upcoming Broadcast Schedule & News Flow */}
        {(showSchedule || showQueues) && <div className="lg:col-span-2 space-y-6">
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
                <div
                  key={ep.id}
                  onClick={() => onSelectEpisode(ep.id)}
                  className="p-4 rounded-xl border border-slate-200/80 hover:border-blue-300 hover:bg-blue-50/20 transition-all cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-bold text-slate-800 text-sm">{ep.title}</span>
                      <Badge variant="primary" size="sm">
                        {ep.programName}
                      </Badge>
                      <span className="text-xs text-slate-500 whitespace-nowrap">الحلقة <span className="font-mono tabular-nums">{ep.episodeNumber}</span></span>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                      <span>تقديم: <strong className="text-slate-700">{ep.presenterName}</strong></span>
                      <span>•</span>
                      <span>إنتاج: <strong className="text-slate-700">{ep.producerName}</strong></span>
                      <span>•</span>
                      <span>الاستوديو: <strong className="text-slate-700">{ep.studioName}</strong></span>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 self-end sm:self-center shrink-0">
                    <div className="text-left text-xs">
                      <span className="text-slate-500 block text-2xs whitespace-nowrap">{arabicDate((ep.broadcastDate || '').slice(0, 10))}</span>
                      <strong className="text-slate-800 font-bold font-mono tabular-nums whitespace-nowrap" dir="ltr">{ep.startTime}–{ep.endTime}</strong>
                    </div>
                    <span className="px-3 py-1 text-xs font-bold rounded-lg bg-blue-50 text-blue-700 whitespace-nowrap">
                      فتح الرانداون
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          )}

          {/* Workflow Queues (Editorial Flow) */}
          {showQueues && (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="p-5 border-b border-slate-200 bg-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <Newspaper className="w-5 h-5 text-emerald-700" />
                <h3 className="font-bold text-slate-800 text-sm sm:text-base">
                  طوابير سير العمل التحريري
                </h3>
              </div>
              <button
                onClick={() => onNavigate('NEWS_LIST')}
                className="text-xs font-semibold text-blue-600 hover:underline flex items-center gap-1"
              >
                غرفة الأخبار كاملة <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Queue Tabs */}
            <div className="flex items-center gap-1 p-3 bg-slate-50/50 border-b border-slate-200 overflow-x-auto">
              {(['DRAFT', 'UNDER_REVIEW', 'APPROVED', 'PUBLISHED'] as const).map((tab) => {
                const count = (newsList || []).filter(n => n.status === tab).length;
                const isActive = activeQueueTab === tab;
                return (
                  <button
                    key={tab}
                    onClick={() => setActiveQueueTab(tab)}
                    className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors flex items-center gap-2 ${
                      isActive ? getStatusColor(tab) + ' shadow-xs border border-slate-200' : 'text-slate-500 hover:bg-slate-100 border border-transparent'
                    }`}
                  >
                    {getStatusLabel(tab)}
                    <span className={`px-1.5 py-0.5 rounded-md text-2xs ${isActive ? 'bg-white/60' : 'bg-slate-200 text-slate-600'}`}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Category Filter Bar for Dashboard Queues */}
            {categories.length > 0 && (
              <div className="px-4 py-2.5 bg-slate-50/70 border-b border-slate-200 flex items-center gap-1.5 overflow-x-auto">
                <span className="text-xs font-bold text-slate-500 pl-1.5 shrink-0 flex items-center gap-1">
                  <Filter className="w-3.5 h-3.5 text-slate-500" />
                  <span>تصفية بالقسم:</span>
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedDashboardCategory('ALL')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold whitespace-nowrap transition-all flex items-center gap-1.5 shrink-0 ${
                    selectedDashboardCategory === 'ALL'
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                  }`}
                >
                  <span>كافة الأقسام</span>
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

                {selectedDashboardCategory !== 'ALL' && (
                  <button
                    type="button"
                    onClick={() => setSelectedDashboardCategory('ALL')}
                    className="text-xs font-bold text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 px-2 py-1 rounded-lg transition-colors shrink-0"
                  >
                    إلغاء التصفية
                  </button>
                )}
              </div>
            )}

            <div className={`p-3 divide-y divide-slate-100 ${queuedNews.length ? 'min-h-[300px]' : ''}`}>
              {queuedNews.length > 0 ? (
                queuedNews.map((news) => {
                  const cat = categories.find((c) => c.id === news.categoryId || c.nameAr === news.categoryName);
                  const catColor = cat?.colorCode || cat?.color || '#2563eb';

                  return (
                    <div
                      key={news.id}
                      onClick={() => onSelectNews(news.id)}
                      className="p-3 hover:bg-slate-50 rounded-xl transition-colors cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-4 group"
                    >
                      <div className="space-y-1.5 truncate">
                        <div className="flex items-center gap-2">
                          {news.priority === 'CRITICAL' && (
                            <Badge variant="danger" size="sm" dot>خطير</Badge>
                          )}
                          {news.priority === 'URGENT' && (
                            <Badge variant="danger" size="sm">عاجل</Badge>
                          )}
                          <span className="text-sm font-bold text-slate-800 truncate group-hover:text-blue-700 transition-colors">{news.title}</span>
                        </div>
                        <div className="text-2xs text-slate-500 flex items-center gap-2 flex-wrap">
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
                        </div>
                      </div>

                      <div className="shrink-0 self-end sm:self-center">
                         <ArrowUpRight className="w-4 h-4 text-slate-500 group-hover:text-blue-600 transition-colors" />
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-slate-500 text-center">
                  <FileCheck className="w-8 h-8 mb-2 text-slate-300" aria-hidden="true" />
                  <p className="text-sm font-medium">الطابور فارغ حالياً</p>
                  <p className="text-xs">
                    {selectedDashboardCategory !== 'ALL'
                      ? `لا مواد في قسم «${categories.find((c) => c.id === selectedDashboardCategory)?.nameAr || 'المحدد'}» بحالة «${getStatusLabel(activeQueueTab)}»`
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
          <div className="bg-white border border-slate-200 rounded-xl p-5">
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
          </div>

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
