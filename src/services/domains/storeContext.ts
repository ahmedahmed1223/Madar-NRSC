import { COLLECTIONS } from '../../shared/collections';
import type { OnAirState } from '../../shared/onair';
import type { SystemSettings, User } from '../../types';
import { dataStore } from '../dataStore';

// Storage keys of the server-synchronised collections (see src/shared/collections.ts).
export const STORAGE_KEYS = {
  USERS: COLLECTIONS.users.storageKey,
  NEWS: COLLECTIONS.news.storageKey,
  STORIES: COLLECTIONS.stories.storageKey,
  PROGRAMS: COLLECTIONS.programs.storageKey,
  EPISODES: COLLECTIONS.episodes.storageKey,
  GUESTS: COLLECTIONS.guests.storageKey,
  TASKS: COLLECTIONS.tasks.storageKey,
  MEDIA: COLLECTIONS.media.storageKey,
  CATEGORIES: COLLECTIONS.categories.storageKey,
  SOURCES: COLLECTIONS.sources.storageKey,
  PROGRAM_TYPES: COLLECTIONS.programTypes.storageKey,
  NOTIFICATIONS: COLLECTIONS.notifications.storageKey,
  ACTIVITY_LOGS: COLLECTIONS.activityLogs.storageKey,
  AUDIT_LOGS: COLLECTIONS.auditLogs.storageKey,
  SETTINGS: COLLECTIONS.settings.storageKey,
};

/**
 * Reads come from the in-memory mirror of the server database; writes are diffed
 * and synchronised to SQLite on the server (with conflict detection).
 */
export function getStored<T>(key: string, defaultVal: T): T {
  return dataStore.get<T>(key, defaultVal);
}

/**
 * Zero-copy read snapshot from the in-memory mirror. Callers must NOT mutate the
 * returned value in place.
 */
export function getSnapshot<T>(key: string, defaultVal: T): T {
  return dataStore.getSnapshot<T>(key, defaultVal);
}

export function setStored<T>(key: string, val: T): void {
  dataStore.set(key, val);
}

export interface ApiDomainDeps {
  getCurrentUser: () => User;
  getUsers: () => User[];
  getSettings: () => SystemSettings;
  getOnAirStates: () => OnAirState[];
  logActivity: (action: string, entityType: string, entityId: string, entityTitle: string, summaryAr: string) => void;
}
