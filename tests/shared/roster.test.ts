import { describe, expect, it } from 'vitest';
import { currentShift, onDutyAt, rosterEntryError, rosterEntryId, RosterEntry } from '../../src/shared/roster';
import { departmentIdOf } from '../../src/shared/departments';

const entry = (date: string, shift: RosterEntry['shift'], userId = 'u1', departmentId = 'control', isLead = false): RosterEntry => ({
  id: rosterEntryId({ date, departmentId, shift, userId }),
  date,
  departmentId,
  shift,
  userId,
  userName: userId,
  isLead,
});

describe('duty roster', () => {
  it('finds who is on duty, including night shifts after midnight', () => {
    const list = [entry('2026-09-26', 'NIGHT', 'night'), entry('2026-09-27', 'MORNING', 'morning'), entry('2026-09-26', 'EVENING', 'eve', 'newsroom')];
    const at = (iso: string) => onDutyAt(list, new Date(iso).getTime()).map((e) => e.userId);
    expect(at('2026-09-27T02:30:00')).toEqual(['night']);
    expect(at('2026-09-27T06:00:00')).toEqual(['morning']);
    expect(at('2026-09-26T15:00:00')).toEqual(['eve']);
    expect(onDutyAt(list, new Date('2026-09-26T15:00:00').getTime(), 'control')).toEqual([]);
  });

  it('puts the shift lead first', () => {
    const list = [entry('2026-09-26', 'MORNING', 'a'), entry('2026-09-26', 'MORNING', 'lead', 'control', true)];
    expect(onDutyAt(list, new Date('2026-09-26T09:00:00').getTime())[0].userId).toBe('lead');
  });

  it('maps the current time to a shift (night belongs to the day it started)', () => {
    expect(currentShift(new Date('2026-09-27T03:00:00'))).toEqual({ date: '2026-09-26', shift: 'NIGHT' });
    expect(currentShift(new Date('2026-09-27T13:59:00'))).toEqual({ date: '2026-09-27', shift: 'MORNING' });
    expect(currentShift(new Date('2026-09-27T22:00:00'))).toEqual({ date: '2026-09-27', shift: 'NIGHT' });
  });

  it('validates entries', () => {
    expect(rosterEntryError(entry('2026-09-26', 'MORNING'))).toBeNull();
    expect(rosterEntryError({ ...entry('2026-09-26', 'MORNING'), departmentId: 'marketing' })).toMatch(/القسم/);
    expect(rosterEntryError({ ...entry('2026-09-26', 'MORNING'), id: 'x' })).toMatch(/معرّف/);
  });

  it('understands legacy free-text departments', () => {
    expect(departmentIdOf({ department: 'المذيعين والتقديم' })).toBe('presenters');
    expect(departmentIdOf({ departmentId: 'graphics', department: 'غرفة الأخبار' })).toBe('graphics');
    expect(departmentIdOf({ department: 'قسم غير معروف' })).toBe('newsroom');
  });
});
