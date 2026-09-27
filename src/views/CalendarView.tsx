import { matchesQuery } from '../shared/search';
import { findStudioConflicts } from '../shared/schedule';
import { localDateString } from '../shared/dates';
import React, { useState, useMemo } from 'react';
import {
  Calendar as CalendarIcon,
  ChevronRight,
  ChevronLeft,
  Clock,
  Tv,
  Filter,
  Video,
  AlertTriangle,
  Radio,
  CheckCircle2,
  CalendarDays,
  Grid3X3,
  Layers,
  Search,
  X,
} from 'lucide-react';
import { Episode, Program } from '../types';
import { Badge } from '../components/common/Badge';

interface CalendarViewProps {
  episodes: Episode[];
  programs: Program[];
  onSelectEpisode: (episodeId: string) => void;
}

export const CalendarView: React.FC<CalendarViewProps> = ({
  episodes = [],
  programs = [],
  onSelectEpisode,
}) => {
  const [selectedProgram, setSelectedProgram] = useState('ALL');
  const [selectedStudio, setSelectedStudio] = useState('ALL');
  const [viewMode, setViewMode] = useState<'WEEK' | 'MONTH' | 'STUDIO'>('WEEK');
  const [weekOffset, setWeekOffset] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');

  // Studios list
  const studios = useMemo(() => {
    const s = new Set<string>();
    episodes.forEach((ep) => {
      if (ep.studioName) s.add(ep.studioName);
    });
    return Array.from(s);
  }, [episodes]);

  // Generate week dates based on weekOffset
  const currentWeekDays = useMemo(() => {
    const baseDate = new Date();
    baseDate.setDate(baseDate.getDate() + weekOffset * 7);
    
    // Find current week Saturday (start of week in AR)
    const dayOfWeek = baseDate.getDay(); // 0 is Sunday, 6 is Saturday
    const diff = (dayOfWeek + 1) % 7; // distance from Saturday
    const saturday = new Date(baseDate);
    saturday.setDate(baseDate.getDate() - diff);

    const arabicDays = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];
    const days = [];
    const todayStr = localDateString();

    for (let i = 0; i < 7; i++) {
      const d = new Date(saturday);
      d.setDate(saturday.getDate() + i);
      const isoStr = localDateString(d);
      days.push({
        name: arabicDays[i],
        date: isoStr,
        displayDate: `${d.getDate()} / ${d.getMonth() + 1}`,
        isToday: isoStr === todayStr,
      });
    }
    return days;
  }, [weekOffset]);

  // Episodes booked in the same studio with overlapping on-air windows (incl. past midnight).
  const conflicts = useMemo(() => findStudioConflicts(episodes), [episodes]);

  const filteredEpisodes = useMemo(() => {
    return episodes.filter((ep) => {
      if (selectedProgram !== 'ALL' && ep.programId !== selectedProgram) return false;
      if (selectedStudio !== 'ALL' && ep.studioName !== selectedStudio) return false;
      if (searchQuery.trim()) {
        if (!matchesQuery(searchQuery, ep.title, ep.programName, ep.presenterName, ep.studioName)) return false;
      }
      return true;
    });
  }, [episodes, selectedProgram, selectedStudio, searchQuery]);

  const hasActiveFilters = selectedProgram !== 'ALL' || selectedStudio !== 'ALL' || searchQuery.trim() !== '' || weekOffset !== 0;

  const handleResetFilters = () => {
    setSelectedProgram('ALL');
    setSelectedStudio('ALL');
    setSearchQuery('');
    setWeekOffset(0);
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 bg-blue-600 text-white rounded-xl shadow-xs">
              <CalendarIcon className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                جدول ومواعيد البث التلفزيوني
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                الخريطة البرامجية الذكية، إدارة حجز الاستوديوهات، ومراقبة البث المباشر
              </p>
            </div>
          </div>
        </div>

        {/* View Switchers & Controls */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Navigation Offset */}
          <div className="flex items-center bg-white border border-slate-200 rounded-xl p-1 shadow-2xs">
            <button
              type="button"
              onClick={() => setWeekOffset((prev) => prev - 1)}
              className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors"
              title="الأسبوع السابق"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setWeekOffset(0)}
              className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-colors ${
                weekOffset === 0 ? 'text-blue-600 bg-blue-50' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              الأسبوع الحالي
            </button>
            <button
              type="button"
              onClick={() => setWeekOffset((prev) => prev + 1)}
              className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors"
              title="الأسبوع القادم"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          </div>

          {/* Mode switch */}
          <div className="flex items-center bg-white border border-slate-200 rounded-xl p-1 shadow-2xs text-xs">
            <button
              type="button"
              onClick={() => setViewMode('WEEK')}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-lg font-bold transition-all ${
                viewMode === 'WEEK'
                  ? 'bg-blue-600 text-white shadow-2xs'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <CalendarDays className="w-3.5 h-3.5" />
              أسبوعي
            </button>
            <button
              type="button"
              onClick={() => setViewMode('STUDIO')}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-lg font-bold transition-all ${
                viewMode === 'STUDIO'
                  ? 'bg-blue-600 text-white shadow-2xs'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Grid3X3 className="w-3.5 h-3.5" />
              الاستوديوهات
            </button>
          </div>

          {/* Filters & Search */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <label htmlFor="calendar-search-input" className="sr-only">بحث في جدول البث</label>
              <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="calendar-search-input"
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="بحث عن حلقة، برنامج، مذيع..."
                autoComplete="off"
                spellCheck="false"
                className="w-48 sm:w-56 pr-10 pl-8 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                  title="مسح البحث"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <label htmlFor="calendar-program-filter" className="sr-only">تصفية حسب البرنامج</label>
            <select
              id="calendar-program-filter"
              value={selectedProgram}
              onChange={(e) => setSelectedProgram(e.target.value)}
              className="px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all font-medium"
            >
              <option value="ALL">جميع البرامج</option>
              {programs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>

            <label htmlFor="calendar-studio-filter" className="sr-only">تصفية حسب الاستوديو</label>
            <select
              id="calendar-studio-filter"
              value={selectedStudio}
              onChange={(e) => setSelectedStudio(e.target.value)}
              className="px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all font-medium"
            >
              <option value="ALL">جميع الاستوديوهات</option>
              {studios.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="px-3 py-2 text-xs font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-xl transition-colors"
                title="إعادة تعيين جميع الفلاتر والبحث"
              >
                إعادة تعيين
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Conflict Warning Banner if any */}
      {conflicts.size > 0 && (
        <div className="flex items-center gap-3 p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs animate-in fade-in">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
          <div className="font-semibold">
            تنبيه تعارض مواعيد: تم رصد {conflicts.size} حلقات تشترك في نفس الاستوديو وتوقيت البث. يرجى مراجعة الاستوديوهات المحددة باللون الأحمر.
          </div>
        </div>
      )}

      {/* WEEK VIEW */}
      {viewMode === 'WEEK' && (
        <div className="grid grid-cols-1 md:grid-cols-7 gap-3">
          {currentWeekDays.map((day) => {
            const dayEpisodes = filteredEpisodes.filter(
              (ep) => ep.broadcastDate === day.date
            );

            return (
              <div
                key={day.date}
                className={`rounded-2xl border flex flex-col min-h-[520px] transition-all ${
                  day.isToday
                    ? 'bg-blue-50/40 border-blue-300 ring-2 ring-blue-500/20 shadow-xs'
                    : 'bg-white border-slate-200 shadow-2xs'
                }`}
              >
                {/* Day Header */}
                <div
                  className={`p-3 text-center border-b rounded-t-2xl ${
                    day.isToday
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-slate-50 border-slate-200 text-slate-700'
                  }`}
                >
                  <div className="text-xs font-black">{day.name}</div>
                  <div className="text-[11px] font-mono mt-0.5 opacity-90">{day.displayDate}</div>
                </div>

                {/* Day Episodes list */}
                <div className="p-2 space-y-2.5 flex-1 overflow-y-auto">
                  {dayEpisodes.length === 0 ? (
                    <div className="py-16 text-center text-slate-300 text-xs">
                      لا توجد برامج
                    </div>
                  ) : (
                    dayEpisodes.map((ep) => {
                      const isConflict = conflicts.has(ep.id);
                      const isLive = ep.status === 'ON_AIR' || (ep.status as any) === 'LIVE';

                      return (
                        <div
                          key={ep.id}
                          onClick={() => onSelectEpisode(ep.id)}
                          className={`p-3 rounded-xl border transition-all space-y-2 cursor-pointer group ${
                            isConflict
                              ? 'bg-rose-50/80 border-rose-300 hover:border-rose-500 shadow-2xs'
                              : isLive
                              ? 'bg-red-50 border-red-300 ring-2 ring-red-500/30'
                              : 'bg-white border-slate-200 hover:border-blue-500 hover:shadow-md'
                          }`}
                        >
                          <div className="flex items-center justify-between text-[11px]">
                            <span
                              className={`font-mono font-black px-2 py-0.5 rounded ${
                                isLive
                                  ? 'bg-red-600 text-white'
                                  : 'bg-blue-50 text-blue-700'
                              }`}
                            >
                              {ep.startTime || '20:00'}
                            </span>
                            <span className="text-[10px] text-slate-500 font-bold">
                              {ep.durationMinutes || 45} دقيقة
                            </span>
                          </div>

                          <h4 className="text-xs font-bold text-slate-800 leading-snug group-hover:text-blue-600 transition-colors">
                            {ep.title}
                          </h4>

                          <div className="text-[10px] text-slate-500 space-y-1 pt-1 border-t border-slate-100">
                            <div className="font-semibold text-slate-700 truncate">
                              {ep.programName}
                            </div>
                            <div className="flex items-center justify-between text-slate-500">
                              <span>{ep.studioName || 'استوديو الأخبار'}</span>
                              <span className="text-slate-600 font-medium truncate max-w-[80px]">
                                {ep.presenterName}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* STUDIO GRID VIEW */}
      {viewMode === 'STUDIO' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <Tv className="w-4 h-4 text-blue-600" />
              مخطط تشغيل الاستوديوهات لليوم الحالي
            </h3>
            <span className="text-xs text-slate-400 font-mono">تحديث مباشر</span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {(studios.length > 0 ? studios : ['استوديو 1 (الأخبار)', 'استوديو 2 (الحواري)', 'استوديو البث الافتراضي']).map(
              (studioName) => {
                const studioEps = filteredEpisodes.filter(
                  (ep) => (ep.studioName || 'استوديو 1 (الأخبار)') === studioName
                );

                return (
                  <div
                    key={studioName}
                    className="border border-slate-200 rounded-2xl p-4 bg-slate-50/50 space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-black text-slate-800 flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                        {studioName}
                      </h4>
                      <Badge variant="default" size="sm">
                        {studioEps.length} حلقات
                      </Badge>
                    </div>

                    <div className="space-y-2">
                      {studioEps.length === 0 ? (
                        <div className="py-8 text-center text-xs text-slate-400 bg-white rounded-xl border border-dashed border-slate-200">
                          الاستوديو متاح
                        </div>
                      ) : (
                        studioEps.map((ep) => (
                          <div
                            key={ep.id}
                            onClick={() => onSelectEpisode(ep.id)}
                            className="p-3 bg-white rounded-xl border border-slate-200 hover:border-blue-500 cursor-pointer transition-all space-y-1.5"
                          >
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-mono font-bold text-blue-600">
                                {ep.startTime}
                              </span>
                              <Badge
                                variant={
                                  ep.status === 'READY_FOR_BROADCAST'
                                    ? 'success'
                                    : (ep.status === 'ON_AIR' || (ep.status as any) === 'LIVE')
                                    ? 'danger'
                                    : 'warning'
                                }
                                size="sm"
                              >
                                {(ep.status === 'ON_AIR' || (ep.status as any) === 'LIVE') ? 'مباشر الآن' : ep.status}
                              </Badge>
                            </div>
                            <div className="text-xs font-bold text-slate-800">{ep.title}</div>
                            <div className="text-[11px] text-slate-500">{ep.presenterName}</div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                );
              }
            )}
          </div>
        </div>
      )}
    </div>
  );
};
