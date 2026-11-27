import { createHash } from 'node:crypto';
import { findShow } from '../shared/bulletins';
import type { CollectionName } from '../shared/collections';
import { isPresenterAccount, PRESENTER_INSTRUCTION_MS, type Cue, type OnAirState } from '../shared/onair';
import { prompterScriptRevision } from '../shared/prompterControls';
import type { AuthContext } from './auth';
import type { NewsroomDatabase } from './db';
import { canRead } from './policy';
import { changeBus } from './sync';

/** A correction is reported from the reading device and addressed by the server to the live operator. */
export function reportPrompterCorrection(
  db: NewsroomDatabase, auth: AuthContext, showId: string, segmentId: unknown, revision: unknown,
): { id: string } | { status: number; message: string } {
  if (!isPresenterAccount(auth.user)) return { status: 403, message: 'تنبيه تصحيح التلقين من حساب المذيع' };
  if (typeof segmentId !== 'string' || !segmentId || segmentId.length > 120 ||
    typeof revision !== 'string' || !/^\d{1,7}-[a-z0-9]{1,7}$/.test(revision)) return { status: 400, message: 'بيانات نسخة التلقين غير صالحة' };
  const lookup = (collection: CollectionName, id: string) => db.getRow(collection, id)?.d;
  const live = lookup('onAir', showId) as OnAirState | undefined;
  if (!live || !canRead(auth, 'onAir', live, lookup)) return { status: 404, message: 'البث غير متاح' };
  const episode = db.getRow('episodes', showId);
  const bulletin = db.getRow('bulletins', showId);
  const showRow = episode || bulletin;
  if (!showRow || !canRead(auth, episode ? 'episodes' : 'bulletins', showRow.d, lookup)) return { status: 404, message: 'البث غير متاح' };
  if (live.status !== 'LIVE' || live.currentSegmentId !== segmentId) return { status: 409, message: 'تغيّرت المادة الحالية على الهواء' };

  const show = findShow(showId, collection => db.listCollection(collection).map(row => row.d));
  const segment = show?.rundown.find(item => item.id === segmentId);
  const script = segment?.scriptText || segment?.script || '';
  if (!segment || typeof script !== 'string' || prompterScriptRevision(script) !== revision) return { status: 409, message: 'تغيّرت نسخة نص التلقين' };

  const story = bulletin ? db.getRow('bulletinStories', segmentId) : null;
  const sourceVersion = story?.v ?? showRow.v;
  const key = createHash('sha256').update(JSON.stringify([showId, segmentId, live.segmentStartedAt, sourceVersion, revision])).digest('hex').slice(0, 24);
  const id = `cue-prompter-${key}`;
  let created = false;
  db.transaction(() => {
    if (db.getRow('cues', id)) return;
    const cue: Cue = {
      id,
      episodeId: showId,
      purpose: 'PROMPTER_CORRECTION',
      targetDepartmentIds: ['direction', 'control'],
      targetUserId: live.operatorId !== auth.user.id ? live.operatorId : undefined,
      message: `صُحّح جزء قُرئ من «${String(segment.title || 'المادة الحالية').slice(0, 80)}». أبلغ المذيع بالتصحيح عبر السماعة.`,
      level: 'urgent',
      fromId: auth.user.id,
      fromName: auth.user.fullName,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + PRESENTER_INSTRUCTION_MS).toISOString(),
      acks: [],
    };
    db.writeRow('cues', id, cue, db.positionBounds('cues').min - 1, auth.user.id);
    created = true;
  });
  if (created) changeBus.emit('rev', db.currentRev());
  return { id };
}
