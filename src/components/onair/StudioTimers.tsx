import { useSyncExternalStore } from 'react';
import type { apiService } from '../../services/api';
import { formatClock, isCueActive, liveTiming, type Cue, type OnAirState } from '../../shared/onair';
import { programmeSeconds, secondsUntilStart, stationWall } from '../../shared/stationTime';
import { DriftIndicator } from './DriftIndicator';

let now = Date.now();
let timer: number | undefined;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  if (timer === undefined) {
    now = Date.now();
    timer = window.setInterval(() => {
      now = Date.now();
      listeners.forEach(callback => callback());
    }, 500);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.clearInterval(timer);
      timer = undefined;
    }
  };
};
const clockSnapshot = () => now;
const useStudioTime = () => useSyncExternalStore(subscribe, clockSnapshot);

type TimerProps = {
  episode?: ReturnType<typeof apiService.getAirShows>[number];
  state?: OnAirState | null;
};

export function StudioClock({ zone }: { zone?: string }) {
  const wall = stationWall(useStudioTime(), zone);
  return (
    <div className="text-left" role="timer" aria-label={`الساعة ${wall.clock}`}>
      <span className="block text-sm xl:text-lg font-bold text-slate-300 text-right">{zone ? 'الساعة (توقيت المحطة)' : 'الساعة'}</span>
      <span className="block text-6xl xl:text-8xl font-black tabular-nums leading-none text-white">{wall.clock}</span>
    </div>
  );
}

export function StudioSegmentTimer({ episode, state, zone }: TimerProps & { zone?: string }) {
  const currentTime = useStudioTime();
  const timing = liveTiming(state, episode, currentTime);
  if (timing) {
    const remaining = timing.remaining;
    const color = remaining < 0 ? 'text-red-500' : remaining <= 30 ? 'text-amber-300' : 'text-emerald-300';
    return (
      <div>
        <span className="block text-lg xl:text-2xl font-bold text-slate-300">{remaining < 0 ? 'تجاوزت الفقرة وقتها بـ' : 'المتبقي للفقرة'}</span>
        <span className={`block text-8xl sm:text-9xl xl:text-[11rem] font-black tabular-nums leading-none ${color}`} dir="ltr">{formatClock(Math.abs(remaining))}</span>
      </div>
    );
  }
  const untilStart = episode && !state ? secondsUntilStart(episode.broadcastDate, episode.startTime, currentTime, zone) : null;
  if (untilStart === null || untilStart <= 0 || untilStart >= 24 * 3600) return null;
  return (
    <div>
      <span className="block text-lg xl:text-2xl font-bold text-slate-300">حتى الهواء</span>
      <span className="block text-8xl xl:text-9xl font-black tabular-nums leading-none text-white" dir="ltr">{formatClock(untilStart)}</span>
    </div>
  );
}

export function StudioProgrammeTimers({ episode, state }: TimerProps) {
  const timing = liveTiming(state, episode, useStudioTime());
  const showLength = programmeSeconds(episode);
  const remaining = timing && showLength > 0 ? showLength - timing.onAirSeconds : null;
  const overrun = remaining !== null && remaining < 0;
  return (
    <section aria-label="توقيت البرنامج" className="flex flex-col gap-4">
      <div className="grid grid-cols-2 xl:grid-cols-1 gap-4">
        <div className="rounded-3xl border-2 border-slate-700 p-5">
          <span className="block text-lg xl:text-2xl font-bold text-slate-300">المنقضي من البرنامج</span>
          <span className="block text-5xl xl:text-7xl font-black tabular-nums text-white" dir="ltr">{timing ? formatClock(timing.onAirSeconds) : '--:--'}</span>
        </div>
        <div className="rounded-3xl border-2 border-slate-700 p-5">
          <span className="block text-lg xl:text-2xl font-bold text-slate-300">{overrun ? 'تجاوز البرنامج مدته بـ' : 'المتبقي للبرنامج'}</span>
          <span className={`block text-5xl xl:text-7xl font-black tabular-nums ${overrun ? 'text-red-500' : 'text-white'}`} dir="ltr">
            {remaining !== null ? formatClock(Math.abs(remaining)) : showLength ? formatClock(showLength) : '--:--'}
          </span>
        </div>
      </div>
      {timing && state?.status === 'LIVE' ? (
        <DriftIndicator drift={timing.drift} size="wall" className="w-full" />
      ) : (
        <div className="rounded-2xl border-2 border-dashed border-slate-700 px-6 py-5 text-center text-lg xl:text-2xl font-semibold text-slate-400">التقدم والتأخر يظهران مع بدء البث</div>
      )}
    </section>
  );
}

export function StudioCueBanner({ cues }: { cues: Cue[] }) {
  const currentTime = useStudioTime();
  const cue = cues.find(candidate => isCueActive(candidate, currentTime));
  if (!cue) return null;
  return (
    <div className={`rounded-2xl px-6 py-4 text-center text-2xl sm:text-4xl xl:text-5xl font-black ${cue.level === 'urgent' ? 'bg-red-600 motion-safe:animate-pulse' : cue.level === 'standby' ? 'bg-amber-400 text-black' : 'bg-sky-600'}`} role="alert">
      {cue.message}
    </div>
  );
}
