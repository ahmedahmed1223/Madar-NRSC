/**
 * Password rules shared by the server (which enforces them) and every form that sets a password
 * (user form, quick setup, temporary passwords), so a form never accepts what the server refuses.
 */

export const MIN_PASSWORD_LENGTH = 10;

export function validatePasswordStrength(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return `كلمة المرور يجب ألا تقل عن ${MIN_PASSWORD_LENGTH} أحرف`;
  }
  if (password.length > 200) return 'كلمة المرور طويلة جداً';
  if (!/[A-Za-z؀-ۿ]/.test(password) || !/\d/.test(password)) {
    return 'كلمة المرور يجب أن تحتوي على حروف وأرقام';
  }
  return null;
}

/** Letters and digits that cannot be mistaken for one another when read aloud or copied by hand (no I l 1 O 0 o). */
export const UNAMBIGUOUS_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
export const UNAMBIGUOUS_DIGITS = '23456789';

/**
 * A temporary password: 12 characters from the unambiguous set, always with letters and digits.
 * `random(n)` returns n random 32-bit integers (crypto.getRandomValues in the browser, crypto.randomInt on the server).
 */
export function temporaryPassword(random: (n: number) => ArrayLike<number>): string {
  const pick = (set: string, n: number) => Array.from(random(n), (v) => set[v % set.length]).join('');
  return `${pick(UNAMBIGUOUS_LETTERS, 4)}${pick(UNAMBIGUOUS_DIGITS, 2)}${pick(UNAMBIGUOUS_LETTERS, 4)}${pick(UNAMBIGUOUS_DIGITS, 2)}`;
}

/** Browser/Node Web Crypto source for temporaryPassword. */
export const webRandom = (n: number) => globalThis.crypto.getRandomValues(new Uint32Array(n));
