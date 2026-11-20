import type { MediaType } from '../types';

export interface UploadedFile {
  id: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
  originalName: string;
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
export function uploadMediaFile(file: File, onProgress?: (percent: number) => void, opts: { keepInSharedFolder?: boolean } = {}): { promise: Promise<UploadedFile>; abort: () => void } {
  // The server honours the shared-folder copy only for colleagues on the station's network.
  return uploadFile<UploadedFile>('/api/v1/media/upload', file, onProgress, opts.keepInSharedFolder ? { 'X-Storage-Share': '1' } : undefined);
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
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
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
