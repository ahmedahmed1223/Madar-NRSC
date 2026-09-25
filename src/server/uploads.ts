import fs from 'fs';
import path from 'path';
import type { Request } from 'express';
import { newId } from '../shared/ids';
import type { NewsroomDatabase, UploadRecord } from './db';
import { logger } from './logger';

/** Accepted media types and the extension used on disk. SVG/HTML are refused (script-capable). */
export const ALLOWED_UPLOAD_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/aac': 'aac',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'application/pdf': 'pdf',
};

export const MEDIA_FILE_URL_PREFIX = '/api/v1/media/files/';

export class UploadError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function uploadsDir(dataDir: string) {
  return path.join(dataDir, 'uploads');
}

/**
 * Streams the raw request body to disk (never buffered in memory), enforcing
 * the size limit while bytes arrive. The file becomes visible only once complete.
 */
export function receiveUpload(req: Request, db: NewsroomDatabase, dataDir: string, maxBytes: number, userId: string): Promise<UploadRecord> {
  const mimeType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  const ext = ALLOWED_UPLOAD_TYPES[mimeType];
  if (!ext) return Promise.reject(new UploadError(415, 'نوع الملف غير مدعوم'));

  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) {
    return Promise.reject(new UploadError(413, 'حجم الملف أكبر من الحد المسموح'));
  }

  let originalName = 'file';
  try {
    originalName = decodeURIComponent(String(req.headers['x-file-name'] || 'file'));
  } catch {
    // keep default
  }
  originalName = path.basename(originalName).replace(/[\u0000-\u001f]/g, '').slice(0, 200) || 'file';

  const dir = uploadsDir(dataDir);
  fs.mkdirSync(dir, { recursive: true });
  const id = newId('upl');
  const storedName = `${id}.${ext}`;
  const finalPath = path.join(dir, storedName);
  const tempPath = `${finalPath}.part`;

  return new Promise<UploadRecord>((resolve, reject) => {
    let size = 0;
    let failed = false;
    const out = fs.createWriteStream(tempPath, { flags: 'wx' });

    const fail = (err: UploadError) => {
      if (failed) return;
      failed = true;
      req.unpipe(out);
      out.destroy();
      fs.rm(tempPath, { force: true }, () => undefined);
      // Drain the rest of the body so the client receives the error response.
      req.resume();
      reject(err);
    };

    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) fail(new UploadError(413, 'حجم الملف أكبر من الحد المسموح'));
    });
    req.on('aborted', () => fail(new UploadError(400, 'انقطع رفع الملف')));
    out.on('error', (err) => {
      logger.error('upload write failed', { error: String(err) });
      fail(new UploadError(500, 'تعذر حفظ الملف'));
    });
    out.on('finish', () => {
      if (failed) return;
      if (size === 0) {
        fs.rm(tempPath, { force: true }, () => undefined);
        return reject(new UploadError(400, 'الملف فارغ'));
      }
      try {
        fs.renameSync(tempPath, finalPath);
        const record: UploadRecord = {
          id,
          storedName,
          originalName,
          mimeType,
          sizeBytes: size,
          uploadedBy: userId,
          createdAt: new Date().toISOString(),
        };
        db.insertUpload(record);
        resolve(record);
      } catch (err) {
        fs.rm(tempPath, { force: true }, () => undefined);
        reject(new UploadError(500, 'تعذر حفظ الملف'));
      }
    });
    req.pipe(out);
  });
}

/** Removes an upload's file and row (used when its media record is deleted). */
export function removeUpload(db: NewsroomDatabase, dataDir: string, uploadId: string) {
  const record = db.getUpload(uploadId);
  if (!record) return;
  fs.rm(path.join(uploadsDir(dataDir), record.storedName), { force: true }, (err) => {
    if (err) logger.warn('failed to delete upload file', { id: uploadId, error: String(err) });
  });
  db.deleteUpload(uploadId);
}

/** Extracts the upload id referenced by a media record, if it points to an uploaded file. */
export function uploadIdFromMedia(media: any): string | null {
  for (const candidate of [media?.url, media?.fileUrl]) {
    if (typeof candidate === 'string' && candidate.startsWith(MEDIA_FILE_URL_PREFIX)) {
      const id = candidate.slice(MEDIA_FILE_URL_PREFIX.length).split(/[?#]/)[0];
      if (/^[A-Za-z0-9_\-]+$/.test(id)) return id;
    }
  }
  return null;
}
