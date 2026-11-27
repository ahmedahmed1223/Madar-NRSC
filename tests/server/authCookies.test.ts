import { describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';
import request from 'supertest';
import { clearSessionCookie, SESSION_COOKIE, sessionIdFromToken, setSessionCookie } from '../../src/server/auth';
import { loadConfig } from '../../src/server/config';
import { createTestServer, DEMO_PASSWORD } from '../helpers';

describe('session cookies in HTTP and HTTPS deployments', () => {
  it.each([
    ['HTTP development', false],
    ['HTTPS production', true],
  ])('sets and clears the same cookie options for %s', (_label, secure) => {
    const config = loadConfig({ NODE_ENV: 'test', COOKIE_SECURE: String(secure) });
    const cookie = vi.fn();
    const clearCookie = vi.fn();
    const response = { cookie, clearCookie } as unknown as Response;

    setSessionCookie(response, 'test-session', config, config.rememberSessionTtlMs);
    clearSessionCookie(response, config);

    expect(cookie).toHaveBeenCalledWith(SESSION_COOKIE, 'test-session', expect.objectContaining({
      httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: config.rememberSessionTtlMs,
    }));
    expect(clearCookie).toHaveBeenCalledWith(SESSION_COOKIE, expect.objectContaining({
      httpOnly: true, secure, sameSite: 'lax', path: '/',
    }));
  });

  it('keeps session cookies temporary by default and revokes a remembered session on logout', async () => {
    const server = await createTestServer({ REMEMBER_SESSION_DAYS: '7' });
    try {
      const signIn = (rememberMe?: boolean) => request(server.app).post('/api/v1/auth/login')
        .set('X-NRCS-Client', 'web').send({ email: 'editor@akhbar.tv', password: DEMO_PASSWORD, rememberMe });
      const temporary = await signIn();
      expect(temporary.status).toBe(200);
      expect(temporary.headers['set-cookie'][0]).not.toMatch(/Max-Age|Expires/i);

      const remembered = await signIn(true);
      expect(remembered.status).toBe(200);
      const cookie = remembered.headers['set-cookie'][0];
      expect(cookie).toContain('Max-Age=604800');
      expect(cookie).toContain('HttpOnly');
      const credential = cookie.split(';')[0];
      const id = sessionIdFromToken(credential.slice(SESSION_COOKIE.length + 1));
      const stored = server.db.getSession(id)!;
      expect(Date.parse(stored.expiresAt) - Date.now()).toBeGreaterThan(6 * 86_400_000);
      server.db.touchSession(id);
      expect(server.db.getSession(id)?.expiresAt).toBe(stored.expiresAt);
      const logout = await request(server.app).post('/api/v1/auth/logout').set('X-NRCS-Client', 'web').set('Cookie', credential);
      expect(logout.status).toBe(200);
      const me = await request(server.app).get('/api/v1/auth/me?optional=1').set('Cookie', credential);
      expect(me.body.user).toBeNull();
    } finally { server.close(); }
  });
});
