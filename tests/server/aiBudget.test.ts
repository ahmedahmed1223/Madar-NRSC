import { describe, expect, it } from 'vitest';
import { createAiBudget } from '../../src/server/aiBudget';
import { loadConfig } from '../../src/server/config';

describe('AI request budget', () => {
  it('uses the effective role allowance and persists usage between service instances', () => {
    const config = loadConfig({ NODE_ENV: 'test', AI_DAILY_REQUESTS: '3', AI_DAILY_REQUESTS_BY_ROLE: '{"PRODUCER":1,"SEALED_DESK":0}' });
    const values = new Map<string, string>();
    const store = {
      getMeta: (name: string) => values.get(name),
      setMeta: (name: string, value: string) => { values.set(name, value); },
      transaction: <T>(work: () => T) => work(),
    };
    const at = Date.parse('2026-11-21T20:00:00Z');
    const first = createAiBudget(store, config.aiUsage);
    expect(first.take('reporter-1', 'PRODUCER', at)).toEqual({ allowed: true, budget: { limit: 1, remaining: 0, resetsAt: '2026-11-22T00:00:00.000Z' } });
    const reloaded = createAiBudget(store, config.aiUsage);
    expect(reloaded.take('reporter-1', 'PRODUCER', at).allowed).toBe(false);
    expect(reloaded.status('reporter-2', 'PRODUCER', at).remaining).toBe(1);
    expect(reloaded.take('elsewhere', 'SEALED_DESK', at).allowed).toBe(false);
    expect(reloaded.status('reporter-1', 'SUPER_ADMIN', at).remaining).toBe(2);
    expect(reloaded.status('reporter-1', 'PRODUCER', Date.parse('2026-11-22T00:00:00Z')).remaining).toBe(1);
  });

  it('rejects a malformed override without exposing its input', () => {
    expect(() => loadConfig({ NODE_ENV: 'test', AI_DAILY_REQUESTS_BY_ROLE: '{"PRODUCER":-1}' })).toThrow(/AI_DAILY_REQUESTS_BY_ROLE/);
  });
});
