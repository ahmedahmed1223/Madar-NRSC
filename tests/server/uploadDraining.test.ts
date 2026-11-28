import type { Request, Response } from 'express';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../src/server/config';
import type { NewsroomDatabase } from '../../src/server/db';
import { externalIntakeRouter } from '../../src/server/externalIntake';
import { createRateLimiter } from '../../src/server/rateLimit';
import { receiveUpload, sendErrorAfterDrain, UploadError } from '../../src/server/uploads';

const unusedDb = {} as NewsroomDatabase;

function requestStream(headers: Record<string, string> = {}) {
  const stream = new PassThrough();
  const req = Object.assign(stream, {
    headers,
    method: 'POST',
    url: '/upload',
    get: (name: string) => headers[name.toLowerCase()],
  }) as unknown as Request;
  const responseHeaders = new Headers();
  const json = vi.fn();
  const res = {
    setHeader: (name: string, value: string) => responseHeaders.set(name, value),
    status: (status: number) => ({ json: (body: unknown) => json(status, body) }),
  } as unknown as Response;
  return { req, res, responseHeaders, json };
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] }); });
afterEach(() => { vi.useRealTimers(); });

it('uses one drain window when an upload fails validation', async () => {
  const { req, res, responseHeaders, json } = requestStream({ 'content-type': 'text/plain', 'content-length': '16' });
  const rejected = receiveUpload(req, unusedDb, '', 1024, 'editor').catch((error: unknown) => {
    if (!(error instanceof UploadError)) throw error;
    sendErrorAfterDrain(req, res, error.status, { error: error.message });
  });
  await vi.advanceTimersByTimeAsync(4999);
  expect(json).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(json).toHaveBeenCalledExactlyOnceWith(415, { error: 'نوع الملف غير مدعوم' });
  expect(responseHeaders.get('Connection')).toBe('close');
  await rejected;
});

it('closes the connection when a denied contributor upload cannot finish draining', async () => {
  const router = externalIntakeRouter(unusedDb, { mediaMaxUploadBytes: 1024 } as AppConfig);
  const { req, res, responseHeaders, json } = requestStream({ 'content-type': 'audio/wav', 'content-length': '16' });
  router(req, res, (error?: unknown) => { if (error) throw error; });
  await vi.advanceTimersByTimeAsync(5000);
  expect(json).toHaveBeenCalledExactlyOnceWith(410, { success: false, error: 'الرابط غير صالح أو انتهت صلاحيته.' });
  expect(responseHeaders.get('Connection')).toBe('close');
});

it('drains a rate-limited request with a pending body and replies immediately without one', async () => {
  const rateLimiter = createRateLimiter({ windowMs: 60_000, max: 1, key: () => 'local', message: 'Try again later' });
  const empty = requestStream();
  const next = vi.fn();
  rateLimiter(empty.req, empty.res, next);
  expect(next).toHaveBeenCalledOnce();
  rateLimiter(empty.req, empty.res, next);
  const body = { success: false, error: 'Try again later', code: 'RATE_LIMITED' };
  expect(empty.json).toHaveBeenCalledExactlyOnceWith(429, body);
  expect(empty.responseHeaders.get('Retry-After')).toBe('60');

  const upload = requestStream({ 'content-type': 'audio/wav', 'content-length': '16' });
  rateLimiter(upload.req, upload.res, next);
  expect(upload.json).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(5000);
  expect(upload.json).toHaveBeenCalledExactlyOnceWith(429, body);
  expect(upload.responseHeaders.get('Retry-After')).toBe('60');
  expect(upload.responseHeaders.get('Connection')).toBe('close');
});
