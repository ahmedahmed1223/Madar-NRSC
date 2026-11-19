import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { Episode, User } from '../../types';
import { apiService } from '../../services/api';
import { RbacService } from '../../services/rbacService';
import { useLiveData } from '../../hooks/useLiveData';
import { bulletinTiming } from '../../shared/bulletins';
import { evaluateBulletinReadiness, timingDelta } from '../../shared/bulletinReadiness';
import { episodeReadiness } from '../../shared/production';
import { stepTypeName, stepTypesOf } from '../../shared/productionCards';
import { stationName, stationsOf } from '../../shared/stations';
import { AR, countLabel } from '../../shared/arabicPlural';
import { cardsAwaitingMyDecision, issuesInScope, managerScope, stationDayStrip, type CardIssue } from '../../shared/managerToday';
import { appLocale, zoneOptions } from '../../shared/dateFormat';
import { localDateString } from '../../shared/dates';

interface TodayStatusPanelProps {
  currentUser: User;
  episodes: Episode[];
  onOpenEpisode: (id: string) => void;
  onOpenBulletin?: (id: string) => void;
  onNavigate: (view: string) => void;
}

type Tone = 'red' | 'amber' | 'emerald' | 'slate' | 'blue';
const CHIP: Record<Tone, string> = {
  red: 'bg-red-50 text-red-700',
  amber: 'bg-amber-50 text-amber-800',
  emerald: 'bg-emerald-50 text-emerald-700',
  slate: 'bg-slate-100 text-slate-600',
  blue: 'bg-blue-50 text-blue-700',
};

interface AirRow {
  id: string;
  kind: 'bulletin' | 'episode';
  time: string;
  title: string;
  chips: { text: string; tone: Tone }[];
  open: () => void;
}

const SHOWN = 5;
const timeOf = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString(appLocale(), { ...zoneOptions(), hour: '2-digit', minute: '2-digit' }) : '');

/**
 * «حالة اليوم» for managers: tonight's bulletins and episodes with their readiness, the cards that
 * wait on my decision, and late and blocked work per station in my scope. Answers "are we on track
 * tonight?" first; the details open on demand.
 */
