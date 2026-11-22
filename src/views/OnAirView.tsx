import { arabicDate } from '../shared/dates';
import { airDisplayDefault, type AirDisplayMode } from '../shared/airDisplay';
import { AirDisplayControls } from '../components/onair/AirDisplayControls';
import { OfflineAirPreparation } from '../components/onair/OfflineAirPreparation';
import { AirScriptPanel } from '../components/onair/AirScriptPanel';
import { evaluateBulletinReadiness } from '../shared/bulletinReadiness';
import { ReadinessPanel } from '../components/bulletins/ReadinessPanel';
import { AirSourceStatus } from '../components/onair/AirSourceStatus';
import { useAirConnection } from '../hooks/useAirConnection';
import { dataStore } from '../services/dataStore';
import { confirmDialog } from '../services/dialogs';
import { navigateTo } from '../services/uiEvents';
import { AsRunPanel } from '../components/onair/AsRunPanel';
import { segmentGuests } from '../shared/episodePlan';
import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Megaphone, MonitorPlay, Play, Square } from 'lucide-react';
import type { Episode, User } from '../types';
import { apiService } from '../services/api';
import { RbacService } from '../services/rbacService';
import { useLiveData } from '../hooks/useLiveData';
import { DEPARTMENTS, departmentIdOf, departmentName } from '../shared/departments';
import { canControlOnAir, CUE_PRESETS, Cue, formatClock, liveTiming, PRESENTER_INSTRUCTIONS } from '../shared/onair';
import { usePresenterPaces } from '../hooks/usePresenterPaces';
import { estimatedSegmentRead, presenterKey, rundownBackTimes } from '../shared/presenterTiming';
import { bulletinTiming, clockOf, minutesOfDay, storyTiming } from '../shared/bulletins';
import { episodeReadiness } from '../shared/production';
import { stationTimeZone } from '../shared/dates';
import { programmeSeconds, secondsUntilStart, stationWall } from '../shared/stationTime';
import { DriftIndicator } from '../components/onair/DriftIndicator';
import { countLabel } from '../shared/arabicPlural';
import { EP_NOUNS } from '../shared/episodeNouns';
import { offlineAirStateMarker, serializeOfflineAirSnapshot, type OfflineAirSourceVersion } from '../shared/offlineAirFreshness';

interface OnAirViewProps {
  currentUser: User;
  onOpenStudioScreen: (episodeId: string) => void;
  selectedShowId: string | null;
  onSelectShow: (id: string) => void;
}

