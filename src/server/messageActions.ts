import { createHash } from 'node:crypto';
import path from 'node:path';
import { Router } from 'express';
import { requireAuth, requirePermission, type AuthContext } from './auth';
import { canRead } from './policy';
import { moduleAllowed, requireModule } from './moduleAccess';
import { MODULE_UNAVAILABLE } from '../shared/moduleAccess';
import { sendStoredFile } from './storage';
import type { NewsroomDatabase } from './db';
import type { AppConfig } from './config';
import { assignedWorkOnly } from '../shared/assignedWork';
import { canReadMessage, isInlineChatType, type ChatMessage } from '../shared/chat';
import {
  messageActionOrigin, messageWorkMediaIds, MESSAGE_MEDIA_URL_PREFIX,
  type MessageActionContext, type MessageActionOrigin, type MessageWork, type MessageWorkCollection, type PrivateMessageMedia,
} from '../shared/messageActions';

const actionPermissions = { news: 'news.create', card: 'cards.manage', request: 'requests.create', library: 'media.upload' };
const workCollections = { news: 'news', card: 'productionCards', request: 'requests' } as const;
type Action = keyof typeof actionPermissions;
type HttpErrorClass = new (status: number, message: string, code?: string) => Error;
type WorkWithAttachments = {
  messageOrigin?: MessageActionOrigin;
  mediaIds?: string[];
  sourceMediaIds?: string[];
  deletedAt?: string | null;
};

export function readableActionMessage(db: NewsroomDatabase, auth: AuthContext, id: unknown): ChatMessage | undefined {
  if (assignedWorkOnly(auth.can) || typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) return undefined;
  const message = db.getRow('messages', id)?.d;
  return message && !message.deletedAt && canReadMessage(message, auth.user.id) ? message : undefined;
}

function privateReferenceId(userId: string, messageId: string, uploadId: string, work?: MessageWork): string {
  const identity = work ? [userId, messageId, uploadId, work.collection, work.id] : [userId, messageId, uploadId];
  return `msgmedia-${createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 36)}`;
}

export function publishMessageWorkAttachments(db: NewsroomDatabase, collection: MessageWorkCollection, id: string,
  before: WorkWithAttachments | null, work: WorkWithAttachments, auth: AuthContext) {
  if (!work.messageOrigin || work.deletedAt) return;
  const previous = new Set(messageWorkMediaIds(collection, before ?? undefined));
  for (const mediaId of new Set(messageWorkMediaIds(collection, work))) {
    if (typeof mediaId !== 'string' || !mediaId.startsWith('msgmedia-') || previous.has(mediaId)) continue;
    const asset = db.getRow('media', mediaId);
    const reference = asset?.d?.privateMessageMedia as PrivateMessageMedia | undefined;
    if (!asset || asset.d.deletedAt || asset.d.ownerId !== auth.user.id || !reference || reference.messageId !== work.messageOrigin.messageId) continue;
    if (reference.work?.id !== id || reference.work.collection !== collection) continue;
    // The attachment becomes visible to the destination readers with the confirmed work update.
    db.writeRow('media', asset.id, asset.d, asset.p, auth.user.id);
  }
}

