import crypto from 'node:crypto';
import { SINGLETON_ID } from '../shared/collections';
import { contributorDropLinkSettings } from '../shared/contributorDropLinkSettings';
import { bookingStatusOf, episodeGuestList, guestKey } from '../shared/episodePlan';
import type { Episode, User } from '../types';
import type { Bulletin, BulletinStory } from '../shared/bulletins';
import type { NewsroomDatabase } from './db';
import { moduleAllowedForUser } from './moduleAccess';

export type IntakeTicket = {
  kind: 'upload' | 'guest';
  issuer: string;
  expiresAt: string;
  usedAt?: string;
  episodeId?: string;
  bulletinStoryId?: string;
  guestId?: string;
};

const PREFIX = 'external_intake:';
const DROP_LINK_ISSUANCE_PREFIX = 'contributor_drop_link_issuance:';
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const keyFor = (token: string) => PREFIX + crypto.createHash('sha256').update(token).digest('hex');

export function readIntakeTicket(db: NewsroomDatabase, token: unknown, lock = false): { key: string; ticket: IntakeTicket } | null {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const key = keyFor(token);
  const raw = lock ? db.lockMeta(key) : db.getMeta(key);
  const ticket: IntakeTicket | null = raw ? JSON.parse(raw) : null;
  return ticket && !ticket.usedAt && ticket.expiresAt > new Date().toISOString() ? { key, ticket } : null;
}

export function issueIntakeTicket(db: NewsroomDatabase, ticket: IntakeTicket) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.pruneExternalIntake(PREFIX, new Date().toISOString());
  db.setMeta(keyFor(token), JSON.stringify(ticket));
  return `/intake#${token}`;
}

export function issueContributorDropLink(db: NewsroomDatabase, issuer: string) {
  const { dailyLimit, expiryHours } = contributorDropLinkSettings(db.getRow('settings', SINGLETON_ID)?.d);
  if (!dailyLimit) return { status: 'paused' as const };
  return db.transaction(() => {
    const key = DROP_LINK_ISSUANCE_PREFIX + issuer;
    const timestamps: number[] = JSON.parse(db.lockMeta(key, '[]') ?? '[]');
    const now = Date.now();
    const recent = timestamps.filter(at => at > now - DAY_MS).sort((left, right) => left - right);
    if (recent.length >= dailyLimit) {
      const availableAt = recent[recent.length - dailyLimit] + DAY_MS;
      return { status: 'limited' as const, retryAfter: Math.ceil((availableAt - now) / 1000) };
    }
    const expiresAt = new Date(now + expiryHours * HOUR_MS).toISOString();
    const path = issueIntakeTicket(db, { kind: 'upload', issuer, expiresAt });
    db.setMeta(key, JSON.stringify([...recent, now]));
    return { status: 'issued' as const, path, expiresAt };
  });
}

export function activeIntakeIssuer(db: NewsroomDatabase, id: string) {
  const user = db.getRow('users', id)?.d as User | undefined;
  return user && user.isActive !== false && !user.deletedAt ? user : undefined;
}

export function guestIntakeTarget(db: NewsroomDatabase, episodeId?: string, guestId?: string) {
  const row = episodeId ? db.getRow('episodes', episodeId) : null;
  const episode = row?.d as Episode | undefined;
  if (!episode || episode.deletedAt || ['CANCELLED', 'BROADCASTED', 'ARCHIVED'].includes(episode.status)) return null;
  const guest = episodeGuestList(episode).find(item => guestKey(item) === guestId);
  if (!guest || guest.connectionType !== 'ZOOM_SKYPE' || !['CONFIRMED', 'ARRIVED'].includes(bookingStatusOf(guest))) return null;
  return { kind: 'episode' as const, row: row!, episode, guest };
}

export function bulletinIntakeTarget(db: NewsroomDatabase, storyId?: string, guestId?: string) {
  const row = storyId ? db.getRow('bulletinStories', storyId) : null;
  const story = row?.d as BulletinStory | undefined;
  if (!story || story.deletedAt || story.killed || story.floated || !story.remoteGuest?.confirmed || story.remoteGuest.guestId !== guestId) return null;
  const bulletin = db.getRow('bulletins', story.bulletinId)?.d as Bulletin | undefined;
  return bulletin && !bulletin.deletedAt && bulletin.status !== 'DONE' ? { kind: 'bulletin' as const, row: row!, story, bulletin } : null;
}

export function intakeGuestTarget(db: NewsroomDatabase, subject: Pick<IntakeTicket, 'issuer' | 'episodeId' | 'guestId' | 'bulletinStoryId'>) {
  if (subject.bulletinStoryId) return moduleAllowedForUser(db, 'bulletins', subject.issuer) ? bulletinIntakeTarget(db, subject.bulletinStoryId, subject.guestId) : null;
  if (!moduleAllowedForUser(db, 'programmes', subject.issuer)) return null;
  return guestIntakeTarget(db, subject.episodeId, subject.guestId);
}
