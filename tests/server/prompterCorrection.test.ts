import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTestServer, loginAgent } from '../helpers';
import { prompterScriptRevision } from '../../src/shared/prompterControls';

let server: Awaited<ReturnType<typeof createTestServer>>;
beforeAll(async () => { server = await createTestServer(); });
afterAll(() => server.close());

it('limits an already-read correction to the live presenter and alerts the operator once for the current copy', async () => {
  const presenter = await loginAgent(server.app, 'presenter@akhbar.tv');
  const director = await loginAgent(server.app, 'director@akhbar.tv');
  const colleague = await loginAgent(server.app, 'journalist@akhbar.tv');
  const directorId = (await director.get('/api/v1/auth/me')).body.user.id;
  const episode = server.db.getRow('episodes', 'ep-101')!;
  const first = episode.d.rundown[0];
  const script = 'تصحيح الرقم في الجملة الأولى. النص الجاري الآن.';
  const rundown = [{ ...first, scriptText: script }, ...episode.d.rundown.slice(1)];
  server.db.writeRow('episodes', episode.id, { ...episode.d, rundown }, episode.p, null);
  const now = new Date().toISOString();
  server.db.writeRow('onAir', episode.id, {
    id: episode.id, episodeId: episode.id, episodeTitle: episode.d.title, status: 'LIVE',
    currentSegmentId: first.id, startedAt: now, segmentStartedAt: now, operatorId: directorId, log: [],
  }, 0, null);

  const send = (agent: typeof presenter, data: { segmentId: string; revision: string }) =>
    agent.post(`/api/v1/onair/${episode.id}/prompter-correction`).set('X-NRCS-Client', 'web').send(data);
  const report = { segmentId: first.id, revision: prompterScriptRevision(script) };
  expect((await send(director, report)).status).toBe(403);
  expect((await send(presenter, { ...report, segmentId: 'previous-segment' })).status).toBe(409);
  expect((await send(presenter, { ...report, revision: prompterScriptRevision('نسخة قديمة') })).status).toBe(409);
  expect((await send(presenter, report)).status).toBe(200);
  expect((await send(presenter, report)).status).toBe(200);
  const cues = server.db.listCollection('cues').map(row => row.d).filter(cue => cue.episodeId === episode.id);
  expect(cues).toEqual([expect.objectContaining({
    purpose: 'PROMPTER_CORRECTION', level: 'urgent', targetUserId: directorId, message: expect.stringContaining('السماعة'),
  })]);
  expect(JSON.stringify((await director.get('/api/v1/data')).body)).toContain(cues[0].id);
  expect(JSON.stringify((await colleague.get('/api/v1/data')).body)).not.toContain(cues[0].id);
});