/** Live control of the show, shared in real time with every department. */
/** On-air control and the As-Run log (what actually aired). */
export const OnAirView: React.FC<OnAirViewProps> = (props) => {
  const [tab, setTab] = useState<'CONTROL' | 'ASRUN'>('CONTROL');
  const canControl = canControlOnAir(props.currentUser, (p) => RbacService.hasPermission(props.currentUser, p));
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900">وضع الهواء</h1>
        <p className="text-xs text-slate-500 mt-1">
          {canControl ? 'أنت تتحكم في البث: الانتقال بين الفقرات يظهر فوراً لدى الاستديو والملقن وكل الأقسام.' : 'متابعة مباشرة لما على الهواء (التحكم للمخرج والكنترول).'}
        </p>
      </div>
      <div role="tablist" aria-label="وضع الهواء" className="flex gap-2 border-b border-slate-200 pb-2 text-xs font-bold">
        {([
          ['CONTROL', 'التحكم بالبث'],
          ['ASRUN', 'سجل البث الفعلي'],
        ] as const).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`min-h-11 px-3 py-2 rounded-xl ${tab === id ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'CONTROL' ? <OnAirControl {...props} /> : <AsRunPanel currentUser={props.currentUser} />}
    </div>
  );
};

const OnAirControl: React.FC<OnAirViewProps> = ({ currentUser, onOpenStudioScreen, selectedShowId, onSelectShow }) => {
  useLiveData(['onAir', 'episodes', 'bulletins', 'bulletinStories', 'cues', 'requests', 'media', 'settings', 'users'], 1000);
  const [displayOverride, setDisplayOverride] = useState<AirDisplayMode | null>(null);
  const displayMode = displayOverride || airDisplayDefault(apiService.getSettings(), 'onAir');
  const canControl = canControlOnAir(currentUser, (p) => RbacService.hasPermission(currentUser, p));
  const connected = useAirConnection();
  // The station's clock and date, whatever zone this computer runs in.
  const stationZone = stationTimeZone(apiService.getSettings()?.defaultTimezone);
  const nowMs = Date.now();
  const wall = stationWall(nowMs, stationZone);
  const today = wall.date;
  // Programme episodes and news bulletins both run here.
  const episodes = apiService.getAirShows().filter((e) => !e.deletedAt);
  const states = apiService.getOnAirStates();
  const liveIds = states.filter((s) => s.status === 'LIVE').map((s) => s.episodeId);
  const candidates = episodes
        .filter(
          (e) =>
            liveIds.includes(e.id) ||
            (e.status !== 'BROADCASTED' && (e.broadcastDate >= today || e.status === 'READY_FOR_BROADCAST' || e.status === 'ON_AIR'))
        )
        .sort((a, b) => Number(liveIds.includes(b.id)) - Number(liveIds.includes(a.id)) ||
          Number(a.broadcastDate < today) - Number(b.broadcastDate < today) ||
          `${a.broadcastDate} ${a.startTime}`.localeCompare(`${b.broadcastDate} ${b.startTime}`));
  const [defaultShowId] = useState(() => liveIds[0] || candidates.find(e => e.broadcastDate >= today)?.id || '');
  const episodeId = selectedShowId ?? defaultShowId;
  const [error, setError] = useState<string | null>(null);
  const [commandPending, setCommandPending] = useState(false);
  const [cueText, setCueText] = useState('');
  const [cueTargets, setCueTargets] = useState<string[]>([]);
  const [instructionText, setInstructionText] = useState('');
  const [instructionRecipient, setInstructionRecipient] = useState<{ showId: string; userId: string }>();

  const episode = episodes.find((e) => e.id === episodeId) as Episode | undefined;
  const state = episode ? apiService.getOnAir(episode.id) : null;
  const rundown = (episode?.rundown || []).filter((s) => s && s.id);
  const live = state?.status === 'LIVE';
  const pastShow = !!episode && episode.broadcastDate < today && !live;
  const timing = liveTiming(state, episode);
  const untilStart = episode && !live && state?.status !== 'ENDED' ? secondsUntilStart(episode.broadcastDate, episode.startTime, nowMs, stationZone) : null;
  const isBulletin = (episode as any)?.kind === 'bulletin';
  const bulletin = isBulletin && episode ? apiService.getBulletins().find(b => b.id === episode.id) : undefined;
  const bulletinStories = bulletin ? apiService.getBulletinStories(bulletin.id) : [];
  const showLength = bulletin?.plannedSeconds || programmeSeconds(episode);
  const paces = usePresenterPaces();
  const bulletinPace = (story: (typeof bulletinStories)[number]) => paces.get(presenterKey(story.anchorName || bulletin?.anchors[0]))?.wpm;
  const bulletinForecast = bulletin && bulletinStories.some(story => bulletinPace(story) && storyTiming(story).read)
    ? bulletinTiming(bulletin, bulletinStories, bulletinPace).rows : undefined;
  const programmeForecast = !isBulletin && episode?.startTime && showLength > 0 && rundown.some(segment => estimatedSegmentRead(segment, paces, episode.presenterName) !== null)
    ? rundownBackTimes(rundown, minutesOfDay(episode.startTime) * 60 + showLength, paces, episode.presenterName) : undefined;
  const currentOrFirst = timing?.current || rundown[0];
  const presenter = currentOrFirst?.presenterName || episode?.presenterName;
  const readingPace = paces.get(presenterKey(presenter));
  const currentStory = bulletinStories.find(story => story.id === currentOrFirst?.id && story.status === 'APPROVED');
  const estimatedRead = currentStory && readingPace ? storyTiming(currentStory, readingPace.wpm).read || null
    : currentOrFirst ? estimatedSegmentRead(currentOrFirst, paces, presenter) : null;
  const presenters = apiService.getUsers().filter(user => !user.deletedAt && user.isActive !== false && user.id !== currentUser.id && (user.role === 'PRESENTER' || departmentIdOf(user) === 'presenters'));
  const matchedPresenters = presenter ? presenters.filter(user => presenterKey(user.fullName) === presenterKey(presenter)) : [];
  const episodePresenterAccount = presenters.find(user => user.id === episode?.presenterId);
  const assigned = matchedPresenters.length === 1 ? matchedPresenters[0].id : !currentOrFirst?.presenterName ? episodePresenterAccount?.id : undefined;
  const manuallySelected = instructionRecipient?.showId === episodeId ? instructionRecipient?.userId : undefined;
  const selectedRecipient = manuallySelected !== undefined && (manuallySelected === '' || presenters.some(user => user.id === manuallySelected)) ? manuallySelected : assigned || '';
  const activeSession = live && state ? { showId: state.episodeId, startedAt: state.startedAt } : undefined;
  const issues = bulletin ? evaluateBulletinReadiness(bulletin, bulletinStories, apiService.getNews(), apiService.getMedia(), new Date(nowMs), stationZone, activeSession) : [];
  const bulletinBlocked = isBulletin && (!bulletin || rundown.length === 0 || issues.some(issue => issue.severity === 'blocker'));
  const canOpenBulletin = RbacService.canOpenScreen(currentUser, 'bulletins');
  const canOpenEpisode = RbacService.canOpenScreen(currentUser, 'episode-workspace');
  const offlineSources: { collection: OfflineAirSourceVersion[0]; id: string }[] = episode ? [
    { collection: isBulletin ? 'bulletins' : 'episodes', id: episode.id },
    ...(isBulletin ? rundown.map(segment => ({ collection: 'bulletinStories' as const, id: segment.id })) : []),
  ] : [];
  const synchronized = episode && dataStore.synchronizedVersions(currentUser.id, offlineSources, { collection: 'onAir', id: episode.id });
  const offlineSnapshot = synchronized ? serializeOfflineAirSnapshot(
    offlineSources.map(({ collection, id }, index) => [collection, id, synchronized.versions[index]]),
    offlineAirStateMarker(state ? { ...state } : null),
  ) : undefined;
  // A bulletin is ready when every story on air is approved; an episode when every department delivered.
  const readiness = episode && !isBulletin ? episodeReadiness(episode, { requests: apiService.getRequests(), media: apiService.getMedia() }) : null;
  const myCues = apiService
    .getCues()
    .filter((c) => c.fromId === currentUser.id && (!episode || !c.episodeId || c.episodeId === episode.id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 5);

  const run = async (fn: () => any, collection: 'onAir' | 'cues' = 'onAir') => {
    if (commandPending || !connected) return false;
    setCommandPending(true);
    try {
      setError(null);
      const saved = await fn();
      if (saved?.id) {
        const outcome = await dataStore.awaitWrite(collection, saved.id);
        if (!outcome.ok) throw new Error(outcome.message || 'لم يؤكد الخادم الأمر');
      }
      return true;
    } catch (err: any) {
      setError(err?.message || 'تعذر تنفيذ الأمر');
      return false;
    } finally { setCommandPending(false); }
  };

  const goTo = (index: number) => {
    if (!episode || !live || index < 0 || index >= rundown.length) return;
    run(() => apiService.setOnAir(episode.id, 'LIVE', rundown[index].id));
  };

  // Keyboard: Space/Left = next, Right = previous (RTL), while live.
  useEffect(() => {
    if (!canControl || !live || !connected) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.defaultPrevented || e.repeat || e.isComposing || e.ctrlKey || e.metaKey || e.altKey || commandPending || document.querySelector('[role=dialog], [role=alertdialog]') || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A', 'SUMMARY'].includes(tag) || (e.target as HTMLElement)?.isContentEditable) return;
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
    if (!episode || !rundown.length || !connected || bulletinBlocked) return;
    if (pastShow && !(await confirmDialog({
      title: 'حلقة أو نشرة من موعد سابق',
      message: `موعد «${episode.title}» هو ${arabicDate(episode.broadcastDate)}. هل تريد بث هذا المحتوى السابق؟`,
      confirmLabel: 'بث المحتوى السابق', cancelLabel: 'إلغاء', danger: true,
    }))) return;
    if (readiness && !readiness.ready && !(await confirmDialog(`الحلقة غير مكتملة الجاهزية (النواقص: ${countLabel(readiness.blockers.length, EP_NOUNS.item)}). بدء البث رغم ذلك؟`))) return;
    if (!await run(() => apiService.setOnAir(episode.id, 'LIVE', rundown[0].id))) {
      void dataStore.pull();
    }
  };

  const sendCue = async (message: string, level: Cue['level']) => {
    if (await run(() => apiService.sendCue(message, level, cueTargets, episode?.id), 'cues')) setCueText('');
  };

  const sendInstruction = (message: string, level: Cue['level']) => run(() => apiService.sendPresenterInstruction(
    episodeId, message, level, selectedRecipient || undefined,
  ), 'cues');

  const remainingCls = !timing ? '' : timing.remaining < 0 ? 'text-red-400' : timing.remaining <= 30 ? 'text-amber-300' : 'text-emerald-300';
  const selectedTitle = episode ? `${episode.programName} — ${episode.title}` : '';
  const nextSegment = timing?.next ?? (!live && state?.status !== 'ENDED' ? rundown[0] : undefined);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-2 min-w-0">
        <div className="min-w-0 w-full sm:w-80 max-w-full space-y-1">
          <label htmlFor="onair-show" className="block text-xs font-semibold text-slate-700">الحلقة أو النشرة</label>
          <select id="onair-show" value={episodeId} onChange={(e) => onSelectShow(e.target.value)} title={selectedTitle || undefined} className="min-h-11 px-3 border border-slate-300 rounded-xl text-xs font-semibold bg-white w-full min-w-0 truncate">
            <option value="">{candidates.length ? 'اختر الحلقة أو النشرة' : 'لا توجد حلقات قادمة'}</option>
            {episode && !candidates.some(candidate => candidate.id === episode.id) && <option value={episode.id}>{selectedTitle}</option>}
            {candidates.map((e) => (
              <option key={e.id} value={e.id}>
                {liveIds.includes(e.id) ? '● على الهواء — ' : ''}
                {e.programName} — {e.title} ({arabicDate(e.broadcastDate)} {e.startTime})
              </option>
            ))}
          </select>
        </div>
          {episode && (
            <button type="button" onClick={() => onOpenStudioScreen(episode.id)} className="min-h-11 inline-flex items-center gap-1.5 px-3 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700">
              <MonitorPlay className="w-4 h-4" aria-hidden />
              شاشة الاستديو
            </button>
          )}
      </div>

      <AirSourceStatus connected={connected} control={canControl} />
      {!live && bulletin && <ReadinessPanel issues={issues} stories={bulletinStories} users={apiService.getUsers()} airStoryCount={rundown.length} onOpen={canOpenBulletin ? story => {
        try { sessionStorage.setItem('madar-open-bulletin-story', story.id); } catch { /* The bulletin remains reachable. */ }
        navigateTo.emit(`/bulletins/${encodeURIComponent(bulletin.id)}`);
      } : undefined} />}
      {!live && readiness && !readiness.ready && episode && <section aria-label="جاهزية الحلقة" className="border-y border-slate-200 py-2 space-y-1">
        <h2 className="text-sm font-bold text-slate-900">جاهزية الحلقة</h2>
        {readiness.blockers[0] ? <p className="text-sm text-amber-800 break-words">{readiness.blockers[0].segmentTitle} · {readiness.blockers[0].detail} · {departmentName(readiness.blockers[0].departmentId)}</p> : <p className="text-sm text-amber-800">أضف فقرة إلى الرانداون.</p>}
        {canOpenEpisode && <button type="button" className="min-h-11 text-sm font-semibold text-blue-700 hover:underline" onClick={() => navigateTo.emit(`/episodes/${encodeURIComponent(episode.id)}`)}>مراجعة قائمة تحضير الحلقة</button>}
      </section>}

      {commandPending && <p role="status" className="text-sm font-bold">جارٍ تأكيد الأمر من الخادم...</p>}
      {error && <p role="alert" className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold">{error}</p>}
      {pastShow && <p role="alert" className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-sm">تم اختيار محتوى من موعد سابق: {arabicDate(episode!.broadcastDate)}. راجع الحلقة أو النشرة قبل بدء البث.</p>}

      {!episode ? (
        <p className="text-center text-xs text-slate-500 py-10 bg-white border border-dashed border-slate-300 rounded-2xl">اختر حلقة لمتابعتها على الهواء.</p>
      ) : (
        <>
          {/* Live panel */}
          <section className="theme-fixed bg-slate-950 text-white rounded-2xl p-5 space-y-4 border border-slate-800" aria-live="polite">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className={`shrink-0 whitespace-nowrap px-2.5 py-1 rounded-lg text-xs font-bold ${live ? 'bg-red-600' : state?.status === 'ENDED' ? 'bg-slate-700' : 'bg-slate-800'}`}>
                  {live ? 'على الهواء' : state?.status === 'ENDED' ? 'انتهى البث' : 'لم يبدأ'}
                </span>
                <span className="text-sm font-bold min-w-0 break-words">
                  {episode.programName} — {episode.title}
                </span>
              </div>
              <div aria-live="off" className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm font-bold text-slate-200 tabular-nums">
                <span title={stationZone ? `بتوقيت المحطة (${stationZone})` : 'بتوقيت هذا الجهاز'}>
                  الساعة <span className="text-white text-base">{wall.clock}</span>
                </span>
                {timing ? (
                  <>
                    <span>على الهواء <span className="text-white text-base">{formatClock(timing.onAirSeconds)}</span></span>
                    {showLength > 0 && (
                      <span>المتبقي للبرنامج <span className="text-white text-base">{formatClock(Math.max(0, showLength - timing.onAirSeconds))}</span></span>
                    )}
                  </>
                ) : (
                  untilStart !== null && untilStart > 0 && untilStart < 24 * 3600 && (
                    <span>حتى الهواء <span className="text-white text-base">{formatClock(untilStart)}</span></span>
                  )
                )}
              </div>
            </div>
            {timing && live && (
              <div className="flex flex-wrap items-center gap-3">
                <DriftIndicator drift={timing.drift} />
                <span className="text-xs text-slate-300">مقارنةً بخطة الرانداون</span>
              </div>
            )}

            {timing?.current ? (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="lg:col-span-2 space-y-1">
                  <span className="text-xs font-bold text-slate-300">الفقرة الحالية ({timing.index + 1} من {rundown.length})</span>
                  <h2 className="text-2xl sm:text-3xl font-bold leading-tight">{timing.current.title}</h2>
                  <p className="text-sm text-slate-300">
                    {timing.current.presenterName || ''}
                    {segmentGuests(timing.current).length ? ` · ${segmentGuests(timing.current).map((g) => g.guestName).join('، ')}` : ''}
                  </p>
                  {estimatedRead !== null && readingPace && <p className="text-xs text-slate-300" title={`${readingPace.samples} قراءات في ${readingPace.sessions} عمليات بث`}>
                    زمن الإلقاء المقدّر {formatClock(estimatedRead)} · {readingPace.wpm} كلمة/دقيقة
                  </p>}
                </div>
                <div className="text-center">
                  <span className="text-xs font-bold text-slate-300 block">المتبقي للفقرة</span>
                  <span className={`text-5xl font-bold tabular-nums ${remainingCls}`} dir="ltr">
                    {formatClock(timing.remaining)}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-300">{state?.status === 'ENDED' ? 'انتهى البث.' : bulletinBlocked ? 'بانتظار معالجة موانع النشرة.' : rundown.length ? 'بانتظار بدء البث من الفقرة الأولى.' : 'أضف فقرة إلى الرانداون قبل بدء البث.'}</p>
            )}

            <AirDisplayControls mode={displayMode} onChange={setDisplayOverride} />
            {displayMode === 'TEXT' && state?.status !== 'ENDED' && <AirScriptPanel segmentId={timing?.current?.id || rundown[0]?.id} script={timing?.current ? timing.current.scriptText : rundown[0]?.scriptText} live={live} />}
            {nextSegment && (
              <p className="text-xs text-slate-300 border-t border-slate-800 pt-3">
                {live ? 'التالي' : 'الفقرة الأولى'} · <strong className="text-white">{nextSegment.title}</strong> ({formatClock(nextSegment.durationSeconds || 0)})
              </p>
            )}

            {canControl && (
              <fieldset disabled={!connected || commandPending} className="flex flex-wrap gap-2 pt-1 min-w-0 disabled:opacity-60">
                {!live ? (
                  <button type="button" onClick={start} disabled={!rundown.length || bulletinBlocked} className="min-h-11 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-sm disabled:opacity-40">
                    <Play className="w-4 h-4" />
                    {state?.status === 'ENDED' ? 'إعادة بدء البث' : 'بدء البث'}
                  </button>
                ) : (
                  <>
                    <button type="button" onClick={() => goTo((timing?.index ?? -1) + 1)} disabled={!timing?.next} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-500 text-white font-bold text-sm disabled:opacity-40">
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
                {live && <span className="text-xs text-slate-300 self-center">المسافة أو ← للتالي، → للسابق</span>}
              </fieldset>
            )}
          </section>

          <OfflineAirPreparation key={JSON.stringify([currentUser.id, episodeId])} showId={episodeId} userId={currentUser.id} snapshot={offlineSnapshot} dbId={synchronized?.dbId}/>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Rundown with live states */}
            <section className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl overflow-hidden" aria-label="الرانداون">
              <ol>
                {rundown.map((seg, i) => {
                  const logged = state?.log?.filter((l) => l.segmentId === seg.id).pop();
                  const bulletinRow = bulletinForecast?.get(seg.id);
                  const programmeRow = programmeForecast?.get(seg.id);
                  const forecast = bulletinRow || programmeRow;
                  const estimate = bulletinRow?.duration ?? programmeRow?.estimatedRead;
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
                        {forecast && <span className="block text-slate-600">أقصى بدء للحاق بنهاية البث <bdi>{clockOf(forecast.back)}</bdi></span>}
                        {estimate != null && estimate !== seg.durationSeconds && <span className="block text-slate-600">المدة المقدّرة <bdi>{formatClock(estimate)}</bdi></span>}
                      </span>
                      <span className="font-mono text-slate-500" dir="ltr">
                        {formatClock(seg.durationSeconds || 0)}
                        {actual !== null && <span className={actual > (seg.durationSeconds || 0) ? ' text-red-600' : ' text-emerald-700'}> / {formatClock(actual)}</span>}
                      </span>
                      {canControl && live && !isCurrent && (
                        <button type="button" onClick={async () => (await confirmDialog(`الانتقال إلى «${seg.title}»؟`)) && goTo(i)} className="px-2 py-1 rounded-lg border border-slate-200 text-2xs font-bold hover:bg-slate-50">
                          انتقال
                        </button>
                      )}
                    </li>
                  );
                })}
              </ol>
              {rundown.length === 0 && (
                <div className="p-8 text-center space-y-1">
                  <p className="text-sm font-bold text-slate-700">لا فقرات في هذا الرانداون بعد</p>
                  <p className="text-xs text-slate-500">أضف الفقرات من مساحة عمل الحلقة أو من رانداون النشرة، ثم عد هنا لبدء البث.</p>
                </div>
              )}
            </section>

            {/* Alerts to departments */}
            <section className="min-w-0 bg-white border border-slate-200 rounded-2xl p-4 space-y-3" aria-label="تنبيهات الهواء">
              <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                <Megaphone className="w-4 h-4 text-amber-700" />
                تنبيهات الهواء
              </h2>
              {canControl || RbacService.hasPermission(currentUser, 'tasks.intercom_broadcast') ? (
                <>
                  <fieldset disabled={!connected || commandPending} className="min-w-0 space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3 disabled:opacity-60">
                    <legend className="px-1 text-xs font-bold text-amber-900">توجيه المذيع</legend>
                    <select aria-label="المذيع المستهدف" value={selectedRecipient} onChange={e => setInstructionRecipient({ showId: episodeId, userId: e.target.value })} className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs">
                      <option value="">المذيعون والاستوديو</option>
                      {presenters.map(user => <option key={user.id} value={user.id}>{user.fullName} والاستوديو</option>)}
                    </select>
                    <div className="flex flex-wrap gap-1.5">
                      {PRESENTER_INSTRUCTIONS.map(preset => <button key={preset.message} type="button" onClick={() => void sendInstruction(preset.message, preset.level)} className="min-h-11 rounded-lg border border-amber-300 bg-white px-2 text-xs font-bold text-slate-800">{preset.message}</button>)}
                    </div>
                    <form onSubmit={async e => {
                      e.preventDefault();
                      if (instructionText.trim() && await sendInstruction(instructionText, 'info')) setInstructionText('');
                    }} className="flex gap-2">
                      <input value={instructionText} onChange={e => setInstructionText(e.target.value)} maxLength={120} aria-label="نص توجيه المذيع" placeholder="توجيه قصير…" className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 text-xs" />
                      <button type="submit" disabled={!instructionText.trim()} className="min-h-11 shrink-0 rounded-lg bg-slate-800 px-2 text-xs font-bold text-white disabled:opacity-50">إرسال</button>
                    </form>
                  </fieldset>
                  {!connected && <p role="status" className="text-xs text-slate-600">يتطلب إرسال التوجيهات اتصالاً بالخادم.</p>}
                  <div className="flex flex-wrap gap-1" role="group" aria-label="الأقسام المستهدفة">
                    <button type="button" onClick={() => setCueTargets([])} aria-pressed={cueTargets.length === 0} className={`min-h-11 px-2 py-1 rounded-lg text-2xs font-bold border ${cueTargets.length === 0 ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-slate-200 text-slate-600'}`}>
                      الجميع
                    </button>
                    {DEPARTMENTS.map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        aria-pressed={cueTargets.includes(d.id)}
                        onClick={() => setCueTargets((t) => (t.includes(d.id) ? t.filter((x) => x !== d.id) : [...t, d.id]))}
                        className={`min-h-11 px-2 py-1 rounded-lg text-2xs font-bold border ${cueTargets.includes(d.id) ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-slate-200 text-slate-600'}`}
                      >
                        {d.name}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {CUE_PRESETS.map((p) => (
                      <button key={p.message} type="button" onClick={() => sendCue(p.message, p.level)} disabled={!connected || commandPending} className={`min-h-11 px-2 py-2 rounded-lg text-2xs font-bold border text-start disabled:opacity-60 ${p.level === 'urgent' ? 'border-red-200 bg-red-50 text-red-700' : p.level === 'standby' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>
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
                    <input value={cueText} onChange={(e) => setCueText(e.target.value)} maxLength={300} placeholder="تنبيه مخصص..." aria-label="نص التنبيه" className="min-h-11 min-w-0 flex-1 px-3 py-2 border border-slate-300 rounded-lg text-xs" />
                    <button type="submit" disabled={!cueText.trim() || !connected || commandPending} className="min-h-11 shrink-0 px-3 py-2 rounded-lg bg-red-600 text-white text-xs font-bold hover:bg-red-700 disabled:opacity-50">إرسال</button>
                  </form>
                  <div className="space-y-1.5">
                    {myCues.map((c) => (
                      <div key={c.id} className="text-2xs p-2 rounded-lg bg-slate-50 border border-slate-100">
                        <strong className="text-slate-800">{c.message}</strong>
                        <span className="text-slate-500"> → {[apiService.getUserById(c.targetUserId || '')?.fullName, ...c.targetDepartmentIds.map(departmentName)].filter(Boolean).join('، ') || 'الجميع'}</span>
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
