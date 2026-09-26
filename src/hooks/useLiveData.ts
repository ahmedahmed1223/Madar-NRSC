import { useEffect, useState } from 'react';
import { dataStore } from '../services/dataStore';
import type { CollectionName } from '../shared/collections';

/** Re-renders when any of the given collections change, and optionally every `tickMs`. */
export function useLiveData(collections: CollectionName[], tickMs = 0): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const unsubscribe = dataStore.subscribe((evt) => {
      if (evt.type === 'data-changed' && evt.collections.some((c) => collections.includes(c as CollectionName))) setVersion((v) => v + 1);
    });
    const timer = tickMs ? window.setInterval(() => setVersion((v) => v + 1), tickMs) : 0;
    return () => {
      unsubscribe();
      if (timer) window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collections.join(','), tickMs]);
  return version;
}
