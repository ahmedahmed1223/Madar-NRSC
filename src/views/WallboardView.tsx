import { useEffect, useMemo, useState } from 'react';
import { useLiveData } from '../hooks/useLiveData';
import { apiService } from '../services/api';
import { appLocale, zoneOptions } from '../shared/dateFormat';
import { stationTimeZone } from '../shared/dates';
import { isBreakingLive } from '../shared/newsWorkflow';
import { secondsUntilStart } from '../shared/stationTime';
import { normalizeTaskStatus } from '../shared/taskWorkflow';
import { mmss } from '../shared/bulletins';

export function WallboardView() {
  const revision = useLiveData(['onAir', 'episodes', 'bulletins', 'bulletinStories', 'news', 'tasks', 'productionCards', 'settings'], 15_000);
  const [now, clock] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => clock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const data = useMemo(() => ({
    shows: apiService.getAirShows(),
    sessions: apiService.getOnAirStates(),
    news: apiService.getNews(),
    tasks: apiService.getTasks(),
    cards: apiService.getCards(),
    zone: stationTimeZone(apiService.getSettings().defaultTimezone),
  }), [revision]);
  const live = data.sessions.filter(session => session.status === 'LIVE');
  const liveIds = new Set(live.map(session => session.episodeId));
  const next = data.shows.flatMap(show => {
    const remaining = secondsUntilStart(show.broadcastDate, show.startTime, now, data.zone);
    return !show.deletedAt && !liveIds.has(show.id) && !['CANCELLED', 'ARCHIVED', 'BROADCASTED'].includes(show.status) && remaining !== null && remaining >= 0
      ? [{ show, remaining }] : [];
  }).sort((a, b) => a.remaining - b.remaining).slice(0, 3);
  const breaking = data.news.filter(item => isBreakingLive(item, now)).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')).slice(0, 3);
  const lateTasks = data.tasks.filter(task => !['COMPLETED', 'CANCELLED'].includes(normalizeTaskStatus(task.status)) && Date.parse(task.dueDate || '') < now);
  const lateCards = data.cards.filter(card => card.status === 'OPEN' && Date.parse(card.dueAt || card.airAt || '') < now);
  const liveReports = live.flatMap(session => {
    const show = data.shows.find(item => item.id === session.episodeId);
    const segment = show?.rundown?.find(entry => entry.id === session.currentSegmentId);
    return segment?.report?.reporterName ? [{ id: session.id, name: segment.report.reporterName, title: segment.title }] : [];
  });

  return (
    <main dir="rtl" className="min-h-dvh bg-slate-950 px-[max(1rem,3vw)] py-[max(1rem,3vh)] text-slate-100">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-800 pb-5">
        <h1 className="text-2xl font-bold md:text-4xl">شاشة غرفة الأخبار</h1>
        <time dir="ltr" aria-live="off" className="font-mono text-3xl tabular-nums sm:text-5xl">{new Date(now).toLocaleTimeString(appLocale(), { ...zoneOptions(), timeStyle: 'medium' })}</time>
      </header>
      <div className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <section className="min-w-0 border-slate-800 lg:border-e lg:pe-6">
          <h2 className="text-lg font-semibold text-slate-300 md:text-2xl">البث القادم</h2>
          {!next.length ? <p className="mt-4 text-slate-400">لا بث مجدول في دفتر البث.</p> : (
            <ol className="mt-3 divide-y divide-slate-800">{next.map(({ show, remaining }) => (
              <li key={show.id} className="flex flex-wrap items-center justify-between gap-4 py-4">
                <strong className="min-w-0 [overflow-wrap:anywhere] text-lg md:text-2xl">{show.title}</strong>
                <bdi className="font-mono text-3xl tabular-nums text-sky-300" aria-live="off">{mmss(remaining)}</bdi>
              </li>
            ))}</ol>
          )}
        </section>
        <section className="min-w-0">
          <h2 className="text-lg font-semibold text-rose-300 md:text-2xl">العاجل</h2>
          {!breaking.length ? <p className="mt-4 text-slate-400">لا عواجل نشطة.</p> : <ul className="mt-3 space-y-3">
            {breaking.map(item => <li key={item.id} className="border-s-2 border-rose-400 ps-3 [overflow-wrap:anywhere] text-lg">{item.title}</li>)}
          </ul>}
        </section>
        <section className="border-t border-slate-800 pt-4">
          <h2 className="text-lg font-semibold text-slate-300 md:text-2xl">المراسلون على الهواء</h2>
          {!liveReports.length ? <p className="mt-3 text-slate-400">لا مداخلات ميدانية مسجّلة الآن.</p> : <ul className="mt-3 space-y-2">
            {liveReports.map(report => <li key={report.id} className="text-lg"><strong className="text-emerald-300">{report.name}</strong> · {report.title}</li>)}
          </ul>}
        </section>
        <section className="border-t border-slate-800 pt-4">
          <h2 className="text-lg font-semibold text-slate-300 md:text-2xl">المواعيد المتأخرة</h2>
          <dl className="mt-3 flex flex-wrap gap-6 text-lg">
            <div><dt>المهام</dt><dd className="text-3xl font-bold text-amber-300">{lateTasks.length}</dd></div>
            <div><dt>التكليفات</dt><dd className="text-3xl font-bold text-amber-300">{lateCards.length}</dd></div>
          </dl>
        </section>
      </div>
    </main>
  );
}
