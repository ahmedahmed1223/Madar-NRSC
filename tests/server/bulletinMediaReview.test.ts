import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestServer, loginAgent } from '../helpers';
import { approveDueBulletinMedia } from '../../src/server/bulletinMediaReview';
import { evaluateBulletinReadiness } from '../../src/shared/bulletinReadiness';

const header = { 'X-NRCS-Client': 'web' };
const bulletinId = 'media-review-bulletin';
const storyId = 'media-review-story';
let server: Awaited<ReturnType<typeof createTestServer>>;

beforeEach(async () => {
  server = await createTestServer();
  const bulletin = server.db.listCollection('bulletins')[0].d;
  server.db.writeRow('bulletins', bulletinId, { ...bulletin, id: bulletinId, editorId: 'usr-2', approvalSteps: [] }, 0, null);
  for (const id of ['first', 'alternative']) {
    server.db.insertUpload({ id, storedName: `${id}.mp4`, originalName: `${id}.mp4`, scope: 'media', mimeType: 'video/mp4', sizeBytes: 24, uploadedBy: 'usr-3', createdAt: new Date().toISOString() });
    server.db.writeRow('media', id, { id, title: id, mediaType: 'VIDEO', durationSeconds: 30, url: `/api/v1/media/files/${id}` }, 0, 'usr-3');
  }
});
afterEach(() => server.close());

const row = () => server.db.getRow('bulletinStories', storyId)!;
const signIn = (role: 'journalist' | 'editor') => loginAgent(server.app, `${role}@akhbar.tv`);
type Agent = Awaited<ReturnType<typeof signIn>>;
async function save(writer: Agent, patch: Record<string, unknown>) {
  const current = row();
  const story = { id: storyId, bulletinId, rank: 1500, slug: 'القصة', type: 'PKG', script: '', clipSeconds: 30, status: 'DRAFT', ...current?.d, ...patch };
  const res = await writer.post('/api/v1/data/sync').set(header).send({ ops: [{ c: 'bulletinStories', id: storyId, op: 'upsert', d: story, baseV: current?.v }] });
  expect(res.body.results[0]).toMatchObject({ ok: true });
  return row().d;
}

const decide = (actor: Agent, action: 'APPROVE' | 'REQUEST_REPLACEMENT', reviewId = row().d.mediaReview.id) => actor
  .post(`/api/v1/bulletins/${bulletinId}/stories/${storyId}/media-review`).set(header).send({ action, reviewId });

it('starts one server-owned three-minute review and keeps full editorial approval independent', async () => {
  const writer = await signIn('journalist');
  const story = await save(writer, { clipMediaId: 'first', mediaReview: { state: 'APPROVED', deadlineAt: 'fake' } });
  const review = story.mediaReview;
  expect(review).toMatchObject({ state: 'PREVIEW', mediaId: 'first' });
  expect(Date.parse(review.deadlineAt) - Date.parse(review.startedAt)).toBe(180_000);
  const issues = evaluateBulletinReadiness(server.db.getRow('bulletins', bulletinId)!.d, [story], [], server.db.listCollection('media').map(row => row.d), new Date());
  expect(issues.map(issue => issue.code)).toEqual(expect.arrayContaining(['MEDIA_REVIEW', 'APPROVAL']));
  await save(writer, { slug: 'عنوان جديد' });
  expect(row().d.mediaReview).toEqual(review);
  expect(approveDueBulletinMedia(server.db, new Date(Date.parse(review.deadlineAt) - 1))).toBe(0);
  expect(approveDueBulletinMedia(server.db, new Date(review.deadlineAt))).toBe(1);
  expect(approveDueBulletinMedia(server.db, new Date(review.deadlineAt))).toBe(0);
  expect(row().d).toMatchObject({ status: 'DRAFT', rank: 1500, mediaReview: { state: 'APPROVED', decision: 'AUTOMATIC' } });
});

it('authorizes early decisions and keeps the rejected clip and its replacement out of auto-approval', async () => {
  const writer = await signIn('journalist');
  const editor = await signIn('editor');
  const first = await save(writer, { clipMediaId: 'first', floated: true });
  expect((await decide(writer, 'REQUEST_REPLACEMENT')).status).toBe(403);
  expect((await decide(editor, 'REQUEST_REPLACEMENT')).status).toBe(200);
  const minuteAfter = new Date(Date.parse(first.mediaReview.deadlineAt) + 60_000);
  expect(approveDueBulletinMedia(server.db, minuteAfter)).toBe(0);
  await save(writer, { clipMediaId: null });
  expect((await save(writer, { clipMediaId: 'first' })).mediaReview.state).toBe('REJECTED');
  const alternative = await save(writer, { clipMediaId: 'alternative' });
  expect(alternative).toMatchObject({ floated: true, rank: 1500, mediaReview: { state: 'REPLACEMENT', mediaId: 'alternative' } });
  expect(alternative.mediaReview.deadlineAt).toBeUndefined();
  expect(approveDueBulletinMedia(server.db, minuteAfter)).toBe(0);
  expect((await decide(editor, 'APPROVE', first.mediaReview.id)).status).toBe(409);
  expect((await decide(editor, 'APPROVE')).status).toBe(200);
  expect(row().d).toMatchObject({ floated: true, rank: 1500, status: 'DRAFT', mediaReview: { state: 'APPROVED', decision: 'MANUAL', decidedById: 'usr-2' } });
});

it('accepts an early review once, and requires a new review if the bytes behind that library entry change', async () => {
  const writer = await signIn('journalist');
  const editor = await signIn('editor');
  await save(writer, { clipMediaId: 'first' });
  expect((await decide(editor, 'APPROVE')).status).toBe(200);
  const approved = row();
  expect(approved.d.mediaReview.decision).toBe('MANUAL');
  expect((await decide(editor, 'APPROVE')).status).toBe(200);
  expect(row().v).toBe(approved.v);

  const media = server.db.getRow('media', 'first')!;
  server.db.writeRow('media', media.id, { ...media.d, fileUrl: '/api/v1/media/files/alternative' }, media.p, 'usr-3');
  const issues = evaluateBulletinReadiness(server.db.getRow('bulletins', bulletinId)!.d, [row().d], [], server.db.listCollection('media').map(row => row.d), new Date());
  expect(issues.some(issue => issue.code === 'MEDIA_REVIEW')).toBe(true);
  expect((await save(writer, { slug: 'تحديث' })).mediaReview).toMatchObject({ uploadId: 'alternative', state: 'REPLACEMENT' });
});

it('keeps expired preview out of air when media usage rights are revoked', async () => {
  const writer = await signIn('journalist');
  const editor = await signIn('editor');
  const { mediaReview } = await save(writer, { clipMediaId: 'first' });
  const media = server.db.getRow('media', 'first')!;
  server.db.writeRow('media', media.id, { ...media.d, rights: { status: 'RESTRICTED' } }, media.p, 'usr-3');
  expect((await decide(editor, 'APPROVE')).status).toBe(409);
  expect(approveDueBulletinMedia(server.db, new Date(mediaReview.deadlineAt))).toBe(1);
  expect(row().d.mediaReview.state).toBe('REPLACEMENT');
  expect((await decide(editor, 'APPROVE')).status).toBe(409);
});
