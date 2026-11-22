import crypto from 'node:crypto';
import { stationTimeZone } from '../shared/dates';
import { episodeGuestList, guestKey } from '../shared/episodePlan';
import { secondsUntilStart } from '../shared/stationTime';
import type { Episode, Guest, Program } from '../types';
import type { Bulletin, BulletinStory } from '../shared/bulletins';
import type { AppConfig } from './config';
import type { NewsroomDatabase } from './db';
import { sendEmail } from './delivery';
import { activeIntakeIssuer, bulletinIntakeTarget, guestIntakeTarget, issueIntakeTicket, type IntakeTicket } from './externalIntakeTickets';

export function guestTechnicalEmail(appUrl: string, path: string) {
  const url = new URL(path, appUrl).href;
  const safe = url.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
  const subject = 'مدار — فحص تقني قبل البث';
  const instructions = 'افتح الرابط قبل موعد البث لفحص الكاميرا والميكروفون والاتصال والإضاءة.';
  return { subject, text: `${instructions}\n${url}`, html: `<p dir="rtl">${instructions}</p><p dir="rtl"><a href="${safe}">بدء الفحص التقني</a></p>` };
}

type Candidate = Pick<IntakeTicket, 'episodeId' | 'bulletinStoryId' | 'issuer'> & {
  guestId: string;
  date: string;
  startTime: string;
};

function upcomingGuestChecks(db: NewsroomDatabase, now: number, zone?: string): Candidate[] {
  const soon = (date: string, startTime: string) => {
    const remaining = secondsUntilStart(date, startTime, now, zone);
    return remaining !== null && remaining > 0 && remaining <= 30 * 60;
  };
  const candidates: Candidate[] = [];
  for (const { d } of db.listCollection('episodes')) {
    const episode = d as Episode;
    if (!soon(episode.broadcastDate, episode.startTime)) continue;
    const program = db.getRow('programs', episode.programId)?.d as Program | undefined;
    const issuer = episode.producerId || program?.producerId;
    if (!issuer || !activeIntakeIssuer(db, issuer)) continue;
    for (const guest of episodeGuestList(episode)) {
      const id = guestKey(guest);
      if (guest.technicalCheckStatus !== 'PASSED' && guestIntakeTarget(db, episode.id, id)) {
        candidates.push({ issuer, episodeId: episode.id, guestId: id, date: episode.broadcastDate, startTime: episode.startTime });
      }
    }
  }
  const bulletins = new Map((db.listCollection('bulletins').map(row => row.d) as Bulletin[])
    .filter(bulletin => !bulletin.deletedAt && bulletin.status !== 'DONE' && soon(bulletin.date, bulletin.startTime))
    .map(bulletin => [bulletin.id, bulletin]));
  if (bulletins.size) for (const { d } of db.listCollection('bulletinStories')) {
    const story = d as BulletinStory;
    const bulletin = bulletins.get(story.bulletinId);
    const slot = story.remoteGuest;
    if (bulletin?.editorId && activeIntakeIssuer(db, bulletin.editorId) && slot && slot.check?.status !== 'PASSED' && bulletinIntakeTarget(db, story.id, slot.guestId)) {
      candidates.push({ issuer: bulletin.editorId, bulletinStoryId: story.id, guestId: slot.guestId, date: bulletin.date, startTime: bulletin.startTime });
    }
  }
  return candidates;
}

export async function sendDueGuestTechnicalInvitations(db: NewsroomDatabase, config: AppConfig, now = Date.now(), deliver = sendEmail) {
  if (!config.autoGuestTechnicalEmail || !config.mail || !config.appUrl) return 0;
  const zone = stationTimeZone(db.getRow('settings', 'singleton')?.d?.defaultTimezone);
  let sent = 0;
  for (const { issuer, episodeId, bulletinStoryId, guestId, date, startTime } of upcomingGuestChecks(db, now, zone)) {
    const address = (db.getRow('guests', guestId)?.d as Guest | undefined)?.email?.trim();
    if (!address) continue;
    const hash = crypto.createHash('sha256').update(JSON.stringify([episodeId, bulletinStoryId, guestId, date, startTime])).digest('hex');
    const key = `guest_intake_invite:${hash}`;
    const prior = db.getMeta(key);
    const attempt = prior ? JSON.parse(prior) : null;
    if (attempt?.sent || Number(attempt?.attemptedAt) > now - 5 * 60_000) continue;
    const expiry = new Date(now + 12 * 3600_000).toISOString();
    const path = issueIntakeTicket(db, { kind: 'guest', issuer, episodeId, bulletinStoryId, guestId, expiresAt: expiry });
    db.setMeta(key, JSON.stringify({ sent: false, attemptedAt: now, expiresAt: expiry }));
    try {
      await deliver(config, address, guestTechnicalEmail(config.appUrl, path));
      db.setMeta(key, JSON.stringify({ sent: true, attemptedAt: now, expiresAt: expiry }));
      sent++;
    } catch {
      // Retry after the attempt window without exposing guest contact details in logs.
    }
  }
  db.pruneExternalIntake('guest_intake_invite:', new Date(now).toISOString());
  return sent;
}
