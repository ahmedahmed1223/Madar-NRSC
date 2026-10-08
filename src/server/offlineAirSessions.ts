import crypto from 'crypto';
import { z } from 'zod';
import type { NewsroomDatabase } from './db';
import type { AuthContext } from './auth';
import { canControlOnAir } from '../shared/onair';
import { OfflineAirError, verifyOfflinePacketProof } from './offlineAir';
import type { OfflineAirPacket } from '../shared/offlineAir';
const id = z.string().min(1).max(200);
const schema = z.object({ sessionId: id, packetId: id, dbId: id, showId: id, preparedAt: z.iso.datetime(), proof: z.string().regex(/^[a-f0-9]{64}$/), events: z.array(z.object({ id, sequence: z.number().int().positive(), action: z.enum(['START','NEXT','PREVIOUS','PAUSE','RESUME','END']), at: z.number().int().nonnegative(), segmentId: id })).min(1).max(2000) });
export function importOfflineSession(db: NewsroomDatabase, auth: AuthContext, body: unknown) {
  if (!canControlOnAir(auth.user, auth.can)) throw new OfflineAirError(403, 'صلاحياتك الحالية لا تسمح باستيراد سجل التشغيل');
  if (Buffer.byteLength(JSON.stringify(body) || '') > 1024 * 1024) throw new OfflineAirError(413, 'السجل أكبر من الحد المسموح');
  const result = schema.safeParse(body);
  if (!result.success) throw new OfflineAirError(400, 'صيغة السجل المحلي غير صالحة');
  const value = result.data;
  const proofPacket = { ...value, userId: auth.user.id, show: { id: value.showId } } as unknown as OfflineAirPacket;
  if (!verifyOfflinePacketProof(db, auth.user.id, proofPacket)) throw new OfflineAirError(403, 'هوية النسخة أو توقيعها أو عمرها غير صالح');
  let state = 'READY'; let lastTime = Date.parse(value.preparedAt) - 120000;
  const ids = new Set<string>();
  for (const [index, event] of value.events.entries()) {
    if (event.sequence !== index + 1 || ids.has(event.id) || event.at < lastTime || event.at > Date.now() + 60000 || state === 'ENDED') throw new OfflineAirError(400, 'ترتيب سجل التشغيل غير صالح');
    ids.add(event.id); lastTime = event.at;
    if (event.action === 'START') { if (state !== 'READY') throw new OfflineAirError(400, 'بداية مكررة'); state = 'RUNNING'; }
    else if (state === 'READY') throw new OfflineAirError(400, 'السجل لم يبدأ');
    else if (event.action === 'PAUSE') { if (state !== 'RUNNING') throw new OfflineAirError(400, 'إيقاف غير صالح'); state = 'PAUSED'; }
    else if (event.action === 'RESUME') { if (state !== 'PAUSED') throw new OfflineAirError(400, 'استئناف غير صالح'); state = 'RUNNING'; }
    else if (event.action === 'END') state = 'ENDED';
  }
  const hash = crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const existing = db.getRow('offlineAirSessions', value.sessionId, true);
  if (existing) {
    if (existing.d.contentHash !== hash || existing.d.actorId !== auth.user.id) throw new OfflineAirError(409, 'معرّف السجل مستخدم بمحتوى مختلف');
    return existing.d;
  }
  const record = { ...value, id: value.sessionId, origin: 'OFFLINE', actorId: auth.user.id, actorName: auth.user.fullName, importedAt: new Date().toISOString(), contentHash: hash };
  db.writeRow('offlineAirSessions', record.id, record, Date.now(), auth.user.id);
  return record;
}
