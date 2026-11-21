import { afterEach, expect, it, vi } from 'vitest';
import { uploadMediaFile } from '../../src/services/mediaUpload';

afterEach(() => vi.unstubAllGlobals());

it('reports measured byte progress and finishes only after the authenticated upload response', async () => {
  const xhr = {
    open: vi.fn(), withCredentials: false, setRequestHeader: vi.fn(), send: vi.fn(),
    upload: { onprogress: null as ((event: Partial<ProgressEvent>) => void) | null },
    onload: null as (() => void) | null, status: 201, responseText: '{"data":{"id":"file"}}',
  };
  vi.stubGlobal('XMLHttpRequest', class { constructor() { return xhr; } });
  const progress = vi.fn();
  const file = new File(['abc'], 'sample.png', { type: 'image/png' });
  const { promise } = uploadMediaFile(file, progress);
  expect(xhr.open).toHaveBeenCalledWith('POST', '/api/v1/media/upload');
  expect(xhr.withCredentials).toBe(true);
  expect(xhr.setRequestHeader).toHaveBeenCalledWith('X-NRCS-Client', 'web');
  expect(xhr.send).toHaveBeenCalledWith(file);
  xhr.upload.onprogress?.({ lengthComputable: false, loaded: 1, total: 3 });
  xhr.upload.onprogress?.({ lengthComputable: true, loaded: 0, total: 0 });
  expect(progress).not.toHaveBeenCalled();
  xhr.upload.onprogress?.({ lengthComputable: true, loaded: 199, total: 200 });
  expect(progress).toHaveBeenLastCalledWith(99);
  xhr.upload.onprogress?.({ lengthComputable: true, loaded: 200, total: 200 });
  expect(progress).toHaveBeenLastCalledWith(100);
  xhr.onload?.();
  await expect(promise).resolves.toEqual({ id: 'file' });
});

it('resumes at the server offset when a chunk committed before its response was lost', async () => {
  const chunkBytes = 2 * 1024 * 1024;
  const file = new File([new Uint8Array(chunkBytes * 4)], 'sample.mp4', { type: 'video/mp4' });
  const id = 'upl-fixture';
  let committed = 0;
  const offsets: number[] = [];
  const out = { id, url: `/api/v1/media/files/${id}`, sizeBytes: file.size, mimeType: file.type, originalName: file.name };
  const responder = vi.fn(async (request: string, init: RequestInit) => {
    if (request.endsWith('/complete')) return Response.json({ data: out });
    if (init.method === 'PUT') {
      const headers = new Headers(init.headers);
      const offset = Number(headers.get('X-Upload-Offset'));
      expect(headers.get('X-Upload-Sha256')).toMatch(/^[0-9a-f]{64}$/);
      offsets.push(offset);
      committed = offset + (init.body as ArrayBuffer).byteLength;
      if (offset === 0) throw new TypeError('connection reset');
      return Response.json({ data: { offset: committed } });
    }
    return Response.json({ data: { id, offset: committed, chunkBytes } });
  });
  vi.stubGlobal('fetch', responder);
  await expect(uploadMediaFile(file).promise).rejects.toThrow('آخر جزء مؤكّد');
  const progress = vi.fn();
  await expect(uploadMediaFile(file, progress).promise).resolves.toEqual(out);
  expect(offsets).toEqual([0, chunkBytes, chunkBytes * 2, chunkBytes * 3]);
  expect(progress).toHaveBeenNthCalledWith(1, 25);
  expect(progress).toHaveBeenLastCalledWith(100);
  expect(responder.mock.calls.filter(([, init]) => init.method === 'POST' && !init.signal?.aborted)).toHaveLength(2);
});
