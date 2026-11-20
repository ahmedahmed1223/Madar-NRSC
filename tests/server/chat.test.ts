import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type request from 'supertest';
import { createTestServer, loginAgent } from '../helpers';
import { dmChannel, groupChannel, stationChannel } from '../../src/shared/chat';

let server: Awaited<ReturnType<typeof createTestServer>>;
const H = { 'X-NRCS-Client': 'web' };
const sync = (agent: request.Agent, ops: any[]) => agent.post('/api/v1/data/sync').set(H).send({ ops });
const send = (agent: request.Agent, id: string, d: Record<string, unknown>) => sync(agent, [{ c: 'messages', op: 'upsert', id, d: { id, ...d } }]);
const visible = async (agent: request.Agent, collection: string) => ((await agent.get('/api/v1/data')).body.collections[collection] || []).map((r: any) => r.d);
const upload = (agent: request.Agent, name: string, type: string, body: string) => agent.post('/api/v1/chat/upload').set(H).set('Content-Type', type).set('X-File-Name', encodeURIComponent(name)).send(Buffer.from(body));

let editor: request.Agent; // usr-2
let journalist: request.Agent; // usr-3
let reporter: request.Agent; // usr-6
let viewer: request.Agent; // usr-9

beforeAll(async () => {
  server = await createTestServer();
  editor = await loginAgent(server.app, 'editor@akhbar.tv');
  journalist = await loginAgent(server.app, 'journalist@akhbar.tv');
  reporter = await loginAgent(server.app, 'reporter@akhbar.tv');
  viewer = await loginAgent(server.app, 'trainee@akhbar.tv');
});
afterAll(() => server.close());

describe('direct messages', () => {
  const channel = dmChannel('usr-2', 'usr-3');

  it('reach the two people only, with the author stamped by the server', async () => {
    const sent = await send(editor, 'msg-dm-1', { channel, text: ' هل وصلت الشهادة؟ ', userId: 'usr-9', userName: 'مزيف', to: ['usr-6'] });
    expect(sent.body.results[0].ok).toBe(true);
    const row = server.db.getRow('messages', 'msg-dm-1')!.d;
    expect(row).toMatchObject({ text: 'هل وصلت الشهادة؟', userId: 'usr-2', to: ['usr-2', 'usr-3'] });
    expect(row.userName).not.toBe('مزيف');

    expect((await visible(journalist, 'messages')).some((m: any) => m.id === 'msg-dm-1')).toBe(true);
    expect((await visible(reporter, 'messages')).some((m: any) => m.id === 'msg-dm-1')).toBe(false);
    // Later changes are filtered the same way.
    const since = (await reporter.get('/api/v1/data')).body.rev;
    await send(journalist, 'msg-dm-2', { channel, text: 'نعم، وصلت' });
    expect((await reporter.get(`/api/v1/data/changes?since=${since}`)).body.changes.some((r: any) => r.id === 'msg-dm-2')).toBe(false);
    expect((await editor.get(`/api/v1/data/changes?since=${since}`)).body.changes.some((r: any) => r.id === 'msg-dm-2')).toBe(true);
  });

  it('cannot be posted into by a third person, or to someone who is not there', async () => {
    expect((await send(reporter, 'msg-dm-x', { channel, text: 'تطفل' })).body.results[0]).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect((await send(editor, 'msg-dm-y', { channel: dmChannel('usr-2', 'usr-none'), text: 'x' })).body.results[0].ok).toBe(false);
    expect((await send(editor, 'msg-dm-z', { channel: 'SECRET', text: 'x' })).body.results[0].ok).toBe(false);
  });

  it('notify the other person once per conversation until they read it', async () => {
    const mine = () => server.db.listCollection('notifications').map((r) => r.d).filter((n) => n.userId === 'usr-3' && n.linkUrl === `/messages/${encodeURIComponent(channel)}`);
    expect(mine()).toHaveLength(1);
    expect(mine()[0]).toMatchObject({ category: 'message' });
    expect(mine()[0].title).toContain('رسالة من');
    await send(editor, 'msg-dm-3', { channel, text: 'رسالة ثانية' });
    expect(mine()).toHaveLength(1);
    // An urgent message always gets through.
    await send(editor, 'msg-dm-urgent', { channel, text: 'الضيف اعتذر', isUrgent: true });
    expect(mine()).toHaveLength(2);
    expect(mine().some((n) => n.urgent)).toBe(true);
  });

  it('stay immutable', async () => {
    const row = server.db.getRow('messages', 'msg-dm-1')!;
    expect((await sync(editor, [{ c: 'messages', op: 'upsert', id: 'msg-dm-1', d: { ...row.d, text: 'معدّلة' }, baseV: row.v }])).body.results[0].ok).toBe(false);
    expect((await sync(editor, [{ c: 'messages', op: 'delete', id: 'msg-dm-1' }])).body.results[0].ok).toBe(false);
  });

  it('does not attach private records to rejected synchronization results', async () => {
    const row = server.db.getRow('messages', 'msg-dm-1')!;
    const ops = [
      { c: 'messages', op: 'delete', id: row.id },
      { c: 'messages', op: 'upsert', id: row.id, baseV: row.v - 1, d: { channel, text: 'مسودة محلية' } },
    ];
    const rejected = (await sync(reporter, ops)).body.results;
    expect(rejected).toHaveLength(2);
    for (const result of rejected) {
      expect(result).toMatchObject({ ok: false, code: 'FORBIDDEN' });
      expect(result.current).toBeUndefined();
    }
    const permittedConflict = (await sync(editor, [ops[1]])).body.results[0];
    expect(permittedConflict).toMatchObject({ ok: false, code: 'CONFLICT', current: { id: row.id, v: row.v } });
  });
});

