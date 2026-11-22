import request from 'supertest';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestServer, loginAgent } from '../helpers';
import { sendDueGuestTechnicalInvitations } from '../../src/server/guestTechInvitations';
import { stationWall } from '../../src/shared/stationTime';
import { stationTimeZone } from '../../src/shared/dates';

let fixture: Awaited<ReturnType<typeof createTestServer>>;
beforeEach(async () => { fixture = await createTestServer(); });
afterEach(() => fixture.close());

const headers = { 'X-NRCS-Client': 'web' };
const prefix = '/api/v1/external-intake';
const tokenFrom = (path: string) => path.split('#')[1];

it('accepts an eligible one-time audiovisual upload into the library without a session', async () => {
  const settings = fixture.db.getRow('settings', 'singleton')!;
  fixture.db.writeRow('settings', settings.id, { ...settings.d, storage: { dropbox: { enabled: true } } }, settings.p, null);
  fixture.db.setMeta('storage.dropbox.credentials', JSON.stringify({ creds: { refreshToken: 'mock-storage-connection' } }));
  const admin = await loginAgent(fixture.app, 'admin@akhbar.tv');
  const viewer = await loginAgent(fixture.app, 'trainee@akhbar.tv');
  await viewer.post(prefix + '/links').set(headers).send({ kind: 'upload' }).expect(403);
  const created = await admin.post(prefix + '/links').set(headers).send({ kind: 'upload' }).expect(200);
  const token = tokenFrom(created.body.data.path);
  const external = request(fixture.app);
  expect((await external.post(prefix + '/info').set(headers).send({ token }).expect(200)).body.data.kind).toBe('upload');
  const submit = (type: string) => external.post(prefix + '/upload').set({
    ...headers, 'X-Madar-Intake': token, 'X-File-Name': 'original.wav', 'Content-Type': type,
  }).send(Buffer.from('RIFF0000WAVEfmt '));
  await submit('text/html').expect(415);
  await submit('audio/wav').expect(201);
  await submit('audio/wav').expect(410);
  const saved = fixture.db.listCollection('media').find(row => row.d.title === 'original.wav');
  expect(saved?.d).toMatchObject({ mediaType: 'AUDIO', ownerId: 'usr-1', tags: ['رفع خارجي'] });
  const uploadId = saved?.d.url.split('/').at(-1);
  expect(fixture.db.dueCopies('dropbox', 5).map(copy => copy.uploadId)).toContain(uploadId);
});

it('stores the result on the ticket’s confirmed online guest and prevents replay', async () => {
  const id = 'ep-101';
  const episode = fixture.db.getRow('episodes', id)!;
  fixture.db.writeRow('episodes', id, { ...episode.d, status: 'PREPARING', guests: [{
    guestId: 'gst-1', guestName: 'ضيف الاختبار', bookingStatus: 'CONFIRMED', arrivalStatus: 'CONFIRMED',
    connectionType: 'ZOOM_SKYPE', segmentTopic: 'ملف البرنامج',
  }] }, episode.p, null);
  const admin = await loginAgent(fixture.app, 'admin@akhbar.tv');
  const issued = await admin.post(prefix + '/links').set(headers).send({ kind: 'guest', guestId: 'gst-1', episodeId: id }).expect(200);
  const token = tokenFrom(issued.body.data.path);
  const external = request(fixture.app);
  const probe = Buffer.alloc(65536);
  const measured = await external.post(prefix + '/speed').set({
    ...headers, 'X-Madar-Intake': token, 'Content-Type': 'application/octet-stream',
  }).send(probe).expect(200);
  expect(measured.body.bytes).toBe(probe.byteLength);
  const submit = (uploadMbps: unknown) => external.post(prefix + '/guest-result').set(headers).send({
    token, camera: true, microphone: true, light: true, uploadMbps,
  });
  await submit(-1).expect(400);
  expect((await submit(4).expect(200)).body.ready).toBe(true);
  await submit(4).expect(410);
  expect(fixture.db.getRow('episodes', id)?.d.guests[0].technicalCheckStatus).toBe('PASSED');
});

it('sends one direct test-check invitation for a confirmed bulletin guest and stores a failed check', async () => {
  const db = fixture.db;
  for (const episode of db.listCollection('episodes')) {
    db.writeRow('episodes', episode.id, { ...episode.d, status: 'CANCELLED' }, episode.p, null);
  }
  const bulletin = db.getRow('bulletins', 'bul-demo-main')!;
  const now = Date.now();
  const zone = stationTimeZone(db.getRow('settings', 'singleton')?.d?.defaultTimezone);
  const scheduled = stationWall(now + 20 * 60_000, zone);
  db.writeRow('bulletins', bulletin.id, { ...bulletin.d, date: scheduled.date, startTime: scheduled.clock.slice(0, 5), status: 'DRAFT', editorId: 'usr-1' }, bulletin.p, null);
  db.writeRow('bulletinStories', 'guest-intake-story', { bulletinId: bulletin.id, id: 'guest-intake-story', type: 'LIVE',
    remoteGuest: { guestId: 'gst-1', confirmed: true } }, 0, null);
  const config = { ...fixture.config, autoGuestTechnicalEmail: true, appUrl: 'https://madar.example.org',
    mail: { host: 'unused', port: 587, secure: false, user: undefined, pass: undefined, from: 'test@example.org' } };
  const messages: string[] = [];
  const deliver = async (_config: unknown, _address: string, content: { text: string }) => { messages.push(content.text); };
  expect(await sendDueGuestTechnicalInvitations(db, config, now, deliver)).toBe(1);
  expect(await sendDueGuestTechnicalInvitations(db, config, now + 60_000, deliver)).toBe(0);
  expect(messages).toHaveLength(1);
  const match = messages[0].match(/https:\/\/madar\.example\.org\/intake#([A-Za-z0-9_-]+)/);
  expect(match).toBeTruthy();
  const checked = await request(fixture.app).post(prefix + '/guest-result').set(headers).send({
    token: match![1], camera: true, microphone: false, light: true, uploadMbps: 4,
  }).expect(200);
  expect(checked.body.ready).toBe(false);
  expect(db.getRow('bulletinStories', 'guest-intake-story')?.d.remoteGuest.check.status).toBe('FAILED');
});
