import { createHash } from 'node:crypto';
import { addDaysIso, stationTimeZone } from '../shared/dates';
import { departmentsOf } from '../shared/departments';
import { shiftName } from '../shared/roster';
import { shiftCoverageGaps, shiftGapSupervisors } from '../shared/shiftGaps';
import { stationsOf, stationGroupsOf } from '../shared/stations';
import { stationWall } from '../shared/stationTime';
import type { NewsroomDatabase } from './db';
import { writeNotification } from './notifications';
import { changeBus } from './sync';

/** Notify each responsible supervisor once per station, shift and missing department. */
export function sendShiftGapNotices(db: NewsroomDatabase, now = new Date()): number {
  const sent = db.transaction(() => {
    const settings = db.getRow('settings', 'singleton')?.d;
    const date = addDaysIso(stationWall(now, stationTimeZone(settings?.defaultTimezone)).date, 1);
    const stations = stationsOf(settings);
    const groups = stationGroupsOf(settings);
    const departments = departmentsOf(settings);
    const users = db.listCollection('users').map(row => row.d);
    const gaps = shiftCoverageGaps({
      date, stations, departments, users,
      episodes: db.listCollection('episodes').map(row => row.d),
      bulletins: db.listCollection('bulletins').map(row => row.d),
      bulletinFormats: db.listCollection('bulletinFormats').map(row => row.d),
      roster: db.listCollection('roster').map(row => row.d),
      tasks: db.listCollection('tasks').map(row => row.d),
      cards: db.listCollection('productionCards').map(row => row.d),
    });
    let count = 0;
    for (const gap of gaps) {
      const station = stations.find(item => item.id === gap.stationId)?.name || 'محطة غير محددة';
      const department = departments.find(item => item.id === gap.departmentId)?.name || gap.departmentId;
      const shows = gap.shows.map(show => show.title).join('، ');
      const replacements = gap.suggestions.map(user => user.name).join('، ');
      const dayLabel = `${gap.date.slice(8, 10)}/${gap.date.slice(5, 7)}`;
      for (const user of shiftGapSupervisors(gap.stationId, users, stations, groups)) {
        const key = createHash('sha256').update(JSON.stringify([gap.id, user.id])).digest('hex').slice(0, 32);
        const id = `shift-gap-${key}`;
        if (db.getRow('notifications', id, true)) continue;
        writeNotification(db, {
          userId: user.id, category: 'system', title: `نقص مناوبة ${department}`,
          message: `${station} · ${shiftName(gap.shift)} ${dayLabel} · ${shows}${replacements ? ` · مقترح: ${replacements}` : ''}`,
          linkUrl: '/roster',
        }, { id, createdAt: now.toISOString() });
        count++;
      }
    }
    return count;
  });
  if (sent) changeBus.emit('rev', db.currentRev());
  return sent;
}
