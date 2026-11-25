import { describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';
import { clearSessionCookie, SESSION_COOKIE, setSessionCookie } from '../../src/server/auth';
import { loadConfig } from '../../src/server/config';

describe('session cookies in HTTP and HTTPS deployments', () => {
  it.each([
    ['HTTP development', false],
    ['HTTPS production', true],
  ])('sets and clears the same cookie options for %s', (_label, secure) => {
    const config = loadConfig({ NODE_ENV: 'test', COOKIE_SECURE: String(secure) });
    const cookie = vi.fn();
    const clearCookie = vi.fn();
    const response = { cookie, clearCookie } as unknown as Response;

    setSessionCookie(response, 'test-session', config);
    clearSessionCookie(response, config);

    expect(cookie).toHaveBeenCalledWith(SESSION_COOKIE, 'test-session', expect.objectContaining({
      httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: config.sessionTtlMs,
    }));
    expect(clearCookie).toHaveBeenCalledWith(SESSION_COOKIE, expect.objectContaining({
      httpOnly: true, secure, sameSite: 'lax', path: '/',
    }));
  });
});
