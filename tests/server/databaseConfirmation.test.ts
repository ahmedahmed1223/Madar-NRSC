import { expect, it } from 'vitest';
import { DatabaseConfirmations } from '../../src/server/databaseConfirmation';
it('invalidates tickets across restart and binds actor, action and session', () => {
  const tickets = new DatabaseConfirmations();
  const binding = { actorId: 'admin', sessionId: 'session', action: 'restore' as const, sha256: 'hash' };
  const { token } = tickets.issue(binding, 1000);
  expect(new DatabaseConfirmations().consume(token, binding, 1001)).toBe(false);
  for (const changed of [{ actorId: 'other' }, { sessionId: 'other' }, { action: 'reset' as const }, { sha256: 'other' }])
    expect(tickets.consume(token, { ...binding, ...changed }, 1001)).toBe(false);
  expect(tickets.consume(token, binding, 1001)).toBe(true);
  expect(tickets.consume(token, binding, 1001)).toBe(false);
  const expired = tickets.issue(binding, 1000);
  expect(tickets.consume(expired.token, binding, 121000)).toBe(false);
});
