import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createTestServer, loginAgent } from '../helpers';
import { buildAuthContext } from '../../src/server/auth';
import { mediaTranscriptionRouter } from '../../src/server/mediaTranscription';
import { autoTranscriptionTick } from '../../src/server/autoMediaTranscription';
import { uploadsDir } from '../../src/server/uploads';
import { firstMediaRightsBlocker, mediaEditorialError, plannedMediaAirAt } from '../../src/shared/mediaEditorial';

const headers = { 'X-NRCS-Client': 'web' };
let fixture: Awaited<ReturnType<typeof createTestServer>>;

beforeAll(async () => { fixture = await createTestServer(); });
afterAll(() => fixture?.close());

it('validates mark order and checks license expiry at the scheduled station time', () => {
  const range = { id: 'mark-1', inSeconds: 2.4, outSeconds: 8, note: 'بداية المقابلة' };
  expect(mediaEditorialError({ mediaType: 'VIDEO', durationSeconds: 10, editRanges: [range] })).toBeNull();
  expect(mediaEditorialError({ mediaType: 'VIDEO', durationSeconds: 10, editRanges: [{ ...range, outSeconds: 2 }] })).toMatch(/خروج/);
  expect(mediaEditorialError({ rights: { status: 'CLEARED', expiresAt: '2026-02-30T10:00:00Z' } })).toMatch(/تاريخ/);
  expect(mediaEditorialError({ rights: { status: 'CLEARED', expiresAt: '2026-11-23T19:00:00Z' } })).toBeNull();
  const airAt = plannedMediaAirAt('2026-11-23', '21:00', 'Asia/Hebron', '00:02:00');
  expect(airAt?.toISOString()).toBe('2026-11-23T19:02:00.000Z');
  const asset = { id: 'clip', rights: { status: 'CLEARED' as const, expiresAt: '2026-11-23T19:01:00Z' } };
  expect(firstMediaRightsBlocker(['clip'], [asset], new Date('2026-11-22T19:00:00Z'), airAt)).toMatch(/قبل موعد/);
  expect(firstMediaRightsBlocker(['previous-version'], [{ id: 'previous-version' }])).toBeNull();
});

it('blocks restricted attachments and denies on-air and MOS after rights change', async () => {
  const producer = await loginAgent(fixture.app, 'producer@akhbar.tv');
  const director = await loginAgent(fixture.app, 'director@akhbar.tv');
  const { id, d, v, p } = fixture.db.listCollection('episodes').find(row => row.d.rundown?.length > 0)!;
  const media = { id: 'rights-regression', title: 'لقطة اختبار', fileName: 'example.mp4', mediaType: 'VIDEO', url: 'https://example.invalid/example.mp4', tags: [] };
  fixture.db.writeRow('media', media.id, { ...media, rights: { status: 'RESTRICTED' } }, 1000, null);
  const segment = { ...d.rundown[0], mediaIds: [media.id] };
  const after = { ...d, rundown: [segment, ...d.rundown.slice(1)] };
  const operation = { c: 'episodes', op: 'upsert', id, baseV: v, d: after };
  const rejected = await producer.post('/api/v1/data/sync').set(headers).send({ ops: [operation] });
  expect(rejected.body.results[0]).toMatchObject({ ok: false, code: 'FORBIDDEN', message: expect.stringMatching(/حقوق البث مقيّدة/) });
  expect(fixture.db.getRow('episodes', id)?.d.rundown[0].mediaIds || []).not.toContain(media.id);

  fixture.db.writeRow('episodes', id, after, p, null);
  const start = { c: 'onAir', op: 'upsert', id, d: { id, episodeId: id, status: 'LIVE', currentSegmentId: segment.id } };
  const denied = await director.post('/api/v1/data/sync').set(headers).send({ ops: [start] });
  expect(denied.body.results[0]).toMatchObject({ ok: false, code: 'FORBIDDEN', message: expect.stringMatching(/تمنع البث/) });
  expect((await producer.get(`/api/v1/episodes/${id}/mos`)).status).toBe(409);
  fixture.db.writeRow('episodes', id, d, p, null);
});

