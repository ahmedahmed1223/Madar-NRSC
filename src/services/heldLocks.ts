/**
 * Edit locks this browser tab holds, kept in sessionStorage so they survive a reload of the same
 * tab. A reload does not run React cleanup and the unload request is best-effort, so the next load
 * releases whatever the previous page still held; an editor that is still open takes it again.
 */
const KEY = 'nrcs-held-locks';

function read(): string[] {
  try {
    const value = JSON.parse(sessionStorage.getItem(KEY) || '[]');
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function write(ids: string[]) {
  try {
    if (ids.length) sessionStorage.setItem(KEY, JSON.stringify(ids));
    else sessionStorage.removeItem(KEY);
  } catch {
    // storage blocked: unload release and lock expiry still apply
  }
}

export function rememberHeldLock(id: string) {
  const ids = read();
  if (!ids.includes(id)) write([...ids, id]);
}

export function forgetHeldLock(id: string) {
  write(read().filter((x) => x !== id));
}

/** Locks left by the previous page in this tab; the list is cleared as it is read. */
export function takeOrphanedLocks(): string[] {
  const ids = read();
  write([]);
  return ids;
}