export function messageActionsRouter(db: NewsroomDatabase, config: AppConfig, changed: () => void, HttpError: HttpErrorClass) {
  const router = Router();

  router.post('/messages/:id', requireAuth, requireModule('messaging'), (req, res) => {
    const auth = req.auth!;
    const { action, includeAttachments, workId } = req.body ?? {};
    if (typeof action !== 'string' || !Object.hasOwn(actionPermissions, action) || typeof includeAttachments !== 'boolean') throw new HttpError(400, 'إجراء الرسالة غير صالح');
    const destination = action === 'card' ? 'assignments' : action === 'news' ? 'news' : action === 'request' ? 'requests' : 'media';
    if (!moduleAllowed(auth, destination) || (destination === 'assignments' && auth.moduleAllowsNewWork?.('assignments') === false)) {
      throw new HttpError(403, MODULE_UNAVAILABLE);
    }
    if (!auth.can(actionPermissions[action as Action])) throw new HttpError(403, 'صلاحياتك لا تسمح بهذا الإجراء');
    if (includeAttachments && (!auth.can('media.upload') || !auth.can('media.view'))) throw new HttpError(403, 'صلاحياتك لا تسمح بحفظ مرفقات الرسالة في المكتبة');
    const message = readableActionMessage(db, auth, req.params.id);
    if (!message) throw new HttpError(404, 'الرسالة غير متاحة');
    let work: MessageWork | undefined;
    if (includeAttachments && action !== 'library') {
      if (typeof workId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(workId)) throw new HttpError(400, 'معرّف مسودة العمل غير صالح');
      work = { collection: workCollections[action as keyof typeof workCollections], id: workId };
    }
    const text = message.text || '';
    const suggestedTitle = (text.replace(/\s+/g, ' ').trim() || message.ref?.title || message.attachments?.[0]?.name || 'رسالة غرفة الأخبار').slice(0, 120);
    const context: MessageActionContext = { origin: messageActionOrigin(message), text, suggestedTitle, mediaIds: [], montageMediaIds: [] };
    let created = false;
    if (includeAttachments) db.transaction(() => {
      for (const attachment of message.attachments || []) {
        const upload = db.getUpload(attachment.id);
        if (!upload || upload.scope !== 'chat') continue;
        const mediaType = upload.mimeType.startsWith('video/') ? 'VIDEO' : upload.mimeType.startsWith('audio/') ? 'AUDIO'
          : upload.mimeType.startsWith('image/') ? 'IMAGE' : upload.mimeType === 'application/pdf' ? 'PDF' : 'DOCUMENT';
        if (action === 'request' && mediaType !== 'VIDEO' && mediaType !== 'AUDIO') continue;
        const id = privateReferenceId(auth.user.id, message.id, upload.id, work);
        const current = db.getRow('media', id);
        if (current && (current.d.ownerId !== auth.user.id || current.d.privateMessageMedia?.messageId !== message.id || current.d.privateMessageMedia?.uploadId !== upload.id)) {
          throw new HttpError(409, 'تعذر تسجيل مرجع مرفق الرسالة');
        }
        if (!current || current.d.deletedAt) {
          const url = `${MESSAGE_MEDIA_URL_PREFIX}${id}`;
          const privateMessageMedia: PrivateMessageMedia = { messageId: message.id, uploadId: upload.id, ...(work ? { work } : {}) };
          const now = new Date().toISOString();
          db.writeRow('media', id, {
            id, title: upload.originalName, fileName: upload.originalName, originalName: upload.originalName,
            url, fileUrl: url, mediaType, mimeType: upload.mimeType, fileSize: upload.sizeBytes, fileSizeBytes: upload.sizeBytes,
            ownerId: auth.user.id, ownerName: auth.user.fullName, uploadedById: auth.user.id, uploadedByName: auth.user.fullName,
            privateMessageMedia, description: `مرفق خاص من رسالة ${message.userName}`, tags: ['مرفق رسالة'], createdAt: now,
          }, current?.p ?? Date.now(), auth.user.id);
          created = true;
        }
        context.mediaIds.push(id);
        if (mediaType === 'VIDEO' || mediaType === 'AUDIO') context.montageMediaIds.push(id);
      }
    });
    if (created) changed();
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, data: context });
  });

  router.get('/media/:id', requirePermission('media.view'), async (req, res) => {
    const auth = req.auth!;
    const id = req.params.id;
    const asset = typeof id === 'string' && /^msgmedia-[a-f0-9]{36}$/.test(id) ? db.getRow('media', id)?.d : undefined;
    const reference: PrivateMessageMedia | undefined = asset?.privateMessageMedia;
    if (!asset || asset.deletedAt || !reference || !canRead(auth, 'media', asset, (collection, id) => db.getRow(collection, id)?.d)) {
      throw new HttpError(404, 'الملف غير موجود');
    }
    const upload = db.getUpload(reference.uploadId);
    if (!upload || upload.scope !== 'chat' || path.basename(upload.storedName) !== upload.storedName) throw new HttpError(404, 'الملف غير موجود');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', `${isInlineChatType(upload.mimeType) ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(upload.originalName)}`);
    await sendStoredFile(db, config, req, res, upload, HttpError);
  });

  return router;
}
