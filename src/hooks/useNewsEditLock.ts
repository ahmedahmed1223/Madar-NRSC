import { useCallback, useEffect, useRef, useState } from 'react';
import { apiService } from '../services/api';
import { authClient } from '../services/authClient';
import { dataStore } from '../services/dataStore';
import { EDIT_LOCK_TTL_MS, EditLock, isLockActive, lockIdFor } from '../shared/collections';

type LockTarget = 'news' | 'episodes' | 'bulletinStories';

export type EditLockStatus = 'none' | 'acquiring' | 'held' | 'locked';

const HEARTBEAT_MS = Math.floor(EDIT_LOCK_TTL_MS / 3);

/**
 * Holds the edit lock on a story while the editor is open so colleagues cannot save over
 * the work in progress. Renews it periodically, releases it on close, and reports when
 * someone else holds (or takes over) the story.
 */
export function useNewsEditLock(newsId: string | undefined) {
  return useEditLock('news', newsId);
}

/** Generic edit lock for lockable collections (stories and programme episodes). */
export function useEditLock(collection: LockTarget, entityId: string | undefined, enabled = true) {
  const newsId = enabled ? entityId : undefined;
  const [status, setStatus] = useState<EditLockStatus>('none');
  const [holder, setHolder] = useState<EditLock | null>(null);
  const heldRef = useRef(false);
  const acquiringRef = useRef(false);

  const me = authClient.getSession()?.user.id;

  const acquireRef = useRef<() => Promise<void>>(async () => undefined);

  const evaluate = useCallback(() => {
    if (!newsId || acquiringRef.current) return;
    const lock = apiService.getEditLocks().find((l) => l.id === lockIdFor(collection, newsId));
    if (lock && isLockActive(lock) && lock.userId !== me) {
      heldRef.current = false;
      setHolder(lock);
      setStatus('locked');
    } else if (lock && isLockActive(lock) && lock.userId === me) {
      heldRef.current = true;
      setHolder(null);
      setStatus('held');
    } else {
      // Released or expired (possibly our own): (re)acquire so the editor stays protected.
      void acquireRef.current();
    }
  }, [collection, newsId, me]);

  const acquire = useCallback(async () => {
    if (!newsId || acquiringRef.current) return;
    acquiringRef.current = true;
    setStatus('acquiring');
    try {
      const lock = await apiService.acquireEditLock(collection, newsId);
      if (lock && lock.userId === me && isLockActive(lock)) {
        heldRef.current = true;
        setHolder(null);
        setStatus('held');
      } else {
        heldRef.current = false;
        setHolder(lock);
        setStatus(lock && isLockActive(lock) ? 'locked' : 'none');
      }
    } catch {
      setStatus('none');
    } finally {
      acquiringRef.current = false;
    }
  }, [collection, newsId, me]);
  acquireRef.current = acquire;

  useEffect(() => {
    heldRef.current = false;
    setHolder(null);
    if (!newsId) {
      setStatus('none');
      return;
    }
    const foreign = apiService.getForeignLock(newsId, collection);
    if (foreign) {
      setHolder(foreign);
      setStatus('locked');
    } else {
      void acquire();
    }

    const heartbeat = setInterval(() => {
      if (heldRef.current) void acquire();
      else evaluate();
    }, HEARTBEAT_MS);

    const unsubscribe = dataStore.subscribe((evt) => {
      if (evt.type === 'data-changed' && evt.collections.includes('editLocks')) evaluate();
    });

    // Best-effort release when the tab closes; otherwise the lock simply expires.
    const onUnload = () => {
      if (!heldRef.current) return;
      try {
        fetch('/api/v1/data/sync', {
          method: 'POST',
          keepalive: true,
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', 'X-NRCS-Client': 'web' },
          body: JSON.stringify({ ops: [{ c: 'editLocks', op: 'delete', id: lockIdFor(collection, newsId) }] }),
        });
      } catch {
        // ignore
      }
    };
    window.addEventListener('beforeunload', onUnload);

    return () => {
      clearInterval(heartbeat);
      unsubscribe();
      window.removeEventListener('beforeunload', onUnload);
      if (heldRef.current) apiService.releaseEditLock(collection, newsId);
      heldRef.current = false;
    };
  }, [collection, newsId, acquire, evaluate]);

  return {
    status,
    holder,
    /** Editors (news.edit_any) may take a story over from a colleague. */
    takeOver: acquire,
  };
}
