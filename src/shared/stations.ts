/**
 * Stations (bureaus) that share one newsroom. Nothing here is fixed: an administrator adds or
 * removes stations in the settings, may mark one as the main station (the rest are branches)
 * and decides which stations work together.
 *
 * Users belong to one station; work on production cards is attributed to the station of the
 * person who did it. A station's "scope" is the set of stations its supervisors follow and may
 * assign work to: the main station follows everyone, a branch follows itself, the main station
 * and the stations it is linked with.
 */

export interface Station {
  id: string;
  name: string;
  /** The main station: follows every branch. At most one. */
  isMain?: boolean;
  /**
   * Stations this one works with. Absent means "all stations" (one open newsroom);
   * a list restricts it to those (links count in both directions).
   */
  linkedIds?: string[];
}

/** Starting point for a new installation; edited freely in the settings. */
export const DEFAULT_STATIONS: Station[] = [
  { id: 'gaza', name: 'غزة' },
  { id: 'beirut', name: 'بيروت' },
  { id: 'istanbul', name: 'إسطنبول' },
];

export const MAX_STATIONS = 40;
const STATION_ID = /^[a-zA-Z0-9_-]{1,40}$/;

/** Stations configured for this deployment (the defaults until an administrator edits them). */
export function stationsOf(settings: { stations?: Station[] } | null | undefined): Station[] {
  return Array.isArray(settings?.stations) ? settings!.stations! : DEFAULT_STATIONS;
}

/** A removed station, kept by name so finished work still says where it was done. */
export interface ArchivedStation {
  id: string;
  name: string;
  removedAt?: string;
}

/** A group of stations (a region) a general manager can be given as a whole. */
export interface StationGroup {
  id: string;
  name: string;
  stationIds: string[];
}

export const MAX_STATION_GROUPS = 20;

export function stationsArchiveOf(settings: { stationsArchive?: ArchivedStation[] } | null | undefined): ArchivedStation[] {
  return Array.isArray(settings?.stationsArchive) ? settings!.stationsArchive! : [];
}

export function stationGroupsOf(settings: { stationGroups?: StationGroup[] } | null | undefined): StationGroup[] {
  return Array.isArray(settings?.stationGroups) ? settings!.stationGroups! : [];
}

/**
 * The archive and groups of the current settings, remembered so screens that only hold the station
 * list (stationName, stationScope) still read them. Set wherever the settings are read (client and server).
 */
let rememberedArchive: ArchivedStation[] = [];
let rememberedGroups: StationGroup[] = [];
export function rememberStationSettings(settings: { stationsArchive?: ArchivedStation[]; stationGroups?: StationGroup[] } | null | undefined) {
  rememberedArchive = stationsArchiveOf(settings);
  rememberedGroups = stationGroupsOf(settings);
}
export const rememberedStationGroups = () => rememberedGroups;

/** A station's name; a removed station keeps its name (marked as removed) for the history of finished work. */
export const stationName = (stations: Station[], id?: string | null, archive: ArchivedStation[] = rememberedArchive) => {
  const live = stations.find((s) => s.id === id);
  if (live) return live.name;
  const gone = id ? archive.find((s) => s.id === id) : undefined;
  return gone ? `${gone.name} (محطة أُزيلت)` : 'بدون محطة';
};

/** The station list after an edit keeps every station that disappeared in the archive (names never get lost). */
export function archiveRemovedStations(before: Station[], after: Station[], archive: ArchivedStation[], now = new Date().toISOString()): ArchivedStation[] {
  const kept = new Set(after.map((s) => s.id));
  const next = archive.filter((a) => !kept.has(a.id));
  for (const station of before) {
    if (!kept.has(station.id) && !next.some((a) => a.id === station.id)) next.push({ id: station.id, name: station.name, removedAt: now });
  }
  return next;
}

export const mainStation = (stations: Station[]) => stations.find((s) => s.isMain);

/** Who a scope is computed for: a station id, or a person (their station and, for a general manager, what they are given). */
export type ScopeSubject = string | null | undefined | { stationId?: string | null; managedStationIds?: string[]; managedGroupIds?: string[] };

/** Scope of one known station: itself, the main station and the stations linked with it (the main station follows all). */
function ownScope(stations: Station[], own: Station): Set<string> {
  if (own.isMain) return new Set(stations.map((s) => s.id));
  const scope = new Set<string>([own.id]);
  for (const other of stations) {
    if (other.id === own.id) continue;
    // An explicit link on either side connects the two; two stations without lists are both open.
    const linked = own.linkedIds?.includes(other.id) || other.linkedIds?.includes(own.id) || (own.linkedIds === undefined && other.linkedIds === undefined);
    if (other.isMain || linked) scope.add(other.id);
  }
  return scope;
}

