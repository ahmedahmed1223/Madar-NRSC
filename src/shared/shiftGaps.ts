import type { EditorialTask, Episode, User } from '../types';
import { isScheduledOn, minutesOfDay, type Bulletin, type BulletinFormat } from './bulletins';
import { scheduledBulletinExists } from './bulletinReadiness';
import { addDaysIso } from './dates';
import { departmentIdOf, departmentsAtStation, type Department } from './departments';
import { isStepOpen, type ProductionCard } from './productionCards';
import { SHIFTS, type RosterEntry, type ShiftId } from './roster';
import { bulletinSlot, episodeSlot, episodeWindow, scheduledBulletinSlot } from './schedule';
import type { Station, StationGroup } from './stations';
import { taskAssigneeId } from './assignedWork';
import { isTaskClosed } from './taskWorkflow';

const CRITICAL_DEPARTMENTS = ['newsroom', 'control', 'montage'] as const;
const MINUTES_PER_DAY = 24 * 60;

interface Slot {
  date: string;
  shift: ShiftId;
  start: number;
  end: number;
}

interface CoverageShow {
  id: string;
  kind: 'bulletin' | 'episode' | 'scheduled-bulletin';
  title: string;
  stationId?: string;
  start: number;
  end: number;
}

export interface ShiftCoverageGap {
  id: string;
  date: string;
  shift: ShiftId;
  stationId?: string;
  departmentId: string;
  shows: CoverageShow[];
  suggestions: { id: string; name: string; openWork: number; nearbyShifts: number }[];
}

interface GapInput {
  date: string;
  stations: Station[];
  departments?: readonly Department[];
  users: User[];
  episodes: Episode[];
  bulletins: Bulletin[];
  bulletinFormats?: BulletinFormat[];
  roster: RosterEntry[];
  tasks: (EditorialTask & { deletedAt?: string | null })[];
  cards: ProductionCard[];
}

const active = (user: User) => user.isActive !== false && !user.deletedAt;

export function shiftGapSupervisors(stationId: string | undefined, users: User[], stations: Station[], groups: StationGroup[]) {
  const available = users.filter(active);
  const leads = available.filter(user => {
    if (user.role === 'MAIN_STATION_MANAGER') return true;
    if (!stationId) return false;
    if (user.role === 'STATION_MANAGER') return user.stationId === stationId;
    if (user.role !== 'GENERAL_MANAGER') return false;
    return user.stationId === stationId || user.managedStationIds?.includes(stationId) || user.managedGroupIds?.some(id => groups.find(group => group.id === id)?.stationIds.includes(stationId));
  });
  if (leads.length) return leads;
  const main = stations.find(station => station.isMain)?.id;
  return available.filter(user => ['ADMIN', 'SUPER_ADMIN'].includes(user.role) && (!user.stationId || user.stationId === stationId || user.stationId === main));
}