describe('groups', () => {
  const group = (extra: Record<string, unknown> = {}) => ({ c: 'conversations', op: 'upsert', id: 'cnv-1', d: { id: 'cnv-1', name: ' تغطية غزة ', memberIds: ['usr-2', 'usr-3'], ownerId: 'usr-9', ...extra } });

  it('are created by people allowed to and seen by members only', async () => {
    expect((await sync(viewer, [{ ...group(), d: { ...group().d, memberIds: ['usr-9', 'usr-3'] } }])).body.results[0]).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect((await sync(editor, [group()])).body.results[0].ok).toBe(true);
    expect(server.db.getRow('conversations', 'cnv-1')!.d).toMatchObject({ name: 'تغطية غزة', ownerId: 'usr-2' });
    expect((await visible(journalist, 'conversations')).map((c: any) => c.id)).toEqual(['cnv-1']);
    expect(await visible(reporter, 'conversations')).toEqual([]);
  });

  it('carry messages to the people who were members when they were sent', async () => {
    const channel = groupChannel('cnv-1');
    expect((await send(reporter, 'msg-g-x', { channel, text: 'لست عضواً' })).body.results[0].ok).toBe(false);
    expect((await send(journalist, 'msg-g-1', { channel, text: 'قبل انضمام المراسلة' })).body.results[0].ok).toBe(true);
    expect(server.db.getRow('messages', 'msg-g-1')!.d.to).toEqual(['usr-2', 'usr-3']);

    // The owner adds the reporter: she reads what comes next, not what came before.
    const row = server.db.getRow('conversations', 'cnv-1')!;
    expect((await sync(journalist, [{ c: 'conversations', op: 'upsert', id: 'cnv-1', d: { ...row.d, memberIds: [...row.d.memberIds, 'usr-6'] }, baseV: row.v }])).body.results[0].ok).toBe(false);
    expect((await sync(editor, [{ c: 'conversations', op: 'upsert', id: 'cnv-1', d: { ...row.d, memberIds: [...row.d.memberIds, 'usr-6'] }, baseV: row.v }])).body.results[0].ok).toBe(true);
    await send(editor, 'msg-g-2', { channel, text: 'أهلاً بالمراسلة' });
    const hers = (await visible(reporter, 'messages')).filter((m: any) => m.channel === channel).map((m: any) => m.id);
    expect(hers).toEqual(['msg-g-2']);
    const note = server.db.listCollection('notifications').map((r) => r.d).find((n) => n.userId === 'usr-6' && String(n.linkUrl).startsWith('/messages/'));
    expect(note.title).toContain('تغطية غزة');
  });

  it('tell a removed member\'s browser that the group is gone', async () => {
    const since = (await reporter.get('/api/v1/data')).body.rev;
    const row = server.db.getRow('conversations', 'cnv-1')!;
    expect((await sync(editor, [{ c: 'conversations', op: 'upsert', id: 'cnv-1', d: { ...row.d, memberIds: row.d.memberIds.filter((id: string) => id !== 'usr-6') }, baseV: row.v }])).body.results[0].ok).toBe(true);
    const change = (await reporter.get(`/api/v1/data/changes?since=${since}`)).body.changes.find((r: any) => r.id === 'cnv-1');
    expect(change).toMatchObject({ c: 'conversations', deleted: true });
    expect(change.d).toBeUndefined();
    // Rows of other private collections never travel to people who may not read them.
    const others = (await reporter.get(`/api/v1/data/changes?since=0`)).body;
    expect(others.reset || !others.changes.some((r: any) => r.c === 'messages' && String(r.d?.channel).startsWith('dm:usr-2:usr-3'))).toBe(true);
  });

  it('let a member leave, and the owner delete', async () => {
    let row = server.db.getRow('conversations', 'cnv-1')!;
    expect((await sync(journalist, [{ c: 'conversations', op: 'upsert', id: 'cnv-1', d: { ...row.d, memberIds: row.d.memberIds.filter((id: string) => id !== 'usr-3') }, baseV: row.v }])).body.results[0].ok).toBe(true);
    expect(await visible(journalist, 'conversations')).toEqual([]);
    expect((await send(journalist, 'msg-g-3', { channel: groupChannel('cnv-1'), text: 'بعد المغادرة' })).body.results[0].ok).toBe(false);
    // What she received while a member is still hers.
    expect((await visible(journalist, 'messages')).some((m: any) => m.id === 'msg-g-1')).toBe(true);
    row = server.db.getRow('conversations', 'cnv-1')!;
    expect((await sync(reporter, [{ c: 'conversations', op: 'delete', id: 'cnv-1' }])).body.results[0].ok).toBe(false);
    expect((await sync(editor, [{ c: 'conversations', op: 'upsert', id: 'cnv-1', d: { ...row.d, deletedAt: new Date().toISOString() }, baseV: row.v }])).body.results[0].ok).toBe(true);
    expect((await send(editor, 'msg-g-4', { channel: groupChannel('cnv-1'), text: 'بعد الحذف' })).body.results[0].ok).toBe(false);
  });
});

