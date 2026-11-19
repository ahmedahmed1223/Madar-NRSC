import { countLabel } from '../shared/arabicPlural';
import { EP_NOUNS } from '../shared/episodeNouns';
import { matchesQuery } from '../shared/search';
import { bulletinSlot, episodeSlot, findStudioClashes, scheduledBulletinSlot, type AirSlot, type StudioClash } from '../shared/schedule';
import { BULLETIN_STATUSES, bulletinKindName } from '../shared/bulletins';
import { addDaysIso, arabicDate, localDateString } from '../shared/dates';
import { episodeStatusInfo } from '../components/episodes/episodeDetails';
import { apiService } from '../services/api';
import { useLiveData } from '../hooks/useLiveData';
import React, { useState, useMemo } from 'react';
import { ChevronRight, ChevronLeft, Tv, AlertTriangle, CalendarDays, Grid3X3, Search, X, Newspaper } from 'lucide-react';
import { Episode, Program } from '../types';
import { Badge } from '../components/common/Badge';

interface CalendarViewProps {
  episodes: Episode[];
  programs: Program[];
  onSelectEpisode: (episodeId: string) => void;
  /** Opens a bulletin's rundown. Without it, bulletin links navigate to /bulletins/<id>. */
  onOpenBulletin?: (bulletinId: string) => void;
  /** Opens the bulletins list (where a scheduled bulletin is created). Without it, links go to /bulletins. */
  onOpenBulletins?: () => void;
}

const ARABIC_DAYS = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];

const isLiveSlot = (s: AirSlot) => s.status === 'ON_AIR' || s.status === 'LIVE';
const byTime = (a: AirSlot, b: AirSlot) => `${a.broadcastDate} ${a.startTime}`.localeCompare(`${b.broadcastDate} ${b.startTime}`);

function slotStatus(slot: AirSlot): { label: string; variant: 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'purple' } {
  if (slot.kind === 'scheduled-bulletin') return { label: 'مجدولة — لم تُنشأ بعد', variant: 'default' };
  if (isLiveSlot(slot)) return { label: 'على الهواء الآن', variant: 'danger' };
  if (slot.kind === 'bulletin') {
    const name = BULLETIN_STATUSES.find((s) => s.id === slot.status)?.name || 'نشرة';
    return { label: name, variant: slot.status === 'DONE' ? 'success' : 'info' };
  }
  return episodeStatusInfo(slot.status);
}

/** Opens an episode, a bulletin or the bulletins list, as a real link where it navigates. */
const SlotLink: React.FC<{
  slot: AirSlot;
  onSelectEpisode: (id: string) => void;
  onOpenBulletin?: (id: string) => void;
  onOpenBulletins?: () => void;
  className?: string;
  title?: string;
  children: React.ReactNode;
}> = ({ slot, onSelectEpisode, onOpenBulletin, onOpenBulletins, className = '', title, children }) => {
  if (slot.kind === 'episode') {
    return (
      <button type="button" onClick={() => onSelectEpisode(slot.refId)} className={className} title={title}>
        {children}
      </button>
    );
  }
  const href = slot.kind === 'bulletin' ? `/bulletins/${encodeURIComponent(slot.refId)}` : '/bulletins';
  const handler = slot.kind === 'bulletin' ? (onOpenBulletin ? () => onOpenBulletin(slot.refId) : null) : onOpenBulletins || null;
  return (
    <a
      href={href}
      title={title}
      className={className}
      onClick={(e) => {
        if (!handler || e.ctrlKey || e.metaKey || e.shiftKey) return;
        e.preventDefault();
        handler();
      }}
    >
      {children}
    </a>
  );
};

const kindLabel = (slot: AirSlot) => (slot.kind === 'episode' ? 'حلقة' : slot.kind === 'bulletin' ? 'نشرة' : 'نشرة مجدولة');

