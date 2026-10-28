import { useEffect, useRef, useState } from 'react';
import { apiService } from '../services/api';
import { authClient } from '../services/authClient';
import { dataStore } from '../services/dataStore';
import { forgetHeldLock, rememberHeldLock } from '../services/heldLocks';
import { EDIT_LOCK_TTL_MS, EditLock, isLockActive, isOwnLock, lockIdFor } from '../shared/collections';

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
  const me = authClient.getSession()?.user.id;
  const acquireRef = useRef<() => Promise<void>>(async () => undefined);
  const pendingRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let held = false;
    const lockId = newsId ? lockIdFor(collection, newsId) : '';
    // Remembered per tab so the next load can release it if this page goes away without cleanup.
    const markHeld = (value: boolean) => {
      held = value;
      if (value) rememberHeldLock(lockId);
    };
    let acquiring = false;
    let disposed = false;
    setHolder(null);
    if (!newsId) {
      setStatus('none');
      return;
    }
    const acquire = () => {
      if (disposed || acquiring) return pendingRef.current;
      acquiring = true;
      const previous = pendingRef.current;
      const pending = (async () => {
        // Serialize lifecycles so a late release cannot clear the next editor's lease.
        await previous;
        if (disposed) return;
        setStatus('acquiring');
        rememberHeldLock(lockId); // the server may grant it after this page is gone
        try {
          const lock = await apiService.acquireEditLock(collection, newsId);
          if (disposed) {
            // The screen closed while we waited; the answer may still be unconfirmed (no owner yet).
            if (isOwnLock(lock, me)) {
              apiService.releaseEditLock(collection, newsId);
              await dataStore.settle();
            }
            return;
          }
          markHeld(!!lock && lock.userId === me && isLockActive(lock));
          if (!held) forgetHeldLock(lockId);
          setHolder(held ? null : lock);
          setStatus(held ? 'held' : lock && isLockActive(lock) ? 'locked' : 'none');
        } catch {
          if (!disposed) setStatus('none');
        } finally {
          acquiring = false;
        }
      })();
      pendingRef.current = pending;
      return pending;
    };
    acquireRef.current = acquire;
    const evaluate = () => {
      if (disposed || acquiring) return;
      const lock = apiService.getEditLocks().find(l => l.id === lockIdFor(collection, newsId));
      if (lock && isLockActive(lock)) {
        markHeld(lock.userId === me);
        setHolder(held ? null : lock);
        setStatus(held ? 'held' : 'locked');
      } else {
        held = false;
        void acquire();
      }
    };
    const foreign = apiService.getForeignLock(newsId, collection);
    if (foreign) {
      setHolder(foreign);
      setStatus('locked');
    } else {
      void acquire();
    }

    const renew = () => {
      if (held) void acquire();
      else evaluate();
    };
    let heartbeat = setInterval(renew, HEARTBEAT_MS);

    const subscribe = () => dataStore.subscribe((evt) => {
      if (evt.type === 'data-changed' && evt.collections.includes('editLocks')) evaluate();
    });
    let unsubscribe = subscribe();

    // Best-effort release when the tab closes; otherwise the lock simply expires.
    const onUnload = () => {
      disposed = true;
      clearInterval(heartbeat);
      unsubscribe();
      // A request still in flight may be granted after the page is gone, so release then too;
      // this endpoint only removes a lock the server shows as ours.
      if (!held && !acquiring) return;
      apiService.releaseEditLockOnServer(collection, newsId);
    };
    // pagehide runs only after navigation is accepted, unlike a cancellable beforeunload.
    const onRestore = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      disposed = false;
      heartbeat = setInterval(renew, HEARTBEAT_MS);
      unsubscribe = subscribe();
      void dataStore.pull().then(evaluate);
    };
    window.addEventListener('pagehide', onUnload);
    window.addEventListener('pageshow', onRestore);

    return () => {
      disposed = true;
      clearInterval(heartbeat);
      unsubscribe();
      window.removeEventListener('pagehide', onUnload);
      window.removeEventListener('pageshow', onRestore);
      // Also covers a request still in flight: releaseEditLock only removes our own lock or request.
      apiService.releaseEditLock(collection, newsId);
      forgetHeldLock(lockId);
      held = false;
    };
  }, [collection, newsId, me]);

  return {
    status,
    holder,
    /** Editors (news.edit_any) may take a story over from a colleague. */
    takeOver: () => acquireRef.current(),
  };
}
