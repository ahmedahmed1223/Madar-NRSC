import { confirmDialog } from '../services/dialogs';
import { AsRunPanel } from '../components/onair/AsRunPanel';
import { segmentGuests } from '../shared/episodePlan';
import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Megaphone, MonitorPlay, Play, Radio, Square } from 'lucide-react';
import type { Episode, User } from '../types';
import { apiService } from '../services/api';
import { RbacService } from '../services/rbacService';
import { useLiveData } from '../hooks/useLiveData';
import { DEPARTMENTS, departmentName } from '../shared/departments';
import { canControlOnAir, CUE_PRESETS, Cue, formatClock, liveTiming } from '../shared/onair';
import { episodeReadiness } from '../shared/production';
import { localDateString } from '../shared/dates';

interface OnAirViewProps {
  currentUser: User;
  onOpenStudioScreen: (episodeId: string) => void;
  /** Episode or bulletin to show first (e.g. opened from a bulletin rundown). */
  initialShowId?: string | null;
}

/** Live control of the show, shared in real time with every department. */
/** On-air control and the As-Run log (what actually aired). */
export const OnAirView: React.FC<OnAirViewProps> = (props) => {
  const [tab, setTab] = useState<'CONTROL' | 'ASRUN'>('CONTROL');
  return (
    <div className="space-y-4">
      <div role="tablist" className="flex gap-2 border-b border-slate-200 pb-2 text-xs font-bold">
        {([
          ['CONTROL', 'التحكم بالبث'],
          ['ASRUN', 'سجل البث الفعلي (As-Run)'],
        ] as const).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`px-4 py-2 rounded-xl ${tab === id ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'CONTROL' ? <OnAirControl {...props} /> : <AsRunPanel currentUser={props.currentUser} />}
    </div>
  );
};

const OnAirControl: React.FC<OnAirViewProps> = ({ currentUser, onOpenStudioScreen, initialShowId }) => {
  useLiveData(['onAir', 'episodes', 'bulletins', 'bulletinStories', 'cues', 'requests', 'media'], 1000);
  const canControl = canControlOnAir(currentUser, (p) => RbacService.hasPermission(currentUser, p));
  const today = localDateString();
  // Programme episodes and news bulletins both run here.
  const episodes = apiService.getAirShows().filter((e) => !e.deletedAt);
  const states = apiService.getOnAirStates();
  const liveIds = states.filter((s) => s.status === 'LIVE').map((s) => s.episodeId);
  const candidates = useMemo(
    () =>
      episodes
        .filter(
          (e) =>
            liveIds.includes(e.id) ||
            (e.status !== 'BROADCASTED' && (e.broadcastDate >= today || e.status === 'READY_FOR_BROADCAST' || e.status === 'ON_AIR'))
        )
        .sort((a, b) => Number(liveIds.includes(b.id)) - Number(liveIds.includes(a.id)) || `${a.broadcastDate} ${a.startTime}`.localeCompare(`${b.broadcastDate} ${b.startTime}`)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [episodes.length, liveIds.join(','), today]
  );
  const [episodeId, setEpisodeId] = useState<string>(() => initialShowId || liveIds[0] || candidates[0]?.id || '');
  const [error, setError] = useState<string | null>(null);
  const [cueText, setCueText] = useState('');
  const [cueTargets, setCueTargets] = useState<string[]>([]);

  const episode = episodes.find((e) => e.id === episodeId) as Episode | undefined;
  const state = episode ? apiService.getOnAir(episode.id) : null;
  const rundown = (episode?.rundown || []).filter((s) => s && s.id);
  const live = state?.status === 'LIVE';
  const timing = liveTiming(state, episode);
  const isBulletin = (episode as any)?.kind === 'bulletin';
  // A bulletin is ready when every story on air is approved; an episode when every department delivered.
  const readiness = !episode
    ? null
    : isBulletin
    ? (() => {
        const pending = rundown.filter((s: any) => s.notApproved);
        return { ready: rundown.length > 0 && pending.length === 0, blockers: pending.map((s: any) => ({ segmentTitle: s.title, detail: 'غير معتمدة' })) };
      })()
    : episodeReadiness(episode, { requests: apiService.getRequests(), media: apiService.getMedia() as any[] });
  const myCues = apiService
    .getCues()
    .filter((c) => c.fromId === currentUser.id && (!episode || !c.episodeId || c.episodeId === episode.id))
    .slice(0, 5);

  const run = (fn: () => void) => {
    try {
      setError(null);
      fn();
    } catch (err: any) {
      setError(err?.message || 'تعذر تنفيذ الأمر');
    }
  };

  const goTo = (index: number) => {
    if (!episode || !live || index < 0 || index >= rundown.length) return;
    run(() => apiService.setOnAir(episode.id, 'LIVE', rundown[index].id));
  };

  // Keyboard: Space/Left = next, Right = previous (RTL), while live.
  useEffect(() => {
    if (!canControl || !live) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
      if (e.key === ' ' || e.key === 'ArrowLeft') {
        e.preventDefault();
        goTo((timing?.index ?? -1) + 1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        goTo((timing?.index ?? 1) - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const start = async () => {
    if (!episode || !rundown.length) return;
    if (readiness && !readiness.ready && !(await confirmDialog(isBulletin ? `${readiness.blockers.length} قصة غير معتمدة في النشرة. بدء البث رغم ذلك؟` : `الحلقة غير مكتملة الجاهزية (${readiness.blockers.length} عنصر). بدء البث رغم ذلك؟`))) return;
    run(() => apiService.setOnAir(episode.id, 'LIVE', rundown[0].id));
  };

  const sendCue = (message: string, level: Cue['level']) =>
    run(() => {
      apiService.sendCue(message, level, cueTargets, episode?.id);
      setCueText('');
    });

  const remainingCls = !timing ? '' : timing.remaining < 0 ? 'text-red-400' : timing.remaining <= 30 ? 'text-amber-300' : 'text-emerald-300';

  return (
    <div className="space-y-5">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Radio className={`w-5 h-5 ${live ? 'text-red-600 animate-pulse' : 'text-slate-500'}`} />
            وضع الهواء
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            {canControl ? 'أنت تتحكم في البث: الانتقال بين الفقرات يظهر فوراً لدى الاستديو والملقن وكل الأقسام.' : 'متابعة مباشرة لما على الهواء (التحكم للمخرج والكنترول).'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select value={episodeId} onChange={(e) => setEpisodeId(e.target.value)} aria-label="الحلقة أو النشرة" className="px-3 py-2 border border-slate-200 rounded-xl text-xs bg-white max-w-xs">
            {candidates.length === 0 && <option value="">لا توجد حلقات قادمة</option>}
            {candidates.map((e) => (
              <option key={e.id} value={e.id}>
                {liveIds.includes(e.id) ? '● على الهواء — ' : ''}
                {e.programName} — {e.title} ({e.broadcastDate} {e.startTime})
              </option>
            ))}
          </select>
          {episode && (
            <button type="button" onClick={() => onOpenStudioScreen(episode.id)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold">
              <MonitorPlay className="w-4 h-4" />
              شاشة الاستديو
            </button>
          )}
        </div>
      </div>

      {error && <p className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold">{error}</p>}

      {!episode ? (
        <p className="text-center text-xs text-slate-500 py-10 bg-white border border-dashed border-slate-300 rounded-2xl">اختر حلقة لمتابعتها على الهواء.</p>
      ) : (
        <>
          {/* Live panel */}
          <section className="theme-fixed bg-slate-950 text-white rounded-2xl p-5 space-y-4 border border-slate-800" aria-live="polite">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className={`px-2.5 py-1 rounded-lg text-xs font-black ${live ? 'bg-red-600 animate-pulse' : state?.status === 'ENDED' ? 'bg-slate-700' : 'bg-slate-800'}`}>
                  {live ? 'على الهواء' : state?.status === 'ENDED' ? 'انتهى البث' : 'لم يبدأ'}
                </span>
                <span className="text-sm font-bold">
                  {episode.programName} — {episode.title}
                </span>
              </div>
              {timing && (
                <div className="flex items-center gap-4 text-xs font-mono">
                  <span>على الهواء: {formatClock(timing.onAirSeconds)}</span>
                  <span className={timing.drift > 5 ? 'text-red-400' : timing.drift < -5 ? 'text-sky-300' : 'text-emerald-300'}>
                    {timing.drift > 5 ? `متأخر ${formatClock(timing.drift)}` : timing.drift < -5 ? `متقدم ${formatClock(-timing.drift)}` : 'في الموعد'}
                  </span>
                </div>
              )}
            </div>

            {timing?.current ? (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="lg:col-span-2 space-y-1">
                  <span className="text-[11px] text-slate-400">الفقرة الحالية ({timing.index + 1} من {rundown.length})</span>
                  <h2 className="text-2xl sm:text-3xl font-black leading-tight">{timing.current.title}</h2>
                  <p className="text-xs text-slate-400">
                    {timing.current.presenterName || ''}
                    {segmentGuests(timing.current).length ? ` · ${segmentGuests(timing.current).map((g) => g.guestName).join('، ')}` : ''}
                  </p>
                </div>
                <div className="text-center">
                  <span className="text-[11px] text-slate-400 block">المتبقي</span>
                  <span className={`text-5xl font-black font-mono ${remainingCls}`} dir="ltr">
                    {formatClock(timing.remaining)}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-400">{rundown.length ? 'جاهز للبدء من الفقرة الأولى.' : 'لا توجد فقرات في الرانداون.'}</p>
            )}

            {timing?.next && (
              <p className="text-xs text-slate-300 border-t border-slate-800 pt-3">
                التالي: <strong className="text-white">{timing.next.title}</strong> ({formatClock(timing.next.durationSeconds || 0)})
              </p>
            )}

            {canControl && (
              <div className="flex flex-wrap gap-2 pt-1">
                {!live ? (
                  <button type="button" onClick={start} disabled={!rundown.length} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-sm disabled:opacity-40">
                    <Play className="w-4 h-4" />
                    {state?.status === 'ENDED' ? 'إعادة بدء البث' : 'بدء البث'}
                  </button>
                ) : (
                  <>
                    <button type="button" onClick={() => goTo((timing?.index ?? -1) + 1)} disabled={!timing?.next} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm disabled:opacity-40">
                      الفقرة التالية
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button type="button" onClick={() => goTo((timing?.index ?? 1) - 1)} disabled={(timing?.index ?? 0) <= 0} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-sm disabled:opacity-40">
                      <ChevronRight className="w-4 h-4" />
                      السابقة
                    </button>
                    <button
                      type="button"
                      onClick={async () => (await confirmDialog('إنهاء البث؟ ستُسجَّل الحلقة كمذاعة.')) && run(() => apiService.setOnAir(episode.id, 'ENDED', state!.currentSegmentId))}
                      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-600 hover:bg-slate-800 text-white font-bold text-sm mr-auto"
                    >
                      <Square className="w-4 h-4" />
                      إنهاء البث
                    </button>
                  </>
                )}
                {live && <span className="text-[11px] text-slate-500 self-center">المسطرة أو ← للتالي، → للسابق</span>}
              </div>
            )}
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Rundown with live states */}
            <section className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl overflow-hidden" aria-label="الرانداون">
              <ol>
                {rundown.map((seg, i) => {
                  const logged = state?.log?.filter((l) => l.segmentId === seg.id).pop();
                  const actual = logged ? Math.round(((logged.endedAt ? new Date(logged.endedAt).getTime() : Date.now()) - new Date(logged.startedAt).getTime()) / 1000) : null;
                  const isCurrent = live && timing?.index === i;
                  const done = !!logged?.endedAt && !isCurrent;
                  return (
                    <li
                      key={seg.id}
                      className={`flex items-center gap-3 px-4 py-2.5 border-b border-slate-100 text-xs ${isCurrent ? 'bg-red-50' : done ? 'opacity-60' : ''}`}
                    >
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center font-bold ${isCurrent ? 'bg-red-600 text-white' : 'bg-slate-100 text-slate-600'}`}>{i + 1}</span>
                      <span className="flex-1 min-w-0">
                        <strong className="block truncate text-slate-800">{seg.title}</strong>
                        <span className="text-slate-500">{seg.presenterName || ''}</span>
                      </span>
                      <span className="font-mono text-slate-500" dir="ltr">
                        {formatClock(seg.durationSeconds || 0)}
                        {actual !== null && <span className={actual > (seg.durationSeconds || 0) ? ' text-red-600' : ' text-emerald-600'}> / {formatClock(actual)}</span>}
                      </span>
                      {canControl && live && !isCurrent && (
                        <button type="button" onClick={async () => (await confirmDialog(`الانتقال إلى «${seg.title}»؟`)) && goTo(i)} className="px-2 py-1 rounded-lg border border-slate-200 text-[11px] font-bold hover:bg-slate-50">
                          انتقال
                        </button>
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>

            {/* Alerts to departments */}
            <section className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3" aria-label="تنبيهات الهواء">
              <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                <Megaphone className="w-4 h-4 text-amber-600" />
                تنبيهات الهواء
              </h2>
              {canControl || RbacService.hasPermission(currentUser, 'tasks.intercom_broadcast') ? (
                <>
                  <div className="flex flex-wrap gap-1" role="group" aria-label="الأقسام المستهدفة">
                    <button type="button" onClick={() => setCueTargets([])} aria-pressed={cueTargets.length === 0} className={`px-2 py-1 rounded-lg text-[11px] font-bold border ${cueTargets.length === 0 ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-200 text-slate-600'}`}>
                      الجميع
                    </button>
                    {DEPARTMENTS.map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        aria-pressed={cueTargets.includes(d.id)}
                        onClick={() => setCueTargets((t) => (t.includes(d.id) ? t.filter((x) => x !== d.id) : [...t, d.id]))}
                        className={`px-2 py-1 rounded-lg text-[11px] font-bold border ${cueTargets.includes(d.id) ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-slate-200 text-slate-600'}`}
                      >
                        {d.name}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {CUE_PRESETS.map((p) => (
                      <button key={p.message} type="button" onClick={() => sendCue(p.message, p.level)} className={`px-2 py-2 rounded-lg text-[11px] font-bold border text-right ${p.level === 'urgent' ? 'border-red-200 bg-red-50 text-red-700' : p.level === 'standby' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>
                        {p.message}
                      </button>
                    ))}
                  </div>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (cueText.trim()) sendCue(cueText, 'urgent');
                    }}
                    className="flex gap-2"
                  >
                    <input value={cueText} onChange={(e) => setCueText(e.target.value)} maxLength={300} placeholder="تنبيه مخصص..." aria-label="نص التنبيه" className="flex-1 px-3 py-2 border border-slate-300 rounded-xl text-xs" />
                    <button type="submit" className="px-3 py-2 rounded-xl bg-red-600 text-white text-xs font-bold">إرسال</button>
                  </form>
                  <div className="space-y-1.5">
                    {myCues.map((c) => (
                      <div key={c.id} className="text-[11px] p-2 rounded-lg bg-slate-50 border border-slate-100">
                        <strong className="text-slate-800">{c.message}</strong>
                        <span className="text-slate-500"> → {c.targetDepartmentIds.length ? c.targetDepartmentIds.map(departmentName).join('، ') : 'الجميع'}</span>
                        <span className="block text-emerald-700">{c.acks.length ? `استلم: ${c.acks.map((a) => a.userName).join('، ')}` : 'لم يستلمه أحد بعد'}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-xs text-slate-500">تصلك تنبيهات المخرج والكنترول هنا وعلى أي شاشة تفتحها.</p>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
};
