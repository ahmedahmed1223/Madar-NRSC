import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Copy, Download, Printer, Scale, Send, X } from 'lucide-react';
import type { User } from '../types';
import { apiService } from '../services/api';
import { dataStore } from '../services/dataStore';
import { RbacService } from '../services/rbacService';
import { downloadCsv } from '../services/csvExport';
import { FilterTabs } from '../components/common/FilterTabs';
import { DepartmentWorkPanel } from '../components/workload/DepartmentWorkPanel';
import { AiringOutcomes } from '../components/reports/AiringOutcomes';
import { useLiveData } from '../hooks/useLiveData';
import { stationDay, timeOnly, when } from '../components/cards/cardUi';
import { formatDay } from '../shared/dateFormat';
import { buildHandover, handoverSections, handoverText } from '../shared/handover';
import { cardKindName, stepTypesOf } from '../shared/productionCards';
import { stationName, stationsOf } from '../shared/stations';
import { managerScope, stationFilterMatcher, stationGroupsOf } from '../shared/managerToday';
import { departmentIdOf, departmentName, DEPARTMENTS } from '../shared/departments';
import { findUserRole } from '../shared/rbac';
import { onDutyAt } from '../shared/roster';
import { dmChannel, groupChannel, MAX_MESSAGE_CHARS, stationChannel } from '../shared/chat';
import { AR, countLabel, countWithNumber } from '../shared/arabicPlural';
import {
  collectWork,
  inPeriod,
  comparePeriods,
  dailyTrend,
  employeeFile,
  groupLoad,
  heavyThreshold,
  LOAD_LEVEL_RULE,
  loadByPerson,
  loadByStation,
  minutesLabel,
  productionSummary,
  type LoadLevel,
  type LoadRow,
  type Period,
  type WorkItem,
} from '../shared/workload';

interface WorkloadViewProps {
  currentUser: User;
  users: User[];
  onOpen: (ref: WorkItem['ref']) => void;
}

type Tab = 'LOAD' | 'OUTPUT' | 'FILE' | 'HANDOVER';
type Range = 'today' | 'week' | 'month' | 'custom';
type GroupBy = 'department' | 'station' | 'role';
type Show = 'ALL' | 'FREE' | 'ISSUES';
type DrillKind = 'open' | 'late' | 'blocked';