it('retains the source clip and its marks on a montage request', async () => {
  const producer = await loginAgent(fixture.app, 'producer@akhbar.tv');
  const id = 'mark-test-source';
  const title = 'مقابلة تجريبية';
  const url = 'https://example.invalid/camera.mp4';
  const editRanges = [{ id: 'usable-interview', inSeconds: 12.68, outSeconds: 28, note: 'استخدم الجملة كاملة' }];
  fixture.db.writeRow('media', id, { id, title, url, mediaType: 'VIDEO', editRanges }, 2000, null);
  const requestId = 'request-with-source';
  const operation = { c: 'requests', op: 'upsert', id: requestId, d: { id: requestId, type: 'MONTAGE', departmentId: 'montage', title, status: 'OPEN', priority: 'NORMAL', sourceMediaIds: [id] } };
  const result = await producer.post('/api/v1/data/sync').set(headers).send({ ops: [operation] });
  expect(result.body.results[0]).toMatchObject({ ok: true });
  expect(fixture.db.getRow('requests', requestId)?.d.sourceMediaIds).toEqual([id]);
  expect(fixture.db.getRow('media', id)?.d).toMatchObject({ url, editRanges });
});

it('consumes a one-time license when its segment goes live and blocks a later broadcast', async () => {
  const director = await loginAgent(fixture.app, 'director@akhbar.tv');
  const { id, d, p } = fixture.db.listCollection('episodes').find(row => row.d.rundown?.length >= 2)!;
  const mediaId = 'one-time-license';
  fixture.db.writeRow('media', mediaId, { id: mediaId, title: 'تصريح لمرة واحدة', mediaType: 'VIDEO', rights: { status: 'CLEARED', origin: 'ONE_TIME' } }, 4000, null);
  const [start, repeat, ...rest] = d.rundown;
  fixture.db.writeRow('episodes', id, { ...d, rundown: [{ ...start, mediaIds: [mediaId] }, { ...repeat, mediaIds: [mediaId] }, ...rest] }, p, null);

  const transition = async (status: string, currentSegmentId: string) => {
    const row = fixture.db.getRow('onAir', id);
    return (await director.post('/api/v1/data/sync').set(headers).send({ ops: [{ c: 'onAir', op: 'upsert', id, d: { id, episodeId: id, status, currentSegmentId }, ...(row ? { baseV: row.v } : {}) }] })).body.results[0];
  };
  expect((await transition('LIVE', start.id)).ok).toBe(true);
  expect(fixture.db.getRow('media', mediaId)?.d.broadcastUse).toMatchObject({ showId: id, segmentId: start.id, startedAt: fixture.db.getRow('onAir', id)?.d.startedAt });
  expect((await transition('LIVE', repeat.id)).ok).toBe(true);
  expect((await transition('ENDED', repeat.id)).ok).toBe(true);
  expect(await transition('LIVE', start.id)).toMatchObject({ ok: false, message: expect.stringMatching(/لمرة واحدة/) });
  fixture.db.writeRow('episodes', id, d, p, null);
});

