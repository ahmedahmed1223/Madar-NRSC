import { describe, expect, it } from 'vitest';
import { setupDoneCount, setupProgress, setupSkipped, setupStateError, type SetupFacts } from '../../src/shared/setup';
import { settingsError } from '../../src/shared/settings';

const fresh: SetupFacts = { stationsConfigured: false, categories: 0, teamMembers: 1, adminTwoFactor: false, backups: false };

describe('quick setup', () => {
  it('starts with nothing done on a fresh installation', () => {
    const progress = setupProgress(fresh);
    expect(Object.values(progress).every((v) => !v)).toBe(true);
    expect(setupDoneCount(progress)).toBe(0);
  });

  it('counts what the system already shows, and what the administrator confirmed', () => {
    const progress = setupProgress({ ...fresh, stationsConfigured: true, categories: 3, teamMembers: 12, adminTwoFactor: true, backups: true });
    expect(progress).toMatchObject({ stations: true, categories: true, team: true, security: true, organization: false, finish: false });
    expect(setupDoneCount(progress)).toBe(4);
    const confirmed = setupProgress({ ...fresh, setup: { confirmed: ['organization', 'security'], completedAt: '2026-11-19T10:00:00Z' } });
    // Reviewing security without 2FA and backups is a skip, not a completion.
    expect(confirmed).toMatchObject({ organization: true, security: false, finish: true, categories: false });
    expect(setupSkipped({ ...fresh, setup: { confirmed: ['security'] } }).security).toBe(true);
    expect(setupSkipped({ ...fresh, adminTwoFactor: true, backups: true, setup: { confirmed: ['security'] } }).security).toBe(false);
  });

  it('only accepts a well-formed state in the shared settings', () => {
    expect(setupStateError({ confirmed: ['organization'] })).toBeNull();
    expect(setupStateError({ confirmed: ['nope'] })).not.toBeNull();
    expect(setupStateError({ completedAt: 'yesterday' })).not.toBeNull();
    expect(setupStateError([])).not.toBeNull();
    const base = { organizationName: 'مدار', defaultTimezone: 'Asia/Gaza', enableAuditLog: true } as any;
    expect(settingsError({ ...base, setup: { confirmed: ['team'] } })).toBeNull();
    expect(settingsError({ ...base, setup: 'done' })).not.toBeNull();
  });
});
