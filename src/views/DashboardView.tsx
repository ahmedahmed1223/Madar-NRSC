import { countLabel } from '../shared/labels';
import { StationClock } from '../components/common/StationClock';
import { appLocale, zoneOptions } from '../shared/dateFormat';
import { arabicDate, localDateString } from '../shared/dates';
import { Avatar } from '../components/common/Avatar';
import React, { useState } from 'react';
import {
  Newspaper,
  Flame,
  Tv,
  Video,
  CheckSquare,
  Users,
  Clock,
  ArrowUpRight,
  TrendingUp,
  AlertCircle,
  Plus,
  Radio,
  FileCheck,
  Calendar as CalendarIcon,
  AlertTriangle,
  Filter,
} from 'lucide-react';
import { Badge } from '../components/common/Badge';
import { NewsItem, Program, Episode, EditorialTask, Guest, BreakingNews, User, Category } from '../types';
import { AppView } from '../components/layout/Sidebar';

import { MyWorkPanel } from '../components/dashboard/MyWorkPanel';
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
  const [activeQueueTab, setActiveQueueTab] = useState<'DRAFT' | 'UNDER_REVIEW' | 'APPROVED' | 'PUBLISHED'>('UNDER_REVIEW');
  const [selectedDashboardCategory, setSelectedDashboardCategory] = useState<string>('ALL');

  const publishedNewsCount = (newsList || []).filter((n) => n.status === 'PUBLISHED').length;
  const pendingReviewNewsCount = (newsList || []).filter((n) => n.status === 'UNDER_REVIEW').length;
  const activeBreakingCount = (breakingNews || []).filter((b) => b.isActive).length;
  const todayKey = new Date().toLocaleDateString('en-CA');
  // Upcoming = on air now, or scheduled from today on and not yet aired; earliest first.
  const nowKey = `${todayKey} ${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`;
  const upcomingEpisodes = (episodes || [])
    .filter((e) => e.status === 'ON_AIR' || (!['CANCELLED', 'ARCHIVED', 'BROADCASTED'].includes(e.status) && `${(e.broadcastDate || '').slice(0, 10)} ${e.endTime || e.startTime || ''}` >= nowKey))
    .sort((a, b) => `${a.broadcastDate} ${a.startTime}`.localeCompare(`${b.broadcastDate} ${b.startTime}`));
  const todayEpisodes = (episodes || []).filter(
    (e) => e.status === 'ON_AIR' || ((e.broadcastDate || '').slice(0, 10) === todayKey && !['CANCELLED', 'ARCHIVED', 'BROADCASTED'].includes(e.status))
  );
  const openTasks = (tasks || []).filter((t) => !['COMPLETED', 'DONE', 'CANCELLED'].includes(t.status));

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

  return (
    <div className="space-y-6">
      {/* Welcome & Live Banner */}
      <div className="bg-gradient-to-l from-blue-50 via-white to-white rounded-3xl p-6 text-slate-900 shadow-xs border border-slate-200 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 text-xs font-semibold border border-blue-200 flex items-center gap-1.5">
              <Radio className="w-3.5 h-3.5 text-red-500 animate-pulse" />
              مركز العمليات الإخبارية والإنتاج المباشر
            </span>
            <StationClock className="px-2.5 py-1 rounded-full bg-white border border-slate-200" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight">
            مرحباً، {currentUser.fullName}
          </h1>
          <p className="text-slate-600 text-xs sm:text-sm max-w-2xl leading-relaxed">
            اليوم: {countLabel(todayEpisodes.length, { zero: 'لا حلقات مجدولة', one: 'حلقة واحدة مجدولة', two: 'حلقتان مجدولتان', few: 'حلقات مجدولة', many: 'حلقة مجدولة' })}،
            و{countLabel(pendingReviewNewsCount, { zero: 'لا أخبار تنتظر التدقيق', one: 'خبر واحد ينتظر التدقيق والاعتماد', two: 'خبران ينتظران التدقيق والاعتماد', few: 'أخبار تنتظر التدقيق والاعتماد', many: 'خبراً ينتظر التدقيق والاعتماد' })}.
          </p>
        </div>

        {/* Fast Action Buttons */}
        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onCreateNews}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-md"
          >
            <Plus className="w-4 h-4" />
            خبر صحفي جديد
          </button>
          <button
            type="button"
            onClick={onCreateEpisode}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-xl text-xs font-bold transition-all"
          >
            <Video className="w-4 h-4 text-purple-600" />
            إعداد حلقة جديدة
          </button>
        </div>
      </div>

      <MyWorkPanel
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
                <span className="text-[10px] bg-red-100 px-1.5 py-0.5 rounded text-red-600 shrink-0">{getStatusLabel(crit.status)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* KPI Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Newsroom */}
        <div
          onClick={() => onNavigate('NEWS_LIST')}
          className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs hover:shadow-md transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-slate-500">إجمالي الأخبار</span>
            <div className="p-2.5 rounded-xl bg-blue-50 text-blue-600 group-hover:bg-blue-600 group-hover:text-white transition-colors">
              <Newspaper className="w-5 h-5" />
            </div>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-3xl font-black text-slate-800">{newsList.length}</span>
            <span className="text-xs text-emerald-600 font-semibold">{publishedNewsCount} منشور</span>
          </div>
          <div className="mt-2 text-[11px] text-slate-400 flex items-center gap-1">
            <FileCheck className="w-3.5 h-3.5 text-amber-500" />
            <span>{pendingReviewNewsCount} قيد المراجعة والتدقيق</span>
          </div>
        </div>

        {/* Card 2: Breaking News */}
        <div
          onClick={() => onNavigate('BREAKING_NEWS')}
          className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs hover:shadow-md transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-slate-500">الأخبار العاجلة</span>
            <div className="p-2.5 rounded-xl bg-red-50 text-red-600 group-hover:bg-red-600 group-hover:text-white transition-colors">
              <Flame className="w-5 h-5" />
            </div>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-3xl font-black text-slate-800">{activeBreakingCount}</span>
            <span className="text-xs text-red-600 font-semibold">على شريط البث</span>
          </div>
          <div className="mt-2 text-[11px] text-slate-400">
            <span>من إجمالي {breakingNews.length} خبراً عاجلاً مسجلاً</span>
          </div>
        </div>

        {/* Card 3: Episodes */}
        <div
          onClick={() => onNavigate('EPISODES')}
          className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs hover:shadow-md transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-slate-500">حلقات البرامج</span>
            <div className="p-2.5 rounded-xl bg-purple-50 text-purple-600 group-hover:bg-purple-600 group-hover:text-white transition-colors">
              <Video className="w-5 h-5" />
            </div>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-3xl font-black text-slate-800">{episodes.length}</span>
            <span className="text-xs text-purple-600 font-semibold">{programs.length} برامج</span>
          </div>
          <div className="mt-2 text-[11px] text-slate-400">
            <span>{countLabel(todayEpisodes.length, { zero: 'لا حلقات', one: 'حلقة واحدة', two: 'حلقتان', few: 'حلقات', many: 'حلقة' })} للبث اليوم</span>
          </div>
        </div>

        {/* Card 4: Open Tasks */}
        <div
          onClick={() => onNavigate('TASKS')}
          className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs hover:shadow-md transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-slate-500">المهام التحريرية</span>
            <div className="p-2.5 rounded-xl bg-amber-50 text-amber-600 group-hover:bg-amber-600 group-hover:text-white transition-colors">
              <CheckSquare className="w-5 h-5" />
            </div>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-3xl font-black text-slate-800">{openTasks.length}</span>
            <span className="text-xs text-amber-600 font-semibold">مفتوحة</span>
          </div>
          <div className="mt-2 text-[11px] text-slate-400">
            <span>من إجمالي {tasks.length} مهمة إجمالية</span>
          </div>
        </div>
      </div>

      {/* Main Two-Column Operational Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (2 Cols in Arabic RTL): Upcoming Broadcast Schedule & News Flow */}
        <div className="lg:col-span-2 space-y-6">
          {/* Upcoming Episodes / Playout */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-2xs">
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
              {upcomingEpisodes.length === 0 && <p className="text-xs text-slate-400 text-center py-6">لا حلقات قادمة مجدولة.</p>}
              {upcomingEpisodes.slice(0, 3).map((ep) => (
                <div
                  key={ep.id}
                  onClick={() => onSelectEpisode(ep.id)}
                  className="p-4 rounded-xl border border-slate-200/80 hover:border-blue-300 hover:bg-blue-50/20 transition-all cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-800 text-sm">{ep.title}</span>
                      <Badge variant="primary" size="sm">
                        {ep.programName}
                      </Badge>
                      <span className="text-xs font-mono text-slate-500">حلقة #{ep.episodeNumber}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                      <span>تقديم: <strong className="text-slate-700">{ep.presenterName}</strong></span>
                      <span>•</span>
                      <span>إنتاج: <strong className="text-slate-700">{ep.producerName}</strong></span>
                      <span>•</span>
                      <span>الاستوديو: <strong className="text-slate-700">{ep.studioName}</strong></span>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 self-end sm:self-center">
                    <div className="text-left font-mono text-xs">
                      <span className="text-slate-400 block text-[10px] font-sans">{arabicDate((ep.broadcastDate || '').slice(0, 10))}</span>
                      <strong className="text-slate-800 font-bold">{ep.startTime} - {ep.endTime}</strong>
                    </div>
                    <span className="px-3 py-1 text-xs font-bold rounded-lg bg-blue-50 text-blue-700">
                      فتح الرانداون
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Workflow Queues (Editorial Flow) */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-2xs overflow-hidden">
            <div className="p-5 border-b border-slate-200 bg-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <Newspaper className="w-5 h-5 text-emerald-600" />
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
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all flex items-center gap-2 ${
                      isActive ? getStatusColor(tab) + ' shadow-xs border border-slate-200' : 'text-slate-500 hover:bg-slate-100 border border-transparent'
                    }`}
                  >
                    {getStatusLabel(tab)}
                    <span className={`px-1.5 py-0.5 rounded-md text-[10px] ${isActive ? 'bg-white/60' : 'bg-slate-200 text-slate-600'}`}>
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
                  <Filter className="w-3.5 h-3.5 text-slate-400" />
                  <span>تصفية بالقسم:</span>
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedDashboardCategory('ALL')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold whitespace-nowrap transition-all flex items-center gap-1.5 shrink-0 ${
                    selectedDashboardCategory === 'ALL'
                      ? 'bg-slate-800 text-white shadow-xs'
                      : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                  }`}
                >
                  <span>كافة الأقسام</span>
                  <span
                    className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
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
                        backgroundColor: isSelected ? color : `${color}10`,
                        borderColor: isSelected ? color : `${color}35`,
                        color: isSelected ? '#ffffff' : color,
                      }}
                    >
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: isSelected ? '#ffffff' : color }}
                      />
                      <span>{cat.nameAr}</span>
                      <span
                        className="text-[10px] px-1.5 py-0.2 rounded-full font-mono font-bold"
                        style={{
                          backgroundColor: isSelected ? 'rgba(255,255,255,0.25)' : `${color}20`,
                          color: isSelected ? '#ffffff' : color,
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

            <div className="p-3 divide-y divide-slate-100 min-h-[300px]">
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
                        <div className="text-[11px] text-slate-500 flex items-center gap-2 flex-wrap">
                          <span
                            className="px-2 py-0.5 rounded-md text-[11px] font-bold border flex items-center gap-1.5 shrink-0"
                            style={{
                              backgroundColor: `${catColor}15`,
                              color: catColor,
                              borderColor: `${catColor}30`,
                            }}
                          >
                            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: catColor }} />
                            <span>{news.categoryName || cat?.nameAr || 'عام'}</span>
                          </span>
                          <span>•</span>
                          <span>بواسطة: <strong className="text-slate-700">{news.authorName}</strong></span>
                          <span>•</span>
                          <span>منذ {new Date(news.updatedAt).toLocaleTimeString(appLocale(), { ...zoneOptions(), hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                      </div>

                      <div className="shrink-0 self-end sm:self-center">
                         <ArrowUpRight className="w-4 h-4 text-slate-400 group-hover:text-blue-600 transition-colors" />
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="flex flex-col items-center justify-center h-full py-12 text-slate-400">
                  <FileCheck className="w-12 h-12 mb-3 text-slate-200" />
                  <p className="text-sm font-medium">الطابور فارغ حالياً</p>
                  <p className="text-xs">
                    {selectedDashboardCategory !== 'ALL'
                      ? `لا توجد مواد إخبارية في قسم (${categories.find((c) => c.id === selectedDashboardCategory)?.nameAr || 'المحدد'}) بحالة (${getStatusLabel(activeQueueTab)})`
                      : `لا يوجد مواد إخبارية في حالة (${getStatusLabel(activeQueueTab)})`}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Editorial Tasks & Guest Directory Preview */}
        <div className="space-y-6">
          {/* Urgent Editorial Tasks */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-2xs">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <CheckSquare className="w-5 h-5 text-amber-600" />
                <h3 className="font-bold text-slate-800 text-sm">مهام تحريرية مستعجلة</h3>
              </div>
              <button
                onClick={() => onNavigate('TASKS')}
                className="text-xs font-semibold text-blue-600 hover:underline"
              >
                إدارة المهام
              </button>
            </div>

            <div className="space-y-2.5">
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
                      variant={['CRITICAL', 'URGENT', 'HIGH'].includes(task.priority) ? 'danger' : 'warning'}
                      size="sm"
                    >
                      {TASK_PRIORITY_LABELS[task.priority] || task.priority}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-500">
                    <span>المسند إليه: {task.assigneeName || task.assignedToName || '—'}</span>
                    <span className="font-mono text-[10px]">
                      {task.dueDate && Date.parse(task.dueDate) < Date.now() && !['DONE', 'COMPLETED', 'CANCELLED'].includes(task.status) ? (
                        <span className="text-rose-700 font-bold">
                          متأخرة منذ {Math.max(1, Math.floor((Date.now() - Date.parse(task.dueDate)) / 86_400_000))} يوم
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
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-2xs">
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
                    <span className="text-[11px] text-slate-500 block truncate">
                      {guest.jobTitle} - {guest.organization}
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-500 shrink-0">
                    {guest.totalAppearances ? `${guest.totalAppearances} ظهور` : 'جديد'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
