import { CURRENT_VERSION } from '../content/whatsNew';

const key = (userId: string) => `nrcs-whatsnew-seen:${userId}`;
export const WHATS_NEW_SEEN_EVENT = 'nrcs-whatsnew-seen';

/** Whether this user has opened the notes of the current version on this device. */
export function hasSeenWhatsNew(userId: string): boolean {
  try {
    return localStorage.getItem(key(userId)) === CURRENT_VERSION;
  } catch {
    return true;
  }
}

export function markWhatsNewSeen(userId: string) {
  try {
    localStorage.setItem(key(userId), CURRENT_VERSION);
  } catch {
    // storage unavailable: the badge simply stays
  }
  window.dispatchEvent(new Event(WHATS_NEW_SEEN_EVENT));
}
