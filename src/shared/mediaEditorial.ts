import { fromLocalInputValue, stationTimeZone } from './dates';

export const MEDIA_RIGHTS_STATES = ['CLEARED', 'RESTRICTED', 'UNKNOWN'] as const;
export const MEDIA_RIGHTS_ORIGINS = ['STATION', 'AGENCY', 'ONE_TIME'] as const;

export interface MediaRights {
  status: (typeof MEDIA_RIGHTS_STATES)[number];
  origin?: (typeof MEDIA_RIGHTS_ORIGINS)[number];
  expiresAt?: string;
  note?: string;
}

export interface MediaBroadcastSession {
  showId: string;
  startedAt: string;
}

export interface MediaBroadcastUse extends MediaBroadcastSession {
  segmentId: string;
  recordedAt: string;
}

export interface MediaEditRange {
  id: string;
  inSeconds: number;
  outSeconds: number;
  note: string;
}

export interface MediaTranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface MediaTranscript {
  language: 'ar';
  sourceUrl: string;
  generatedAt: string;
  segments: MediaTranscriptSegment[];
}

export interface AutoTranscriptionJob {
  sourceUrl: string;
  attempts: number;
  nextAt: string;
  failed?: boolean;
}

interface EditorialMedia {
  id: string;
  title?: string;
  fileName?: string;
  mediaType?: string;
  durationSeconds?: number;
  url?: string;
  fileUrl?: string;
  rights?: MediaRights | null;
  privateMessageMedia?: unknown;
  broadcastUse?: MediaBroadcastUse;
  editRanges?: MediaEditRange[];
  deletedAt?: string | null;
}

interface MediaSegment {
  id: string;
  title?: string;
  mediaIds?: string[];
  videoAssetUrl?: string;
}

interface MontageDelivery {
  type: string;
  status: string;
  resultMediaId?: string;
  deletedAt?: string | null;
  link?: { episodeId?: string; segmentId?: string };
}

