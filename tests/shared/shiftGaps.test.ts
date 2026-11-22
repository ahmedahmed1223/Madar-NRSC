import { describe, expect, it } from 'vitest';
import { shiftCoverageGaps, shiftGapSupervisors } from '../../src/shared/shiftGaps';
import type { Bulletin, BulletinFormat } from '../../src/shared/bulletins';
import type { RosterEntry } from '../../src/shared/roster';
import type { EditorialTask, User } from '../../src/types';

const date = '2026-11-23';
const station = { id: 'gaza', name: 'غزة' };
const user = (id: string, departmentId: string, extra: Partial<User> = {}) => ({
  id, fullName: id, departmentId, stationId: station.id, isActive: true, ...extra,
} as User);
const main = { id: 'evening', date, startTime: '05:50', plannedSeconds: 1800, kind: 'MAIN', status: 'PLANNING', editorId: 'editor', title: 'النشرة' } as Bulletin;
const entry = (userId: string, departmentId: string, d: string, shift: RosterEntry['shift']) => ({ id: `entry:${userId}:${d}`, userId, departmentId, date: d, shift, userName: userId });

describe('tomorrow shift gaps', () => {
  it('handles overnight changes, station boundaries and the least-loaded available candidate', () => {
    const users = [user('editor', 'newsroom'), user('on-duty', 'control'), user('busy', 'montage'), user('free', 'montage'),
      user('elsewhere', 'montage', { stationId: 'other' }), user('off', 'montage', { isActive: false })];
    const gaps = shiftCoverageGaps({ date, stations: [station, { id: 'other', name: 'محطة أخرى' }], users, bulletins: [main], episodes: [],
      roster: [entry('editor', 'newsroom', '2026-11-22', 'NIGHT'), entry('editor', 'newsroom', date, 'MORNING'),
        entry('on-duty', 'control', '2026-11-22', 'NIGHT'), entry('free', 'montage', '2026-11-22', 'NIGHT'), entry('elsewhere', 'montage', date, 'MORNING')],
      tasks: [{ id: 'work', assigneeId: 'busy', status: 'IN_PROGRESS' }] as EditorialTask[], cards: [],
    });
    expect(gaps.map(gap => [gap.date, gap.shift, gap.departmentId, gap.suggestions.map(next => next.id)])).toEqual([
      [date, 'MORNING', 'control', ['on-duty']], [date, 'MORNING', 'montage', ['free', 'busy']],
    ]);
  });

  it('notifies the supervisors responsible for the affected station', () => {
    const people = [user('local', 'newsroom', { role: 'STATION_MANAGER' }), user('elsewhere', 'newsroom', { role: 'STATION_MANAGER', stationId: 'other' }),
      user('region', 'newsroom', { role: 'GENERAL_MANAGER', stationId: 'other', managedGroupIds: ['group'] })];
    const groups = [{ id: 'group', name: 'المنطقة', stationIds: [station.id] }];
    expect(shiftGapSupervisors(station.id, people, [station], groups).map(person => person.id)).toEqual(['local', 'region']);
  });

  it('flags a scheduled main bulletin even when the rundown has not been created', () => {
    const planned = { id: 'format', name: 'النشرة المسائية', days: [1], kind: 'MAIN', startTime: '20:00', plannedSeconds: 1800, editorId: 'editor' } as BulletinFormat;
    const input = { date, stations: [station], users: [user('editor', 'newsroom')], bulletinFormats: [planned], episodes: [], roster: [], tasks: [], cards: [] };
    const gaps = shiftCoverageGaps({ ...input, bulletins: [] });
    expect(gaps).toHaveLength(3);
    expect(gaps.every(gap => gap.shows.length === 1 && gap.shows[0].title === 'النشرة المسائية')).toBe(true);
    const created = shiftCoverageGaps({ ...input, bulletins: [{ ...main, formatId: planned.id, startTime: planned.startTime }] });
    expect(created.every(gap => gap.shows.length === 1 && gap.shows[0].id === main.id)).toBe(true);
  });
});
