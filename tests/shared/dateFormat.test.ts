import { afterEach, describe, expect, it } from 'vitest';
import { appLocale, configureDateFormat, formatDay, sanitizeDateSettings, zoneOptions } from '../../src/shared/dateFormat';
import { addDaysIso, arabicDate, fromLocalInputValue, localDateString, toLocalInputValue } from '../../src/shared/dates';

const riyadhUnified = { defaultTimezone: 'Asia/Riyadh (GMT+3)', dateTime: { timeBasis: 'station' } };

afterEach(() => configureDateFormat(null));

describe('station-wide date and time', () => {
  it('unified station time: fields are read and shown in the station zone on any device', () => {
    configureDateFormat(riyadhUnified);
    expect(fromLocalInputValue('2026-09-27T10:30')).toBe('2026-09-27T07:30:00.000Z');
    expect(toLocalInputValue('2026-09-27T07:30:00.000Z')).toBe('2026-09-27T10:30');
    // 22:00 UTC is already the next day in Riyadh.
    expect(localDateString(new Date('2026-09-27T22:00:00Z'))).toBe('2026-09-28');
    expect(zoneOptions()).toEqual({ timeZone: 'Asia/Riyadh' });
  });

  it('device time stays the default', () => {
    configureDateFormat({ defaultTimezone: 'Asia/Riyadh' });
    expect(zoneOptions()).toEqual({});
  });

  it('digits, calendar and clock follow the settings', () => {
    configureDateFormat({ dateTime: { digits: 'arab', calendar: 'islamic-umalqura', hourCycle: 'h12' } });
    expect(appLocale()).toBe('ar-EG-u-ca-islamic-umalqura-hc-h12-nu-arab');
    expect(arabicDate('2026-09-27')).toMatch(/[٠-٩]/);
    expect(arabicDate('2026-09-27')).toMatch(/هـ/);
    configureDateFormat({ dateTime: { dateStyle: 'numeric' } });
    expect(formatDay('2026-09-07').replace(/\u200f/g, '')).toBe('07/09/2026');
  });

  it('a plain day never moves, whatever the zone', () => {
    configureDateFormat(riyadhUnified);
    expect(arabicDate('2026-09-27')).toBe('27 سبتمبر 2026');
    expect(addDaysIso('2026-09-30', 2)).toBe('2026-10-02');
    expect(addDaysIso('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('ignores unknown values', () => {
    expect(sanitizeDateSettings({ digits: 'roman', timeBasis: 'moon', clockSeconds: 'yes' })).toEqual(sanitizeDateSettings(null));
  });
});
