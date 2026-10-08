import crypto from 'crypto';
import type { NewsroomDatabase } from './db';
import type { AuthContext } from './auth';
import { canRead } from './policy';
import { findShow, approvalProgress } from '../shared/bulletins';
import { canControlOnAir } from '../shared/onair';
import { offlineAirPacketSchema, type OfflineAirPacket } from '../shared/offlineAir';

export class OfflineAirError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const fail = (status: number, message: string): never => { throw new OfflineAirError(status, message); };
const identity = (packet: Pick<OfflineAirPacket, 'packetId' | 'dbId' | 'userId' | 'preparedAt'> & { show: { id: string } }) =>
  JSON.stringify(['offline-air-v1', packet.packetId, packet.dbId, packet.userId, packet.show.id, packet.preparedAt]);
function signingKey(db: NewsroomDatabase): string {
  let key = db.getMeta('offline_air_signing_key');
  if (!key) { key = crypto.randomBytes(32).toString('hex'); db.setMeta('offline_air_signing_key', key); }
  return key;
}
export function verifyOfflinePacketProof(db: NewsroomDatabase, userId: string, packet: OfflineAirPacket, now = Date.now()): boolean {
  if (packet.dbId !== db.dbId || packet.userId !== userId) return false;
  const prepared = Date.parse(packet.preparedAt);
  if (!Number.isFinite(prepared) || prepared > now + 60000 || now - prepared > 30 * 86400000) return false;
  const key = db.getMeta('offline_air_signing_key');
  if (!key || typeof packet.proof !== 'string') return false;
  const expected = crypto.createHmac('sha256', key).update(identity(packet)).digest('hex');
  const actual = Buffer.from(packet.proof);
  const bytes = Buffer.from(expected);
  return actual.length === bytes.length && crypto.timingSafeEqual(actual, bytes);
}
export function prepareOfflinePacket(db: NewsroomDatabase, auth: AuthContext, showId: string, shellVersion: string): OfflineAirPacket {
  const episode = db.getRow('episodes', showId);
  const bulletin = episode ? null : db.getRow('bulletins', showId);
  const parent = episode || bulletin;
  if (!parent || parent.d.deletedAt) return fail(404, 'الحلقة أو النشرة غير موجودة');
  if (!canRead(auth, parent.c, parent.d)) return fail(403, 'لا تملك صلاحية قراءة الحلقة');
  const stories = bulletin ? db.listCollection('bulletinStories').filter(row => row.d.bulletinId === showId && !row.d.deletedAt) : [];
  if (stories.some(row => !canRead(auth, 'bulletinStories', row.d))) return fail(403, 'لا يمكن تجهيز نسخة جزئية من النشرة');
  const show = findShow(showId, collection => db.listCollection(collection).map(row => row.d));
  if (!show?.rundown?.length) return fail(400, 'لا توجد فقرات لتجهيزها');
  const canEdit = bulletin ? auth.can('bulletins.edit') || auth.can('bulletins.manage') || auth.can('bulletins.approve') : auth.can('episodes.edit') || auth.can('rundown.edit');
  const packet: OfflineAirPacket = {
    version: 1, packetId: crypto.randomUUID(), dbId: db.dbId, userId: auth.user.id,
    preparedAt: new Date().toISOString(), shellVersion, proof: 'pending',
    show: { id: show.id, title: show.title, segments: show.rundown.map((segment: any) => {
      const story = stories.find(row => row.id === segment.id)?.d;
      const approved = bulletin ? story?.status === 'APPROVED' && !approvalProgress(bulletin.d, story).next : true;
      return {
        id: segment.id, title: segment.title || '', script: approved ? segment.scriptText || segment.script || '' : '',
        durationSeconds: Math.max(0, Number(segment.durationSeconds) || 0), notes: segment.notes || '', approved,
      };
    }) },
    baseRows: [{ collection: parent.c as 'episodes' | 'bulletins', id: parent.id, v: parent.v, ...(parent.d.updatedAt ? { updatedAt: parent.d.updatedAt } : {}) },
      ...(bulletin ? stories.filter(row => show.rundown.some((segment: any) => segment.id === row.id)).map(row => ({ collection: 'bulletinStories' as const, id: row.id, segmentId: row.id, v: row.v, ...(row.d.updatedAt ? { updatedAt: row.d.updatedAt } : {}) })) : show.rundown.map((segment: any) => ({ collection: 'episodes' as const, id: parent.id, segmentId: segment.id, v: parent.v })))],
    confirmedState: db.getRow('onAir', showId)?.d || null,
    canOperate: canControlOnAir(auth.user, auth.can),
    canEdit: !!db.getRow('settings', 'singleton')?.d.allowOfflineScriptEdits && canEdit,
  };
  packet.proof = crypto.createHmac('sha256', signingKey(db)).update(identity(packet)).digest('hex');
  return offlineAirPacketSchema.parse(packet);
}
