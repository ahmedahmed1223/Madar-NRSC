import express, { type Request } from 'express';
import { guestKey } from '../shared/episodePlan';
import { newId } from '../shared/ids';
import { MODULE_UNAVAILABLE } from '../shared/moduleAccess';
import type { Episode, Guest } from '../types';
import { buildAuthContext, requireAuth } from './auth';
import type { AppConfig } from './config';
import type { NewsroomDatabase, UploadRecord } from './db';
import { sendEmail } from './delivery';
import { guestTechnicalEmail } from './guestTechInvitations';
import { moduleAllowed } from './moduleAccess';
import { createRateLimiter } from './rateLimit';
import { changeBus } from './sync';
import { queueCopiesForUpload } from './storage';
import { ALLOWED_UPLOAD_TYPES, MEDIA_FILE_URL_PREFIX, receiveUpload, removeUpload, UploadError } from './uploads';
import { activeIntakeIssuer as activeUser, intakeGuestTarget, issueContributorDropLink, issueIntakeTicket as issue, readIntakeTicket as readTicket } from './externalIntakeTickets';

const uploadTypes = Object.fromEntries(Object.entries(ALLOWED_UPLOAD_TYPES).filter(([mime]) => /^(audio|video)\//.test(mime)));
const invalid = 'الرابط غير صالح أو انتهت صلاحيته.';

function mayIssueGuestCheck(req: Request, episode: Episode) {
  const auth = req.auth!;
  return auth.can('episodes.edit') || auth.can('programs.manage') || episode.producerId === auth.user.id && auth.can('episodes.view');
}

function mayRedeemDropLink(db: NewsroomDatabase, issuer: string) {
  const user = activeUser(db, issuer);
  if (!user) return false;
  const auth = buildAuthContext(db, user, 'external-intake');
  return moduleAllowed(auth, 'media') && auth.can('media.upload');
}

export function externalIntakeRouter(db: NewsroomDatabase, config: AppConfig) {
  const router = express.Router();
  const uploading = new Set<string>();
  const maxUpload = Math.min(config.mediaMaxUploadBytes, 256 * 1024 * 1024);
  const denied = (res: express.Response) => res.status(410).json({ success: false, error: invalid });
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

  router.post('/links', requireAuth, createRateLimiter({ windowMs: 60_000, max: 10, key: req => req.auth!.user.id,
    message: 'انتظر دقيقة قبل إنشاء روابط أخرى.' }), async (req, res) => {
    const kind = req.body.kind;
    const auth = req.auth!;
    if (kind === 'upload') {
      if (!moduleAllowed(auth, 'media')) return res.status(403).json({ success: false, error: MODULE_UNAVAILABLE });
      if (!auth.can('media.upload')) return res.status(403).json({ success: false, error: 'صلاحية رفع الوسائط مطلوبة.' });
      const issued = issueContributorDropLink(db, auth.user.id);
      if (issued.status === 'paused') {
        return res.status(403).json({ success: false, error: 'إنشاء روابط الرفع الخارجي متوقف في الإعدادات.' });
      }
      if (issued.status === 'limited') {
        res.setHeader('Retry-After', String(issued.retryAfter));
        return res.status(429).json({ success: false, code: 'RATE_LIMITED', error: 'بلغت الحد اليومي لروابط الرفع الخارجي.' });
      }
      return res.json({ success: true, data: { path: issued.path, expiresAt: issued.expiresAt } });
    }
    const { episodeId, bulletinStoryId, guestId, email } = req.body;
    const subject = {
      episodeId: typeof episodeId === 'string' ? episodeId : undefined,
      bulletinStoryId: typeof bulletinStoryId === 'string' ? bulletinStoryId : undefined,
      guestId: typeof guestId === 'string' ? guestId : undefined,
    };
    const target = kind === 'guest' && subject.guestId ? intakeGuestTarget(db, { ...subject, issuer: auth.user.id }) : null;
    const canInvite = target?.kind === 'episode' ? mayIssueGuestCheck(req, target.episode)
      : target?.kind === 'bulletin' && (auth.can('bulletins.manage') || auth.can('bulletins.edit') && [target.bulletin.editorId, target.story.writerId].includes(auth.user.id));
    if (!target || !canInvite) return res.status(404).json({ success: false, error: 'اختر ضيفًا مؤكدًا يشارك عبر الإنترنت.' });
    const address = (db.getRow('guests', guestId)?.d as Guest | undefined)?.email?.trim();
    if (email === true && (!config.mail || !config.appUrl || !address)) return res.status(400).json({ success: false, error: 'أضف بريد الضيف واضبط البريد وعنوان مدار لإرسال الرابط.' });
    const expiresAt = new Date(Date.now() + 12 * 3600_000).toISOString();
    const path = issue(db, { kind, issuer: auth.user.id, ...subject, expiresAt });
    if (email === true) {
      try { await sendEmail(config, address!, guestTechnicalEmail(config.appUrl!, path)); }
      catch { return res.status(502).json({ success: false, error: 'تعذر الإرسال بالبريد. أنشئ رابطًا لنسخه.', data: { path, expiresAt } }); }
    }
    return res.json({ success: true, data: { path, expiresAt, emailed: email === true } });
  });

  router.post('/info', (req, res) => {
    const found = readTicket(db, req.body.token);
    if (!found) return denied(res);
    const { ticket } = found;
    const valid = ticket.kind === 'upload' ? mayRedeemDropLink(db, ticket.issuer)
      : activeUser(db, ticket.issuer) && intakeGuestTarget(db, ticket);
    if (!valid) return denied(res);
    return res.json({ success: true, data: { kind: ticket.kind, expiresAt: ticket.expiresAt, maxUpload } });
  });

  router.post('/upload', async (req, res) => {
    const found = readTicket(db, req.get('X-Madar-Intake'));
    if (!found || found.ticket.kind !== 'upload' || uploading.has(found.key)) {
      req.resume();
      return denied(res);
    }
    const permitted = () => mayRedeemDropLink(db, found.ticket.issuer);
    if (!permitted()) { req.resume(); return denied(res); }
    uploading.add(found.key);
    let upload: UploadRecord | undefined;
    try {
      upload = await receiveUpload(req, db, config.dataDir, maxUpload, found.ticket.issuer, { allowed: uploadTypes });
      const savedUpload = upload;
      const id = newId('media');
      const recorded = db.transaction(() => {
        if (!readTicket(db, req.get('X-Madar-Intake'), true) || !permitted()) return false;
        const now = new Date().toISOString();
        const mediaType = savedUpload.mimeType.startsWith('audio/') ? 'AUDIO' : 'VIDEO';
        db.writeRow('media', id, {
          id, title: savedUpload.originalName, fileName: savedUpload.originalName, mediaType, mimeType: savedUpload.mimeType,
          fileSize: savedUpload.sizeBytes, url: `${MEDIA_FILE_URL_PREFIX}${savedUpload.id}`, tags: ['رفع خارجي'],
          ownerId: found.ticket.issuer, uploadedById: found.ticket.issuer, uploadedAt: now, createdAt: now,
          rights: { status: 'UNKNOWN' },
          ...(mediaType === 'VIDEO' && { videoStatus: 'RAW' }),
        }, db.positionBounds('media').min - 1, found.ticket.issuer);
        queueCopiesForUpload(db, savedUpload);
        db.setMeta(found.key, JSON.stringify({ ...found.ticket, usedAt: now }));
        return true;
      });
      if (!recorded) {
        removeUpload(db, config.dataDir, upload.id);
        upload = undefined;
        return denied(res);
      }
      upload = undefined;
      changeBus.emit('rev', db.currentRev());
      return res.status(201).json({ success: true });
    } catch (error) {
      if (upload) removeUpload(db, config.dataDir, upload.id);
      return res.status(error instanceof UploadError ? error.status : 500).json({
        success: false, error: error instanceof UploadError ? error.message : 'تعذر استلام الملف.',
      });
    } finally { uploading.delete(found.key); }
  });

  router.post('/speed', express.raw({ type: 'application/octet-stream', limit: '256kb' }), (req, res) => {
    const found = readTicket(db, req.get('X-Madar-Intake'));
    if (!found || found.ticket.kind !== 'guest' || !intakeGuestTarget(db, found.ticket)) return denied(res);
    return Buffer.isBuffer(req.body) ? res.json({ success: true, bytes: req.body.length }) : res.status(400).json({ success: false });
  });

  router.post('/guest-result', (req, res) => {
    const found = readTicket(db, req.body.token);
    if (!found || found.ticket.kind !== 'guest' || !activeUser(db, found.ticket.issuer)) return denied(res);
    const target = intakeGuestTarget(db, found.ticket);
    if (!target) return denied(res);
    const { camera, microphone, light, uploadMbps } = req.body;
    if ([camera, microphone, light].some(value => typeof value !== 'boolean') ||
      typeof uploadMbps !== 'number' || !Number.isFinite(uploadMbps) || uploadMbps < 0 || uploadMbps > 10_000) {
      return res.status(400).json({ success: false, error: 'نتيجة الفحص غير صالحة.' });
    }
    const now = new Date().toISOString();
    const ready = camera && microphone && light && uploadMbps >= 2;
    const status = ready ? 'PASSED' : 'FAILED';
    const note = `فحص ذاتي. الكاميرا ${camera ? 'تعمل' : 'تحتاج فحصًا'}، الميكروفون ${microphone ? 'يعمل' : 'يحتاج فحصًا'}، الإضاءة ${light ? 'كافية' : 'ضعيفة'}، الرفع ${uploadMbps.toFixed(1)} Mbps.`;
    db.transaction(() => {
      if (target.kind === 'episode') {
        const guests = (target.episode.guests || []).map(guest => guestKey(guest) === found.ticket.guestId ? {
          ...guest, technicalCheckStatus: status, technicalCheckAt: now, technicalCheckNote: note,
        } : guest);
        db.writeRow('episodes', target.row.id, { ...target.episode, guests, updatedAt: now }, target.row.p, null);
      } else {
        const remoteGuest = { ...target.story.remoteGuest, check: { status, at: now, note } };
        db.writeRow('bulletinStories', target.row.id, { ...target.story, remoteGuest, updatedAt: now }, target.row.p, null);
      }
      db.setMeta(found.key, JSON.stringify({ ...found.ticket, usedAt: now }));
    });
    changeBus.emit('rev', db.currentRev());
    return res.json({ success: true, ready });
  });
  return router;
}
