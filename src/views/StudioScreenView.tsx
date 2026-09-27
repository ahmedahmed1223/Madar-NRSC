import { guestKey, guestRoleName, questionKindName, segmentGuests, segmentQuestions } from '../shared/episodePlan';
import React, { useRef, useState } from 'react';
import { Maximize2 } from 'lucide-react';
import type { User } from '../types';
import { apiService } from '../services/api';
import { useLiveData } from '../hooks/useLiveData';
import { CUE_ACTIVE_MS, formatClock, isCueForUser, liveTiming } from '../shared/onair';

interface StudioScreenViewProps {
  currentUser: User;
  initialEpisodeId?: string | null;
}

const lowerThirdsFromStory = (seg: any): string[] => (seg?.graphics || []).flatMap((g: any) => g.lines || []);

/** Big, glanceable display for the studio floor and presenters. */
export const StudioScreenView: React.FC<StudioScreenViewProps> = ({ currentUser, initialEpisodeId }) => {
  useLiveData(['onAir', 'episodes', 'bulletins', 'bulletinStories', 'cues', 'requests'], 500);
  const ref = useRef<HTMLDivElement>(null);
  const live = apiService.getOnAirStates().filter((s) => s.status === 'LIVE');
  const [episodeId, setEpisodeId] = useState<string>(initialEpisodeId || live[0]?.episodeId || '');
  const effectiveId = episodeId || live[0]?.episodeId || '';
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

  const remainingCls = !timing ? 'text-slate-300' : timing.remaining < 0 ? 'text-red-500' : timing.remaining <= 30 ? 'text-amber-300' : 'text-emerald-300';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <select value={effectiveId} onChange={(e) => setEpisodeId(e.target.value)} aria-label="الحلقة" className="px-3 py-2 border border-slate-200 rounded-xl text-xs bg-white max-w-sm">
          {!effectiveId && <option value="">لا يوجد بث مباشر الآن</option>}
          {apiService
            .getAirShows()
            .filter((e) => !e.deletedAt && (e.status !== 'BROADCASTED' || live.some((l) => l.episodeId === e.id)))
            .map((e) => (
              <option key={e.id} value={e.id}>
                {live.some((l) => l.episodeId === e.id) ? '● ' : ''}
                {e.programName} — {e.title}
              </option>
            ))}
        </select>
        <button type="button" onClick={() => ref.current?.requestFullscreen?.()} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold">
          <Maximize2 className="w-4 h-4" />
          ملء الشاشة
        </button>
      </div>

      <div ref={ref} className="theme-fixed bg-black text-white rounded-2xl min-h-[70vh] p-6 sm:p-10 flex flex-col gap-6 overflow-auto">
        {cue && (
          <div className={`rounded-2xl px-6 py-4 text-center text-2xl sm:text-4xl font-black ${cue.level === 'urgent' ? 'bg-red-600 animate-pulse' : cue.level === 'standby' ? 'bg-amber-500 text-black' : 'bg-sky-600'}`} role="alert">
            {cue.message}
          </div>
        )}
        <div className="flex items-center justify-between text-sm sm:text-base text-slate-400">
          <span>{episode ? `${episode.programName} — ${episode.title}` : 'لا يوجد بث'}</span>
          <span className={`px-3 py-1 rounded-lg font-black ${state?.status === 'LIVE' ? 'bg-red-600 text-white' : 'bg-slate-800'}`}>{state?.status === 'LIVE' ? 'ON AIR' : 'OFF AIR'}</span>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-4">
          <h1 className="text-4xl sm:text-6xl lg:text-7xl font-black leading-tight">{seg?.title || (state?.status === 'ENDED' ? 'انتهى البث' : 'بانتظار بدء البث')}</h1>
          {timing && (
            <span className={`text-7xl sm:text-9xl font-black font-mono ${remainingCls}`} dir="ltr">
              {formatClock(timing.remaining)}
            </span>
          )}
          {guests.length > 0 && (
            <p className="text-xl sm:text-2xl text-slate-300">
              {guests.map((g) => `${g.guestName}${g.role === 'MAIN' ? '' : ` (${guestRoleName(g.role)})`}`).join('، ')}
            </p>
          )}
          {lowerThirds.length > 0 && (
            <div className="space-y-1">
              {lowerThirds.map((l, i) => (
                <p key={i} className="text-lg sm:text-xl text-sky-300 font-bold">▸ {l}</p>
              ))}
            </div>
          )}
        </div>
        {questions.length > 0 && (
          <div className="border-t border-slate-800 pt-4 space-y-2" aria-label="أسئلة الفقرة">
            {questions.map((q: any) => (
              <p key={q.id} className="text-lg sm:text-2xl text-slate-200 leading-relaxed">
                <span className={`text-sm font-bold ml-2 ${q.kind === 'BACKUP' ? 'text-slate-500' : 'text-amber-300'}`}>{questionKindName(q.kind)}</span>
                {q.questionText}
              </p>
            ))}
          </div>
        )}
        {timing?.next && (
          <div className="border-t border-slate-800 pt-4 text-lg sm:text-2xl text-slate-300">
            التالي: <strong className="text-white">{timing.next.title}</strong> <span className="font-mono text-slate-500" dir="ltr">({formatClock(timing.next.durationSeconds || 0)})</span>
          </div>
        )}
      </div>
    </div>
  );
};
