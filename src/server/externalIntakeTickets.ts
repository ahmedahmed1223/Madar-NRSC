import crypto from 'node:crypto';
import { bookingStatusOf, episodeGuestList, guestKey } from '../shared/episodePlan';
import type { Episode, User } from '../types';
import type { Bulletin, BulletinStory } from '../shared/bulletins';
import type { NewsroomDatabase } from './db';

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
const keyFor = (token: string) => PREFIX + crypto.createHash('sha256').update(token).digest('hex');

export function readIntakeTicket(db: NewsroomDatabase, token: unknown): { key: string; ticket: IntakeTicket } | null {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const key = keyFor(token);
  const raw = db.getMeta(key);
  const ticket: IntakeTicket | null = raw ? JSON.parse(raw) : null;
  return ticket && !ticket.usedAt && ticket.expiresAt > new Date().toISOString() ? { key, ticket } : null;
}

export function issueIntakeTicket(db: NewsroomDatabase, ticket: IntakeTicket) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.pruneExternalIntake(PREFIX, new Date().toISOString());
  db.setMeta(keyFor(token), JSON.stringify(ticket));
  return `/intake#${token}`;
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

export function intakeGuestTarget(db: NewsroomDatabase, subject: Pick<IntakeTicket, 'episodeId' | 'guestId' | 'bulletinStoryId'>) {
  return subject.bulletinStoryId ? bulletinIntakeTarget(db, subject.bulletinStoryId, subject.guestId)
    : guestIntakeTarget(db, subject.episodeId, subject.guestId);
}
