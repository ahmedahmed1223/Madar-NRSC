import { guestKey, guestRoleName, questionKindName, segmentGuests, segmentQuestions } from '../shared/episodePlan';
import { airDisplayDefault, type AirDisplayMode } from '../shared/airDisplay';
import { AirDisplayControls } from '../components/onair/AirDisplayControls';
import { AirScriptPanel } from '../components/onair/AirScriptPanel';
import React, { useRef, useState } from 'react';
import { Maximize2 } from 'lucide-react';
import type { User } from '../types';
import { apiService } from '../services/api';
import { useLiveData } from '../hooks/useLiveData';
import { CUE_ACTIVE_MS, formatClock, isCueForUser, liveTiming } from '../shared/onair';
import { stationTimeZone } from '../shared/dates';
import { programmeSeconds, secondsUntilStart, stationWall } from '../shared/stationTime';
import { DriftIndicator } from '../components/onair/DriftIndicator';
import { AirSourceStatus } from '../components/onair/AirSourceStatus';
import { useAirConnection } from '../hooks/useAirConnection';

interface StudioScreenViewProps {
  currentUser: User;
  selectedShowId: string | null;
  onSelectShow: (id: string) => void;
}

const lowerThirdsFromStory = (seg: any): string[] => (seg?.graphics || []).flatMap((g: any) => g.lines || []);

