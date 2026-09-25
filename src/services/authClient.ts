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

  async login(email: string, password: string): Promise<SessionInfo> {
    const res = await apiFetch<SessionInfo & { success: boolean }>('/api/v1/auth/login', {
      method: 'POST',
      json: { email, password },
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

  /** Admin: set a user's password (the user must change it at next sign-in). */
  async setUserPassword(userId: string, password: string): Promise<void> {
    await apiFetch(`/api/v1/users/${encodeURIComponent(userId)}/password`, { method: 'POST', json: { password } });
  },
};