export function shiftCoverageGaps({ date, stations, departments, users, episodes, bulletins, bulletinFormats = [], roster, tasks, cards }: GapInput): ShiftCoverageGap[] {
  const people = new Map(users.map(user => [user.id, user]));
  const staff = new Map(users.filter(active).map(user => [user.id, user]));
  const stationIds = new Set(stations.map(station => station.id));
  const homeStation = stations.find(station => station.isMain)?.id || (stations.length === 1 ? stations[0].id : undefined);
  const stationFor = (hostId: string | undefined) => {
    const id = people.get(hostId || '')?.stationId;
    return id && stationIds.has(id) ? id : homeStation;
  };
  const midnight = Date.parse(`${date}T00:00:00Z`) / 60_000;
  const shows: CoverageShow[] = [
    ...bulletins.filter(b => b.date === date && b.kind === 'MAIN' && !b.deletedAt && !['DONE', 'CANCELLED'].includes(b.status)).map(b => ({
      id: b.id, kind: 'bulletin' as const, title: b.title, slot: bulletinSlot(b), stationId: stationFor(b.editorId),
    })),
    ...episodes.filter(e => e.broadcastDate === date && !e.deletedAt && !['BROADCASTED', 'CANCELLED', 'ARCHIVED'].includes(e.status)).map(e => ({
      id: e.id, kind: 'episode' as const, title: e.title, slot: episodeSlot({ ...e, durationMinutes: e.plannedDurationMinutes || e.durationMinutes }), stationId: stationFor(e.producerId || e.presenterId),
    })),
    ...bulletinFormats.filter(f => f.kind === 'MAIN' && isScheduledOn(f, date) && !scheduledBulletinExists(f, date, bulletins)).map(f => ({
      id: f.id, kind: 'scheduled-bulletin' as const, title: f.name, slot: scheduledBulletinSlot(f, date), stationId: stationFor(f.editorId),
    })),
  ].flatMap(({ slot, ...show }) => {
    const window = episodeWindow(slot);
    return window ? [{ ...show, start: window.start - midnight, end: window.end - midnight }] : [];
  });
  const slots: Slot[] = [-1, 0, 1].flatMap(offset => SHIFTS.map(shift => {
    const start = minutesOfDay(shift.start);
    const end = minutesOfDay(shift.end);
    return { date: addDaysIso(date, offset), shift: shift.id, start: start + offset * MINUTES_PER_DAY, end: end + (offset + Number(end <= start)) * MINUTES_PER_DAY };
  }));
  const duty = new Map<string, RosterEntry[]>();
  const nearbyShifts = new Map<string, number>();
  const workload = new Map<string, number>();
  const tally = (map: Map<string, number>, id: string | undefined) => { if (id) map.set(id, (map.get(id) || 0) + 1); };
  const weekStart = addDaysIso(date, -6);
  const weekEnd = addDaysIso(date, 1);
  for (const entry of roster) {
    if (!staff.has(entry.userId) || (entry as RosterEntry & { deletedAt?: string }).deletedAt) continue;
    const label = `${entry.date}:${entry.shift}`;
    const current = duty.get(label) || [];
    current.push(entry);
    duty.set(label, current);
    if (weekStart <= entry.date && entry.date <= weekEnd) tally(nearbyShifts, entry.userId);
  }
  for (const task of tasks) {
    if (!task.deletedAt && !isTaskClosed(task.status)) tally(workload, taskAssigneeId(task));
  }
  for (const card of cards) {
    if (card.deletedAt || card.status !== 'OPEN') continue;
    const responsible = new Set([card.ownerId, ...card.steps.filter(isStepOpen).map(step => step.assigneeId)]);
    responsible.forEach(id => tally(workload, id));
  }

  const gaps = new Map<string, ShiftCoverageGap>();
  for (const show of shows) {
    const availableDepartments = departmentsAtStation(show.stationId, departments);
    for (const slot of slots) {
      if (slot.start >= show.end || slot.end <= show.start) continue;
      const entries = duty.get(`${slot.date}:${slot.shift}`) || [];
      for (const departmentId of CRITICAL_DEPARTMENTS) {
        if (!availableDepartments.some(department => department.id === departmentId)) continue;
        const inStation = (userId: string) => stationFor(userId) === show.stationId;
        if (entries.some(entry => entry.departmentId === departmentId && inStation(entry.userId))) continue;
        const id = `${slot.date}:${slot.shift}:${show.stationId || 'unassigned'}:${departmentId}`;
        const existing = gaps.get(id);
        if (existing) { existing.shows.push(show); continue; }
        const booked = new Set(entries.map(entry => entry.userId));
        const suggestions = [...staff.values()].filter(user => inStation(user.id) && departmentIdOf(user) === departmentId && !booked.has(user.id))
          .map(user => ({ id: user.id, name: user.fullName, openWork: workload.get(user.id) || 0, nearbyShifts: nearbyShifts.get(user.id) || 0 }))
          .sort((a, b) => a.openWork - b.openWork || a.nearbyShifts - b.nearbyShifts || a.name.localeCompare(b.name, 'ar'))
          .slice(0, 3);
        gaps.set(id, { id, date: slot.date, shift: slot.shift, stationId: show.stationId, departmentId, shows: [show], suggestions });
      }
    }
  }
  const shiftOrder = new Map(SHIFTS.map((shift, index) => [shift.id, index]));
  return [...gaps.values()].sort((a, b) => a.date.localeCompare(b.date) || shiftOrder.get(a.shift)! - shiftOrder.get(b.shift)! || a.departmentId.localeCompare(b.departmentId));
}
