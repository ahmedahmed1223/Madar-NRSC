import { afterEach, expect, it, vi } from 'vitest';
import { apiFetch, setUnauthorizedHandler } from '../src/services/http';
afterEach(() => { setUnauthorizedHandler(null); vi.unstubAllGlobals(); });
it('keeps the signed-in session on scoped confirmation errors but still handles actual expiry', async () => {
  const unauthorized = vi.fn(); setUnauthorizedHandler(unauthorized);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'أعد التأكيد', code: 'CONFIRMATION_INVALID' }), { status: 401, headers: { 'content-type': 'application/json' } })));
  await expect(apiFetch('/api/v1/db/backups/restore', { confirmationErrors: true } as any)).rejects.toThrow('أعد التأكيد');
  expect(unauthorized).not.toHaveBeenCalled();
  await expect(apiFetch('/api/v1/data/bootstrap', { confirmationErrors: true } as any)).rejects.toThrow();
  expect(unauthorized).toHaveBeenCalledTimes(1);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'expired' }), { status: 401, headers: { 'content-type': 'application/json' } })));
  await expect(apiFetch('/api/v1/db/backups/restore', { confirmationErrors: true } as any)).rejects.toThrow();
  expect(unauthorized).toHaveBeenCalledTimes(2);
});
