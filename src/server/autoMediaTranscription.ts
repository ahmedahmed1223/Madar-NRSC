import type { AppConfig } from './config';
import type { NewsroomDatabase } from './db';
import { logger } from './logger';
import { createMediaTranscriber, TranscriptionError } from './mediaTranscription';
import { moduleAllowedForUser } from './moduleAccess';
import { uploadIdFromMedia } from './uploads';
import type { AutoTranscriptionJob } from '../shared/mediaEditorial';

const RETRY_MINUTES = [5, 30];

export function newAutoTranscriptionJob(asset: { mediaType?: string; fileUrl?: string; url?: string; rights?: { status: string } }, allowVideo: boolean, now = new Date()): AutoTranscriptionJob | undefined {
  const sourceUrl = asset.fileUrl || asset.url;
  if (!sourceUrl || !uploadIdFromMedia({ url: sourceUrl }) || asset.rights?.status === 'RESTRICTED' ||
      (asset.mediaType !== 'AUDIO' && !(allowVideo && asset.mediaType === 'VIDEO'))) return undefined;
  return { sourceUrl, attempts: 0, nextAt: now.toISOString() };
}

/** Processes one saved job per tick. Pending work and retry attempts survive a process restart. */
export function autoTranscriptionTick(db: NewsroomDatabase, config: AppConfig, changed: () => void, send: typeof fetch = fetch) {
  const transcribe = createMediaTranscriber(db, config, changed, send);
  return async (cancel?: AbortSignal, now = new Date()) => {
    if (cancel?.aborted || !config.mediaTranscriptionAuto || !config.mediaTranscription) return false;
    const due = db.listCollection('media').filter(row => {
      const { autoTranscriptionJob: job, deletedAt } = row.d;
      return !deletedAt && job && !job.failed && job.nextAt <= now.toISOString() &&
        moduleAllowedForUser(db, 'transcription', row.d.ownerId ?? row.d.uploadedById, row.d.stationId);
    }).sort((a, b) => a.d.autoTranscriptionJob.nextAt.localeCompare(b.d.autoTranscriptionJob.nextAt))[0];
    if (!due) return false;
    const job: AutoTranscriptionJob = due.d.autoTranscriptionJob;
    const source = due.d.fileUrl || due.d.url;
    if (source === job.sourceUrl && due.d.rights?.status !== 'RESTRICTED' && due.d.transcript?.sourceUrl !== source) {
      try {
        await transcribe(due.id, null, cancel);
        return true;
      } catch (error) {
        if (cancel?.aborted || error instanceof TranscriptionError && error.status === 403) return false;
        const retryable = !(error instanceof TranscriptionError) || error.status >= 500 || error.status === 429;
        const wait = RETRY_MINUTES[job.attempts];
        const next = { ...job, attempts: job.attempts + 1, failed: !retryable || wait === undefined,
          nextAt: new Date(now.getTime() + (wait || 0) * 60_000).toISOString() };
        const current = db.getRow('media', due.id);
        if (current && !current.d.deletedAt && current.d.autoTranscriptionJob?.sourceUrl === job.sourceUrl && (current.d.fileUrl || current.d.url) === source) {
          db.writeRow('media', due.id, { ...current.d, autoTranscriptionJob: next }, current.p, null);
          changed();
        }
        if (next.failed) logger.warn('automatic media transcription stopped', { assetId: due.id, attempts: next.attempts });
        return true;
      }
    }
    const { autoTranscriptionJob: _job, ...rest } = due.d;
    db.writeRow('media', due.id, rest, due.p, null);
    changed();
    return true;
  };
}

export function startAutoMediaTranscription(db: NewsroomDatabase, config: AppConfig, changed: () => void) {
  if (!config.mediaTranscriptionAuto || !config.mediaTranscription) return () => undefined;
  const controller = new AbortController();
  const work = autoTranscriptionTick(db, config, changed);
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try { await work(controller.signal); }
    catch (error) { logger.error('automatic media transcription job failed', { error: String(error) }); }
    finally { busy = false; }
  };
  const interval = setInterval(() => void tick(), 15_000);
  interval.unref();
  void tick();
  return () => { clearInterval(interval); controller.abort(); };
}