/**
 * Ids of the stations someone follows and may assign work to.
 * - Nobody's station given (central management): every station.
 * - A station that no longer exists: nothing (a removed station never widens anyone's reach).
 * - A general manager given stations or groups: the union of those stations' scopes (and their own station's).
 */
export function stationScope(stations: Station[], who?: ScopeSubject, groups: StationGroup[] = rememberedGroups): Set<string> {
  const subject = typeof who === 'object' && who !== null ? who : { stationId: who };
  const managed = new Set<string>(subject.managedStationIds || []);
  for (const groupId of subject.managedGroupIds || []) groups.find((g) => g.id === groupId)?.stationIds.forEach((id) => managed.add(id));
  const known = [...managed].map((id) => stations.find((s) => s.id === id)).filter((s): s is Station => !!s);
  const ownId = subject.stationId || undefined;
  const own = ownId ? stations.find((s) => s.id === ownId) : undefined;
  if (managed.size) {
    const scope = new Set<string>();
    for (const station of own ? [own, ...known] : known) ownScope(stations, station).forEach((id) => scope.add(id));
    return scope;
  }
  if (!ownId) return new Set(stations.map((s) => s.id));
  return own ? ownScope(stations, own) : new Set();
}

export function stationGroupsError(value: unknown, stations: Station[]): string | null {
  if (!Array.isArray(value) || value.length > MAX_STATION_GROUPS) return `الحد الأقصى ${MAX_STATION_GROUPS} مجموعة محطات`;
  const ids = new Set<string>();
  const names = new Set<string>();
  const known = new Set(stations.map((s) => s.id));
  for (const group of value) {
    if (!group || typeof group.id !== 'string' || !STATION_ID.test(group.id)) return 'معرّف مجموعة المحطات غير صالح';
    if (typeof group.name !== 'string' || !group.name.trim() || group.name.length > 60) return 'اسم مجموعة المحطات مطلوب وبحد أقصى 60 حرفاً';
    const name = group.name.trim().toLocaleLowerCase();
    if (ids.has(group.id) || names.has(name)) return 'اسم مجموعة المحطات أو معرّفها مكرر';
    if (!Array.isArray(group.stationIds) || group.stationIds.some((id: unknown) => typeof id !== 'string' || !known.has(id))) return `مجموعة «${group.name}» تضم محطة غير موجودة`;
    ids.add(group.id);
    names.add(name);
  }
  return null;
}

export function stationsArchiveError(value: unknown): string | null {
  if (!Array.isArray(value) || value.length > 500) return 'أرشيف المحطات غير صالح';
  for (const item of value) {
    if (!item || typeof item.id !== 'string' || !STATION_ID.test(item.id) || typeof item.name !== 'string' || item.name.length > 60) return 'أرشيف المحطات غير صالح';
  }
  return null;
}

/** A general manager's stations and groups must exist (checked whenever they change). */
export function managedScopeError(user: { managedStationIds?: unknown; managedGroupIds?: unknown }, stations: Station[], groups: StationGroup[]): string | null {
  for (const [key, known, label] of [
    ['managedStationIds', stations.map((s) => s.id), 'المحطات'],
    ['managedGroupIds', groups.map((g) => g.id), 'مجموعات المحطات'],
  ] as const) {
    const value = user[key];
    if (value === undefined) continue;
    if (!Array.isArray(value) || value.length > MAX_STATIONS || value.some((id) => typeof id !== 'string' || !(known as readonly string[]).includes(id))) return `${label} التي يتابعها المدير غير موجودة`;
  }
  return null;
}

export function stationsError(value: unknown): string | null {
  if (!Array.isArray(value) || value.length > MAX_STATIONS) return `الحد الأقصى ${MAX_STATIONS} محطة`;
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const station of value) {
    if (!station || typeof station.id !== 'string' || !STATION_ID.test(station.id)) return 'معرّف المحطة غير صالح';
    if (typeof station.name !== 'string' || !station.name.trim() || station.name.length > 60) return 'اسم المحطة مطلوب وبحد أقصى 60 حرفاً';
    const name = station.name.trim().toLocaleLowerCase();
    if (ids.has(station.id) || names.has(name)) return 'اسم المحطة أو معرّفها مكرر';
    if (station.isMain !== undefined && typeof station.isMain !== 'boolean') return 'تحديد المحطة الرئيسية غير صالح';
    ids.add(station.id);
    names.add(name);
  }
  if (value.filter((s) => s.isMain).length > 1) return 'محطة رئيسية واحدة فقط؛ البقية فروع';
  for (const station of value) {
    if (station.linkedIds === undefined) continue;
    if (!Array.isArray(station.linkedIds) || station.linkedIds.some((id: unknown) => typeof id !== 'string' || !ids.has(id) || id === station.id)) return `ارتباطات محطة «${station.name}» تشير إلى محطة غير موجودة`;
  }
  return null;
}