/** Big, glanceable display for the studio floor and presenters. */
export const StudioScreenView: React.FC<StudioScreenViewProps> = ({ currentUser, selectedShowId, onSelectShow }) => {
  useLiveData(['onAir', 'episodes', 'bulletins', 'bulletinStories', 'cues', 'requests', 'settings'], 500);
  const connected = useAirConnection();
  const [displayOverride, setDisplayOverride] = useState<AirDisplayMode | null>(null);
  const displayMode = displayOverride || airDisplayDefault(apiService.getSettings(), 'studio');
  const ref = useRef<HTMLDivElement>(null);
  const liveStates = apiService.getOnAirStates().filter((s) => s.status === 'LIVE');
  const effectiveId = selectedShowId || liveStates[0]?.episodeId || '';
  const episode: any = apiService.getAirShows().find((e) => e.id === effectiveId);
  const state = effectiveId ? apiService.getOnAir(effectiveId) : null;
  const timing = liveTiming(state, episode);
  const seg = timing?.current;
  const guests = seg ? segmentGuests(seg) : [];
  const guestNames = new Set(guests.map((g) => ((episode?.guests || []) as any[]).find((x) => guestKey(x) === g.guestId)?.cgName || g.guestName));
  const lowerThirds = seg
    ? apiService
        .getRequests()
        .filter(
          (r) =>
            r.type === 'GRAPHICS' &&
            r.status !== 'CANCELLED' &&
            r.status !== 'REJECTED' &&
            // Segment graphics, plus the guests' name straps requested for the episode.
            (r.link?.segmentId === seg.id || (r.link?.episodeId === effectiveId && !r.link?.segmentId && guestNames.has(r.lines?.[0] || '')))
        )
        .flatMap((r) => r.lines || [])
        // Bulletin stories carry their own graphics.
        .concat(lowerThirdsFromStory(seg))
        .filter((line, i, arr) => arr.indexOf(line) === i)
    : [];
  const questions = seg && episode ? segmentQuestions(episode, seg).filter((q: any) => !q.isAsked).slice(0, 4) : [];
  const cue = apiService
    .getCues()
    .filter((c) => Date.now() - new Date(c.createdAt).getTime() < CUE_ACTIVE_MS && (!c.episodeId || c.episodeId === effectiveId))
    .filter((c) => c.targetDepartmentIds.length === 0 || ['studio', 'presenters'].some((d) => c.targetDepartmentIds.includes(d)) || isCueForUser(c, currentUser))[0];

  const remainingCls = !timing ? 'text-slate-200' : timing.remaining < 0 ? 'text-red-500' : timing.remaining <= 30 ? 'text-amber-300' : 'text-emerald-300';
  // Wall clock and countdowns in the station's time zone, whatever this computer's clock says.
  const stationZone = stationTimeZone(apiService.getSettings()?.defaultTimezone);
  const nowMs = Date.now();
  const wall = stationWall(nowMs, stationZone);
  const showLength = programmeSeconds(episode);
  const live = state?.status === 'LIVE';
  const untilStart = episode && !state ? secondsUntilStart(episode.broadcastDate, episode.startTime, nowMs, stationZone) : null;
  const programmeLeft = timing && showLength > 0 ? showLength - timing.onAirSeconds : null;
  const nextSegment = timing?.next ?? (!live && state?.status !== 'ENDED' ? episode?.rundown?.[0] : undefined);
  const fullTitle = episode ? `${episode.programName} — ${episode.title}` : '';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <select value={effectiveId} onChange={(e) => onSelectShow(e.target.value)} aria-label="الحلقة" title={fullTitle || undefined} className="min-h-11 w-full sm:w-80 min-w-0 max-w-full truncate px-3 py-2 border border-slate-200 rounded-xl text-xs bg-white">
          {!effectiveId && <option value="">لا يوجد بث مباشر الآن</option>}
          {apiService
            .getAirShows()
            .filter((e) => !e.deletedAt && (e.status !== 'BROADCASTED' || liveStates.some((l) => l.episodeId === e.id)))
            .map((e) => (
              <option key={e.id} value={e.id}>
                {liveStates.some((l) => l.episodeId === e.id) ? '● ' : ''}
                {e.programName} — {e.title}
              </option>
            ))}
        </select>
        <button type="button" onClick={() => ref.current?.requestFullscreen?.()} className="min-h-11 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-300 bg-white text-blue-700 text-xs font-bold">
          <Maximize2 className="w-4 h-4" />
          ملء الشاشة
        </button>
      </div>

      <div ref={ref} data-testid="studio-wall" className="theme-fixed bg-black text-white rounded-2xl min-h-[70vh] p-6 sm:p-10 flex flex-col gap-6 overflow-auto">
        <AirSourceStatus connected={connected} />
        <AirDisplayControls mode={displayMode} onChange={setDisplayOverride} />
        {cue && (
          <div className={`rounded-2xl px-6 py-4 text-center text-2xl sm:text-4xl xl:text-5xl font-black ${cue.level === 'urgent' ? 'bg-red-600 animate-pulse' : cue.level === 'standby' ? 'bg-amber-400 text-black' : 'bg-sky-600'}`} role="alert">
            {cue.message}
          </div>
        )}

        {/* Top line: what is on, whether it is on air, and the station's wall clock. */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <span className={`shrink-0 px-4 py-2 rounded-xl text-xl xl:text-3xl font-black ${live ? 'bg-red-600 text-white' : 'bg-slate-700 text-white'}`}>{live ? 'على الهواء' : state?.status === 'ENDED' ? 'انتهى البث' : 'خارج الهواء'}</span>
            <span className="min-w-0 text-xl sm:text-2xl xl:text-3xl font-bold text-slate-100 break-words">{fullTitle || 'لا يوجد بث'}</span>
          </div>
          <div className="text-left" role="timer" aria-label={`الساعة ${wall.clock}`}>
            <span className="block text-sm xl:text-lg font-bold text-slate-300 text-right">{stationZone ? 'الساعة (توقيت المحطة)' : 'الساعة'}</span>
            <span className="block text-6xl xl:text-8xl font-black tabular-nums leading-none text-white">{wall.clock}</span>
          </div>
        </div>

        <div className="flex-1 grid grid-cols-1 xl:grid-cols-3 gap-6 items-stretch">
          {/* The current segment and its time left */}
          <section aria-label="الفقرة الحالية" className="xl:col-span-2 flex flex-col items-center justify-center text-center gap-4 rounded-3xl border-2 border-slate-700 p-6">
            <h1 className="no-strap text-4xl sm:text-6xl xl:text-7xl font-black leading-tight">{seg?.title || (state?.status === 'ENDED' ? 'انتهى البث' : 'بانتظار بدء البث')}</h1>
            {timing ? (
              <div>
                <span className="block text-lg xl:text-2xl font-bold text-slate-300">{timing.remaining < 0 ? 'تجاوزت الفقرة وقتها بـ' : 'المتبقي للفقرة'}</span>
                <span className={`block text-8xl sm:text-9xl xl:text-[11rem] font-black tabular-nums leading-none ${remainingCls}`} dir="ltr">
                  {formatClock(Math.abs(timing.remaining))}
                </span>
              </div>
            ) : (
              untilStart !== null && untilStart > 0 && untilStart < 24 * 3600 && (
                <div>
                  <span className="block text-lg xl:text-2xl font-bold text-slate-300">حتى الهواء</span>
                  <span className="block text-8xl xl:text-9xl font-black tabular-nums leading-none text-white" dir="ltr">{formatClock(untilStart)}</span>
                </div>
              )
            )}
            {guests.length > 0 && (
              <p className="text-2xl xl:text-3xl text-slate-100">
                {guests.map((g) => `${g.guestName}${g.role === 'MAIN' ? '' : ` (${guestRoleName(g.role)})`}`).join('، ')}
              </p>
            )}
            {lowerThirds.length > 0 && (
              <div className="space-y-1">
                {lowerThirds.map((l, i) => (
                  <p key={i} className="text-xl xl:text-2xl text-sky-300 font-bold">▸ {l}</p>
                ))}
              </div>
            )}
          </section>

          {/* The programme as a whole, and ahead/behind */}
          <section aria-label="توقيت البرنامج" className="flex flex-col gap-4">
            <div className="grid grid-cols-2 xl:grid-cols-1 gap-4">
              <div className="rounded-3xl border-2 border-slate-700 p-5">
                <span className="block text-lg xl:text-2xl font-bold text-slate-300">المنقضي من البرنامج</span>
                <span className="block text-5xl xl:text-7xl font-black tabular-nums text-white" dir="ltr">{timing ? formatClock(timing.onAirSeconds) : '--:--'}</span>
              </div>
              <div className="rounded-3xl border-2 border-slate-700 p-5">
                <span className="block text-lg xl:text-2xl font-bold text-slate-300">{programmeLeft !== null && programmeLeft < 0 ? 'تجاوز البرنامج مدته بـ' : 'المتبقي للبرنامج'}</span>
                <span className={`block text-5xl xl:text-7xl font-black tabular-nums ${programmeLeft !== null && programmeLeft < 0 ? 'text-red-500' : 'text-white'}`} dir="ltr">
                  {programmeLeft !== null ? formatClock(Math.abs(programmeLeft)) : showLength ? formatClock(showLength) : '--:--'}
                </span>
              </div>
            </div>
            {timing && live ? (
              <DriftIndicator drift={timing.drift} size="wall" className="w-full" />
            ) : (
              <div className="rounded-2xl border-2 border-dashed border-slate-700 px-6 py-5 text-center text-lg xl:text-2xl font-semibold text-slate-400">التقدم والتأخر يظهران مع بدء البث</div>
            )}
          </section>
        </div>

        {displayMode === 'TEXT' && state?.status !== 'ENDED' && <AirScriptPanel segmentId={seg?.id || episode?.rundown?.[0]?.id} script={seg ? seg.scriptText : episode?.rundown?.[0]?.scriptText} live={state?.status === 'LIVE'} />}
        {questions.length > 0 && (
          <div className="border-t-2 border-slate-700 pt-4 space-y-2" aria-label="أسئلة الفقرة">
            {questions.map((q: any) => (
              <p key={q.id} className="text-xl sm:text-2xl xl:text-3xl text-slate-100 leading-relaxed">
                <span className={`text-base xl:text-xl font-bold ml-2 ${q.kind === 'BACKUP' ? 'text-slate-300' : 'text-amber-300'}`}>{questionKindName(q.kind)}</span>
                {q.questionText}
              </p>
            ))}
          </div>
        )}
        {nextSegment && (
          <div className="border-t-2 border-slate-700 pt-4 text-2xl xl:text-4xl text-slate-200 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="font-bold">{timing ? 'الفقرة التالية:' : 'الفقرة الأولى:'}</span>
            <strong className="min-w-0 break-words text-white font-bold">{nextSegment.title}</strong>
            <span className="tabular-nums text-slate-300" dir="ltr">{formatClock(nextSegment.durationSeconds || 0)}</span>
          </div>
        )}
      </div>
    </div>
  );
};
