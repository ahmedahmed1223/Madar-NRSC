import type { BulletinStory } from '../shared/bulletins';
import { newId } from '../shared/ids';
import type { Cue } from '../shared/onair';
import type { NewsroomDatabase } from './db';

export function cueBulletinExclusion(db: NewsroomDatabase, before: BulletinStory | null, after: BulletinStory, actor: { id: string; fullName: string }) {
  if (!before || before.killed || before.floated || !(after.killed || after.floated)) return;
  const state = db.getRow('onAir', after.bulletinId)?.d;
  if (state?.status !== 'LIVE') return;
  const isCurrent = state.currentSegmentId === after.id;
  const decision = after.killed ? 'استُبعدت' : 'أُجلت';
  const cue: Cue = {
    id: newId('cue'), episodeId: after.bulletinId, targetDepartmentIds: ['direction', 'control', 'studio', 'presenters'],
    message: isCurrent ? `${decision} «${after.slug}» من ترتيب البث. يبقى النص الحالي حتى الانتقال.` : `${decision} «${after.slug}» من ترتيب البث.`,
    level: isCurrent ? 'urgent' : 'standby', fromId: actor.id, fromName: actor.fullName,
    createdAt: new Date().toISOString(), acks: [],
  };
  db.writeRow('cues', cue.id, cue, db.positionBounds('cues').min - 1, actor.id);
}
