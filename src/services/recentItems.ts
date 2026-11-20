import { pushRecent, sanitizeRecent, type RecentEntry } from '../shared/commandPalette';

/** Recently opened records per user, kept in this browser only (a convenience, not shared data). */
const key = (userId: string) => `nrcs-recent-items:${userId}`;

export function loadRecent(userId: string): RecentEntry[] {
  try { return sanitizeRecent(JSON.parse(localStorage.getItem(key(userId)) || 'null')); }
  catch { return []; }
}

export function rememberRecent(userId: string, entry: Omit<RecentEntry, 'openedAt'>): RecentEntry[] {
  const next = pushRecent(loadRecent(userId), { ...entry, openedAt: new Date().toISOString() });
  try { localStorage.setItem(key(userId), JSON.stringify(next)); }
  catch { /* storage blocked: the list just stays for this visit */ }
  return next;
}

export function clearRecent(userId: string): void {
  try { localStorage.removeItem(key(userId)); }
  catch { /* nothing stored */ }
}
