import { afterEach, expect, it, vi } from 'vitest';
import { savedFilterRequest, SavedFilterUnknownOutcome } from '../../src/services/savedNewsFilterTransport';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('bounds a stalled request and distinguishes its unknown outcome', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', (_url: string, init: RequestInit) => new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))));
  const request = savedFilterRequest('/api/v1/data/sync', { method: 'POST', json: {} });
  const assertion = expect(request).rejects.toBeInstanceOf(SavedFilterUnknownOutcome);
  await vi.advanceTimersByTimeAsync(12_001);
  await assertion;
});

it('caller cancellation ends waiting and leaves outcome unknown', async () => {
  vi.stubGlobal('fetch', (_url: string, init: RequestInit) => new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))));
  const controller = new AbortController();
  const request = savedFilterRequest('/api/v1/data/sync', { method: 'POST', json: {} }, controller.signal);
  controller.abort();
  await expect(request).rejects.toBeInstanceOf(SavedFilterUnknownOutcome);
});
