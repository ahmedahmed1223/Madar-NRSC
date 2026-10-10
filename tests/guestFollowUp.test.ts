import { expect, it } from 'vitest';
import { guestFollowUpError, guestFollowUpWarnings } from '../src/shared/guestFollowUp';
import { episodeReadiness } from '../src/shared/production';

it('validates bounded guest follow-up and preserves historical inactive owners', () => {
  const users = [{ id: 'active', isActive: true }, { id: 'inactive', isActive: false }] as any;
  expect(guestFollowUpError({}, users)).toBeNull();
  expect(guestFollowUpError({ technicalCheckNote: 'x'.repeat(1000) }, users)).toBeNull();
  expect(guestFollowUpError({ technicalCheckNote: 'x'.repeat(1001) }, users)).not.toBeNull();
  expect(guestFollowUpError({ technicalCheckAt: 'bad' }, users)).not.toBeNull();
  expect(guestFollowUpError({ technicalCheckAt: '2026-02-30T12:00:00Z' }, users)).not.toBeNull();
  expect(guestFollowUpError({ technicalCheckStatus: 'UNKNOWN' }, users)).not.toBeNull();
  expect(guestFollowUpError({ contactOwnerId: 'active' }, users)).toBeNull();
  expect(guestFollowUpError({ contactOwnerId: 'inactive' }, users)).not.toBeNull();
  expect(guestFollowUpError({ contactOwnerId: 'inactive' }, users, { contactOwnerId: 'inactive' })).toBeNull();
});
it('reports non-blocking follow-up warnings only when relevant', () => {
  expect(guestFollowUpWarnings({})).toEqual([]);
  expect(guestFollowUpWarnings({ bookingStatus: 'CONFIRMED', technicalCheckStatus: 'FAILED' })).toHaveLength(2);
  const readiness = episodeReadiness({ rundown: [{ id: 's', title: 'نص', segmentType: 'READER', scriptText: 'نص جاهز' }], guests: [{ bookingStatus: 'CONFIRMED', technicalCheckStatus: 'FAILED' }] }, { requests: [], media: [] });
  expect(readiness.ready).toBe(true); expect(readiness.blockers).toEqual([]); expect(readiness.warnings).toHaveLength(2);
});
