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

/** Streams a file to the server (XHR so the UI can show upload progress). */
export function uploadMediaFile(file: File, onProgress?: (percent: number) => void): { promise: Promise<UploadedFile>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<UploadedFile>((resolve, reject) => {
    xhr.open('POST', '/api/v1/media/upload');
    xhr.withCredentials = true;
    xhr.setRequestHeader('X-NRCS-Client', 'web');
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
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
      if (xhr.status >= 200 && xhr.status < 300 && body?.data) resolve(body.data as UploadedFile);
      else reject(new Error(body?.error || `فشل رفع الملف (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('تعذر الاتصال بالخادم أثناء رفع الملف'));
    xhr.onabort = () => reject(new Error('تم إلغاء الرفع'));
    xhr.send(file);
  });
  return { promise, abort: () => xhr.abort() };
}