export function mediaTimecode(seconds: number): string {
  const hundredths = Math.round(Math.max(0, seconds) * 100);
  const hours = Math.floor(hundredths / 360000);
  const minutes = Math.floor(hundredths / 6000) % 60;
  const secs = Math.floor(hundredths / 100) % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(hundredths % 100).padStart(2, '0')}`;
}

export function mediaEditorialError(asset: Pick<EditorialMedia, 'mediaType' | 'durationSeconds' | 'rights' | 'editRanges'>): string | null {
  const { rights, editRanges } = asset;
  if (rights !== undefined && rights !== null) {
    if (typeof rights !== 'object' || !MEDIA_RIGHTS_STATES.includes(rights.status) ||
        (rights.origin !== undefined && !MEDIA_RIGHTS_ORIGINS.includes(rights.origin)) ||
        (rights.note !== undefined && (typeof rights.note !== 'string' || rights.note.length > 1000)) ||
        (rights.expiresAt !== undefined && (typeof rights.expiresAt !== 'string' ||
          !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(rights.expiresAt) ||
          !Number.isFinite(Date.parse(rights.expiresAt)) ||
          new Date(rights.expiresAt).toISOString() !== rights.expiresAt.replace(/(?<!\.\d{3})Z$/, '.000Z')))) {
      return 'بيانات حقوق الاستخدام أو تاريخ انتهائها غير صالحة';
    }
  }
  if (editRanges === undefined) return null;
  if (!Array.isArray(editRanges) || editRanges.length > 50 ||
      (editRanges.length > 0 && asset.mediaType !== 'AUDIO' && asset.mediaType !== 'VIDEO')) return 'علامات المونتاج غير صالحة لهذه المادة';
  const seen = new Set<string>();
  for (const range of editRanges) {
    if (!range || typeof range.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(range.id) || seen.has(range.id) ||
        !Number.isFinite(range.inSeconds) || range.inSeconds < 0 || !Number.isFinite(range.outSeconds) ||
        range.outSeconds <= range.inSeconds || range.outSeconds > 86400 ||
        (asset.durationSeconds && range.outSeconds > asset.durationSeconds + 1) ||
        typeof range.note !== 'string' || range.note.length > 1000) return 'اختر نقطة خروج بعد الدخول ضمن مدة المادة، واكتب ملاحظة حتى 1000 حرف';
    seen.add(range.id);
  }
  return null;
}

export function mediaRightsIssue(asset: Pick<EditorialMedia, 'rights' | 'privateMessageMedia' | 'broadcastUse'> | undefined, now = new Date(), plannedAirAt?: Date | null, session?: MediaBroadcastSession): string | null {
  if (asset?.privateMessageMedia) return 'مرفق خاص برسالة';
  const rights = asset?.rights;
  if (!rights) return null;
  if (rights.status === 'RESTRICTED') return 'حقوق البث مقيّدة';
  if (rights.status !== 'CLEARED') return 'حقوق البث غير موثّقة';
  if (rights.origin === 'ONE_TIME' && asset.broadcastUse &&
    (asset.broadcastUse.showId !== session?.showId || asset.broadcastUse.startedAt !== session?.startedAt)) return 'استُخدمت المادة بتصريح البث لمرة واحدة';
  if (!rights.expiresAt) return null;
  const expires = Date.parse(rights.expiresAt);
  if (!Number.isFinite(expires) || expires <= now.getTime()) return 'انتهت صلاحية حقوق البث';
  if (plannedAirAt && expires <= plannedAirAt.getTime()) return 'تنتهي صلاحية حقوق البث قبل موعد الاستخدام';
  return null;
}

/** Includes direct library attachments, library video URLs and completed montage deliveries. */
export function segmentMediaIds(segment: MediaSegment, episodeId: string | undefined, media: EditorialMedia[], requests: MontageDelivery[] = []): Set<string> {
  const ids = new Set(Array.isArray(segment.mediaIds) ? segment.mediaIds : []);
  const url = libraryMediaPath(segment.videoAssetUrl);
  if (url) for (const asset of media) {
    if (url === libraryMediaPath(asset.url) || url === libraryMediaPath(asset.fileUrl)) ids.add(asset.id);
  }
  for (const request of requests) {
    if (!request.deletedAt && request.type === 'MONTAGE' && request.status === 'DONE' && request.resultMediaId &&
      request.link?.segmentId === segment.id && (!request.link.episodeId || request.link.episodeId === episodeId)) ids.add(request.resultMediaId);
  }
  return ids;
}

function libraryMediaPath(url?: string): string | undefined {
  if (typeof url !== 'string' || !url) return undefined;
  return /^(?:https?:\/\/[^/]+)?(\/api\/v1\/media\/files\/[A-Za-z0-9_-]+)(?:[?#]|$)/.exec(url)?.[1] || url;
}

export function firstMediaRightsBlocker(ids: Iterable<string>, media: EditorialMedia[], now = new Date(), plannedAirAt?: Date | null, session?: MediaBroadcastSession): string | null {
  const byId = new Map(media.map(asset => [asset.id, asset]));
  for (const id of ids) {
    const asset = byId.get(id);
    if (!asset) continue;
    const issue = mediaRightsIssue(asset, now, plannedAirAt, session);
    if (issue) return `«${asset.title || asset.fileName || 'مادة وسائط'}» — ${issue}`;
  }
  return null;
}

export function plannedMediaAirAt(day?: string, time?: string, timeZone?: string, offset?: string): Date | null {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !time || !/^\d{2}:\d{2}(?::\d{2})?$/.test(time)) return null;
  const value = fromLocalInputValue(`${day}T${time}`, stationTimeZone(timeZone));
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  const parts = typeof offset === 'string' ? /^(\d+):(\d{2}):(\d{2})$/.exec(offset) : null;
  const seconds = parts ? Number(parts[1]) * 3600 + Number(parts[2]) * 60 + Number(parts[3]) : 0;
  return new Date(timestamp + seconds * 1000);
}
