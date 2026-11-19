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

export const stationName = (stations: Station[], id?: string | null) => stations.find((s) => s.id === id)?.name || 'بدون محطة';

export const mainStation = (stations: Station[]) => stations.find((s) => s.isMain);

/**
 * Ids of the stations someone at `stationId` follows and may assign work to.
 * People without a station (central management) and the main station follow everyone.
 */
export function stationScope(stations: Station[], stationId?: string | null): Set<string> {
  const all = new Set(stations.map((s) => s.id));
  const own = stations.find((s) => s.id === stationId);
  if (!own || own.isMain) return all;
  const scope = new Set<string>([own.id]);
  for (const other of stations) {
    if (other.id === own.id) continue;
    // An explicit link on either side connects the two; two stations without lists are both open.
    const linked = own.linkedIds?.includes(other.id) || other.linkedIds?.includes(own.id) || (own.linkedIds === undefined && other.linkedIds === undefined);
    if (other.isMain || linked) scope.add(other.id);
  }
  return scope;
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