describe('open channels, references and read markers', () => {
  it('carry station and department channels and a reference to a record', async () => {
    expect((await send(reporter, 'msg-st-1', { channel: stationChannel('gaza'), text: 'تحديث من غزة', ref: { kind: 'news', id: 'nws-1', title: ' خبر القمة ' } })).body.results[0].ok).toBe(true);
    expect(server.db.getRow('messages', 'msg-st-1')!.d).toMatchObject({ ref: { kind: 'news', id: 'nws-1', title: 'خبر القمة' } });
    expect(server.db.getRow('messages', 'msg-st-1')!.d.to).toBeUndefined();
    expect((await send(reporter, 'msg-st-2', { channel: stationChannel('mars'), text: 'x' })).body.results[0].ok).toBe(false);
    expect((await send(reporter, 'msg-q-1', { channel: 'quality', text: 'للمراجعة' })).body.results[0].ok).toBe(true);
    expect((await visible(viewer, 'messages')).some((m: any) => m.id === 'msg-st-1')).toBe(true);
  });

  it('keep each colleague\'s read marker private', async () => {
    const mark = (agent: request.Agent, userId: string, baseV?: number) => sync(agent, [{ c: 'chatReads', op: 'upsert', id: userId, d: { id: userId, userId, seen: { general: new Date().toISOString() } }, ...(baseV ? { baseV } : {}) }]);
    expect((await mark(editor, 'usr-2')).body.results[0].ok).toBe(true);
    expect((await mark(journalist, 'usr-2', server.db.getRow('chatReads', 'usr-2')!.v)).body.results[0].ok).toBe(false);
    expect(await visible(journalist, 'chatReads')).toEqual([]);
    expect((await visible(editor, 'chatReads')).map((r: any) => r.id)).toEqual(['usr-2']);
  });

  it('serve older history to the people of the conversation only', async () => {
    const channel = dmChannel('usr-2', 'usr-3');
    const before = encodeURIComponent(new Date(Date.now() + 60_000).toISOString());
    const mine = await editor.get(`/api/v1/chat/history?channel=${encodeURIComponent(channel)}&before=${before}`);
    expect(mine.body.data.map((m: any) => m.id)).toEqual(['msg-dm-1', 'msg-dm-2', 'msg-dm-3', 'msg-dm-urgent']);
    const theirs = await reporter.get(`/api/v1/chat/history?channel=${encodeURIComponent(channel)}&before=${before}`);
    expect(theirs.body.data).toEqual([]);
    expect((await editor.get('/api/v1/chat/history?channel=SECRET&before=x')).status).toBe(400);
  });
});

