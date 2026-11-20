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
