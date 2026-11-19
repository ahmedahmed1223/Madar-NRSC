import { pushRecentSearch, sanitizeRecentSearches } from '../shared/arabicSearch';

/**
 * Searches a user ran recently, per screen ("global" for Ctrl+K, "news" for the news list), kept in
 * this browser only. Storage can be blocked or full; the screens work the same without it.
 */
const key = (userId: string, scope: string) => `nrcs-recent-searches:${scope}:${userId}`;

export function loadRecentSearches(userId: string, scope: string): string[] {
  if (!userId) return [];
  try { return sanitizeRecentSearches(JSON.parse(localStorage.getItem(key(userId, scope)) || 'null')); }
  catch { return []; }
}

export function rememberSearch(userId: string, scope: string, query: string): string[] {
  if (!userId || !query.trim()) return loadRecentSearches(userId, scope);
  const next = pushRecentSearch(loadRecentSearches(userId, scope), query);
  try { localStorage.setItem(key(userId, scope), JSON.stringify(next)); }
  catch { /* storage blocked: the list just stays for this visit */ }
  return next;
}

export function clearRecentSearches(userId: string, scope: string): void {
  try { localStorage.removeItem(key(userId, scope)); }
  catch { /* nothing stored */ }
}
