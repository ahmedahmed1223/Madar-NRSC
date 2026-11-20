import { describe, expect, it } from 'vitest';
import { minutesGap, minutesLabel, minutesOf, segmentClock } from '../../src/shared/durations';
import { driftStatus, programmeSeconds, secondsUntilStart, stationWall } from '../../src/shared/stationTime';

describe('duration formats', () => {
  it('writes segments as mm:ss', () => {
    expect(segmentClock(0)).toBe('00:00');
    expect(segmentClock(210)).toBe('03:30');
    expect(segmentClock(3725)).toBe('1:02:05');
    expect(segmentClock(-90)).toBe('01:30');
  });

  it('writes programme totals in minutes', () => {
    expect(minutesLabel(34 * 60)).toBe('34 د');
    expect(minutesLabel(33 * 60 + 30)).toBe('33 د 30 ث');
    expect(minutesLabel(45)).toBe('45 ث');
    expect(minutesLabel(0)).toBe('0 د');
    expect(minutesOf(34 * 60, 50 * 60)).toBe('34 د من 50 د');
  });

  it('describes the gap in words, not with a sign', () => {
    expect(minutesGap(34 * 60, 50 * 60)).toEqual({ state: 'SHORT', text: 'ينقص 16 د' });
    expect(minutesGap(53 * 60, 50 * 60)).toEqual({ state: 'OVER', text: 'يزيد 3 د' });
    expect(minutesGap(50 * 60, 50 * 60).state).toBe('EXACT');
  });
});

describe('station time', () => {
  const at = Date.UTC(2026, 10, 19, 17, 56, 30); // 17:56:30 UTC

  it('reads the wall clock in the station zone, not the device', () => {
    expect(stationWall(at, 'Asia/Riyadh')).toMatchObject({ date: '2026-11-19', clock: '20:56:30' });
    expect(stationWall(at, 'Asia/Tokyo')).toMatchObject({ date: '2026-11-20', clock: '02:56:30' });
  });

  it('counts down to a scheduled start in station time', () => {
    expect(secondsUntilStart('2026-11-19', '21:00', at, 'Asia/Riyadh')).toBe(3 * 60 + 30);
    expect(secondsUntilStart('2026-11-19', '20:00', at, 'Asia/Riyadh')).toBe(-(56 * 60 + 30));
    // The same instant in another station zone is a different countdown.
    expect(secondsUntilStart('2026-11-19', '21:00', at, 'Europe/Istanbul')).toBe(3 * 60 + 30);
    expect(secondsUntilStart('2026-11-19', '21:00', at, 'Asia/Gaza')).toBe(63 * 60 + 30);
    expect(secondsUntilStart('', '21:00', at, 'Asia/Riyadh')).toBeNull();
  });

  it('turns drift into a labelled ahead/behind verdict', () => {
    expect(driftStatus(4)).toMatchObject({ kind: 'ON_TIME', level: 'ok', label: 'في الموعد' });
    expect(driftStatus(40)).toMatchObject({ kind: 'BEHIND', level: 'warn', label: 'متأخر', amount: 40 });
    expect(driftStatus(125)).toMatchObject({ kind: 'BEHIND', level: 'alert' });
    expect(driftStatus(-30)).toMatchObject({ kind: 'AHEAD', level: 'ok', label: 'متقدم', amount: 30 });
    expect(driftStatus(-103)).toMatchObject({ kind: 'AHEAD', level: 'warn', amount: 103 });
  });

  it('takes the programme length from the slot, else the rundown', () => {
    expect(programmeSeconds({ durationMinutes: 50, rundown: [{ durationSeconds: 60 }] })).toBe(3000);
    expect(programmeSeconds({ rundown: [{ durationSeconds: 60 }, { durationSeconds: 90 }] })).toBe(150);
  });
});