describe('files in messages', () => {
  it('are uploaded by any colleague, attached by their uploader and read with the message', async () => {
    const up = await upload(journalist, 'محضر الاجتماع.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'محتوى');
    expect(up.status).toBe(201);
    expect(up.body.data).toMatchObject({ name: 'محضر الاجتماع.docx', size: Buffer.byteLength('محتوى') });
    const id = up.body.data.id;
    expect(server.db.getUpload(id)?.scope).toBe('chat');
    expect((await reporter.get(`/api/v1/media/files/${id}`)).status).toBe(404);
    expect((await upload(journalist, 'x.exe', 'application/x-msdownload', 'MZ')).status).toBe(415);

    // Someone else cannot attach a file they did not upload.
    const channel = dmChannel('usr-2', 'usr-3');
    expect((await send(editor, 'msg-f-x', { channel, text: '', attachments: [{ id }] })).body.results[0]).toMatchObject({ ok: false, code: 'INVALID' });
    const sent = await send(journalist, 'msg-f-1', { channel, text: '', attachments: [{ id, name: 'اسم مزور.pdf', mimeType: 'application/pdf', size: 1 }] });
    expect(sent.body.results[0].ok).toBe(true);
    expect(server.db.getRow('messages', 'msg-f-1')!.d.attachments).toEqual([{ id, name: 'محضر الاجتماع.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: Buffer.byteLength('محتوى') }]);

    const mine = await editor.get(`/api/v1/chat/files/${id}`);
    expect(mine.status).toBe(200);
    expect(mine.headers['content-disposition']).toContain('attachment');
    expect(mine.headers['x-content-type-options']).toBe('nosniff');
    expect(mine.headers['cache-control']).toContain('no-store');
    expect((await editor.get(`/api/v1/media/files/${id}`)).status).toBe(404);
    expect((await reporter.get(`/api/v1/chat/files/${id}`)).status).toBe(404);
    expect((await reporter.get('/api/v1/chat/files/..%2Fsecret')).status).toBe(404);
  });

  it('show pictures in place and survive the clean-up of unused uploads', async () => {
    const up = await upload(reporter, 'صورة.png', 'image/png', 'png-bytes');
    const id = up.body.data.id;
    await send(reporter, 'msg-f-2', { channel: 'general', text: 'صورة من الميدان', attachments: [{ id }] });
    const file = await viewer.get(`/api/v1/chat/files/${id}`);
    expect(file.status).toBe(200);
    expect(file.headers['content-disposition']).toContain('inline');

    const unused = (await upload(reporter, 'لم ترسل.png', 'image/png', 'x')).body.data.id;
    const orphans = server.db.findOrphanUploads(-60_000).map((u) => u.id);
    expect(orphans).toContain(unused);
    expect(orphans).not.toContain(id);
  });
});
