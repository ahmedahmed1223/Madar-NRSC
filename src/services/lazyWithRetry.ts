import { lazy, ComponentType } from 'react';

const RELOAD_FLAG = 'nrcs_chunk_reload';

/**
 * Lazy screen loading that survives a new deployment: if an old page asks for a file that no
 * longer exists (a "chunk" from the previous version), reload once to pick up the new version
 * instead of showing a broken screen. A second failure is reported normally.
 */
export function lazyWithRetry<T extends ComponentType<any>>(factory: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      const mod = await factory();
      try {
        sessionStorage.removeItem(RELOAD_FLAG);
      } catch {
        // storage unavailable
      }
      return mod;
    } catch (err: any) {
      const chunkError = /dynamically imported module|Loading chunk|Importing a module script failed|Failed to fetch/i.test(String(err?.message || err));
      let reloaded = false;
      try {
        reloaded = sessionStorage.getItem(RELOAD_FLAG) === '1';
        if (chunkError && !reloaded) sessionStorage.setItem(RELOAD_FLAG, '1');
      } catch {
        reloaded = true;
      }
      if (chunkError && !reloaded) {
        window.location.reload();
        return new Promise<{ default: T }>(() => undefined);
      }
      throw err;
    }
  });
}
