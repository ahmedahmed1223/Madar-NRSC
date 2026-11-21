import { expect, it } from 'vitest';
import { matchesCardWorkPeriod } from '../../src/shared/cardWorkPeriod';

it('includes any relevant deadline within the station day, Saturday-run week or calendar month', () => {
  const today = '2026-11-21';
  expect(matchesCardWorkPeriod('TODAY', today, ['2026-11-22', today])).toBe(true);
  expect(matchesCardWorkPeriod('WEEK', today, ['2026-11-27'])).toBe(true);
  expect(matchesCardWorkPeriod('WEEK', today, ['2026-11-20', '2026-11-28'])).toBe(false);
  expect(matchesCardWorkPeriod('MONTH', today, ['2026-11-01'])).toBe(true);
  expect(matchesCardWorkPeriod('MONTH', today, ['2026-10-31', '2026-12-01'])).toBe(false);
});

it('finds undated work separately and keeps it available under all periods', () => {
  const today = '2026-11-21';
  expect(matchesCardWorkPeriod('UNDATED', today, [])).toBe(true);
  expect(matchesCardWorkPeriod('UNDATED', today, ['2026-11-29'])).toBe(false);
  expect(matchesCardWorkPeriod('TODAY', today, [])).toBe(false);
  expect(matchesCardWorkPeriod('ALL', today, [])).toBe(true);
});
