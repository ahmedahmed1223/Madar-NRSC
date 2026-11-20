import { apiService } from '../../services/api';
import { addDaysIso } from '../../shared/dates';
import { bulletinKindName } from '../../shared/bulletins';
import { bulletinSlot, scheduledBulletinSlot, type AirSlot } from '../../shared/schedule';

/**
 * Bulletins that hold a studio around a day: the created ones, and the scheduled ones nobody has
 * created yet (the day before and after too, for shows that run past midnight). Episode forms
 * check a new time against these as well as against other episodes.
 */
export function bulletinSlotsAround(date: string | undefined): AirSlot[] {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
  const days = [addDaysIso(date, -1), date, addDaysIso(date, 1)];
  return [
    ...apiService
      .getBulletins()
      .filter((b) => days.includes(b.date))
      .map((b) => bulletinSlot(b, bulletinKindName(b.kind))),
    ...days.flatMap((d) => apiService.missingScheduledBulletins(d).map((f) => scheduledBulletinSlot(f, d))),
  ];
}
