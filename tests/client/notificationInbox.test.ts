import { describe, expect, it } from 'vitest';
import type { AppNotification } from '../../src/types';
import { groupNotifications, notificationInboxPath, notificationSnoozeKey, readNotificationSnoozes, SNOOZE_MS } from '../../src/shared/notificationInbox';

const notice = (id: string, changes: Partial<AppNotification> = {}): AppNotification => ({
  id, userId: 'a', title: id, message: '', type: 'SYSTEM', category: 'news',
  isRead: false, createdAt: '2026-11-20T10:00:00Z', ...changes,
});

describe('notification inbox', () => {
  it('shows urgent notices first even when they were previously snoozed', () => {
    const urgent = notice('urgent', { urgent: true });
    const normal = notice('normal');
    const inbox = groupNotifications([normal, urgent], 'a', { urgent: 120, normal: 120 }, 100);
    expect(inbox.groups).toEqual([{ id: 'urgent', items: [urgent] }]);
    expect(inbox.snoozed).toEqual([normal]);
    expect(inbox.unreadCount).toBe(1);
  });

  it('sorts categories and restores expired items without changing their read status', () => {
    const unreadOld = notice('old');
    const unreadNew = notice('new', { createdAt: '2026-11-20T12:00:00Z' });
    const readNew = notice('read', { createdAt: '2026-11-20T13:00:00Z', isRead: true });
    const other = notice('broadcast', { userId: 'all', category: undefined });
    const inbox = groupNotifications([readNew, other, unreadOld, notice('private', { userId: 'b' }), unreadNew], 'a', { old: 100 }, 100);
    expect(inbox.groups).toEqual([
      { id: 'news', items: [unreadNew, unreadOld, readNew] }, { id: 'other', items: [other] },
    ]);
    expect(inbox.snoozed).toEqual([]);
    expect(inbox.unreadCount).toBe(3);
  });

  it('reads only the authenticated account key and ignores malformed or expired records', () => {
    const values = new Map([[notificationSnoozeKey('a'), JSON.stringify({ live: 101, expired: 99, corrupt: '105', future: SNOOZE_MS + 101 })]]);
    const storage = { getItem: (key: string) => values.get(key) ?? null };
    expect(readNotificationSnoozes(storage, 'a', 100)).toEqual({ live: 101 });
    expect(readNotificationSnoozes(storage, 'b', 100)).toEqual({});
    expect(readNotificationSnoozes({ getItem: () => '{' }, 'a', 100)).toEqual({});
  });

  it('keeps the given internal path intact when its screen is allowed', () => {
    const canOpen = (view: string) => view === 'roster';
    expect(notificationInboxPath('/roster/handover/shift-1?origin=inbox', canOpen)).toBe('/roster/handover/shift-1?origin=inbox');
    expect(notificationInboxPath('/news/story-1', canOpen)).toBeNull();
    for (const path of ['//external.example/roster', '/roster/%ZZ', '/roster/../news', '/toString']) {
      expect(notificationInboxPath(path, () => true)).toBeNull();
    }
  });
});
