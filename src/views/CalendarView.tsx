import React, { useState } from 'react';
import {
  Calendar as CalendarIcon,
  ChevronRight,
  ChevronLeft,
  Clock,
  Tv,
  Filter,
  Video,
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
  const [viewMode, setViewMode] = useState<'WEEK' | 'MONTH'>('WEEK');

  // Days in current Arabic calendar week view
  const days = [
    { name: 'السبت', date: '2026-09-12' },
    { name: 'الأحد', date: '2026-09-13', isToday: true },
    { name: 'الاثنين', date: '2026-09-14' },
    { name: 'الثلاثاء', date: '2026-09-15' },
    { name: 'الأربعاء', date: '2026-09-16' },
    { name: 'الخميس', date: '2026-09-17' },
    { name: 'الجمعة', date: '2026-09-18' },
  ];

  const filteredEpisodes = (episodes || []).filter((ep) => {
    if (selectedProgram !== 'ALL' && ep.programId !== selectedProgram) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-800 tracking-tight">
            جدول ومواعيد البث التلفزيوني
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            الخريطة البرامجية الأسبوعية، توزيع الاستوديوهات، ومواعيد البث المباشر
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl p-1 text-xs">
            <button
              type="button"
              onClick={() => setViewMode('WEEK')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-colors ${
                viewMode === 'WEEK' ? 'bg-blue-600 text-white shadow-2xs' : 'text-slate-600'
              }`}
            >
              جدول أسبوعي
            </button>
            <button
              type="button"
              onClick={() => setViewMode('MONTH')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-colors ${
                viewMode === 'MONTH' ? 'bg-blue-600 text-white shadow-2xs' : 'text-slate-600'
              }`}
            >
              شهري
            </button>
          </div>

          <select
            value={selectedProgram}
            onChange={(e) => setSelectedProgram(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-xl text-xs bg-white focus:ring-2 focus:ring-blue-500"
          >
            <option value="ALL">جميع البرامج</option>
            {programs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Week Grid */}
      <div className="grid grid-cols-1 md:grid-cols-7 gap-3">
        {days.map((day) => {
          // Episodes on this day (or dummy match)
          const dayEpisodes = filteredEpisodes.filter((ep) => ep.broadcastDate === day.date || day.isToday);

          return (
            <div
              key={day.date}
              className={`rounded-2xl border flex flex-col min-h-[500px] transition-all ${
                day.isToday
                  ? 'bg-blue-50/40 border-blue-300 shadow-xs'
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
                <div className="text-xs font-bold">{day.name}</div>
                <div className="text-[11px] font-mono mt-0.5 opacity-90">{day.date}</div>
              </div>

              {/* Day Episodes list */}
              <div className="p-2 space-y-2.5 flex-1 overflow-y-auto">
                {dayEpisodes.length === 0 ? (
                  <div className="py-12 text-center text-slate-300 text-xs">
                    لا توجد برامج مجدولة
                  </div>
                ) : (
                  dayEpisodes.map((ep) => (
                    <div
                      key={ep.id}
                      onClick={() => onSelectEpisode(ep.id)}
                      className="p-3 bg-white rounded-xl border border-slate-200 shadow-2xs hover:border-blue-500 hover:shadow-md cursor-pointer transition-all space-y-2 group"
                    >
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-mono font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded">
                          {ep.startTime}
                        </span>
                        <Badge
                          variant={ep.status === 'READY_FOR_BROADCAST' ? 'success' : 'warning'}
                          size="sm"
                        >
                          {ep.durationMinutes} د
                        </Badge>
                      </div>

                      <h4 className="text-xs font-bold text-slate-800 leading-snug group-hover:text-blue-600">
                        {ep.title}
                      </h4>

                      <div className="text-[10px] text-slate-500 space-y-0.5">
                        <div className="font-semibold text-slate-700">{ep.programName}</div>
                        <div>{ep.studioName}</div>
                        <div>المقدم: {ep.presenterName}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