export const TodayStatusPanel: React.FC<TodayStatusPanelProps> = ({ currentUser, episodes, onOpenEpisode, onOpenBulletin, onNavigate }) => {
  useLiveData(['bulletins', 'bulletinStories', 'productionCards', 'onAir', 'requests', 'media', 'settings', 'users'], 60_000);
  const [showAllAir, setShowAllAir] = useState(false);
  const [openStation, setOpenStation] = useState<string | null>(null);

  const now = Date.now();
  const today = localDateString();
  const dayStart = new Date(`${today}T00:00:00`).getTime();
  const settings = apiService.getSettings();
  const stations = stationsOf(settings);
  const stepTypes = stepTypesOf(settings);
  const scope = managerScope(currentUser, stations, RbacService.hasPermission(currentUser, 'workload.view_all'));
  const cards = apiService.getCards().filter((c) => !c.deletedAt);
  const live = new Set(apiService.getOnAirStates().filter((s) => s.status === 'LIVE').map((s) => s.episodeId));
  const openBulletin = (id: string) => (onOpenBulletin ? onOpenBulletin(id) : onNavigate('bulletins'));

  // Tonight on air: today's bulletins and episodes not yet aired, in running order.
  const news = apiService.getNews();
  const media = apiService.getMedia();
  const air: AirRow[] = [
    ...apiService
      .getBulletins()
      .filter((b) => b.date === today && b.status !== 'DONE' && !b.deletedAt)
      .map((b): AirRow => {
        const stories = apiService.getBulletinStories(b.id);
        const issues = evaluateBulletinReadiness(b, stories, news, media, new Date(now));
        const blockers = issues.filter((i) => i.severity === 'blocker').length;
        const delta = timingDelta(bulletinTiming(b, stories).overUnder);
        const chips: AirRow['chips'] = [];
        if (live.has(b.id)) chips.push({ text: 'على الهواء', tone: 'red' });
        chips.push(blockers ? { text: countLabel(blockers, AR.blocker), tone: 'red' } : { text: 'بلا موانع', tone: 'emerald' });
        if (delta.state !== 'ON_TIME') chips.push({ text: delta.text, tone: delta.state === 'OVER' ? 'red' : 'amber' });
        return { id: b.id, kind: 'bulletin', time: b.startTime, title: b.title, chips, open: () => openBulletin(b.id) };
      }),
    ...episodes
      .filter((e) => live.has(e.id) || e.status === 'ON_AIR' || ((e.broadcastDate || '').slice(0, 10) === today && !['CANCELLED', 'ARCHIVED', 'BROADCASTED'].includes(e.status)))
      .map((e): AirRow => {
        const r = episodeReadiness(e, { requests: apiService.getRequests(), media });
        const chips: AirRow['chips'] = [];
        if (live.has(e.id) || e.status === 'ON_AIR') chips.push({ text: 'على الهواء', tone: 'red' });
        if (r.ready) chips.push({ text: 'جاهزة', tone: 'emerald' });
        else if (!r.total) chips.push({ text: 'بلا فقرات', tone: 'amber' });
        else chips.push({ text: `${r.readySegments} من ${r.total} فقرات جاهزة`, tone: r.blockers.length ? 'amber' : 'slate' }, { text: countLabel(r.blockers.length, AR.blocker), tone: 'red' });
        return { id: e.id, kind: 'episode', time: e.startTime || '', title: `${e.programName ? `${e.programName} — ` : ''}${e.title}`, chips, open: () => onOpenEpisode(e.id) };
      }),
  ].sort((a, b) => a.time.localeCompare(b.time));
  const airWithIssues = air.filter((r) => r.chips.some((c) => c.tone === 'red' && c.text !== 'على الهواء') || r.chips.some((c) => c.tone === 'amber'));
  const airShown = showAllAir ? air : air.slice(0, SHOWN);

  const mine = cardsAwaitingMyDecision(cards, currentUser.id, now);
  const issues = issuesInScope(cards, scope, now);
  const blockedCount = issues.filter((i) => i.blocked).length;
  const lateCount = issues.filter((i) => i.late).length;
  const strip = stationDayStrip(cards, stations, scope, dayStart, now);
  // My own station first, then the busiest.
  strip.sort((a, b) => Number(b.stationId === currentUser.stationId) - Number(a.stationId === currentUser.stationId) || b.blocked + b.late - (a.blocked + a.late));

  const issueLine = (issue: CardIssue) => {
    const step = issue.step;
    const what = step ? `${stepTypeName(stepTypes, step.type)}${issue.blocked && step.status === 'BLOCKED' ? `: ${step.blockedReason || 'بدون سبب مكتوب'}` : ''}` : '';
    const where = issue.stationId ? stationName(stations, issue.stationId) : '';
    return (
      <li key={issue.card.id}>
        <button type="button" onClick={() => onNavigate(`cards/${issue.card.id}`)} className="w-full text-right flex flex-wrap items-center gap-x-2 gap-y-1 py-2 px-1 rounded-md hover:bg-slate-50 print-text">
          <span className="text-xs font-bold text-slate-900 min-w-0 flex-1 truncate">{issue.card.title}</span>
          {issue.blocked && <span className={`text-2xs font-bold rounded px-1.5 py-0.5 ${CHIP.red}`}>متعطلة</span>}
          {issue.late && <span className={`text-2xs font-bold rounded px-1.5 py-0.5 ${CHIP.amber}`}>متأخرة</span>}
          {issue.card.airAt && <span className={`text-2xs font-bold rounded px-1.5 py-0.5 ${CHIP.blue}`}>البث {timeOf(issue.card.airAt)}</span>}
          <span className="basis-full text-2xs text-slate-600 truncate">
            {what}
            {where ? ` · ${where}` : ''}
            {issue.card.ownerName && issue.card.ownerId !== currentUser.id ? ` · القرار عند ${issue.card.ownerName}` : ''}
          </span>
        </button>
      </li>
    );
  };

  const metrics = [
    {
      label: 'الليلة على الهواء',
      period: 'اليوم',
      value: air.length,
      note: air.length ? (airWithIssues.length ? `${countLabel(airWithIssues.length, { zero: '', one: 'واحدة تحتاج متابعة', two: 'اثنتان تحتاجان متابعة', few: 'تحتاج متابعة', many: 'تحتاج متابعة' })}` : 'كلها بلا موانع') : 'لا نشرات ولا حلقات',
      tone: airWithIssues.length ? 'text-amber-700' : 'text-slate-900',
      target: 'today-air',
    },
    { label: 'بانتظار قراري', period: 'الآن', value: mine.length, note: 'بطاقات أملكها متعطلة أو متأخرة', tone: mine.length ? 'text-red-700' : 'text-slate-900', target: 'today-decide' },
    { label: 'متعطلة', period: 'الآن', value: blockedCount, note: scope.size === stations.length ? 'في كل المحطات' : 'في محطاتي', tone: blockedCount ? 'text-red-700' : 'text-slate-900', target: 'today-stations' },
    { label: 'متأخرة', period: 'الآن', value: lateCount, note: scope.size === stations.length ? 'في كل المحطات' : 'في محطاتي', tone: lateCount ? 'text-amber-700' : 'text-slate-900', target: 'today-stations' },
  ];
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <section aria-labelledby="today-status-title" data-testid="today-status" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="today-status-title" className="text-base font-bold text-slate-900">حالة اليوم</h2>
        <span className="text-2xs text-slate-500">
          {new Date(now).toLocaleDateString(appLocale(), { ...zoneOptions(), weekday: 'long', day: 'numeric', month: 'long' })} · تُحدَّث تلقائياً
        </span>
      </div>

      {/* The answer in four numbers; each opens its detail below. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 bg-white border border-slate-200 rounded-xl divide-y lg:divide-y-0 divide-x divide-x-reverse divide-slate-200 overflow-hidden">
        {metrics.map((m) => (
          <button key={m.label} type="button" onClick={() => jump(m.target)} className="text-right p-4 hover:bg-slate-50 focus-visible:bg-slate-50 transition-colors min-w-0 print-text">
            <span className="block text-xs font-semibold text-slate-600">
              {m.label} <span className="font-normal text-slate-500">({m.period})</span>
            </span>
            <span className={`block font-mono text-3xl font-bold tabular-nums leading-tight mt-1 ${m.tone}`}>{m.value}</span>
            <span className="block text-2xs text-slate-500 mt-1 truncate">{m.note}</span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 bg-white border border-slate-200 rounded-xl divide-y lg:divide-y-0 lg:divide-x lg:divide-x-reverse divide-slate-200">
        {/* Tonight on air */}
        <div id="today-air" className="p-4 min-w-0 scroll-mt-20">
          <h3 className="text-sm font-bold text-slate-900 mb-1">نشرات وحلقات اليوم</h3>
          {air.length === 0 ? (
            <p className="text-xs text-slate-500 py-2">لا نشرات ولا حلقات مجدولة لبقية اليوم.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {airShown.map((row) => (
                <li key={`${row.kind}:${row.id}`}>
                  <button type="button" onClick={row.open} className="w-full text-right flex flex-wrap items-center gap-x-2 gap-y-1 py-2 px-1 rounded-md hover:bg-slate-50 print-text">
                    <span className="font-mono text-xs font-bold text-slate-900 tabular-nums w-11 shrink-0" dir="ltr">{row.time || '—'}</span>
                    <span className="text-xs font-semibold text-slate-800 min-w-0 flex-1 truncate">
                      <span className="text-2xs text-slate-500 font-normal">{row.kind === 'bulletin' ? 'نشرة' : 'حلقة'} · </span>
                      {row.title}
                    </span>
                    {row.chips.map((c) => (
                      <span key={c.text} className={`text-2xs font-bold rounded px-1.5 py-0.5 ${CHIP[c.tone]}`}>{c.text}</span>
                    ))}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {air.length > SHOWN && (
            <button type="button" onClick={() => setShowAllAir((v) => !v)} aria-expanded={showAllAir} className="mt-1 text-2xs font-bold text-blue-700 hover:underline no-print">
              {showAllAir ? 'عرض أقل' : `عرض الكل (${air.length})`}
            </button>
          )}
        </div>

        {/* Cards waiting on my decision */}
        <div id="today-decide" className="p-4 min-w-0 scroll-mt-20">
          <div className="flex items-center justify-between gap-2 mb-1">
            <h3 className="text-sm font-bold text-slate-900">يحتاج قراري</h3>
            <button type="button" onClick={() => onNavigate('cards')} className="text-2xs font-bold text-blue-700 hover:underline no-print">بطاقات الإنتاج</button>
          </div>
          {mine.length === 0 ? (
            <p className="text-xs text-slate-500 py-2">لا بطاقات تملك قرارها متعطلة أو متأخرة.</p>
          ) : (
            <ul className="divide-y divide-slate-100">{mine.slice(0, SHOWN).map(issueLine)}</ul>
          )}
          {mine.length > SHOWN && (
            <button type="button" onClick={() => onNavigate('cards')} className="mt-1 text-2xs font-bold text-blue-700 hover:underline no-print">
              و{countLabel(mine.length - SHOWN, { one: 'بطاقة أخرى', two: 'بطاقتان أخريان', few: 'بطاقات أخرى', many: 'بطاقة أخرى' })}
            </button>
          )}
        </div>
      </div>

      {/* Per station: one ruled row each, the late and blocked cards open under it. */}
      {strip.length > 0 && (
        <div id="today-stations" className="bg-white border border-slate-200 rounded-xl overflow-hidden scroll-mt-20">
          <div className="px-4 pt-3 pb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-bold text-slate-900">{strip.length > 1 ? 'المحطات' : `محطة ${stationName(stations, strip[0].stationId)}`}</h3>
            <span className="text-2xs text-slate-500">مفتوحة ومتأخرة ومتعطلة: الآن · المنجز: مهام اليوم</span>
          </div>
          <div role="table" aria-label="حالة المحطات اليوم" className="text-xs">
            <div role="row" className="hidden sm:grid grid-cols-[minmax(7rem,1fr)_repeat(4,5.5rem)_1.5rem] gap-2 px-4 py-1.5 border-y border-slate-100 text-2xs font-bold text-slate-500">
              <span role="columnheader">المحطة</span>
              <span role="columnheader">بطاقات مفتوحة</span>
              <span role="columnheader">متأخرة</span>
              <span role="columnheader">متعطلة</span>
              <span role="columnheader">أُنجز اليوم</span>
              <span aria-hidden="true" />
            </div>
            {strip.map((row) => {
              const list = issues.filter((i) => i.stationId === row.stationId);
              const expanded = openStation === row.stationId;
              return (
                <div key={row.stationId} role="rowgroup" className="border-b border-slate-100 last:border-0">
                  <button
                    type="button"
                    role="row"
                    onClick={() => setOpenStation(expanded ? null : row.stationId)}
                    aria-expanded={list.length ? expanded : undefined}
                    disabled={!list.length}
                    className="w-full text-right grid grid-cols-[minmax(6rem,1fr)_repeat(4,auto)] sm:grid-cols-[minmax(7rem,1fr)_repeat(4,5.5rem)_1.5rem] items-center gap-2 px-4 py-2.5 hover:bg-slate-50 disabled:hover:bg-transparent disabled:cursor-default print-text"
                  >
                    <span role="rowheader" className="font-bold text-slate-900 truncate">
                      {stationName(stations, row.stationId)}
                      {row.stationId === currentUser.stationId && <span className="font-normal text-2xs text-slate-500"> (محطتي)</span>}
                    </span>
                    <span role="cell" className="tabular-nums"><span className="sm:hidden text-2xs text-slate-500">مفتوحة </span>{row.open}</span>
                    <span role="cell" className={`tabular-nums ${row.late ? 'text-amber-700 font-bold' : ''}`}><span className="sm:hidden text-2xs text-slate-500 font-normal">متأخرة </span>{row.late}</span>
                    <span role="cell" className={`tabular-nums ${row.blocked ? 'text-red-700 font-bold' : ''}`}><span className="sm:hidden text-2xs text-slate-500 font-normal">متعطلة </span>{row.blocked}</span>
                    <span role="cell" className="tabular-nums"><span className="sm:hidden text-2xs text-slate-500">أُنجز </span>{row.doneToday}</span>
                    {list.length > 0 ? <ChevronDown aria-hidden="true" className={`hidden sm:block w-4 h-4 text-slate-500 transition-transform no-print ${expanded ? 'rotate-180' : ''}`} /> : <span className="hidden sm:block" />}
                  </button>
                  {expanded && list.length > 0 && <ul className="px-4 pb-2 divide-y divide-slate-100 bg-slate-50/60">{list.map(issueLine)}</ul>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
};
