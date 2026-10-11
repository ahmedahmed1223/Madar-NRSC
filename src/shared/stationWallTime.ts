import { validZone } from './dateFormat';
import { zoneOffsetMinutes } from './dates';

const cache = new Map<string, number | null>();

/** Resolve one unambiguous station wall time; never inherit the device timezone. */
export function stationWallTime(date: string, time: string, zone: string): number | null {
  const key = `${date}|${time}|${zone}`;
  if (cache.has(key)) return cache.get(key)!;
  let result: number | null = null;
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || '');
  const clock = /^(\d{2}):(\d{2})$/.exec(time || '');
  const tz = validZone(zone);
  if (day && clock && tz && +day[1] >= 1000 && +clock[1] < 24 && +clock[2] < 60) {
    const wall = Date.UTC(+day[1], +day[2] - 1, +day[3], +clock[1], +clock[2]);
    const check = new Date(wall);
    if (check.getUTCFullYear() === +day[1] && check.getUTCMonth() + 1 === +day[2] && check.getUTCDate() === +day[3]) {
      const offsets = new Set<number>();
      // Sample either side of the date so repeated times yield both candidate offsets.
      for (let hours = -48; hours <= 48; hours += 6) offsets.add(zoneOffsetMinutes(tz, new Date(wall + hours * 3_600_000)));
      const candidates = [...offsets].map(offset => wall - offset * 60_000)
        .filter(candidate => candidate + zoneOffsetMinutes(tz, new Date(candidate)) * 60_000 === wall);
      if (candidates.length === 1) result = candidates[0];
    }
  }
  if (cache.size >= 500) cache.clear();
  cache.set(key, result);
  return result;
}