it('uses an explicit mock Azure provider and saves seekable Arabic segments without reuploading', async () => {
  const { db, config } = fixture;
  const user = db.listCollection('users').find(row => row.d.email === 'editor@akhbar.tv')!.d;
  const sourceUrl = '/api/v1/media/files/synthetic-audio';
  const storedName = 'synthetic-audio.wav';
  const fakeAudio = Buffer.from('synthetic audio data for mocked provider');
  mkdirSync(uploadsDir(config.dataDir), { recursive: true });
  writeFileSync(path.join(uploadsDir(config.dataDir), storedName), fakeAudio);
  db.insertUpload({ id: 'synthetic-audio', storedName, originalName: 'sample.wav', mimeType: 'audio/wav', sizeBytes: fakeAudio.length, uploadedBy: user.id, createdAt: new Date().toISOString(), scope: 'media' });
  db.writeRow('media', 'mock-transcript', { id: 'mock-transcript', mediaType: 'AUDIO', url: sourceUrl }, 3000, null);
  const azure = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ phrases: [{ offsetMilliseconds: 150, durationMilliseconds: 1200, text: '  مرحبًا بكم ' }] }));
  const changed = vi.fn();
  const app = express();
  app.use((req, _res, next) => { req.auth = buildAuthContext(db, user, 'test-session'); next(); });
  app.use(mediaTranscriptionRouter(db, { ...config, mediaTranscription: { region: 'eastus', key: 'mock-test-key', ffmpeg: undefined } }, changed, azure));
  const response = await request(app).post('/mock-transcript/transcription');
  expect(response.status).toBe(200);
  expect(response.body.data).toMatchObject({ language: 'ar', sourceUrl, segments: [{ start: 0.15, end: 1.35, text: 'مرحبًا بكم' }] });
  const [endpoint, options] = azure.mock.calls[0];
  expect(endpoint).toBe('https://eastus.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe?api-version=2025-10-15');
  expect((options!.body as FormData).get('definition')).toBe('{"locales":["ar-PS"]}');
  expect((await request(app).post('/mock-transcript/transcription')).body.data).toEqual(response.body.data);
  expect(changed).toHaveBeenCalledTimes(1);
  expect(azure).toHaveBeenCalledTimes(1);
});

it('queues new local uploads only with opt-in and retries a temporary provider failure', async () => {
  expect(fixture.config.mediaTranscriptionAuto).toBe(false);
  const automated = await createTestServer({ MEDIA_TRANSCRIPTION_AUTO: 'true', MEDIA_TRANSCRIPTION_AZURE_REGION: 'eastus', MEDIA_TRANSCRIPTION_AZURE_KEY: 'mock-only-key' });
  try {
    const editor = await loginAgent(automated.app, 'editor@akhbar.tv');
    const uploaded = await editor.post('/api/v1/media/upload').set(headers).set('Content-Type', 'audio/wav').set('X-File-Name', 'automatic-test.wav').send(Buffer.from('synthetic file')).expect(201);
    const sourceUrl = uploaded.body.data.url;
    const id = 'automatic-test';
    const result = await editor.post('/api/v1/data/sync').set(headers).send({ ops: [{ c: 'media', op: 'upsert', id, d: { id, title: 'اختبار آلي', mediaType: 'AUDIO', url: sourceUrl } }] });
    expect(result.body.results[0].ok).toBe(true);
    const pending = automated.db.getRow('media', id)?.d.autoTranscriptionJob;
    expect(pending).toMatchObject({ sourceUrl, attempts: 0 });

    const azure = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(Response.json({ phrases: [{ offsetMilliseconds: 200, durationMilliseconds: 700, text: 'النص التجريبي' }] }));
    const work = autoTranscriptionTick(automated.db, automated.config, () => undefined, azure);
    const now = new Date(pending.nextAt);
    expect(await work(undefined, now)).toBe(true);
    const retry = automated.db.getRow('media', id)?.d.autoTranscriptionJob;
    expect(retry).toMatchObject({ sourceUrl, attempts: 1, failed: false });
    expect(await work(undefined, now)).toBe(false);
    expect(await work(undefined, new Date(retry.nextAt))).toBe(true);
    expect(automated.db.getRow('media', id)?.d).toMatchObject({ transcript: { segments: [{ start: 0.2, end: 0.9, text: 'النص التجريبي' }] } });
    expect(automated.db.getRow('media', id)?.d.autoTranscriptionJob).toBeUndefined();
    expect(azure).toHaveBeenCalledTimes(2);
  } finally {
    automated.close();
  }
});
