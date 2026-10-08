import type { User } from '../types';
import { apiFetch } from './http';
import { listPacketMetadata, purgeUser } from './offlineAirStore';
import { confirmDialog } from './dialogs';

export interface SessionInfo {
  user: User;
  permissions: string[];
  mustChangePassword: boolean;
  /** Days before trashed items are purged by the server (0 = kept forever). */
  trashRetentionDays?: number;
}

let session: SessionInfo | null = null;

export const authClient = {
  getSession(): SessionInfo | null {
    return session;
  },

  setSession(next: SessionInfo | null) {
    if (!next && session?.user.id && typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel('madar-offline-air');
      channel.postMessage({ type: 'logout', userId: session.user.id }); channel.close();
    }
    session = next;
  },

  async fetchSession(): Promise<SessionInfo | null> {
    try {
      // A slow or stuck first request must not leave the screen waiting forever.
      const res = await apiFetch<SessionInfo & { success: boolean }>('/api/v1/auth/me', { signal: AbortSignal.timeout(10_000) });
      session = { user: res.user, permissions: res.permissions, mustChangePassword: res.mustChangePassword, trashRetentionDays: res.trashRetentionDays };
      return session;
    } catch {
      session = null;
      return null;
    }
  },

  /** Throws ApiError with code TOTP_REQUIRED when the account needs an authenticator code. */
  async login(email: string, password: string, totp?: string): Promise<SessionInfo> {
    const res = await apiFetch<SessionInfo & { success: boolean }>('/api/v1/auth/login', {
      signal: AbortSignal.timeout(20_000),
      method: 'POST',
      json: totp ? { email, password, totp } : { email, password },
    });
    session = { user: res.user, permissions: res.permissions, mustChangePassword: res.mustChangePassword, trashRetentionDays: res.trashRetentionDays };
    return session;
  },

  async logout(): Promise<boolean> {
    const userId = session?.user.id;
    if (userId && typeof indexedDB !== 'undefined') {
      const saved = (await listPacketMetadata()).filter(row => row.userId === userId);
      if (saved.length && !await confirmDialog({ title: 'نسخ الهواء المحلية', message: 'سيحذف تسجيل الخروج نسخ الهواء المشفرة والتشغيل المحلي على هذا الجهاز. صدّر النسخ من شاشة الهواء قبل المتابعة للاحتفاظ بالسجلات غير المستوردة.', confirmLabel: 'حذف النسخ وتسجيل الخروج', cancelLabel: 'البقاء', danger: true })) return false;
      await purgeUser(userId);
      if (typeof BroadcastChannel !== 'undefined') {
        const channel = new BroadcastChannel('madar-offline-air');
        channel.postMessage({ type: 'logout', userId }); channel.close();
      }
    }
    await apiFetch('/api/v1/auth/logout', { method: 'POST' });
    session = null;
    return true;
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
