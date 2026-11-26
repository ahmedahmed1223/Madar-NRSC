import { execFile } from 'node:child_process';
import { openAsBlob } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { Router } from 'express';
import { moduleAllowedForUser, requireModule } from './moduleAccess';
import { requirePermission } from './auth';
import type { AppConfig } from './config';
import type { NewsroomDatabase } from './db';
import { createRateLimiter } from './rateLimit';
import { uploadIdFromMedia, uploadsDir } from './uploads';
import type { MediaTranscript, MediaTranscriptSegment } from '../shared/mediaEditorial';

const exec = promisify(execFile);
const MAX_AUDIO_BYTES = 24 * 1024 * 1024;
const MAX_VIDEO_BYTES = 512 * 1024 * 1024;
const AUDIO_EXTENSIONS: Record<string, string> = { 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg', 'audio/aac': 'aac' };

export class TranscriptionError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export function readAzureTranscript(payload: unknown): MediaTranscriptSegment[] {
  const phrases = (payload as { phrases?: unknown })?.phrases;
  if (!Array.isArray(phrases) || phrases.length > 3500) throw new TranscriptionError(502, 'تعذر قراءة نتيجة التفريغ من Azure Speech');
  const segments: MediaTranscriptSegment[] = [];
  let textLength = 0;
  for (const phrase of phrases) {
    if (!phrase || typeof phrase.text !== 'string') throw new TranscriptionError(502, 'وصلت نتيجة تفريغ غير صالحة');
    const text = phrase.text.trim();
    if (!text) continue;
    const { offsetMilliseconds, durationMilliseconds } = phrase;
    if (!Number.isSafeInteger(offsetMilliseconds) || offsetMilliseconds < 0 ||
        !Number.isSafeInteger(durationMilliseconds) || durationMilliseconds <= 0 || offsetMilliseconds + durationMilliseconds > 7_200_000) {
      throw new TranscriptionError(502, 'وصلت نتيجة تفريغ دون توقيت صالح');
    }
    textLength += text.length;
    if (textLength > 200_000) throw new TranscriptionError(422, 'التفريغ طويل جدًا. قسّم التسجيل إلى مقاطع أقصر.');
    segments.push({ start: offsetMilliseconds / 1000, end: (offsetMilliseconds + durationMilliseconds) / 1000, text });
  }
  if (!segments.length) throw new TranscriptionError(422, 'لم تلتقط خدمة التفريغ كلامًا في الملف');
  return segments.sort((a, b) => a.start - b.start);
}

const activeByDatabase = new WeakMap<NewsroomDatabase, Set<string>>();

export function createMediaTranscriber(db: NewsroomDatabase, config: AppConfig, changed: () => void, send: typeof fetch = fetch) {
  const provider = config.mediaTranscription;
  const running = activeByDatabase.get(db) || new Set<string>();
  activeByDatabase.set(db, running);
  return async (id: unknown, userId: string | null, cancel?: AbortSignal): Promise<MediaTranscript> => {
    let started = false;
    try {
      cancel?.throwIfAborted();
      if (!provider) throw new TranscriptionError(503, 'لم تُهيّأ خدمة التفريغ على الخادم');
      if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new TranscriptionError(404, 'المادة غير موجودة');
      const asset = db.getRow('media', id)?.d;
      const sourceUrl = asset?.fileUrl || asset?.url;
      const uploadId = uploadIdFromMedia({ url: sourceUrl });
      if (!asset || asset.deletedAt) throw new TranscriptionError(404, 'المادة غير موجودة');
      if (asset.transcript && asset.transcript.sourceUrl === sourceUrl) return asset.transcript;
      if (!uploadId || !['VIDEO', 'AUDIO'].includes(asset.mediaType)) throw new TranscriptionError(422, 'التفريغ للملفات الصوتية أو الفيديو المحفوظة في مكتبة الوسائط');
      const upload = db.getUpload(uploadId);
      if (!upload || upload.scope !== 'media' || upload.localEvicted || path.basename(upload.storedName) !== upload.storedName) {
        throw new TranscriptionError(422, 'تحتاج إلى نسخة من الملف على خادم مدار للتفريغ');
      }
      const extension = AUDIO_EXTENSIONS[upload.mimeType];
      if (!extension && !provider.ffmpeg) throw new TranscriptionError(422, 'تتطلب هذه الصيغة تهيئة FFmpeg على الخادم لاستخراج الصوت');
      if (!/^(?:video|audio)\//.test(upload.mimeType)) throw new TranscriptionError(422, 'الملف لا يحتوي على وسائط صوتية مدعومة');
      if (running.has(id) || running.size >= 2) throw new TranscriptionError(429, 'هناك عملية تفريغ جارية. أعد المحاولة بعد اكتمالها.');
      running.add(id);
      started = true;
      const file = path.join(uploadsDir(config.dataDir), upload.storedName);
      const info = await stat(file).catch(() => null);
      if (!info?.isFile()) throw new TranscriptionError(422, 'تحتاج إلى نسخة من الملف على خادم مدار للتفريغ');
      if (info.size > (extension ? MAX_AUDIO_BYTES : MAX_VIDEO_BYTES)) throw new TranscriptionError(413, 'الملف أكبر من حد التفريغ. استخدم نسخة صوتية أقصر.');

      let audio: Blob;
      if (extension) {
        audio = await openAsBlob(file, { type: upload.mimeType });
      } else {
        try {
          const { stdout } = await exec(provider.ffmpeg!, [
            '-nostdin', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,matroska,webm,avi,mpegts,aac',
            '-i', file, '-map', '0:a:0', '-vn', '-sn', '-dn', '-ac', '1', '-ar', '16000', '-b:a', '64k', '-f', 'mp3', 'pipe:1',
          ], { timeout: 30_000, maxBuffer: MAX_AUDIO_BYTES, encoding: 'buffer', windowsHide: true, signal: cancel });
          audio = new Blob([new Uint8Array(stdout)], { type: 'audio/mpeg' });
        } catch {
          throw new TranscriptionError(422, 'تعذر استخراج الصوت. تحقق من وجود مسار صوتي أو استخدم ملفًا صوتيًا أقصر.');
        }
      }
      const form = new FormData();
      form.set('audio', audio, `audio.${extension || 'mp3'}`);
      form.set('definition', JSON.stringify({ locales: ['ar-PS'] }));
      cancel?.throwIfAborted();
      const ready = db.getRow('media', id)?.d;
      if (!ready || ready.deletedAt || (ready.fileUrl || ready.url) !== sourceUrl) throw new TranscriptionError(409, 'تغيّر مصدر المادة قبل إرسالها للتفريغ');
      if (!moduleAllowedForUser(db, 'transcription', userId ?? ready.ownerId ?? ready.uploadedById ?? upload.uploadedBy, ready.stationId)) {
        throw new TranscriptionError(403, 'تفريغ الوسائط موقوف لهذا النطاق');
      }
      if (userId === null && ready.rights?.status === 'RESTRICTED') throw new TranscriptionError(422, 'حقوق المادة مقيّدة للتفريغ التلقائي');
      let response: Response;
      try {
        const timeout = AbortSignal.timeout(90_000);
        response = await send(`https://${provider.region}.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe?api-version=2025-10-15`, {
          method: 'POST', headers: { 'Ocp-Apim-Subscription-Key': provider.key }, body: form,
          signal: cancel ? AbortSignal.any([cancel, timeout]) : timeout, redirect: 'error',
        });
      } catch {
        throw new TranscriptionError(502, 'تعذر الاتصال بخدمة Azure Speech أو انتهت مهلة التفريغ');
      }
      if (!response.ok) throw new TranscriptionError(response.status === 429 ? 429 : 502, 'تعذر التفريغ لدى Azure Speech');
      const payload = await response.json().catch(() => null);
      cancel?.throwIfAborted();
      const transcript: MediaTranscript = { language: 'ar', sourceUrl, generatedAt: new Date().toISOString(), segments: readAzureTranscript(payload) };
      const saved = db.transaction(() => {
        const current = db.getRow('media', id);
        if (!current || current.d.deletedAt || (current.d.fileUrl || current.d.url) !== sourceUrl) {
          throw new TranscriptionError(409, 'تغير مصدر المادة أثناء التفريغ. افتح نسختها الحالية وحاول مجددًا.');
        }
        if (current.d.transcript && current.d.transcript.sourceUrl === sourceUrl) return current.d.transcript;
        const { autoTranscriptionJob: _job, ...latest } = current.d;
        db.writeRow('media', id, { ...latest, transcript }, current.p, userId);
        return transcript;
      });
      changed();
      return saved;
    } finally {
      if (started && typeof id === 'string') running.delete(id);
    }
  };
}

export function mediaTranscriptionRouter(db: NewsroomDatabase, config: AppConfig, changed: () => void, send: typeof fetch = fetch) {
  const router = Router();
  const provider = config.mediaTranscription;
  const transcribe = createMediaTranscriber(db, config, changed, send);
  const access = [requirePermission('media.view'), requirePermission('media.upload'), requireModule('transcription')];
  router.get('/transcription', ...access, (_req, res) => res.json({ success: true, data: { enabled: !!provider, video: !!provider?.ffmpeg, automatic: config.mediaTranscriptionAuto } }));
  const limit = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 8, key: req => req.auth!.user.id, message: 'بلغت حد طلبات التفريغ لهذه الساعة' });
  router.post('/:id/transcription', ...access, limit, async (req, res, next) => {
    try {
      const data = await transcribe(req.params.id, req.auth!.user.id);
      res.json({ success: true, data });
    } catch (error) {
      if (error instanceof TranscriptionError) res.status(error.status).json({ success: false, error: error.message });
      else next(error);
    }
  });
  return router;
}
