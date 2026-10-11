import { afterEach, expect, it, vi } from 'vitest';
import { handoverRequest, HandoverUnknownOutcome, matchingHandoverDraft } from '../../src/services/handoverTransport';
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('bounds stalled requests and never silently resends', async () => {
  vi.useFakeTimers();
  const fetch = vi.fn((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))));
  vi.stubGlobal('fetch', fetch);
  const assertion = expect(handoverRequest('/api/v1/shift-handovers', { method: 'POST', json: {} })).rejects.toBeInstanceOf(HandoverUnknownOutcome);
  await vi.advanceTimersByTimeAsync(12_001);
  await assertion;
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('caller abort leaves outcome unknown and HTTP errors remain known failures', async () => {
  vi.stubGlobal('fetch', (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))));
  const controller = new AbortController();
  const request = handoverRequest('/api/v1/shift-handovers', {}, controller.signal);
  controller.abort();
  await expect(request).rejects.toBeInstanceOf(HandoverUnknownOutcome);
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: 'Denied' }), { status: 403 }));
  await expect(handoverRequest('/api/v1/shift-handovers')).rejects.toMatchObject({ status: 403 });
});
it('reconciles the exact saved input without treating newer different content as success', () => {
  const input = { id: 'h', schemaVersion: 1, departmentId: 'newsroom', sourceDate: '2026-10-11', sourceShift: 'MORNING', recipientDate: '2026-10-11', recipientShift: 'EVENING', title: 'A', note: '', references: [] } as any;
  const row = { id: 'h', v: 1, d: { ...input, state: 'DRAFT', references: [] } } as any;
  expect(matchingHandoverDraft(row, input)).toBe(true);
  expect(matchingHandoverDraft({ ...row, d: { ...row.d, note: 'different' } }, input)).toBe(false);
  expect(matchingHandoverDraft({ ...row, d: { ...row.d, references: [{ available: false }] } }, input)).toBe(false);
});
