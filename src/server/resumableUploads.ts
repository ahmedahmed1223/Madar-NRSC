import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type ErrorRequestHandler, type Request } from 'express';
import { newId } from '../shared/ids';
import { ALLOWED_UPLOAD_TYPES, MEDIA_FILE_URL_PREFIX, UploadError, uploadsDir } from './uploads';
import type { NewsroomDatabase, UploadRecord } from './db';
import { logger } from './logger';

const CHUNK_BYTES = 2 * 1024 * 1024;
const STAGE_TTL = 2 * 60 * 60 * 1000;
const SESSION_ID = /^upl-[A-Za-z0-9_-]+$/;

interface Stage {
  id: string;
  owner: string;
  originalName: string;
  mimeType: string;
  size: number;
  offset: number;
  touchedAt: number;
}

function uploaded(record: UploadRecord) {
  return { id: record.id, url: `${MEDIA_FILE_URL_PREFIX}${record.id}`, mimeType: record.mimeType, sizeBytes: record.sizeBytes, originalName: record.originalName };
}

export function createResumableUploadRouter(db: NewsroomDatabase, dataDir: string, maxBytes: number, onCompleted?: (record: UploadRecord, request: Request) => void): express.Router {
  const router = express.Router();
  const directory = path.join(dataDir, 'resumable-media');
  const stagePath = (id: string) => path.join(directory, `${id}.json`);
  const bytesPath = (id: string) => path.join(directory, `${id}.part`);
  const inFlight = new Map<string, Request>();
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  function removeStage(id: string) {
    fs.rmSync(stagePath(id), { force: true });
    fs.rmSync(`${stagePath(id)}.tmp`, { force: true });
    fs.rmSync(bytesPath(id), { force: true });
  }

  function loadStage(id: string): Stage | null {
    if (!SESSION_ID.test(id) || !fs.existsSync(stagePath(id))) return null;
    const stage = JSON.parse(fs.readFileSync(stagePath(id), 'utf8')) as Stage;
    if (Date.now() - stage.touchedAt > STAGE_TTL && !inFlight.has(id)) {
      removeStage(id);
      return null;
    }
    return stage;
  }

  function writeStage(stage: Stage) {
    const file = stagePath(stage.id);
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(stage), { flush: true });
    fs.renameSync(`${file}.tmp`, file);
  }

  const routeId = (req: Request) => typeof req.params.id === 'string' ? req.params.id : '';
  const requestOwner = (req: Request) => req.auth!.user.id;
  function ownedStage(req: Request) {
    const stage = loadStage(routeId(req));
    if (!stage || stage.owner !== requestOwner(req)) throw new UploadError(404, 'جلسة الرفع غير متاحة');
    return stage;
  }

  function ownedCompletedUpload(req: Request): UploadRecord | undefined {
    const id = routeId(req);
    const current = SESSION_ID.test(id) ? db.getUpload(id) : undefined;
    return current?.scope === 'media' && current.uploadedBy === requestOwner(req) ? current : undefined;
  }

  router.post('/', (req, res) => {
    const { name, mimeType, size } = req.body ?? {};
    if (typeof mimeType !== 'string' || !Object.prototype.hasOwnProperty.call(ALLOWED_UPLOAD_TYPES, mimeType)) throw new UploadError(415, 'نوع الملف غير مدعوم');
    if (!Number.isSafeInteger(size) || size <= 0) throw new UploadError(400, 'حجم الملف غير صالح');
    if (size > maxBytes) throw new UploadError(413, 'حجم الملف أكبر من الحد المسموح');
    fs.mkdirSync(directory, { recursive: true });
    const stagedFiles = fs.readdirSync(directory);
    const stages = stagedFiles
      .filter(file => file.endsWith('.json'))
      .map(file => loadStage(file.slice(0, -5))).filter(stage => stage !== null);
    for (const name of stagedFiles) {
      const orphan = /^(upl-[A-Za-z0-9_-]+)\.(?:part|json\.tmp)$/.exec(name);
      if (orphan && !fs.existsSync(stagePath(orphan[1]))) {
        const file = path.join(directory, name);
        if (fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs > STAGE_TTL) fs.rmSync(file, { force: true });
      }
    }
    const owner = requestOwner(req);
    if (stages.filter(stage => stage.owner === owner).length >= 2 || stages.length >= 32 || stages.reduce((total, stage) => total + stage.size, 0) + size > 4 * maxBytes) {
      throw new UploadError(429, 'مساحة الرفع المؤقت مشغولة. أكمل رفعاً سابقاً أو ألغِه ثم أعد المحاولة.');
    }
    const originalName = path.basename(typeof name === 'string' ? name : '').replace(/[\u0000-\u001f]/g, '').slice(0, 200) || 'file';
    const stage = { id: newId('upl'), owner, originalName, mimeType, size, offset: 0, touchedAt: Date.now() };
    try {
      fs.writeFileSync(bytesPath(stage.id), Buffer.alloc(0), { flag: 'wx' });
      writeStage(stage);
    } catch (error) {
      removeStage(stage.id);
      throw error;
    }
    res.status(201).json({ data: { id: stage.id, offset: stage.offset, chunkBytes: CHUNK_BYTES } });
  });

  router.get('/:id', (req, res) => {
    const completed = ownedCompletedUpload(req);
    if (completed) { res.json({ data: { id: completed.id, offset: completed.sizeBytes, chunkBytes: CHUNK_BYTES, completed: uploaded(completed) } }); return; }
    const stage = ownedStage(req);
    res.json({ data: { id: stage.id, offset: stage.offset, chunkBytes: CHUNK_BYTES } });
  });

  router.put('/:id', (req, res, next) => {
    const { id } = ownedStage(req);
    if (inFlight.has(id)) throw new UploadError(409, 'توجد دفعة أخرى قيد الرفع');
    inFlight.set(id, req);
    res.once('close', () => { if (inFlight.get(id) === req) inFlight.delete(id); });
    next();
  }, express.raw({ type: 'application/octet-stream', limit: CHUNK_BYTES, inflate: false }), (req, res) => {
    const stage = ownedStage(req);
    if (req.get('X-Upload-Offset') !== String(stage.offset)) throw new UploadError(409, 'تغير موضع الرفع. أعد المحاولة من آخر جزء مؤكد.');
    const expected = Math.min(CHUNK_BYTES, stage.size - stage.offset);
    const bytes: unknown = req.body;
    if (expected <= 0 || !Buffer.isBuffer(bytes) || bytes.length !== expected) throw new UploadError(400, 'حجم جزء الرفع غير صالح');
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (req.get('X-Upload-Sha256') !== hash) throw new UploadError(400, 'تعذر التحقق من سلامة جزء الرفع');
    const temporaryFile = bytesPath(stage.id);
    const actual = fs.statSync(temporaryFile).size;
    if (actual < stage.offset) throw new UploadError(409, 'ملف الرفع المؤقت غير مكتمل؛ أعد الرفع.');
    if (actual > stage.offset) fs.truncateSync(temporaryFile, stage.offset);
    fs.writeFileSync(temporaryFile, bytes, { flag: 'a', flush: true });
    const offset = stage.offset + bytes.length;
    writeStage({ ...stage, offset, touchedAt: Date.now() });
    inFlight.delete(stage.id);
    res.json({ data: { offset } });
  });

  router.post('/:id/complete', (req, res) => {
    const existing = ownedCompletedUpload(req);
    if (existing) { res.json({ data: uploaded(existing) }); return; }
    const stage = ownedStage(req);
    if (inFlight.has(stage.id) || stage.offset !== stage.size) throw new UploadError(409, 'لم يكتمل رفع الملف بعد');
    const storedName = `${stage.id}.${ALLOWED_UPLOAD_TYPES[stage.mimeType]}`;
    fs.mkdirSync(uploadsDir(dataDir), { recursive: true });
    const target = path.join(uploadsDir(dataDir), storedName);
    const part = bytesPath(stage.id);
    const staged = fs.existsSync(part);
    // A prior attempt may have moved the bytes before its database insert completed.
    const awaitingRegistration = staged ? part : target;
    if (!fs.existsSync(awaitingRegistration) || fs.statSync(awaitingRegistration).size !== stage.size) throw new UploadError(409, 'لم يكتمل رفع الملف بعد');
    const record: UploadRecord = { id: stage.id, storedName, originalName: stage.originalName, mimeType: stage.mimeType, sizeBytes: stage.size, uploadedBy: stage.owner, scope: 'media', createdAt: new Date().toISOString() };
    if (staged) fs.renameSync(part, target);
    try {
      db.insertUpload(record);
    } catch (error) {
      if (staged) fs.renameSync(target, part);
      throw error;
    }
    try { removeStage(stage.id); }
    catch (error) { logger.warn('upload staging cleanup failed', { id: record.id, error: String(error) }); }
    try { onCompleted?.(record, req); }
    catch (error) { logger.warn('upload post-commit operation failed', { id: record.id, error: String(error) }); }
    res.json({ data: uploaded(record) });
  });

  router.delete('/:id', (req, res) => {
    const stage = ownedStage(req);
    if (inFlight.has(stage.id)) throw new UploadError(409, 'جزء قيد الرفع');
    removeStage(stage.id);
    res.sendStatus(204);
  });

  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof UploadError) { res.status(error.status).json({ error: error.message }); return; }
    if (error?.status === 413) { res.status(413).json({ error: 'حجم جزء الرفع أكبر من الحد المسموح' }); return; }
    if (error?.status === 415) { res.status(415).json({ error: 'نوع تحميل جزء الرفع غير مدعوم' }); return; }
    logger.warn('resumable upload failed', { error: String(error) });
    res.status(500).json({ error: 'تعذر حفظ جزء الرفع' });
  };
  router.use(errors);
  return router;
}
