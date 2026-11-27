import type { User } from '../types';
import { apiFetch } from './http';
import { listPacketMetadata, purgeUser } from './offlineAirStore';
import { confirmDialog } from './dialogs';

export interface SessionInfo {
  user: User;
  permissions: string[];
  mustChangePassword: boolean;
  setupReviewId?: string;
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
      // ?optional=1: nobody signed in yet is a normal answer (200, user null), so the sign-in screen logs no 401.
      const res = await apiFetch<Omit<SessionInfo, 'user'> & { user: SessionInfo['user'] | null; success: boolean }>('/api/v1/auth/me?optional=1', { signal: AbortSignal.timeout(10_000) });
      if (!res.user) {
        session = null;
        return null;
      }
      session = { user: res.user, permissions: res.permissions, mustChangePassword: res.mustChangePassword, trashRetentionDays: res.trashRetentionDays, setupReviewId: res.setupReviewId };
      return session;
    } catch {
      session = null;
      return null;
    }
  },

  /** Throws ApiError with code TOTP_REQUIRED when the account needs an authenticator code. */
  async login(email: string, password: string, totp?: string, rememberMe = false): Promise<SessionInfo> {
    const res = await apiFetch<SessionInfo & { success: boolean }>('/api/v1/auth/login', {
      signal: AbortSignal.timeout(20_000),
      method: 'POST',
      json: { email, password, totp, rememberMe },
    });
    session = { user: res.user, permissions: res.permissions, mustChangePassword: res.mustChangePassword, trashRetentionDays: res.trashRetentionDays, setupReviewId: res.setupReviewId };
    return session;
  },

  async setupReviewShown(id: string) {
    await apiFetch('/api/v1/admin/setup/review-shown', { method: 'POST', json: { id } });
    if (session?.setupReviewId === id) session = { ...session, setupReviewId: undefined };
  },

  async logout(onConfirmed?: () => void): Promise<'cancelled' | 'completed' | 'cleanup-failed'> {
    const userId = session?.user.id;
    const localUser = userId && typeof indexedDB !== 'undefined' ? userId : null;
    const saved = localUser ? await listPacketMetadata().catch(() => null) : [];
    if (saved?.some(row => row.userId === localUser)) {
      const confirmed = await confirmDialog({ title: 'نسخ الهواء المحلية', message: 'سيحذف تسجيل الخروج نسخ الهواء المشفرة والتشغيل المحلي على هذا الجهاز. صدّر النسخ من شاشة الهواء قبل المتابعة للاحتفاظ بالسجلات غير المستوردة.', confirmLabel: 'حذف النسخ وتسجيل الخروج', cancelLabel: 'البقاء', danger: true });
      if (!confirmed) return 'cancelled';
    }
    const result = await apiFetch<{ success?: boolean } | null>('/api/v1/auth/logout', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
    });
    if (result?.success !== true) throw new Error('لم يؤكد الخادم تسجيل الخروج');
    onConfirmed?.();
    this.setSession(null);
    if (saved === null) return 'cleanup-failed';
    if (localUser) {
      try { await purgeUser(localUser); } catch { return 'cleanup-failed'; }
    }
    return 'completed';
  },

  /** The server answered PASSWORD_CHANGE_REQUIRED: the session now has to change its password first. */
  requirePasswordChange() {
    if (session) session = { ...session, mustChangePassword: true };
  },

  /** Admin: sign a colleague out of every device. */
  async revokeUserSessions(userId: string): Promise<void> {
    await apiFetch('/api/v1/admin/sessions/revoke', { method: 'POST', json: { userId } });
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
