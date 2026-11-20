import { useEffect, useState } from 'react';
import { activeNotificationSnoozes, notificationSnoozeKey, readNotificationSnoozes, SNOOZE_MS, type NotificationSnoozes } from '../shared/notificationInbox';

const EMPTY: NotificationSnoozes = {};
const load = (userId: string) => ({
  userId,
  entries: readNotificationSnoozes({ getItem: (key) => window.localStorage.getItem(key) }, userId, Date.now()),
  stored: true,
});

export function useNotificationSnoozes(userId: string) {
  const [state, setState] = useState(() => load(userId));
  const [now, setNow] = useState(Date.now);
  const entries = state.userId === userId ? state.entries : EMPTY;

  useEffect(() => {
    setState(load(userId));
    setNow(Date.now());
  }, [userId]);

  useEffect(() => {
    const next = Object.values(entries).reduce((earliest, expiry) => expiry > now ? Math.min(earliest, expiry) : earliest, Infinity);
    if (!Number.isFinite(next)) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(0, next - Date.now()));
    return () => window.clearTimeout(timer);
  }, [entries, now]);

  const update = (id: string, snoozed: boolean) => {
    const time = Date.now();
    const active = activeNotificationSnoozes(entries, time);
    if (!snoozed) delete active[id];
    const next = snoozed ? { ...active, [id]: time + SNOOZE_MS } : active;
    let stored = true;
    try {
      window.localStorage.setItem(notificationSnoozeKey(userId), JSON.stringify(next));
    } catch {
      stored = false;
    }
    setState({ userId, entries: next, stored });
    setNow(time);
  };

  return { entries, now, update, storageFailed: state.userId === userId && !state.stored };
}
