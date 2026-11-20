import type { AppNotification } from '../types';
import { isKnownScreen, parsePath } from '../services/router';
import { isNotificationCategory, NOTIFICATION_CATEGORY_IDS, type NotificationCategory } from './notifications';

export const SNOOZE_MS = 60 * 60 * 1000;
export type NotificationSnoozes = Record<string, number>;
type GroupId = 'urgent' | NotificationCategory | 'other';
const GROUP_ORDER: GroupId[] = ['urgent', ...NOTIFICATION_CATEGORY_IDS, 'other'];

export const notificationSnoozeKey = (userId: string) => `madar-notification-snoozes-v1:${encodeURIComponent(userId)}`;

export function activeNotificationSnoozes(value: unknown, now: number): NotificationSnoozes {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, expiry]) =>
    Number.isFinite(expiry) && expiry > now && expiry <= now + SNOOZE_MS
  ));
}

export function readNotificationSnoozes(storage: Pick<Storage, 'getItem'>, userId: string, now: number): NotificationSnoozes {
  try {
    return activeNotificationSnoozes(JSON.parse(storage.getItem(notificationSnoozeKey(userId)) || 'null'), now);
  } catch {
    return {};
  }
}

export const isNotificationSnoozed = (notice: AppNotification, snoozes: NotificationSnoozes, now: number) =>
  !notice.urgent && snoozes[notice.id] > now;

export function groupNotifications(notices: AppNotification[], userId: string, snoozes: NotificationSnoozes, now: number) {
  const grouped = new Map<GroupId, AppNotification[]>();
  const snoozed: AppNotification[] = [];
  let unreadCount = 0;
  let unreadUrgent = false;
  const mine = notices.filter((n) => n.userId === userId || n.userId === 'all').sort((a, b) =>
    Number(a.isRead) - Number(b.isRead) || (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0) || a.id.localeCompare(b.id)
  );

  for (const notice of mine) {
    if (isNotificationSnoozed(notice, snoozes, now)) {
      snoozed.push(notice);
      continue;
    }
    const group = notice.urgent ? 'urgent' : isNotificationCategory(notice.category) ? notice.category : 'other';
    const items = grouped.get(group) ?? [];
    items.push(notice);
    grouped.set(group, items);
    if (!notice.isRead) {
      unreadCount++;
      unreadUrgent ||= !!notice.urgent;
    }
  }

  return {
    groups: GROUP_ORDER.flatMap((id) => {
      const items = grouped.get(id);
      return items ? [{ id, items }] : [];
    }),
    snoozed,
    unreadCount,
    unreadUrgent,
  };
}

/** Only hand off a valid, currently available app route, preserving the original target. */
export function notificationInboxPath(path: string | undefined, canOpen: (screen: string) => boolean): string | null {
  if (!path || !/^\/[a-z][a-z0-9_-]*(?:[/?#]|$)/.test(path)) return null;
  try {
    const decoded = decodeURI(path);
    if (/[\\\u0000-\u001f\u007f]/.test(decoded) || /(?:^|\/)\.{1,2}(?:\/|$)/.test(decoded.split(/[?#]/)[0])) return null;
    const { view } = parsePath(path);
    return !Object.hasOwn(Object.prototype, view) && isKnownScreen(view) && canOpen(view) ? path : null;
  } catch {
    return null;
  }
}
