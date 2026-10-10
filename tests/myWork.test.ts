import { expect, it } from 'vitest';
import { orderWorkSections, stationWorkDay, stationWorkTime } from '../src/shared/myWork';
import { sanitizeWorkSections } from '../src/shared/workContext';

it('uses the station day across midnight independently of the device', () => {
  expect(stationWorkDay(new Date('2026-10-10T21:30:00Z'), 'Asia/Riyadh (GMT+3)')).toBe('2026-10-11');
  expect(stationWorkDay(new Date('2026-10-10T01:30:00Z'), 'America/New_York')).toBe('2026-10-09');
  expect(stationWorkTime(new Date('2026-10-10T21:30:00Z'), 'Asia/Riyadh')).toBe('00:30');
});
it('handles daylight-saving transitions and invalid zones without changing plain days', () => {
  expect(stationWorkDay(new Date('2026-03-08T06:59:00Z'), 'America/New_York')).toBe('2026-03-08');
  expect(stationWorkTime(new Date('2026-03-08T06:59:00Z'), 'America/New_York')).toBe('01:59');
  expect(stationWorkTime(new Date('2026-03-08T07:01:00Z'), 'America/New_York')).toBe('03:01');
  const noon = new Date(2026, 9, 10, 12, 30);
  expect(stationWorkDay(noon, 'Invalid/Zone')).toBe('2026-10-10');
});
it('orders applicable sections without dropping operational sections hidden in preferences', () => {
  const preferences = sanitizeWorkSections({ order: ['my-tasks', 'my-news'], hidden: ['my-episodes'] });
  expect(orderWorkSections(['my-news', 'my-episodes', 'my-tasks'], preferences)).toEqual(['my-tasks', 'my-news', 'my-episodes']);
});
