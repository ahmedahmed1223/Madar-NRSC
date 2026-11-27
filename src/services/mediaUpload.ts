import type { CloudProviderId } from '../shared/storage';
import type { MediaType } from '../types';
import { apiFetch, ApiError } from './http';

export interface UploadedFile {
  id: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
  originalName: string;
}

const RESUMABLE_ENDPOINT = '/api/v1/media/resumable';
const RESUMABLE_MIN_BYTES = 8 * 1024 * 1024;
const resumeIds = new WeakMap<File, string>();

export async function discardMediaUpload(file: File): Promise<void> {
  const id = resumeIds.get(file);
  if (!id) return;
  resumeIds.delete(file);
  try { await apiFetch(`${RESUMABLE_ENDPOINT}/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
  catch { /* Interrupted staging expires automatically. */ }
}

interface UploadCursor { id: string; offset: number; chunkBytes: number; completed?: UploadedFile }

async function resumeMediaFile(file: File, signal: AbortSignal, onProgress?: (percent: number) => void, headers?: Record<string, string>): Promise<UploadedFile> {
  let cursor: UploadCursor | undefined;
  const known = resumeIds.get(file);
  if (known) {
    try {
      cursor = (await apiFetch<{ data: UploadCursor }>(`${RESUMABLE_ENDPOINT}/${encodeURIComponent(known)}`, { signal, cache: 'no-store' })).data;
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404) throw error;
      resumeIds.delete(file);
    }
  }
  if (!cursor) {
    cursor = (await apiFetch<{ data: UploadCursor }>(RESUMABLE_ENDPOINT, {
      method: 'POST', signal, json: { name: file.name, mimeType: file.type, size: file.size },
    })).data;
    resumeIds.set(file, cursor.id);
  }
  if (cursor.completed) {
    resumeIds.delete(file);
    onProgress?.(100);
    return cursor.completed;
  }
  const { id, chunkBytes } = cursor;
  let offset = cursor.offset;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > file.size || !Number.isSafeInteger(chunkBytes) || chunkBytes < 1 || chunkBytes > 2 * 1024 * 1024) throw new Error('موضع الرفع غير صالح');
  const target = `${RESUMABLE_ENDPOINT}/${encodeURIComponent(id)}`;
  onProgress?.(Math.min(99, Math.floor(offset * 100 / file.size)));
  while (offset < file.size) {
    signal.throwIfAborted();
    const end = Math.min(offset + chunkBytes, file.size);
    const bytes = await file.slice(offset, end).arrayBuffer();
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    const checksum = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
    const confirmation = await apiFetch<{ data: { offset: number } }>(target, {
      method: 'PUT', signal, body: bytes, headers: { 'Content-Type': 'application/octet-stream', 'X-Upload-Offset': String(offset), 'X-Upload-Sha256': checksum },
    });
    if (confirmation.data.offset !== end) throw new Error('لم يؤكد الخادم جزء الرفع كاملاً. أعد المحاولة.');
    offset = end;
    onProgress?.(Math.min(99, Math.floor(offset * 100 / file.size)));
  }
  const { data } = await apiFetch<{ data: UploadedFile }>(`${target}/complete`, { method: 'POST', signal, headers });
  resumeIds.delete(file);
  onProgress?.(100);
  return data;
}

export const ACCEPTED_UPLOAD_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/ogg',
  'audio/aac',
  'audio/mp4',
  'audio/x-m4a',
  'application/pdf',
];

export function mediaTypeForMime(mime: string): MediaType {
  if (mime.startsWith('image/')) return 'IMAGE';
  if (mime.startsWith('video/')) return 'VIDEO';
  if (mime.startsWith('audio/')) return 'AUDIO';
  return 'DOCUMENT';
}

/** Streams a file to the media library (XHR so the UI can show upload progress). */
export function uploadMediaFile(file: File, onProgress?: (percent: number) => void, opts: { keepInSharedFolder?: boolean; cloudTargets?: CloudProviderId[] } = {}): { promise: Promise<UploadedFile>; abort: () => void } {
  const headers: Record<string, string> = {};
  if (opts.keepInSharedFolder) headers['X-Storage-Share'] = '1';
  if (opts.cloudTargets) headers['X-Storage-Cloud-Targets'] = opts.cloudTargets.join(',') || 'none';
  if (file.size >= RESUMABLE_MIN_BYTES && !!globalThis.crypto?.subtle && ACCEPTED_UPLOAD_TYPES.includes(file.type)) {
    const controller = new AbortController();
    const promise = resumeMediaFile(file, controller.signal, onProgress, headers).catch(error => {
      if (controller.signal.aborted) throw new Error('تم إيقاف الرفع. يمكنك إعادة المحاولة من آخر جزء أكده الخادم.');
      if (error instanceof TypeError) throw new Error('انقطع الاتصال أثناء الرفع. أعد المحاولة للمتابعة من آخر جزء مؤكّد.');
      throw error;
    });
    return { promise, abort: () => controller.abort() };
  }
  // The server honours the shared-folder copy only for colleagues on the station's network.
  return uploadFile<UploadedFile>('/api/v1/media/upload', file, onProgress, headers);
}

/** Real length of an audio/video file in whole seconds, read in the browser (null when unknown). */
export function readMediaDuration(file: File): Promise<number | null> {
  if (!/^(video|audio)\//.test(file.type) || typeof document === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const el = document.createElement(file.type.startsWith('video/') ? 'video' : 'audio');
    const url = URL.createObjectURL(file);
    const done = (value: number | null) => {
      URL.revokeObjectURL(url);
      el.removeAttribute('src');
      resolve(value);
    };
    const timer = window.setTimeout(() => done(null), 8000);
    el.preload = 'metadata';
    el.onloadedmetadata = () => {
      window.clearTimeout(timer);
      done(Number.isFinite(el.duration) && el.duration > 0 ? Math.max(1, Math.round(el.duration)) : null);
    };
    el.onerror = () => {
      window.clearTimeout(timer);
      done(null);
    };
    el.src = url;
  });
}

/** Streams a file to the server and resolves with what the endpoint answers. */
export function uploadFile<T>(url: string, file: File, onProgress?: (percent: number) => void, extraHeaders?: Record<string, string>): { promise: Promise<T>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<T>((resolve, reject) => {
    xhr.open('POST', url);
    xhr.withCredentials = true;
    xhr.setRequestHeader('X-NRCS-Client', 'web');
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    for (const [name, value] of Object.entries(extraHeaders || {})) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress?.(Math.min(100, Math.floor((e.loaded / e.total) * 100)));
    };
    xhr.onload = () => {
      let body: any = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // non-JSON error page
      }
      if (xhr.status >= 200 && xhr.status < 300 && body?.data) resolve(body.data as T);
      else reject(new Error(body?.error || `فشل رفع الملف (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('تعذر الاتصال بالخادم أثناء رفع الملف'));
    xhr.onabort = () => reject(new Error('تم إلغاء الرفع'));
    xhr.send(file);
  });
  return { promise, abort: () => xhr.abort() };
}
