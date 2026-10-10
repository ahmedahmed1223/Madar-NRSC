import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { apiService } from '../../src/services/api';
import { DEFAULT_NEWS_FILTER } from '../../src/shared/savedNewsFilters';
import { createTestServer, listen, DEMO_PASSWORD } from '../helpers';

let server: Awaited<ReturnType<typeof createTestServer>>;
let http: Awaited<ReturnType<typeof listen>>;
beforeAll(async () => {
  server = await createTestServer();
  http = await listen(server.app);
  const realFetch = globalThis.fetch;
  const login = await realFetch(http.baseUrl + '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-NRCS-Client': 'web' }, body: JSON.stringify({ email: 'journalist@akhbar.tv', password: DEMO_PASSWORD }) });
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set('Cookie', cookie);
    return realFetch(http.baseUrl + url, { ...init, headers });
  });
});
afterAll(async () => { vi.unstubAllGlobals(); await http.close(); server.close(); });

it('returns confirmed rows and rejects stale update and deletion without changing the saved filter', async () => {
  const draft = { id: 'client-filter', schemaVersion: 1 as const, name: 'Daily', pinned: false, definition: { ...DEFAULT_NEWS_FILTER } };
  const created = await apiService.saveSavedNewsFilter(draft);
  expect(created.v).toBeGreaterThan(0);
  expect(created.d.name).toBe('Daily');
  const updated = await apiService.saveSavedNewsFilter({ ...draft, name: 'Current' }, created.v);
  await expect(apiService.saveSavedNewsFilter({ ...draft, name: 'Stale' }, created.v)).rejects.toThrow();
  await expect(apiService.deleteSavedNewsFilter(draft.id, created.v)).rejects.toThrow();
  const rows = await apiService.getSavedNewsFilterRows();
  expect(rows.find(row => row.id === draft.id)?.d.name).toBe('Current');
  await apiService.deleteSavedNewsFilter(draft.id, updated.v);
  expect((await apiService.getSavedNewsFilterRows()).some(row => row.id === draft.id)).toBe(false);
});