export const CalendarView: React.FC<CalendarViewProps> = ({
  episodes = [],
  programs = [],
  onSelectEpisode,
  onOpenBulletin,
  onOpenBulletins,
}) => {
  useLiveData(['bulletins', 'bulletinFormats'], 60_000);
  const [selectedProgram, setSelectedProgram] = useState('ALL');
  const [selectedStudio, setSelectedStudio] = useState('ALL');
  const [viewMode, setViewMode] = useState<'WEEK' | 'MONTH' | 'STUDIO'>('WEEK');
  const [weekOffset, setWeekOffset] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const todayStr = localDateString();
  const [studioDay, setStudioDay] = useState(todayStr);

  // Generate week dates based on weekOffset
  const currentWeekDays = useMemo(() => {
    // The week around today (the station's today under unified time), Saturday first.
    const base = addDaysIso(todayStr, weekOffset * 7);
    const [by, bm, bd] = base.split('-').map(Number);
    const dayOfWeek = new Date(Date.UTC(by, bm - 1, bd)).getUTCDay(); // 0 is Sunday, 6 is Saturday
    const saturdayIso = addDaysIso(base, -((dayOfWeek + 1) % 7));
    return ARABIC_DAYS.map((name, i) => {
      const isoStr = addDaysIso(saturdayIso, i);
      return { name, date: isoStr, displayDate: arabicDate(isoStr), isToday: isoStr === todayStr };
    });
  }, [weekOffset, todayStr]);
  const weekDates = currentWeekDays.map((d) => d.date);
  const shownStudioDay = weekDates.includes(studioDay) ? studioDay : weekDates.includes(todayStr) ? todayStr : weekDates[0];

  // Everything that holds a studio: programme episodes, created bulletins, and the bulletins the
  // schedule plans for this week that nobody has created yet (from today on).
  const bulletins = apiService.getBulletins();
  const missingKey = weekDates.filter((d) => d >= todayStr).map((d) => `${d}:${apiService.missingScheduledBulletins(d).map((f) => f.id).join(',')}`).join('|');
  const slots: AirSlot[] = useMemo(() => {
    const scheduled = weekDates
      .filter((d) => d >= todayStr)
      .flatMap((d) => apiService.missingScheduledBulletins(d).map((f) => scheduledBulletinSlot(f, d)));
    return [
      ...episodes.filter((e) => !e.deletedAt).map((e) => episodeSlot(e as any)),
      ...bulletins.map((b) => bulletinSlot(b, bulletinKindName(b.kind))),
      ...scheduled,
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episodes, bulletins.map((b) => `${b.id}@${b.updatedAt}`).join(','), missingKey]);

  // Bookings of the same studio with overlapping on-air windows (incl. past midnight).
  const clashes = useMemo(() => findStudioClashes(slots), [slots]);
  const conflictIds = useMemo(() => new Set(clashes.flatMap((c) => [c.a.id, c.b.id])), [clashes]);
  const clashesOf = (slot: AirSlot) => clashes.filter((c) => c.a.id === slot.id || c.b.id === slot.id).map((c) => (c.a.id === slot.id ? c.b : c.a));
  const inWeek = (c: StudioClash) => weekDates.includes(c.a.broadcastDate || '') || weekDates.includes(c.b.broadcastDate || '');
  const weekClashes = clashes.filter(inWeek);
  const otherClashes = clashes.length - weekClashes.length;

  // Studios list
  const studios = useMemo(() => {
    const s = new Set<string>();
    slots.forEach((slot) => slot.studioName && s.add(slot.studioName));
    return Array.from(s);
  }, [slots]);

  const visible = (slot: AirSlot) => {
    if (selectedProgram === 'BULLETINS' && slot.kind === 'episode') return false;
    if (selectedProgram !== 'ALL' && selectedProgram !== 'BULLETINS' && (slot.kind !== 'episode' || slot.programId !== selectedProgram)) return false;
    if (selectedStudio !== 'ALL' && slot.studioName !== selectedStudio) return false;
    if (searchQuery.trim() && !matchesQuery(searchQuery, slot.title, slot.programName, slot.presenterName, slot.studioName)) return false;
    return true;
  };
  const filteredSlots = slots.filter(visible).sort(byTime);

  const hasActiveFilters = selectedProgram !== 'ALL' || selectedStudio !== 'ALL' || searchQuery.trim() !== '' || weekOffset !== 0;

  const handleResetFilters = () => {
    setSelectedProgram('ALL');
    setSelectedStudio('ALL');
    setSearchQuery('');
    setWeekOffset(0);
  };

  const linkProps = { onSelectEpisode, onOpenBulletin, onOpenBulletins };

  const slotCard = (slot: AirSlot, compact: boolean) => {
    const isConflict = conflictIds.has(slot.id);
    const isLive = isLiveSlot(slot);
    const isBulletin = slot.kind !== 'episode';
    const status = slotStatus(slot);
    const others = isConflict ? clashesOf(slot) : [];
    return (
      <div key={slot.id} className="space-y-1">
        <SlotLink
          slot={slot}
          {...linkProps}
          title={[kindLabel(slot), slot.title, slot.programName, slot.studioName, slot.presenterName].filter(Boolean).join(' · ')}
          className={`block w-full text-right p-2 rounded-xl border transition-all space-y-1.5 group ${
            isConflict
              ? 'bg-rose-50/80 border-rose-400 border-2 hover:border-rose-600'
              : isLive
              ? 'bg-red-50 border-red-300 ring-2 ring-red-500/30'
              : slot.kind === 'scheduled-bulletin'
              ? 'bg-white border-dashed border-indigo-300 hover:border-indigo-500'
              : isBulletin
              ? 'bg-indigo-50/60 border-indigo-200 hover:border-indigo-500'
              : 'bg-white border-slate-200 hover:border-blue-500 hover:shadow-md'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-1 text-2xs">
            <span className={`font-bold px-1.5 py-0.5 rounded tabular-nums ${isLive ? 'bg-red-600 text-white' : isBulletin ? 'bg-indigo-100 text-indigo-800' : 'bg-blue-50 text-blue-700'}`}>
              {slot.startTime || '—'}
              {slot.endTime ? `–${slot.endTime}` : ''}
            </span>
            <span className="text-2xs text-slate-600 font-bold whitespace-nowrap">{slot.durationMinutes || 0} د</span>
          </div>
          {isBulletin && (
            <span className="inline-flex items-center gap-1 text-2xs font-bold text-indigo-800">
              <Newspaper className="w-3 h-3" aria-hidden="true" />
              {slot.kind === 'bulletin' ? 'نشرة' : 'نشرة مجدولة — لم تُنشأ بعد'}
            </span>
          )}
          <h4 className={`${compact ? 'text-2xs' : 'text-xs'} font-bold text-slate-800 leading-snug line-clamp-3 group-hover:text-blue-700 transition-colors`}>{slot.title}</h4>
          <div className="text-2xs text-slate-600 space-y-0.5 pt-1 border-t border-slate-100">
            {slot.kind === 'episode' && <div className="font-semibold text-blue-700 truncate">{slot.programName}</div>}
            <div className="truncate">{slot.studioName || 'بلا استوديو'}</div>
            {!compact && <Badge variant={status.variant} size="sm">{status.label}</Badge>}
          </div>
        </SlotLink>
        {isConflict && (
          <p className="text-2xs font-bold text-rose-800 px-1" role="note">
            <AlertTriangle className="w-3 h-3 inline-block ml-1 -mt-0.5" aria-hidden="true" />
            تعارض في الاستوديو مع{' '}
            {others.map((o, i) => (
              <React.Fragment key={o.id}>
                {i > 0 && '، '}
                <SlotLink slot={o} {...linkProps} className="underline hover:text-rose-950">
                  {kindLabel(o)} «{o.title}»
                </SlotLink>
              </React.Fragment>
            ))}
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">جدول البث</h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">الحلقات والنشرات حسب اليوم أو الاستوديو، مع كشف تعارض الاستوديوهات بين الحلقات والنشرات.</p>
        </div>

        {/* View Switchers & Controls */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Navigation Offset */}
          <div className="flex items-center bg-white border border-slate-200 rounded-xl p-1 shadow-2xs">
            <button type="button" onClick={() => setWeekOffset((prev) => prev - 1)} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors" title="الأسبوع السابق" aria-label="الأسبوع السابق">
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setWeekOffset(0)}
              className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-colors ${weekOffset === 0 ? 'text-blue-600 bg-blue-50' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              الأسبوع الحالي
            </button>
            <button type="button" onClick={() => setWeekOffset((prev) => prev + 1)} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors" title="الأسبوع القادم" aria-label="الأسبوع القادم">
              <ChevronLeft className="w-4 h-4" />
            </button>
          </div>

          {/* Mode switch */}
          <div className="flex items-center bg-white border border-slate-200 rounded-xl p-1 shadow-2xs text-xs">
            <button
              type="button"
              onClick={() => setViewMode('WEEK')}
              aria-pressed={viewMode === 'WEEK'}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-lg font-bold transition-all ${viewMode === 'WEEK' ? 'bg-blue-600 text-white shadow-2xs' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              <CalendarDays className="w-3.5 h-3.5" />
              أسبوعي
            </button>
            <button
              type="button"
              onClick={() => setViewMode('STUDIO')}
              aria-pressed={viewMode === 'STUDIO'}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-lg font-bold transition-all ${viewMode === 'STUDIO' ? 'bg-blue-600 text-white shadow-2xs' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              <Grid3X3 className="w-3.5 h-3.5" />
              الاستوديوهات
            </button>
          </div>

          {/* Filters & Search */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <label htmlFor="calendar-search-input" className="sr-only">بحث في جدول البث</label>
              <Search className="w-4 h-4 text-slate-500 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="calendar-search-input"
                type="text"
                inputMode="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="بحث عن حلقة، نشرة، برنامج، مذيع..."
                autoComplete="off"
                spellCheck="false"
                className="w-48 sm:w-56 pr-10 pl-8 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
              />
              {searchQuery && (
                <button type="button" onClick={() => setSearchQuery('')} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-600 p-0.5" title="مسح البحث" aria-label="مسح البحث">
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
              <option value="ALL">جميع البرامج والنشرات</option>
              <option value="BULLETINS">النشرات الإخبارية فقط</option>
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

      {/* Studio clashes this week, each with links to both bookings */}
      {(weekClashes.length > 0 || otherClashes > 0) && (
        <section role="alert" aria-label="تعارض الاستوديوهات" className="p-3.5 bg-rose-50 border-2 border-rose-300 rounded-xl text-rose-900 text-xs space-y-2">
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <AlertTriangle className="w-4 h-4 text-rose-700 shrink-0" aria-hidden="true" />
            تعارض في الاستوديوهات: {countLabel(weekClashes.length, EP_NOUNS.clash)} هذا الأسبوع
            {otherClashes > 0 && <span className="font-semibold text-rose-800">(و{countLabel(otherClashes, EP_NOUNS.clash)} في أسابيع أخرى)</span>}
          </h2>
          {weekClashes.length > 0 && (
            <ul className="space-y-1.5">
              {weekClashes.map((c) => (
                <li key={`${c.a.id}|${c.b.id}`} className="flex flex-wrap items-center gap-x-1.5 gap-y-1 bg-white/70 border border-rose-200 rounded-lg px-2.5 py-1.5">
                  <strong>{c.studioName}</strong>
                  <span>·</span>
                  <span>{arabicDate(c.b.broadcastDate || '')}</span>
                  <span>·</span>
                  <SlotLink slot={c.a} {...linkProps} className="font-bold text-blue-800 underline hover:text-blue-950">
                    {kindLabel(c.a)} «{c.a.title}» <span className="tabular-nums">{c.a.startTime}–{c.a.endTime}</span>
                  </SlotLink>
                  <span>مع</span>
                  <SlotLink slot={c.b} {...linkProps} className="font-bold text-blue-800 underline hover:text-blue-950">
                    {kindLabel(c.b)} «{c.b.title}» <span className="tabular-nums">{c.b.startTime}–{c.b.endTime}</span>
                  </SlotLink>
                  <span className="text-rose-800">(تداخل {c.overlapMinutes} د)</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* WEEK VIEW */}
      {viewMode === 'WEEK' && (
        <div className="grid grid-cols-1 md:grid-cols-7 gap-3">
          {currentWeekDays.map((day) => {
            const daySlots = filteredSlots.filter((s) => s.broadcastDate === day.date);
            return (
              <div
                key={day.date}
                className={`rounded-2xl border flex flex-col md:min-h-[520px] transition-all ${
                  day.isToday ? 'bg-blue-50/40 border-blue-300 ring-2 ring-blue-500/20 shadow-xs' : 'bg-white border-slate-200 shadow-2xs'
                }`}
              >
                <div className={`p-3 text-center border-b rounded-t-2xl ${day.isToday ? 'bg-blue-600 text-white border-blue-600' : 'bg-slate-50 border-slate-200 text-slate-700'}`}>
                  <div className="text-xs font-bold">{day.name}</div>
                  <div className="text-2xs tabular-nums mt-0.5 opacity-90">{day.displayDate}</div>
                </div>
                <div className="p-2 space-y-2.5 flex-1 overflow-y-auto">
                  {daySlots.length === 0 ? (
                    <div className="py-16 text-center text-slate-400 text-xs">لا حلقات ولا نشرات</div>
                  ) : (
                    daySlots.map((slot) => slotCard(slot, true))
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
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <Tv className="w-4 h-4 text-blue-600" />
              تشغيل الاستوديوهات يوم {arabicDate(shownStudioDay)}
            </h3>
            <div className="flex flex-wrap gap-1" role="group" aria-label="اليوم">
              {currentWeekDays.map((d) => (
                <button
                  key={d.date}
                  type="button"
                  aria-pressed={d.date === shownStudioDay}
                  onClick={() => setStudioDay(d.date)}
                  className={`px-2.5 py-1 rounded-lg text-2xs font-bold border ${d.date === shownStudioDay ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}
                >
                  {d.isToday ? 'اليوم' : d.name}
                </button>
              ))}
            </div>
          </div>

          {studios.length === 0 ? (
            <p className="py-8 text-center text-xs text-slate-500">لم يُحدَّد استوديو لأي حلقة أو نشرة بعد.</p>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {studios
                .filter((st) => selectedStudio === 'ALL' || st === selectedStudio)
                .map((studioName) => {
                  const studioSlots = filteredSlots.filter((s) => s.studioName === studioName && s.broadcastDate === shownStudioDay);
                  const busy = studioSlots.some((s) => conflictIds.has(s.id));
                  return (
                    <div key={studioName} className={`border rounded-2xl p-4 space-y-3 ${busy ? 'border-rose-300 bg-rose-50/40' : 'border-slate-200 bg-slate-50/50'}`}>
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-bold text-slate-800 flex items-center gap-2">
                          <span className={`w-2.5 h-2.5 rounded-full ${busy ? 'bg-rose-500' : 'bg-emerald-500'}`} aria-hidden="true" />
                          {studioName}
                        </h4>
                        <Badge variant={busy ? 'danger' : 'default'} size="sm">
                          {busy ? 'تعارض' : countLabel(studioSlots.length, EP_NOUNS.show)}
                        </Badge>
                      </div>
                      <div className="space-y-2">
                        {studioSlots.length === 0 ? (
                          <div className="py-8 text-center text-xs text-slate-500 bg-white rounded-xl border border-dashed border-slate-200">الاستوديو متاح</div>
                        ) : (
                          studioSlots.map((slot) => slotCard(slot, false))
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
