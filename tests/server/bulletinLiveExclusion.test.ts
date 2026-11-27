import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestServer, loginAgent } from '../helpers';
import { bulletinAsShow } from '../../src/shared/bulletins';
import { liveTiming } from '../../src/shared/onair';

let server: Awaited<ReturnType<typeof createTestServer>>;
const bulletinId = 'live-exclusion-test';
const ids = ['current-story', 'skip-story', 'next-story'];
const header = { 'X-NRCS-Client': 'web' };
beforeEach(async () => {
  server = await createTestServer();
  const bulletin = server.db.listCollection('bulletins')[0].d;
  server.db.writeRow('bulletins', bulletinId, { ...bulletin, id: bulletinId, editorId: 'usr-2', approvalSteps: [], status: 'PLANNING' }, 0, null);
  ids.forEach((id, index) => server.db.writeRow('bulletinStories', id, { id, bulletinId, rank: (index + 1) * 1000, slug: id,
    type: 'READER', script: `نص قصة النشرة ${index + 1}`, status: 'APPROVED', writerId: 'usr-2' }, index, 'usr-2'));
});
afterEach(() => server.close());

it('keeps the presenter on the current story until the next take, while skipping excluded stories and alerting the team', async () => {
  const control = await loginAgent(server.app, 'admin@akhbar.tv');
  const editor = await loginAgent(server.app, 'editor@akhbar.tv');
  const sync = async (actor: typeof control, op: object) => (await actor.post('/api/v1/data/sync').set(header).send({ ops: [op] })).body.results[0];
  const state = () => server.db.getRow('onAir', bulletinId);
  const take = (status: 'LIVE' | 'ENDED', currentSegmentId: string) => sync(control, { c: 'onAir', op: 'upsert', id: bulletinId,
    baseV: state()?.v, d: { id: bulletinId, episodeId: bulletinId, status, currentSegmentId } });
  expect(await take('LIVE', ids[0])).toMatchObject({ ok: true });
  const startedAt = state()!.d.segmentStartedAt;
  for (const id of ids.slice(0, 2)) {
    const row = server.db.getRow('bulletinStories', id)!;
    expect(await sync(editor, { c: 'bulletinStories', op: 'upsert', id, baseV: row.v, d: { ...row.d, killed: true } })).toMatchObject({ ok: true });
  }
  const bulletin = server.db.getRow('bulletins', bulletinId)!.d;
  const stories = ids.map(id => server.db.getRow('bulletinStories', id)!.d);
  const shown = bulletinAsShow(bulletin, stories, state()!.d.currentSegmentId);
  expect(shown.rundown.map(segment => segment.id)).toEqual([ids[0], ids[2]]);
  expect(liveTiming(state()!.d, shown)).toMatchObject({ current: { id: ids[0], scriptText: stories[0].script }, next: { id: ids[2] } });
  expect(state()!.d.segmentStartedAt).toBe(startedAt);
  const cues = server.db.listCollection('cues').filter(row => row.d.episodeId === bulletinId).map(row => row.d);
  expect(cues).toHaveLength(2);
  expect(cues.some(cue => cue.message.includes(ids[0]) && cue.targetDepartmentIds.includes('direction'))).toBe(true);
  expect(await take('LIVE', ids[1])).toMatchObject({ ok: false });
  expect(await take('ENDED', ids[0])).toMatchObject({ ok: true });
});
