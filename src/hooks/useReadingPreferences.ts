import { useEffect, useState } from 'react';
import { readReadingPreferences, READING_DEFAULTS, readingPreferencesKey, writeReadingPreferences, type ReadingPreferences } from '../services/readingPreferences';

function deviceStorage() {
  try { return window.localStorage; }
  catch { return null; }
}

function load(userId: string | null) {
  return { userId, preferences: userId ? readReadingPreferences(deviceStorage(), userId) : READING_DEFAULTS, failed: false };
}

export function useReadingPreferences(userId: string | null) {
  const [saved, setSaved] = useState(() => load(userId));
  const current = saved.userId === userId ? saved : load(userId);
  if (current !== saved) setSaved(current);

  useEffect(() => {
    if (!userId) return;
    const refresh = (event: StorageEvent) => {
      if (event.key === null || event.key === readingPreferencesKey(userId)) setSaved(load(userId));
    };
    window.addEventListener('storage', refresh);
    return () => window.removeEventListener('storage', refresh);
  }, [userId]);

  const update = (patch: Partial<ReadingPreferences>) => {
    if (!userId) return;
    const storage = deviceStorage();
    const prior = current.failed ? current.preferences : readReadingPreferences(storage, userId);
    const preferences = { ...prior, ...patch };
    setSaved({ userId, preferences, failed: !writeReadingPreferences(storage, userId, preferences) });
  };
  return { preferences: current.preferences, update, storageFailed: current.failed };
}
