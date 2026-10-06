import { expect, it } from 'vitest';
import { POLICIES } from '../../src/server/policy';
import { INITIAL_SETTINGS } from '../../src/services/mockData';

const check = (patch: Record<string, unknown>, allowed = true) => POLICIES.settings({
  auth: { can: () => allowed } as any, collection: 'settings', kind: 'update',
  before: INITIAL_SETTINGS, after: { ...INITIAL_SETTINGS, ...patch },
});
it('accepts valid station and editorial defaults', () => {
  expect(check({ defaultNewsPriority: 'HIGH', breakingDurationHours: 4 })).toBeNull();
});
it.each([{ organizationName: ' ' }, { defaultTimezone: 'invalid/zone' },
  { defaultSegmentDurationSeconds: 0 }, { breakingDurationHours: 100 },
  { defaultNewsPriority: 'INVALID' }, { enableAuditLog: false }])('rejects unsafe settings %j', patch => {
  expect(check(patch)).toBeTruthy();
});
it('requires settings permission and forbids deleting settings', () => {
  expect(check({}, false)).toBeTruthy();
  expect(POLICIES.settings({ auth: { can: () => true } as any, collection: 'settings', kind: 'delete', before: INITIAL_SETTINGS, after: null })).toBeTruthy();
});
