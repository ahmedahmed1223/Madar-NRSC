import { describe, expect, it } from 'vitest';
import { DEFAULT_STATIONS, stationScope, stationsError, stationsOf, type Station } from '../../src/shared/stations';
import { settingsError } from '../../src/shared/settings';

const ids = (set: Set<string>) => [...set].sort();

describe('stations', () => {
  it('starts from an editable default list', () => {
    expect(stationsOf(null)).toBe(DEFAULT_STATIONS);
    expect(stationsOf({ stations: [] })).toEqual([]);
    expect(stationsOf({ stations: [{ id: 'a', name: 'عمّان' }] })).toEqual([{ id: 'a', name: 'عمّان' }]);
  });

  it('lets every station follow every other one when nothing is restricted', () => {
    expect(ids(stationScope(DEFAULT_STATIONS, 'gaza'))).toEqual(['beirut', 'gaza', 'istanbul']);
  });

  it('gives the main station and central management the whole newsroom', () => {
    const stations: Station[] = [{ id: 'hq', name: 'الرئيسية', isMain: true }, { id: 'a', name: 'أ', linkedIds: [] }, { id: 'b', name: 'ب', linkedIds: [] }];
    expect(ids(stationScope(stations, 'hq'))).toEqual(['a', 'b', 'hq']);
    expect(ids(stationScope(stations, undefined))).toEqual(['a', 'b', 'hq']);
    // A station that no longer exists is an empty scope, never the whole newsroom.
    expect(ids(stationScope(stations, 'removed-station'))).toEqual([]);
  });

  it('limits a branch to itself, the main station and its links, in both directions', () => {
    const stations: Station[] = [
      { id: 'hq', name: 'الرئيسية', isMain: true },
      { id: 'a', name: 'أ', linkedIds: ['b'] },
      { id: 'b', name: 'ب', linkedIds: [] },
      { id: 'c', name: 'ج', linkedIds: [] },
    ];
    expect(ids(stationScope(stations, 'a'))).toEqual(['a', 'b', 'hq']);
    expect(ids(stationScope(stations, 'b'))).toEqual(['a', 'b', 'hq']);
    expect(ids(stationScope(stations, 'c'))).toEqual(['c', 'hq']);
  });

  it('keeps a restricted station out of an open station unless one of them names the other', () => {
    const stations: Station[] = [{ id: 'open', name: 'مفتوحة' }, { id: 'closed', name: 'مقيدة', linkedIds: [] }, { id: 'open2', name: 'مفتوحة 2' }];
    expect(ids(stationScope(stations, 'open'))).toEqual(['open', 'open2']);
    expect(ids(stationScope(stations, 'closed'))).toEqual(['closed']);
  });

  it('rejects malformed station lists', () => {
    expect(stationsError(DEFAULT_STATIONS)).toBeNull();
    expect(stationsError([{ id: 'a', name: 'أ', isMain: true }, { id: 'b', name: 'ب', isMain: true }])).toContain('رئيسية واحدة');
    expect(stationsError([{ id: 'a', name: 'أ' }, { id: 'a', name: 'ب' }])).toContain('مكرر');
    expect(stationsError([{ id: 'a', name: 'أ' }, { id: 'b', name: ' أ ' }])).toContain('مكرر');
    expect(stationsError([{ id: 'a b', name: 'أ' }])).toContain('معرّف');
    expect(stationsError([{ id: 'a', name: '  ' }])).toContain('اسم المحطة');
    expect(stationsError([{ id: 'a', name: 'أ', linkedIds: ['ghost'] }])).toContain('غير موجودة');
    expect(stationsError([{ id: 'a', name: 'أ', linkedIds: ['a'] }])).toContain('غير موجودة');
    expect(stationsError('x')).not.toBeNull();
  });

  it('is enforced when the shared settings are saved', () => {
    const base = { organizationName: 'مدار', defaultTimezone: 'Asia/Gaza', enableAuditLog: true } as any;
    expect(settingsError({ ...base, stations: [{ id: 'a', name: 'أ' }] })).toBeNull();
    expect(settingsError({ ...base, stations: [{ id: 'a', name: '' }] })).toContain('اسم المحطة');
    expect(settingsError({ ...base, cardStepTypes: [{ id: 'edit', name: 'تحرير', weight: 11 }] })).toContain('وزن');
  });
});
