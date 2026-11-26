import { afterEach, expect, it, vi } from 'vitest';
import { ApiService } from '../../src/services/api';

afterEach(() => vi.unstubAllGlobals());

it('keeps absent prototype-named IDs empty after a JSON round trip', async () => {
  const body = JSON.stringify({ data: {
    available: true,
    programCounts: JSON.parse('{"__proto__":2}'),
    guestSummaries: JSON.parse('{"constructor":{"totalAppearances":1,"appearanceHistory":[],"monthlyAppearanceCounts":{}}}'),
  } });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, {
    headers: { 'Content-Type': 'application/json' },
  })));
  const result = await ApiService.getEpisodeSummaries();
  expect(result.programCounts.__proto__).toBe(2);
  expect(result.programCounts.constructor).toBeUndefined();
  expect(result.guestSummaries.toString).toBeUndefined();
  expect(result.guestSummaries.constructor).toMatchObject({ totalAppearances: 1 });
});
