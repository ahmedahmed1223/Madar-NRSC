import type { NewsroomDatabase } from './db';
import { MERGE_COLLECTIONS, MERGE_HISTORY_KEEP, SINGLETON_ID } from '../shared/collections';
import { isStepOpen } from '../shared/productionCards';
import { departmentsError, departmentsOf, departmentStationIds, type Department } from '../shared/departments';
import { archiveRemovedStations, stationGroupsOf, stationsArchiveOf, stationsOf, type Station } from '../shared/stations';

/** Who and what still belongs to a station: what removing it would leave behind. */
export function stationUsage(db: NewsroomDatabase, stationId: string) {
  const members = db.listCollection('users').map((r) => r.d).filter((u) => u && !u.deletedAt && u.stationId === stationId);
  const managers = db.listCollection('users').map((r) => r.d).filter((u) => u && !u.deletedAt && (u.managedStationIds || []).includes(stationId));
  const cards = db.listCollection('productionCards').map((r) => r.d).filter((c) => c && !c.deletedAt && c.status === 'OPEN');
  const openSteps = cards.flatMap((c) => (c.steps || []).filter((s: any) => s.stationId === stationId && isStepOpen(s)).map((s: any) => ({ cardId: c.id, cardTitle: c.title, stepId: s.id, assigneeName: s.assigneeName })));
  const departments = departmentsOf(db.getRow('settings', SINGLETON_ID)?.d);
  const localDepartments = departments.filter(d => {
    const scope = departmentStationIds(d, departments);
    return scope?.length === 1 && scope[0] === stationId;
  }).map(({ id, name }) => ({ id, name }));
  return {
    members: members.map((u) => ({ id: u.id, fullName: u.fullName })),
    managers: managers.map((u) => ({ id: u.id, fullName: u.fullName })),
    openSteps,
    localDepartments,
    openCardsOwned: cards.filter((c) => c.ownerStationId === stationId).length,
  };
}

export class StationRemovalError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * Removes a station in one transaction: its colleagues, its open card steps and the open cards it
 * owns move to `replacementId`; general managers stop following it; finished work keeps the old id,
 * whose name stays readable through `settings.stationsArchive`. Without a replacement, removal is
 * refused while anyone or anything open still belongs to the station.
 */
export function removeStation(db: NewsroomDatabase, stationId: string, replacementId: string | undefined, actor: { id: string; fullName: string }) {
  return db.transaction(() => {
    const row = db.getRow('settings', SINGLETON_ID);
    const settings = row?.d || {};
    const stations: Station[] = stationsOf(settings);
    const station = stations.find((s) => s.id === stationId);
    if (!station) throw new StationRemovalError(404, 'المحطة غير موجودة');
    const replacement = replacementId ? stations.find((s) => s.id === replacementId && s.id !== stationId) : undefined;
    if (replacementId && !replacement) throw new StationRemovalError(400, 'المحطة البديلة غير موجودة');
    const usage = stationUsage(db, stationId);
    if (!replacement && (usage.members.length || usage.openSteps.length || usage.openCardsOwned)) {
      throw new StationRemovalError(409, `في محطة «${station.name}» ${usage.members.length} من الزملاء و${usage.openSteps.length} مهمة مفتوحة؛ اختر محطة بديلة تنتقل إليها`);
    }

    let movedUsers = 0;
    for (const userRow of db.listCollection('users')) {
      const u = userRow.d;
      if (!u || u.deletedAt) continue;
      const moves = replacement && u.stationId === stationId;
      const managed = (u.managedStationIds || []).includes(stationId);
      if (!moves && !managed) continue;
      const next = { ...u };
      if (moves) { next.stationId = replacement!.id; movedUsers++; }
      if (managed) next.managedStationIds = u.managedStationIds.filter((id: string) => id !== stationId);
      db.writeRow('users', userRow.id, next, userRow.p, actor.id);
    }

    let movedSteps = 0;
    for (const cardRow of db.listCollection('productionCards')) {
      const card = cardRow.d;
      if (!replacement || !card || card.deletedAt || card.status !== 'OPEN') continue;
      let touched = false;
      const steps = (card.steps || []).map((s: any) => {
        if (s.stationId !== stationId || !isStepOpen(s)) return s;
        touched = true;
        movedSteps++;
        return { ...s, stationId: replacement.id };
      });
      const ownerStationId = card.ownerStationId === stationId ? replacement.id : card.ownerStationId;
      if (!touched && ownerStationId === card.ownerStationId) continue;
      // Browsers holding the previous version merge against it (see sync: MERGE_COLLECTIONS).
      if (MERGE_COLLECTIONS.has('productionCards')) db.recordHistory('productionCards', cardRow.id, cardRow.v, card, actor.id, actor.fullName, MERGE_HISTORY_KEEP);
      db.writeRow('productionCards', cardRow.id, { ...card, steps, ownerStationId, updatedAt: new Date().toISOString() }, cardRow.p, actor.id);
    }

    const remaining = stations.filter((s) => s.id !== stationId).map((s) => (s.linkedIds ? { ...s, linkedIds: s.linkedIds.filter((id) => id !== stationId) } : s));
    const groups = stationGroupsOf(settings).map((g) => ({ ...g, stationIds: g.stationIds.filter((id) => id !== stationId) }));
    const next: any = { ...settings, stations: remaining, stationsArchive: archiveRemovedStations(stations, remaining, stationsArchiveOf(settings)) };
    if (Array.isArray(settings.stationGroups)) next.stationGroups = groups;
    if (Array.isArray(settings.departments)) {
      next.departments = settings.departments.map((d: Department) => {
        if (!d.stationIds?.includes(stationId)) return d;
        const stationIds = d.stationIds.filter(id => id !== stationId);
        if (replacement && !stationIds.includes(replacement.id)) stationIds.push(replacement.id);
        if (!stationIds.length) throw new StationRemovalError(409, `قسم «${d.name}» محصور في هذه المحطة؛ اختر محطة بديلة أو عدّل نطاق القسم أولاً`);
        return { ...d, stationIds };
      });
      const invalid = departmentsError(next.departments, { stationIds: remaining.map(s => s.id), previous: settings.departments });
      if (invalid) throw new StationRemovalError(409, invalid);
    }
    db.writeRow('settings', SINGLETON_ID, next, row?.p ?? 0, actor.id);
    return { station, replacement, movedUsers, movedSteps };
  });
}
