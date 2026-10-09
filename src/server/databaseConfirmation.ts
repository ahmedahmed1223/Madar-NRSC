import crypto from 'node:crypto';

export interface DatabaseConfirmationBinding {
  actorId: string; sessionId: string; action: 'restore' | 'reset'; sha256?: string;
}
export class DatabaseConfirmations {
  private entries = new Map<string, { binding: DatabaseConfirmationBinding; expires: number }>();
  issue(binding: DatabaseConfirmationBinding, now = Date.now()) {
    for (const [key, entry] of this.entries) if (entry.expires <= now) this.entries.delete(key);
    if (this.entries.size >= 1000) throw new Error('Confirmation capacity reached');
    const token = crypto.randomBytes(32).toString('base64url');
    const expires = now + 120000;
    this.entries.set(token, { binding: { ...binding }, expires });
    return { token, expiresAt: new Date(expires).toISOString() };
  }
  consume(token: string, binding: DatabaseConfirmationBinding, now = Date.now()): boolean {
    const entry = this.entries.get(token);
    if (!entry) return false;
    if (entry.expires <= now) { this.entries.delete(token); return false; }
    if (entry.binding.actorId !== binding.actorId || entry.binding.sessionId !== binding.sessionId ||
      entry.binding.action !== binding.action || entry.binding.sha256 !== binding.sha256) return false;
    this.entries.delete(token);
    return true;
  }
}

export class ConfirmationFailures {
  private failures = new Map<string, { count: number; until: number }>();
  blocked(keys: string[], now = Date.now()): boolean {
    for (const [key, entry] of this.failures) if (entry.until <= now) this.failures.delete(key);
    return keys.some(key => (this.failures.get(key)?.count ?? 0) >= 5);
  }
  record(keys: string[], now = Date.now()) {
    for (const key of keys) {
      const old = this.failures.get(key);
      this.failures.set(key, { count: (old && old.until > now ? old.count : 0) + 1,
        until: old && old.until > now ? old.until : now + 900000 });
    }
  }
}
