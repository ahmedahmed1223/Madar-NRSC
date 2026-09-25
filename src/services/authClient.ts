import type { User } from '../types';
import { apiFetch } from './http';

export interface SessionInfo {
  user: User;
  permissions: string[];
  mustChangePassword: boolean;
}

let session: SessionInfo | null = null;

export const authClient = {
  getSession(): SessionInfo | null {
    return session;
  },

  setSession(next: SessionInfo | null) {
    session = next;
  },

  async fetchSession(): Promise<SessionInfo | null> {
    try {
      const res = await apiFetch<SessionInfo & { success: boolean }>('/api/v1/auth/me');
      session = { user: res.user, permissions: res.permissions, mustChangePassword: res.mustChangePassword };
      return session;
    } catch {
      session = null;
      return null;
    }
  },

  /** Throws ApiError with code TOTP_REQUIRED when the account needs an authenticator code. */
  async login(email: string, password: string, totp?: string): Promise<SessionInfo> {
    const res = await apiFetch<SessionInfo & { success: boolean }>('/api/v1/auth/login', {
      method: 'POST',
      json: totp ? { email, password, totp } : { email, password },
    });
    session = { user: res.user, permissions: res.permissions, mustChangePassword: res.mustChangePassword };
    return session;
  },

  async logout(): Promise<void> {
    try {
      await apiFetch('/api/v1/auth/logout', { method: 'POST' });
    } finally {
      session = null;
    }
  },

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await apiFetch('/api/v1/auth/change-password', { method: 'POST', json: { currentPassword, newPassword } });
    if (session) session = { ...session, mustChangePassword: false };
  },

  async setupTwoFactor(password: string): Promise<{ secret: string; otpauthUrl: string }> {
    return apiFetch('/api/v1/auth/2fa/setup', { method: 'POST', json: { password } });
  },

  async enableTwoFactor(code: string): Promise<void> {
    await apiFetch('/api/v1/auth/2fa/enable', { method: 'POST', json: { code } });
  },

  async disableTwoFactor(password: string, code: string): Promise<void> {
    await apiFetch('/api/v1/auth/2fa/disable', { method: 'POST', json: { password, code } });
  },

  /** Admin: remove 2FA from a user who lost their authenticator device. */
  async resetUserTwoFactor(userId: string): Promise<void> {
    await apiFetch(`/api/v1/users/${encodeURIComponent(userId)}/2fa/reset`, { method: 'POST' });
  },

  /** Admin: set a user's password (the user must change it at next sign-in). */
  async setUserPassword(userId: string, password: string): Promise<void> {
    await apiFetch(`/api/v1/users/${encodeURIComponent(userId)}/password`, { method: 'POST', json: { password } });
  },
};