const SELECT = 'min-w-0 max-w-full min-h-11 sm:min-h-9 px-3 border border-slate-300 rounded-lg text-sm sm:text-xs bg-white';
const TOOL = 'inline-flex items-center justify-center gap-1.5 min-h-11 sm:min-h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50';
const FILTER_BAR = 'grid grid-cols-2 items-center gap-2 no-print sm:flex sm:flex-wrap';
const EXPORT_TOOLS = 'col-span-full flex flex-wrap items-center gap-2 sm:ms-auto';
const TH = 'p-3 font-bold text-right whitespace-nowrap';
const TD = 'p-3 tabular-nums';
/** The name column stays in view while a wide table scrolls sideways on a phone (RTL: the right edge). */
const STICKY = 'sticky right-0 z-[1] bg-white';
const LEVEL: Record<LoadLevel, { name: string; style: string }> = {
  HIGH: { name: 'حمل مرتفع', style: 'bg-rose-50 text-rose-700 border-rose-200' },
  NORMAL: { name: 'متوازن', style: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  LOW: { name: 'طاقة متاحة', style: 'bg-sky-50 text-sky-800 border-sky-200' },
};
const RANGE_NAMES: Record<Range, string> = { today: 'اليوم', week: 'آخر 7 أيام', month: 'آخر 30 يوماً', custom: 'فترة محددة' };
const GROUP_NAMES: Record<GroupBy, string> = { department: 'القسم', station: 'المحطة', role: 'الدور' };
const DRILL_NAMES: Record<DrillKind, string> = { open: 'مفتوحة', late: 'متأخرة', blocked: 'متعطلة' };

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const points = (n: number) => countLabel(n, AR.point);
/** «1 متفرغ»، «4 متفرغين»، «11 متفرغاً» for a team's summary line. */
const FREE = { one: 'متفرغ', two: 'متفرغان', few: 'متفرغين', many: 'متفرغاً' };
const NOTES_KEY = (userId: string) => `madar-handover-notes:${userId}`;

/** A figure that opens the list of the items behind it (no button when there is nothing to list). */
const Count: React.FC<{ value: number; tone?: string; label: string; onOpen: () => void }> = ({ value, tone = '', label, onOpen }) =>
  value > 0 ? (
    <button type="button" onClick={onOpen} title={`عرض ${label}`} aria-label={`${value} ${label}: عرض القائمة`} className={`tabular-nums underline decoration-dotted underline-offset-4 hover:decoration-solid print-text ${tone}`}>
      {value}
    </button>
  ) : (
    <span className="tabular-nums">0</span>
  );

/**
 * Team follow-up: who carries what now (per station, per team and per person, with the late
 * and blocked items behind each figure and who is free), the trend of finished work against the
 * previous period, what was produced, each colleague's record and the shift handover brief.
 */
export function WorkloadView(props: WorkloadViewProps) {
  const { currentUser, onOpen } = props;
  useLiveData(['settings', 'roles']);
  const leadsDepartment = RbacService.leadsDepartment(currentUser);
  const canViewReport = RbacService.canOpenScreen(currentUser, 'workload', false);
  const [view, setView] = useState<'DEPARTMENT' | 'REPORT'>('DEPARTMENT');
  return <div className="space-y-4">
    {leadsDepartment && canViewReport && <div className="flex flex-wrap gap-2" role="group" aria-label="نطاق المتابعة">
      <button type="button" className={TOOL} aria-pressed={view === 'DEPARTMENT'} onClick={() => setView('DEPARTMENT')}>أعمال فريقي</button>
      <button type="button" className={TOOL} aria-pressed={view === 'REPORT'} onClick={() => setView('REPORT')}>الأعباء والأداء</button>
    </div>}
    {leadsDepartment && (view === 'DEPARTMENT' || !canViewReport) ? <DepartmentWorkPanel key={currentUser.id} currentUser={currentUser} onOpen={onOpen} />
      : canViewReport ? <WorkloadReport {...props} /> : null}
  </div>;
}

const WorkloadReport: React.FC<WorkloadViewProps> = ({ currentUser, users, onOpen }) => {
  const canView = RbacService.hasPermission(currentUser, 'workload.view');
  const canViewAll = RbacService.hasPermission(currentUser, 'workload.view_all');
  const [version, setVersion] = useState(0);
  const [tab, setTab] = useState<Tab>(canView ? 'LOAD' : 'FILE');
  const [range, setRange] = useState<Range>('week');
  const [fromDay, setFromDay] = useState(() => stationDay(Date.now() - 6 * 86400_000));
  const [toDay, setToDay] = useState(() => stationDay(Date.now()));
  const [department, setDepartment] = useState('ALL');
  const [role, setRole] = useState('ALL');
  const [groupBy, setGroupBy] = useState<GroupBy>('department');
  const [show, setShow] = useState<Show>('ALL');
  const [openTeams, setOpenTeams] = useState<Set<string>>(new Set());
  const [drill, setDrill] = useState<{ title: string; items: WorkItem[] } | null>(null);
  const [personId, setPersonId] = useState(canView ? '' : currentUser.id);
  const [shiftHours, setShiftHours] = useState(8);
  const [copied, setCopied] = useState(false);
  const [notes, setNotes] = useState(() => {
    try {
      return localStorage.getItem(NOTES_KEY(currentUser.id)) || '';
    } catch {
      return '';
    }
  });
  const [sendTo, setSendTo] = useState('');
  const [sendState, setSendState] = useState<{ ok: boolean; text: string } | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(
    () =>
      dataStore.subscribe((evt) => {
        if (evt.type === 'data-changed' && evt.collections.some((c) => ['productionCards', 'tasks', 'requests', 'news', 'users', 'settings', 'roster', 'conversations'].includes(c))) setVersion((v) => v + 1);
      }),
    []
  );
  useEffect(() => {
    try {
      if (notes) localStorage.setItem(NOTES_KEY(currentUser.id), notes);
      else localStorage.removeItem(NOTES_KEY(currentUser.id));
    } catch {
      // Storage blocked: the notes last for this visit.
    }
  }, [notes, currentUser.id]);

  const settings = useMemo(() => apiService.getSettings(), [version]);
  const stations = stationsOf(settings);
  const stepTypes = stepTypesOf(settings);
  const cards = useMemo(() => apiService.getCards(), [version]);
  const roles = RbacService.getRoleDefinitions();
  const roleOf = (u: User) => findUserRole(u, roles)?.nameAr?.split(' (')[0] || u.role;
  const roleIdOf = (u: User) => u.customRoleId || u.role;

  // Supervisors follow their own station and the ones linked to it; central management follows all.
  const scope = useMemo(() => managerScope(currentUser, stations, canViewAll), [canViewAll, stations, currentUser]);
  const groups = stationGroupsOf(settings).filter((g) => g.stationIds.some((id) => scope.has(id)));
  const seesEverything = scope.size === stations.length;
  const visibleStations = stations.filter((s) => scope.has(s.id));
  // A branch manager starts on their own station; the main station and central management on all.
  const [station, setStation] = useState(() => (!seesEverything && currentUser.stationId && scope.has(currentUser.stationId) ? currentUser.stationId : 'ALL'));
  const [handoverStationId, setHandoverStationId] = useState(() => (currentUser.stationId && scope.has(currentUser.stationId) ? currentUser.stationId : 'ALL'));
  const visibleUsers = useMemo(
    () => (canView ? users.filter((u) => u.isActive !== false && !u.deletedAt && (seesEverything || (u.stationId && scope.has(u.stationId)) || u.id === currentUser.id)) : users.filter((u) => u.id === currentUser.id)),
    [canView, users, scope, seesEverything, currentUser.id]
  );
  const departmentsInUse = DEPARTMENTS.filter((d) => visibleUsers.some((u) => departmentIdOf(u) === d.id));
  const rolesInUse = [...new Map(visibleUsers.map((u) => [roleIdOf(u), roleOf(u)])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'ar'));

  const period: Period = useMemo(() => {
    const now = new Date();
    if (range === 'custom') {
      const from = new Date(`${fromDay}T00:00:00`).getTime();
      const to = new Date(`${toDay}T00:00:00`).getTime() + 86400_000;
      return Number.isFinite(from) && Number.isFinite(to) && to > from ? { from, to } : { from: startOfDay(now), to: startOfDay(now) + 86400_000 };
    }
    const days = range === 'today' ? 0 : range === 'week' ? 6 : 29;
    return { from: startOfDay(now) - days * 86400_000, to: startOfDay(now) + 86400_000 };
  }, [range, fromDay, toDay]);
  const periodLabel = range === 'custom' ? `${formatDay(fromDay)} — ${formatDay(toDay)}` : RANGE_NAMES[range];

  const items = useMemo(
    () => collectWork({ cards, tasks: apiService.getTasks(), requests: apiService.getRequests(), news: apiService.getNews(), users, stepTypes }),
    // Recomputed when shared data changes (version) or the user list is replaced.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version, users]
  );
  const scopedItems = useMemo(() => (seesEverything ? items : items.filter((i) => i.stationId && scope.has(i.stationId))), [items, scope, seesEverything]);

  // Filters: station, department and role pick the people; their work follows them.
  const teamFiltered = department !== 'ALL' || role !== 'ALL';
  const matchesTeam = (u: User) => (department === 'ALL' || departmentIdOf(u) === department) && (role === 'ALL' || roleIdOf(u) === role);
  const teamUsers = visibleUsers.filter(matchesTeam);
  const inStation = stationFilterMatcher(station, groups);
  const peopleUsers = teamUsers.filter((u) => inStation(u.stationId));
  const teamIds = new Set(teamUsers.map((u) => u.id));
  const peopleIds = new Set(peopleUsers.map((u) => u.id));
  // Work nobody picked up yet belongs to its station, not to a department or role.
  const teamItems = scopedItems.filter((i) => (i.userId ? teamIds.has(i.userId) : !teamFiltered));
  const filteredItems = teamItems.filter((i) => (i.userId ? peopleIds.has(i.userId) : inStation(i.stationId)));

  const comparedStations = visibleStations.filter((s) => station === 'ALL' || !station.startsWith('group:') || inStation(s.id));
  const stationRows = useMemo(() => loadByStation(teamItems, teamUsers, comparedStations, period), [teamItems, teamUsers, comparedStations, period]);
  const now = Date.now();
  const roster = apiService.getRoster();
  const userById = new Map(visibleUsers.map((u) => [u.id, u]));
  const peopleRows = loadByPerson(filteredItems, peopleUsers, period).map((r) => {
    const u = userById.get(r.id);
    return {
      ...r,
      stationId: u?.stationId,
      jobTitle: u?.jobTitle,
      departmentId: u ? departmentIdOf(u) : '',
      roleName: u ? roleOf(u) : '',
      onDuty: onDutyAt(roster.filter((e) => e.userId === r.id), now).length > 0,
    };
  });
  const heavy = heavyThreshold(peopleRows);
  const shownRows = peopleRows.filter((r) => (show === 'FREE' ? r.open === 0 : show === 'ISSUES' ? r.overdue + r.blocked > 0 : true));
  const teams = groupLoad(
    shownRows,
    (r) => String(groupBy === 'department' ? r.departmentId : groupBy === 'station' ? r.stationId || '' : r.roleName),
    (id) => (groupBy === 'department' ? departmentName(id) : groupBy === 'station' ? stationName(stations, id) : id || 'بدون دور')
  );
  const trend = dailyTrend(filteredItems, period, stationDay);
  const comparison = comparePeriods(filteredItems, period);
  const openNow = filteredItems.filter((i) => i.open);
  const freeNow = peopleRows.filter((r) => r.open === 0);
  const output = useMemo(() => productionSummary(seesEverything ? cards : cards.filter((c) => c.steps.some((s) => s.stationId && scope.has(s.stationId))), stepTypes, period), [cards, stepTypes, period, scope, seesEverything]);

  // Drill-down: the items behind a figure.
  const pick = (list: WorkItem[], kind: DrillKind) => list.filter((i) => i.open && (kind === 'open' || (kind === 'late' ? i.overdue : i.blocked)));
  const drillTo = (title: string, list: WorkItem[]) => {
    setDrill({ title, items: [...list].sort((a, b) => Number(b.blocked) - Number(a.blocked) || Number(b.overdue) - Number(a.overdue) || (a.dueAt || '9').localeCompare(b.dueAt || '9')) });
    window.setTimeout(() => document.getElementById('workload-drill')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 0);
  };
  const drillPerson = (row: { id: string; name: string }, kind: DrillKind) => drillTo(`${row.name} — ${DRILL_NAMES[kind]}`, pick(filteredItems.filter((i) => i.userId === row.id), kind));
  const drillStation = (row: { id: string; name: string }, kind: DrillKind) =>
    drillTo(`${row.name} — ${DRILL_NAMES[kind]}`, pick(teamItems.filter((i) => (stations.some((s) => s.id === i.stationId) ? i.stationId : '') === row.id), kind));

  const fallbackPerson = [...peopleRows].sort((a, b) => b.donePoints - a.donePoints || b.openPoints - a.openPoints)[0]?.id || currentUser.id;
  const person = visibleUsers.find((u) => u.id === (personId || fallbackPerson)) || currentUser;
  const file = useMemo(() => employeeFile(items, person, period, stationDay), [items, person, period]);

  const handoverStation = handoverStationId === 'ALL' ? (seesEverything ? null : currentUser.stationId || null) : handoverStationId;
  const brief = useMemo(() => {
    const at = Date.now();
    return buildHandover(cards, { stationId: handoverStation, from: at - shiftHours * 3600_000, now: at, aheadHours: shiftHours, stepTypes, time: when, stationName: (id) => stationName(stations, id) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, handoverStation, shiftHours, version]);
  const briefHeading = `موجز تسليم المناوبة — ${handoverStation ? `محطة ${stationName(stations, handoverStation)}` : 'كل المحطات'} — ${when(new Date(brief.from).toISOString())} إلى ${timeOnly(new Date(brief.to).toISOString())}`;
  const sections = handoverSections(shiftHours);

  // Where a brief can go: a colleague, one of my groups, or a station channel.
  const recipients = useMemo(() => {
    const groups = apiService.getConversations().map((c) => ({ value: groupChannel(c.id), label: `مجموعة: ${c.name}` }));
    const stationsOut = visibleStations.map((s) => ({ value: stationChannel(s.id), label: `قناة محطة ${s.name}` }));
    const people = users
      .filter((u) => u.id !== currentUser.id && u.isActive !== false && !u.deletedAt && (seesEverything || (u.stationId && scope.has(u.stationId))))
      .sort((a, b) => Number(b.stationId === currentUser.stationId) - Number(a.stationId === currentUser.stationId) || a.fullName.localeCompare(b.fullName, 'ar'))
      .map((u) => ({ value: dmChannel(currentUser.id, u.id), label: `${u.fullName} — ${stationName(stations, u.stationId)}` }));
    return { groups, stations: stationsOut, people };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, users, scope, seesEverything]);
  const recipientLabel = (value: string) => [...recipients.groups, ...recipients.stations, ...recipients.people].find((r) => r.value === value)?.label || '';

  const sendBrief = async () => {
    if (!sendTo || sending) return;
    setSending(true);
    setSendState(null);
    try {
      let text = handoverText(brief, briefHeading, notes);
      const tail = '\n… (الموجز كاملاً في «متابعة الفرق والتكاليف» ← تسليم المناوبة)';
      if (text.length > MAX_MESSAGE_CHARS) text = text.slice(0, MAX_MESSAGE_CHARS - tail.length) + tail;
      apiService.sendMessage(sendTo, text);
      const sent = apiService.getMessages().at(-1);
      const outcome = sent ? await dataStore.awaitWrite('messages', sent.id) : { ok: true };
      if (!outcome.ok) throw new Error((outcome as { message?: string }).message || 'لم يؤكد الخادم الإرسال بعد');
      setSendState({ ok: true, text: `أُرسل الموجز إلى ${recipientLabel(sendTo)}.` });
    } catch (err: any) {
      setSendState({ ok: false, text: err?.message || 'تعذر إرسال الموجز' });
    } finally {
      setSending(false);
    }
  };

  const filterSummary = [
    `الفترة: ${periodLabel}`,
    `المحطة: ${station === 'ALL' ? 'كل المحطات' : station.startsWith('group:') ? groups.find((g) => `group:${g.id}` === station)?.name || '' : stationName(stations, station)}`,
    department !== 'ALL' ? `القسم: ${departmentName(department)}` : '',
    role !== 'ALL' ? `الدور: ${rolesInUse.find(([id]) => id === role)?.[1] || role}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const printedAt = `أُعدّ في ${when(new Date().toISOString())}`;

  /** The sheet's title block: the organisation, what this is, the chosen filters and when it was prepared. */
  const PrintHeading: React.FC<{ title: string; detail?: string }> = ({ title, detail }) => (
    <div className="hidden print-only print-keep">
      <p className="text-xs">{settings.organizationName}</p>
      <h2 className="text-lg font-bold">{title}</h2>
      <p className="text-xs">{detail ?? filterSummary} · {printedAt}</p>
    </div>
  );

  const exportLoad = () =>
    downloadCsv(`متابعة-الفرق-${stationDay(Date.now())}.csv`, [
      ['متابعة الفرق والتكاليف', settings.organizationName, filterSummary, printedAt],
      [],
      ['المحطة', 'الأفراد', 'مهام مفتوحة', 'نقاط الحمل', 'الحمل للفرد', 'متأخرة', 'متعطلة', 'لم تُستلم', 'أُنجز في الفترة', 'نقاط منجزة', 'التقييم'],
      ...stationRows.map((r) => [r.name, r.people, r.open, r.openPoints, r.level ? r.perPerson.toFixed(1) : '', r.overdue, r.blocked, r.unassigned, r.done, r.donePoints, r.level ? LEVEL[r.level].name : '']),
      [],
      ['اليوم', 'أُنجز', 'نقاط منجزة'],
      ...trend.map((d) => [d.date, d.done, d.donePoints]),
      ['الفترة السابقة', comparison.previousDone, comparison.previousPoints],
      [],
      ['الاسم', 'المحطة', 'القسم', 'الدور', 'مفتوحة', 'نقاط الحمل', 'متأخرة', 'متعطلة', 'أُنجز', 'نقاط منجزة', 'وقت فعلي (د)', 'الحالة'],
      ...peopleRows.map((r) => [r.name, stationName(stations, r.stationId), departmentName(r.departmentId), r.roleName, r.open, r.openPoints, r.overdue, r.blocked, r.done, r.donePoints, r.spentMinutes, r.open === 0 ? 'متفرغ' : r.openPoints > heavy ? 'حمل مرتفع' : '']),
    ]);

  const exportOutput = () =>
    downloadCsv(`الإنتاج-${stationDay(Date.now())}.csv`, [
      ['الإنتاج', settings.organizationName, `الفترة: ${periodLabel}`, printedAt],
      ['مواد أُنجزت', output.total, 'منها مشتركة', output.shared],
      [],
      ['المحطة', 'مواد شاركت فيها', 'منها مشتركة', 'مهام أنجزتها', 'النقاط', 'حصتها من العمل %'],
      ...output.byStation.map((r) => [stationName(stations, r.stationId), r.cards, r.shared, r.steps, r.points, r.share]),
      [],
      ['نوع المادة', 'العدد'],
      ...output.byKind.map((k) => [cardKindName(k.kind), k.count]),
    ]);

  const exportFile = () =>
    downloadCsv(`ملف-إنجاز-${person.fullName}.csv`, [
      ['ملف إنجاز', person.fullName, stationName(stations, person.stationId), periodLabel],
      [],
      ['الحالة', 'النوع', 'المادة', 'النقاط', 'الوقت الفعلي (د)', 'بدأ', 'أُنجز', 'التسليم المطلوب'],
      ...file.done.map((i) => ['منجز', i.typeName, i.title, i.points, i.spentMinutes ?? '', i.startedAt ? when(i.startedAt) : '', when(i.doneAt), i.dueAt ? when(i.dueAt) : '']),
      ...file.open.map((i) => [i.blocked ? 'متعطل' : i.overdue ? 'متأخر' : 'مفتوح', i.typeName, i.title, i.points, '', i.startedAt ? when(i.startedAt) : '', '', i.dueAt ? when(i.dueAt) : '']),
    ]);

  const stationSelect = (value: string, onChange: (v: string) => void, allLabel: string, withGroups = false) => (
    <select aria-label="المحطة" value={value} onChange={(e) => onChange(e.target.value)} className={SELECT}>
      {(seesEverything || visibleStations.length > 1) && <option value="ALL">{allLabel}</option>}
      {withGroups && groups.length > 0 && (
        <optgroup label="مجموعات المحطات">
          {groups.map((g) => (
            <option key={g.id} value={`group:${g.id}`}>{g.name}</option>
          ))}
        </optgroup>
      )}
      {visibleStations.map((s) => (
        <option key={s.id} value={s.id}>{s.name}</option>
      ))}
    </select>
  );

  const periodFilter = (
    <>
      <select aria-label="الفترة" value={range} onChange={(e) => setRange(e.target.value as Range)} className={`${SELECT} ${range === 'custom' ? 'col-span-full' : ''}`}>
        {(Object.keys(RANGE_NAMES) as Range[]).map((r) => (
          <option key={r} value={r}>{RANGE_NAMES[r]}</option>
        ))}
      </select>
      {range === 'custom' && (
        <div className="col-span-full grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <div className="grid gap-1 min-w-0">
            <label htmlFor="workload-from-day" className="text-xs text-slate-600">من يوم</label>
            <input id="workload-from-day" type="date" value={fromDay} max={toDay} onChange={(e) => setFromDay(e.target.value)} className={SELECT} />
          </div>
          <div className="grid gap-1 min-w-0">
            <label htmlFor="workload-to-day" className="text-xs text-slate-600">إلى يوم</label>
            <input id="workload-to-day" type="date" value={toDay} min={fromDay} onChange={(e) => setToDay(e.target.value)} className={SELECT} />
          </div>
        </div>
      )}
    </>
  );

  const printButton = (
    <button type="button" onClick={() => window.print()} className={TOOL}>
      <Printer className="w-4 h-4" />
      طباعة / حفظ PDF
    </button>
  );

  const itemRow = (item: WorkItem, date: string) => (
    <tr key={item.key} className="border-b border-slate-100 last:border-0">
      <td className="p-3 whitespace-nowrap text-slate-600">{date}</td>
      <td className="p-3 whitespace-nowrap">{item.typeName}</td>
      <td className="p-3">
        <button type="button" onClick={() => onOpen(item.ref)} className="text-blue-700 hover:underline text-right font-bold">{item.title}</button>
      </td>
      <td className={TD}>{item.points}</td>
      <td className={TD}>{minutesLabel(item.open ? item.estimateMinutes || 0 : item.spentMinutes || 0)}</td>
    </tr>
  );

  const nameOf = (id?: string) => (id ? users.find((u) => u.id === id)?.fullName || '' : '');
  const maxDay = Math.max(1, ...trend.map((d) => d.done));
  const changeText =
    comparison.change === null
      ? 'لا إنجاز مسجّل في الفترة السابقة للمقارنة'
      : comparison.change === 0
        ? 'مثل الفترة السابقة'
        : `${comparison.change > 0 ? 'أكثر' : 'أقل'} بـ${Math.abs(comparison.change)}% من الفترة السابقة (${points(comparison.previousPoints)})`;

  return (
    <div className="space-y-5">
      {/* On paper each tab prints its own heading (organisation, sheet, filters), so the screen title stays off the sheet. */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3 no-print">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Scale className="w-5 h-5 text-blue-600" />
            متابعة الفرق والتكاليف
          </h1>
          <p className="text-xs text-slate-500 mt-1">من يحمل ماذا الآن، وما المتأخر والمتعطل ومن المتفرغ، وما أنجزه كل فرد وكل محطة، محسوباً من العمل الموثّق في المنصة.</p>
        </div>
      </div>

      <FilterTabs<Tab>
        label="متابعة الفرق والتكاليف"
        active={tab}
        onChange={(t) => {
          setTab(t);
          setDrill(null);
        }}
        tabs={[
          ...(canView ? [{ id: 'LOAD' as const, label: 'الفرق والأعباء', tone: 'blue' as const }, { id: 'OUTPUT' as const, label: 'الإنتاج', tone: 'emerald' as const }] : []),
          { id: 'FILE' as const, label: canView ? 'ملف موظف' : 'ملف إنجازي', tone: 'violet' as const },
          { id: 'HANDOVER' as const, label: 'تسليم المناوبة', tone: 'amber' as const },
        ]}
      />

      {tab === 'LOAD' && canView && (
        <div className="space-y-5">
          <PrintHeading title="متابعة الفرق والتكاليف" />
          <div role="group" aria-label="تصفية عبء العمل وتصديره" className={FILTER_BAR}>
            {periodFilter}
            {stationSelect(station, setStation, 'كل المحطات', true)}
            <select aria-label="القسم" value={department} onChange={(e) => setDepartment(e.target.value)} className={SELECT}>
              <option value="ALL">كل الأقسام</option>
              {departmentsInUse.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
            <select aria-label="الدور" value={role} onChange={(e) => setRole(e.target.value)} className={SELECT}>
              <option value="ALL">كل الأدوار</option>
              {rolesInUse.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
            <span className={EXPORT_TOOLS}>
              {printButton}
              <button type="button" onClick={exportLoad} className={TOOL}>
                <Download className="w-4 h-4" />
                CSV
              </button>
            </span>
          </div>

          {/* Now, in five numbers: each opens the items behind it. */}
          <dl className="grid grid-cols-2 lg:grid-cols-5 bg-white border border-slate-200 rounded-xl divide-y lg:divide-y-0 divide-x divide-x-reverse divide-slate-200 overflow-hidden">
            {[
              { label: 'مهام مفتوحة', period: 'الآن', value: openNow.length, open: () => drillTo('كل المهام المفتوحة', openNow), tone: 'text-slate-900' },
              { label: 'متأخرة', period: 'الآن', value: openNow.filter((i) => i.overdue).length, open: () => drillTo('المتأخرة', pick(filteredItems, 'late')), tone: 'text-amber-700' },
              { label: 'متعطلة', period: 'الآن', value: openNow.filter((i) => i.blocked).length, open: () => drillTo('المتعطلة', pick(filteredItems, 'blocked')), tone: 'text-rose-700' },
              { label: 'متفرغون', period: 'الآن', value: freeNow.length, open: () => setShow('FREE'), tone: 'text-sky-800', note: countLabel(peopleRows.length, { ...AR.person, zero: 'لا أفراد' }) },
              { label: 'أُنجز', period: periodLabel, value: comparison.done, open: () => drillTo('المنجز في الفترة', filteredItems.filter(item => !item.open && inPeriod(item.doneAt, period))), tone: 'text-slate-900', note: points(comparison.donePoints) },
            ].map((m) => (
              <div key={m.label} className="p-4 min-w-0">
                <dt className="text-xs font-semibold text-slate-600">{m.label} <span className="font-normal text-slate-500">({m.period})</span></dt>
                <dd className={`font-mono text-3xl font-bold leading-tight mt-1 max-sm:[&_button]:min-h-11 max-sm:[&_button]:min-w-11 max-sm:[&_button]:text-start ${m.value ? m.tone : 'text-slate-900'}`}>
                  {m.open ? <Count value={m.value} label={m.label} onOpen={m.open} /> : <span className="tabular-nums">{m.value}</span>}
                </dd>
                {m.note && <dd className="text-2xs text-slate-500 mt-1 truncate">{m.note}</dd>}
              </div>
            ))}
          </dl>

          {drill && (
            <section id="workload-drill" aria-label={drill.title} className="bg-white border border-blue-200 rounded-xl p-4 space-y-2 scroll-mt-20">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-bold text-slate-900">{drill.title} <span className="font-normal text-slate-500">({drill.items.length})</span></h2>
                <button type="button" onClick={() => setDrill(null)} aria-label="إغلاق القائمة" className="inline-flex items-center justify-center min-h-11 min-w-11 sm:min-h-8 sm:min-w-8 rounded-lg text-slate-500 hover:bg-slate-100">
                  <X className="w-4 h-4" />
                </button>
              </div>
              {drill.items.length === 0 ? (
                <p className="text-xs text-slate-500">لا عناصر.</p>
              ) : (
                <ul className="divide-y divide-slate-100 text-xs">
                  {drill.items.map((i) => (
                    <li key={i.key} className="py-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <button type="button" onClick={() => onOpen(i.ref)} className="font-bold text-blue-700 hover:underline text-right">{i.title}</button>
                      <span className="text-slate-500">{i.typeName}</span>
                      {i.blocked && <span className="px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 font-bold text-2xs">متعطلة</span>}
                      {i.overdue && <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 font-bold text-2xs">متأخرة</span>}
                      <span className="text-slate-600 mr-auto">
                        {nameOf(i.userId) || (i.stationId ? `محطة ${stationName(stations, i.stationId)} — لم تُستلم` : 'غير مسندة')}
                        {i.dueAt ? ` · التسليم ${when(i.dueAt)}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {/* Day by day across the period, against the period before it. */}
          <section className="space-y-2 print-keep" aria-labelledby="trend-title">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="trend-title" className="text-sm font-bold text-slate-900">الإنجاز يوماً بيوم <span className="font-normal text-slate-500">({periodLabel})</span></h2>
              <p className="text-2xs text-slate-600">
                {points(comparison.donePoints)} · {changeText}
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              {trend.length <= 1 ? (
                <p className="text-xs text-slate-600">
                  اليوم: {countLabel(trend[0]?.done || 0, { ...AR.task, zero: 'لا مهام منجزة' })}{trend[0]?.done ? ' منجزة' : ''}. اختر «آخر 7 أيام» أو «آخر 30 يوماً» لرؤية الاتجاه.
                </p>
              ) : (
                <>
                  <div className="flex items-end gap-0.5 h-28" aria-hidden="true">
                    {trend.map((d) => (
                      <div key={d.date} className="flex-1 min-w-0 h-full flex flex-col justify-end group relative" title={`${formatDay(d.date)}: ${countLabel(d.done, { ...AR.task, zero: 'لا مهام' })} (${points(d.donePoints)})`}>
                        {d.done > 0 && trend.length <= 14 && <span className="text-3xs font-bold text-slate-700 text-center tabular-nums leading-4">{d.done}</span>}
                        <div className={`w-full rounded-t ${d.done ? 'bg-blue-600 group-hover:bg-blue-700' : 'bg-slate-200'}`} style={{ height: d.done ? `${Math.max(4, (d.done / maxDay) * 85)}%` : '2px' }} />
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-0.5 mt-1 text-3xs text-slate-500" aria-hidden="true">
                    {trend.map((d, i) => (
                      <span key={d.date} className="flex-1 min-w-0 text-center truncate">
                        {trend.length <= 14 || i % 5 === 0 || i === trend.length - 1 ? d.date.slice(8) : ''}
                      </span>
                    ))}
                  </div>
                  <table className="sr-only">
                    <caption>الإنجاز يوماً بيوم</caption>
                    <thead>
                      <tr><th scope="col">اليوم</th><th scope="col">مهام منجزة</th><th scope="col">نقاط</th></tr>
                    </thead>
                    <tbody>
                      {trend.map((d) => (
                        <tr key={d.date}><th scope="row">{formatDay(d.date)}</th><td>{d.done}</td><td>{d.donePoints}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          </section>

          {(station === 'ALL' || station.startsWith('group:')) && stationRows.length > 1 && (
            <section className="space-y-2">
              <h2 className="text-sm font-bold text-slate-900">مقارنة المحطات</h2>
              <p className="text-2xs text-slate-500">
                نقاط الحمل = وزن نوع المهمة × درجة تعقيدها (تُضبط الأوزان من الإعدادات)، وتشمل مراجعة الأخبار ومهام الجودة. «الحمل للفرد» يقسم النقاط المفتوحة على عدد أفراد المحطة. {LOAD_LEVEL_RULE} <span className="no-print">اضغط رقم المتأخرة أو المتعطلة لرؤية ما وراءه.</span>
              </p>
              <div role="region" tabIndex={0} aria-label="جدول مقارنة المحطات (يمكن تمريره أفقياً)" className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
                <table className="w-full min-w-[46rem] text-xs">
                  <thead>
                    <tr className="text-slate-600 border-b border-slate-200">
                      {['المحطة', 'التقييم', 'متأخرة', 'متعطلة', 'الأفراد', 'مهام مفتوحة', 'نقاط الحمل', 'الحمل للفرد', 'لم تُستلم', 'أُنجز في الفترة'].map((h, i) => (
                        <th key={h} scope="col" className={`${TH} ${i === 0 ? STICKY : ''}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {stationRows.map((row) => (
                      <tr key={row.id || 'none'} className="border-b border-slate-100 last:border-0">
                        <th scope="row" className={`p-3 text-right font-bold text-slate-900 whitespace-nowrap ${STICKY}`}>{row.name}</th>
                        <td className="p-3">
                          {row.level ? (
                            <span title={LOAD_LEVEL_RULE} className={`px-2 py-0.5 rounded-md border font-bold whitespace-nowrap ${LEVEL[row.level].style}`}>{LEVEL[row.level].name}</span>
                          ) : '—'}
                        </td>
                        <td className={`${TD} ${row.overdue ? 'font-bold' : ''}`}><Count value={row.overdue} tone="text-amber-700" label="متأخرة" onOpen={() => drillStation(row, 'late')} /></td>
                        <td className={`${TD} ${row.blocked ? 'font-bold' : ''}`}><Count value={row.blocked} tone="text-rose-700" label="متعطلة" onOpen={() => drillStation(row, 'blocked')} /></td>
                        <td className={TD}>{row.people}</td>
                        <td className={TD}><Count value={row.open} label="مفتوحة" onOpen={() => drillStation(row, 'open')} /></td>
                        <td className={TD}>{row.openPoints}</td>
                        <td className={`${TD} font-bold`}>{row.level ? row.perPerson.toFixed(1) : '—'}</td>
                        <td className={TD}>{row.unassigned}</td>
                        <td className={`${TD} whitespace-nowrap`}>{row.done} ({points(row.donePoints)})</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Teams: a summary line each, the people open underneath. */}
          <section className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-bold text-slate-900">الفرق والأفراد</h2>
              <span className="flex flex-wrap items-center gap-2 no-print">
                <label className="text-2xs text-slate-600" htmlFor="workload-group">تجميع حسب</label>
                <select id="workload-group" value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)} className={SELECT}>
                  {(Object.keys(GROUP_NAMES) as GroupBy[]).map((g) => (
                    <option key={g} value={g}>{GROUP_NAMES[g]}</option>
                  ))}
                </select>
                <select aria-label="عرض" value={show} onChange={(e) => setShow(e.target.value as Show)} className={SELECT}>
                  <option value="ALL">كل الأفراد</option>
                  <option value="FREE">المتفرغون الآن</option>
                  <option value="ISSUES">من لديه متأخر أو متعطل</option>
                </select>
                <button type="button" onClick={() => setOpenTeams(openTeams.size ? new Set() : new Set(teams.map((t) => t.id)))} className="text-2xs font-bold text-blue-700 hover:underline">
                  {openTeams.size ? 'طي الكل' : 'فتح الكل'}
                </button>
              </span>
            </div>
            <p className="text-2xs text-slate-500">«متفرغ»: لا مهام مفتوحة عليه الآن. «حمل مرتفع»: نقاطه المفتوحة أكثر من 1.5 ضعف متوسط الأفراد المعروضين. «مناوب»: ضمن المناوبة الحالية.</p>
            <div role="region" tabIndex={0} aria-label="جدول الفرق والأفراد (يمكن تمريره أفقياً)" className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
              <table className="w-full min-w-[46rem] text-xs">
                <thead>
                  <tr className="text-slate-600 border-b border-slate-200">
                    {['الاسم', 'الحالة', 'متأخرة', 'متعطلة', 'مفتوحة', 'نقاط الحمل', 'أُنجز', 'نقاط منجزة', 'المحطة', 'القسم', 'الدور'].map((h, i) => (
                      <th key={h} scope="col" className={`${TH} ${i === 0 ? STICKY : ''}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                {teams.length === 0 && (
                  <tbody>
                    <tr><td colSpan={11} className="p-6 text-center text-slate-500">لا أفراد يطابقون التصفية. تُحدَّد محطة كل زميل وقسمه من «المستخدمون والصلاحيات».</td></tr>
                  </tbody>
                )}
                {teams.map((team) => {
                  const expanded = openTeams.has(team.id) || teams.length === 1;
                  return (
                    <tbody key={team.id || 'none'} className="border-b border-slate-200 last:border-0">
                      <tr className="bg-slate-50">
                        <th scope="rowgroup" className={`p-3 text-right font-bold text-slate-900 whitespace-nowrap ${STICKY} !bg-slate-50`}>
                          <button
                            type="button"
                            onClick={() => setOpenTeams((s) => { const next = new Set(s); if (next.has(team.id)) next.delete(team.id); else next.add(team.id); return next; })}
                            aria-expanded={expanded}
                            className="inline-flex items-center gap-1.5 print-text"
                          >
                            <ChevronDown aria-hidden="true" className={`w-4 h-4 text-slate-500 transition-transform no-print ${expanded ? '' : 'rotate-90'}`} />
                            {team.name}{' '}
                            <span className="font-normal text-slate-500">({countLabel(team.people, AR.person)})</span>
                          </button>
                        </th>
                        <td className="p-3 whitespace-nowrap text-sky-800 font-bold">{team.free ? countWithNumber(team.free, FREE) : ''}</td>
                        <td className={`${TD} font-bold`}><Count value={team.overdue} tone="text-amber-700" label="متأخرة" onOpen={() => drillTo(`${team.name} — متأخرة`, pick(filteredItems.filter((i) => team.members.some((m) => m.id === i.userId)), 'late'))} /></td>
                        <td className={`${TD} font-bold`}><Count value={team.blocked} tone="text-rose-700" label="متعطلة" onOpen={() => drillTo(`${team.name} — متعطلة`, pick(filteredItems.filter((i) => team.members.some((m) => m.id === i.userId)), 'blocked'))} /></td>
                        <td className={`${TD} font-bold`}>{team.open}</td>
                        <td className={`${TD} font-bold`}>{team.openPoints}</td>
                        <td className={TD}>{team.done}</td>
                        <td className={TD}>{team.donePoints}</td>
                        <td colSpan={3} />
                      </tr>
                      {expanded &&
                        (team.members as unknown as (typeof peopleRows)[number][]).map((row) => (
                          <tr key={row.id} className="border-t border-slate-100">
                            <th scope="row" className={`p-3 pr-8 text-right ${STICKY}`}>
                              <button type="button" onClick={() => { setPersonId(row.id); setTab('FILE'); }} className="font-bold text-blue-700 hover:underline text-right whitespace-nowrap">{row.name}</button>
                              <span className="block text-2xs font-normal text-slate-500 max-w-48 truncate">{row.jobTitle}</span>
                            </th>
                            <td className="p-3 whitespace-nowrap">
                              <span className="flex flex-wrap gap-1">
                                {row.open === 0 && <span className="px-1.5 py-0.5 rounded bg-sky-50 text-sky-800 font-bold text-2xs">متفرغ</span>}
                                {row.open > 0 && row.openPoints > heavy && <span className="px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 font-bold text-2xs" title="نقاطه المفتوحة أكثر من 1.5 ضعف متوسط الأفراد المعروضين">حمل مرتفع</span>}
                                {row.onDuty && <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-bold text-2xs">مناوب</span>}
                              </span>
                            </td>
                            <td className={TD}><Count value={row.overdue} tone="text-amber-700 font-bold" label="متأخرة" onOpen={() => drillPerson(row, 'late')} /></td>
                            <td className={TD}><Count value={row.blocked} tone="text-rose-700 font-bold" label="متعطلة" onOpen={() => drillPerson(row, 'blocked')} /></td>
                            <td className={TD}><Count value={row.open} label="مفتوحة" onOpen={() => drillPerson(row, 'open')} /></td>
                            <td className={`${TD} font-bold`}>{row.openPoints}</td>
                            <td className={TD}>{row.done}</td>
                            <td className={TD}>{row.donePoints}</td>
                            <td className="p-3 whitespace-nowrap">{stationName(stations, row.stationId)}</td>
                            <td className="p-3 whitespace-nowrap">{departmentName(row.departmentId)}</td>
                            <td className="p-3 whitespace-nowrap">{row.roleName}</td>
                          </tr>
                        ))}
                    </tbody>
                  );
                })}
              </table>
            </div>
          </section>
        </div>
      )}

      {tab === 'OUTPUT' && canView && (
        <div className="space-y-5">
          <PrintHeading title="الإنتاج" detail={`الفترة: ${periodLabel}`} />
          <AiringOutcomes accepts={(session, item) => inPeriod(session.startedAt, period) &&
            (seesEverything || !!item.stationId && scope.has(item.stationId)) && inStation(item.stationId)} />
          <div role="group" aria-label="تصفية الإنتاج وتصديره" className={FILTER_BAR}>
            {periodFilter}
            <span className={EXPORT_TOOLS}>
              {printButton}
              <button type="button" onClick={exportOutput} className={TOOL}>
                <Download className="w-4 h-4" />
                CSV
              </button>
            </span>
          </div>
          <dl className="grid grid-cols-2 lg:grid-cols-4 bg-white border border-slate-200 rounded-xl divide-y lg:divide-y-0 divide-x divide-x-reverse divide-slate-200 overflow-hidden">
            <div className="p-4">
              <dt className="text-xs font-semibold text-slate-600">مواد أُنجزت <span className="font-normal text-slate-500">({periodLabel})</span></dt>
              <dd className="font-mono text-3xl font-bold tabular-nums text-slate-900">{output.total}</dd>
              <dd className="text-2xs text-slate-500 mt-1">بطاقات اكتملت كل مهامها؛ «أُنجز» في الفرق يعدّ المهام لا البطاقات.</dd>
            </div>
            <div className="p-4">
              <dt className="text-xs font-semibold text-slate-600">منها مشتركة بين محطات</dt>
              <dd className="font-mono text-3xl font-bold tabular-nums text-slate-900">{output.shared}</dd>
            </div>
            {output.byKind.slice(0, 2).map((k) => (
              <div key={k.kind} className="p-4">
                <dt className="text-xs font-semibold text-slate-600">{cardKindName(k.kind)}</dt>
                <dd className="font-mono text-3xl font-bold tabular-nums text-slate-900">{k.count}</dd>
              </div>
            ))}
          </dl>
          <section className="space-y-2">
            <h2 className="text-sm font-bold text-slate-900">إسهام كل محطة</h2>
            <p className="text-2xs text-slate-500">المادة المشتركة تُحتسب مرة واحدة في الإجمالي أعلاه، وتظهر هنا عند كل محطة أنجزت فيها مهمة، بنقاط ما أنجزته.</p>
            <div role="region" tabIndex={0} aria-label="جدول إسهام كل محطة (يمكن تمريره أفقياً)" className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
              <table className="w-full min-w-[36rem] text-xs">
                <thead>
                  <tr className="text-slate-600 border-b border-slate-200">
                    {['المحطة', 'مواد شاركت فيها', 'منها مشتركة', 'مهام أنجزتها', 'النقاط', 'حصتها من العمل'].map((h, i) => (
                      <th key={h} scope="col" className={`${TH} ${i === 0 ? STICKY : ''}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {output.byStation.length === 0 && (
                    <tr><td colSpan={6} className="p-6 text-center text-slate-500">لم تكتمل تكليفات في هذه الفترة.</td></tr>
                  )}
                  {output.byStation.map((row) => (
                    <tr key={row.stationId || 'none'} className="border-b border-slate-100 last:border-0">
                      <th scope="row" className={`p-3 text-right font-bold text-slate-900 whitespace-nowrap ${STICKY}`}>{stationName(stations, row.stationId)}</th>
                      <td className={TD}>{row.cards}</td>
                      <td className={TD}>{row.shared}</td>
                      <td className={TD}>{row.steps}</td>
                      <td className={TD}>{row.points}</td>
                      <td className={`${TD} font-bold`}>{row.share}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          {output.byKind.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-bold text-slate-900">حسب نوع المادة</h2>
              <div className="flex flex-wrap gap-2">
                {output.byKind.map((k) => (
                  <span key={k.kind} className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-xs text-slate-700"><b>{cardKindName(k.kind)}</b>: {k.count}</span>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {tab === 'FILE' && (
        <div className="space-y-5">
          <div role="group" aria-label="تصفية ملف الإنجاز وتصديره" className={FILTER_BAR}>
            {canView && (
              <select aria-label="الموظف" value={person.id} onChange={(e) => setPersonId(e.target.value)} className={`${SELECT} col-span-full`}>
                {visibleUsers.map((u) => (
                  <option key={u.id} value={u.id}>{u.fullName} — {stationName(stations, u.stationId)}</option>
                ))}
              </select>
            )}
            {periodFilter}
            <span className={EXPORT_TOOLS}>
              {printButton}
              <button type="button" onClick={exportFile} className={TOOL}>
                <Download className="w-4 h-4" />
                CSV
              </button>
            </span>
          </div>

          <div>
            <p className="hidden print-only text-xs">{settings.organizationName}</p>
            <h2 className="text-lg font-bold text-slate-900">ملف إنجاز: {person.fullName}</h2>
            <p className="text-xs text-slate-600">
              {person.jobTitle} — {stationName(stations, person.stationId)} — الفترة: {periodLabel}
              <span className="hidden print-only"> — {printedAt}</span>
            </p>
          </div>

          <dl className="grid grid-cols-2 lg:grid-cols-5 gap-2">
            {[
              { label: `مواد أنجزها (${periodLabel})`, value: file.totals.done },
              { label: 'نقاط الإنجاز', value: file.totals.donePoints },
              { label: 'الوقت الفعلي المسجّل', value: minutesLabel(file.totals.spentMinutes) },
              { label: 'أيام عمل فيها', value: file.days.length },
              { label: 'على مكتبه الآن', value: file.totals.open },
            ].map((stat) => (
              <div key={stat.label} className="bg-white border border-slate-200 rounded-2xl p-3">
                <dt className="text-2xs text-slate-600">{stat.label}</dt>
                <dd className="text-xl font-bold tabular-nums text-slate-900">{stat.value}</dd>
              </div>
            ))}
          </dl>

          {file.byType.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-sm font-bold text-slate-900">حسب نوع العمل</h3>
              <div className="flex flex-wrap gap-2">
                {file.byType.map((t) => (
                  <span key={t.typeName} className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-xs text-slate-700"><b>{t.typeName}</b>: {t.count} ({points(t.points)})</span>
                ))}
              </div>
            </section>
          )}

          {file.days.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-sm font-bold text-slate-900">متى عمل</h3>
              <div className="flex flex-wrap gap-2">
                {file.days.map((d) => (
                  <span key={d.date} className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-xs text-slate-700"><b>{formatDay(d.date)}</b>: أنجز {d.done}، بدأ {d.started}</span>
                ))}
              </div>
            </section>
          )}

          <section className="space-y-2">
            <h3 className="text-sm font-bold text-slate-900">ما أنجزه ({file.done.length})</h3>
            <div role="region" tabIndex={0} aria-label="جدول ما أنجزه (يمكن تمريره أفقياً)" className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
              <table className="w-full min-w-[40rem] text-xs">
                <thead>
                  <tr className="text-slate-600 border-b border-slate-200">
                    {['أُنجز', 'النوع', 'المادة', 'النقاط', 'الوقت الفعلي'].map((h) => (
                      <th key={h} scope="col" className={TH}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {file.done.length === 0 && (
                    <tr><td colSpan={5} className="p-6 text-center text-slate-500">لا إنجاز مسجّل في هذه الفترة.</td></tr>
                  )}
                  {file.done.map((item) => itemRow(item, when(item.doneAt)))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-bold text-slate-900">على مكتبه الآن ({file.open.length})</h3>
            <div role="region" tabIndex={0} aria-label="جدول ما على مكتبه الآن (يمكن تمريره أفقياً)" className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
              <table className="w-full min-w-[40rem] text-xs">
                <thead>
                  <tr className="text-slate-600 border-b border-slate-200">
                    {['التسليم', 'النوع', 'المادة', 'النقاط', 'الوقت المقدر'].map((h) => (
                      <th key={h} scope="col" className={TH}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {file.open.length === 0 && (
                    <tr><td colSpan={5} className="p-6 text-center text-slate-500">لا مهام مفتوحة.</td></tr>
                  )}
                  {file.open.map((item) => itemRow(item, item.blocked ? 'متعطلة' : item.dueAt ? `${when(item.dueAt)}${item.overdue ? ' (متأخرة)' : ''}` : '—'))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {tab === 'HANDOVER' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 no-print">
            {stationSelect(handoverStationId, setHandoverStationId, 'كل المحطات')}
            <select aria-label="مدة المناوبة" value={shiftHours} onChange={(e) => setShiftHours(Number(e.target.value))} className={SELECT}>
              {[6, 8, 12, 24].map((h) => (
                <option key={h} value={h}>آخر {countLabel(h, AR.hour)}</option>
              ))}
            </select>
            <span className="flex items-center gap-2 mr-auto">
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(handoverText(brief, briefHeading, notes));
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 2500);
                  } catch {
                    setCopied(false);
                  }
                }}
                className={TOOL}
              >
                <Copy className="w-4 h-4" />
                {copied ? 'نُسخ الموجز' : 'نسخ نصاً'}
              </button>
              {printButton}
            </span>
          </div>

          <div>
            <p className="hidden print-only text-xs">{settings.organizationName} · {printedAt}</p>
            <h2 className="text-lg font-bold text-slate-900">{briefHeading}</h2>
            <p className="text-xs text-slate-600 no-print">يُعدّه النظام من العمل الموثّق في التكليفات، بطاقة واحدة في كل سطر مع المهمة التي تنتظرها الآن. أضف ملاحظاتك ثم أرسله للمناوبة التالية.</p>
          </div>

          {/* The outgoing manager's own notes: written here, sent and printed at the top of the brief. */}
          <section className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2">
            <label htmlFor="handover-notes" className="text-sm font-bold text-slate-900 block">ملاحظات مسؤول المناوبة</label>
            <textarea
              id="handover-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value.slice(0, 2000))}
              rows={3}
              placeholder="ما يجب أن تعرفه المناوبة التالية: قرارات اتُّخذت، مواد تنتظر، اتصالات معلّقة…"
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm no-print"
            />
            <p className="hidden print-only text-sm whitespace-pre-wrap">{notes || 'لا ملاحظات.'}</p>
            <div className="flex flex-wrap items-center gap-2 no-print">
              <label htmlFor="handover-to" className="text-xs text-slate-600">إرسال إلى</label>
              <select id="handover-to" value={sendTo} onChange={(e) => setSendTo(e.target.value)} className={`${SELECT} max-w-full`}>
                <option value="">اختر زميلاً أو مجموعة…</option>
                {recipients.groups.length > 0 && (
                  <optgroup label="مجموعاتي">
                    {recipients.groups.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </optgroup>
                )}
                <optgroup label="قنوات المحطات">
                  {recipients.stations.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </optgroup>
                <optgroup label="الزملاء">
                  {recipients.people.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </optgroup>
              </select>
              <button type="button" disabled={!sendTo || sending} onClick={() => void sendBrief()} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold disabled:opacity-50">
                <Send className="w-4 h-4" />
                {sending ? 'جارٍ الإرسال…' : 'إرسال للمناوبة التالية'}
              </button>
              {notes && <span className="text-2xs text-slate-500">تُحفظ الملاحظات على هذا الجهاز حتى تمسحها.</span>}
            </div>
            {sendState && (
              <p role="status" className={`text-xs font-bold ${sendState.ok ? 'text-emerald-700' : 'text-rose-700'}`}>{sendState.text}</p>
            )}
          </section>

          {sections.map((section) => {
            const rows = brief[section.key];
            return (
              <section key={section.key} className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2">
                <h3 className="text-sm font-bold text-slate-900">{section.title} <span className="font-normal text-slate-500 tabular-nums">({rows.length})</span></h3>
                {rows.length === 0 ? (
                  <p className="text-xs text-slate-500">{section.empty}</p>
                ) : (
                  <ul className="divide-y divide-slate-100 text-xs">
                    {rows.map((row) => (
                      <li key={row.cardId} className="py-2 leading-6">
                        {row.urgent && <span className="ml-1 px-1.5 py-0.5 rounded bg-red-600 text-white font-bold text-3xs">عاجل</span>}
                        <button type="button" onClick={() => onOpen({ nav: 'cards', id: row.cardId })} className="font-bold text-blue-700 hover:underline">{row.title}</button>
                        <span className="text-slate-700"> — {row.detail}</span>
                        {row.doneInShift.length > 0 && <span className="block text-2xs text-emerald-800">أُنجز في المناوبة: {row.doneInShift.join('؛ ')}</span>}
                        {row.notes.map((note, i) => (
                          <span key={i} className="block text-2xs text-slate-600">ملاحظة: {note}</span>
                        ))}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
};

export type { LoadRow };
