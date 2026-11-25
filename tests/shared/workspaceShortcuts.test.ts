import { afterEach, describe, expect, it } from 'vitest';
import { configureDateFormat } from '../../src/shared/dateFormat';
import { fromLocalInputValue, tomorrowMorningInput } from '../../src/shared/dates';
import { sanitizeWorkSections } from '../../src/shared/workContext';
import { stepLaborMinutes } from '../../src/shared/cardExecutionTiming';

afterEach(() => configureDateFormat(null));

describe('workspace shortcuts', () => {
  it('uses the station calendar for tomorrow when the device has a different day', () => {
    configureDateFormat({ dateTime: { timeBasis: 'station' }, defaultTimezone: 'Asia/Hebron' });
    expect(tomorrowMorningInput(new Date('2026-11-25T23:30:00Z'))).toBe('2026-11-27T09:00');
    expect(fromLocalInputValue('2026-11-27T09:00')).toBe('2026-11-27T07:00:00.000Z');
  });

  it('rolls tomorrow over a year boundary', () => {
    configureDateFormat({ dateTime: { timeBasis: 'station' }, defaultTimezone: 'UTC' });
    expect(tomorrowMorningInput(new Date('2026-12-31T10:00:00Z'))).toBe('2027-01-01T09:00');
  });

  it('adds personal work links without discarding saved dashboard preferences', () => {
    const result = sanitizeWorkSections({ order: ['my-tasks', 'my-news'], hidden: ['my-news'] });
    expect(result.order.slice(0, 2)).toEqual(['my-tasks', 'my-news']);
    expect(result.order).toContain('my-personal-tasks');
    expect(result.order).toContain('my-personal-notes');
    expect(result.hidden).toEqual(['my-news']);
  });

  it('ignores nonnumeric and invalid recorded minutes', () => {
    expect(stepLaborMinutes({ spentMinutes: NaN })).toBeNull();
    expect(stepLaborMinutes({ spentMinutes: Infinity })).toBeNull();
    expect(stepLaborMinutes({ spentMinutes: -5 })).toBeNull();
    expect(stepLaborMinutes({ spentMinutes: 4, timeLog: [{ id: 'bad', minutes: NaN }, { id: 'good', minutes: 7 }] })).toBe(7);
  });
});
