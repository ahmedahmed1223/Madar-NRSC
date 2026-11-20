import { describe, expect, it } from 'vitest';
import { canReadMessage, chatReadsError, chatRefLink, conversationChangeError, dmChannel, groupChannel, messageError, parseChannel, sendError, stationChannel, unreadByChannel, type Conversation } from '../../src/shared/chat';

const users = new Set(['a', 'b', 'c', 'd']);
const group: Conversation = { id: 'g1', name: 'تغطية غزة', memberIds: ['a', 'b'], ownerId: 'a' };
const ctx = { users, stations: new Set(['gaza']), conversations: [group] };
const msg = (channel: string, extra: Record<string, unknown> = {}) => ({ id: 'm1', channel, text: 'مرحبا', ...extra });

describe('channels', () => {
  it('gives two people one conversation whoever starts it', () => {
    expect(dmChannel('b', 'a')).toBe(dmChannel('a', 'b'));
    expect(parseChannel(dmChannel('b', 'a'))).toEqual({ kind: 'dm', userIds: ['a', 'b'] });
  });

  it('recognises open channels, stations, groups and rejects the rest', () => {
    expect(parseChannel('general')).toEqual({ kind: 'general' });
    expect(parseChannel('montage')).toEqual({ kind: 'department', id: 'montage' });
    expect(parseChannel('quality')?.kind).toBe('department');
    expect(parseChannel(stationChannel('gaza'))).toEqual({ kind: 'station', id: 'gaza' });
    expect(parseChannel(groupChannel('g1'))).toEqual({ kind: 'group', id: 'g1' });
    expect(parseChannel('NEWSROOM')?.kind).toBe('legacy');
    for (const bad of ['SECRET', 'dm:a', 'dm:b:a', 'dm:a:a', 'dm:a:b:c', 'grp:', 'st:a b', '', null, 5]) expect(parseChannel(bad), String(bad)).toBeNull();
  });
});

describe('who reads a message', () => {
  it('keeps a direct message between its two people', () => {
    const m = msg(dmChannel('a', 'b'));
    expect(canReadMessage(m, 'a')).toBe(true);
    expect(canReadMessage(m, 'b')).toBe(true);
    expect(canReadMessage(m, 'c')).toBe(false);
  });

  it('shows a group message to the people it was sent to', () => {
    const m = msg(groupChannel('g1'), { to: ['a', 'b'] });
    expect(canReadMessage(m, 'b')).toBe(true);
    expect(canReadMessage(m, 'c')).toBe(false);
    // Without the server's list nobody reads it.
    expect(canReadMessage(msg(groupChannel('g1')), 'a')).toBe(false);
  });

  it('opens channels to everyone and hides malformed messages', () => {
    expect(canReadMessage(msg('general'), 'z')).toBe(true);
    expect(canReadMessage(msg(stationChannel('gaza')), 'z')).toBe(true);
    expect(canReadMessage(msg('SECRET'), 'a')).toBe(false);
    expect(canReadMessage(null, 'a')).toBe(false);
  });
});

describe('sending', () => {
  it('needs text or a file, and a well-formed reference', () => {
    expect(messageError(msg('general'))).toBeNull();
    expect(messageError(msg('general', { text: '  ' }))).toContain('اكتب رسالة');
    expect(messageError(msg('general', { text: '', attachments: [{ id: 'upl-1' }] }))).toBeNull();
    expect(messageError(msg('general', { attachments: [{ id: 'upl-1' }, { id: 'upl-1' }] }))).toContain('مرفق');
    expect(messageError(msg('general', { attachments: new Array(11).fill(0).map((_, i) => ({ id: `u${i}` })) }))).toContain('الحد الأقصى');
    expect(messageError(msg('general', { text: 'x'.repeat(4001) }))).toContain('نص الرسالة');
    expect(messageError(msg('general', { ref: { kind: 'news', id: 'nws-1', title: 'خبر' } }))).toBeNull();
    expect(messageError(msg('general', { ref: { kind: 'secret', id: 'x', title: 'x' } }))).toContain('الإشارة');
    expect(messageError(msg('general', { ref: { kind: 'news', id: 'nws-1', title: ' ' } }))).toContain('الإشارة');
  });

  it('only lets the people of a conversation post to it', () => {
    expect(sendError(msg(dmChannel('a', 'b')), 'a', ctx)).toBeNull();
    expect(sendError(msg(dmChannel('a', 'b')), 'c', ctx)).toContain('ليست لك');
    expect(sendError(msg(dmChannel('a', 'gone')), 'a', ctx)).toContain('غير موجود');
    expect(sendError(msg(groupChannel('g1')), 'b', ctx)).toBeNull();
    expect(sendError(msg(groupChannel('g1')), 'c', ctx)).toContain('لست عضواً');
    expect(sendError(msg(groupChannel('nope')), 'a', ctx)).toContain('غير موجودة');
    expect(sendError(msg(groupChannel('g1')), 'a', { ...ctx, conversations: [{ ...group, deletedAt: 'x' }] })).toContain('غير موجودة');
    expect(sendError(msg(stationChannel('gaza')), 'c', ctx)).toBeNull();
    expect(sendError(msg(stationChannel('mars')), 'c', ctx)).toContain('محطة');
  });

  it('links a reference to the screen of its record', () => {
    expect(chatRefLink({ kind: 'news', id: 'nws-1', title: 'x' })).toBe('/news/nws-1');
    expect(chatRefLink({ kind: 'card', id: 'crd-1', title: 'x' })).toBe('/cards/crd-1');
    expect(chatRefLink({ kind: 'episode', id: 'e1', title: 'x' })).toBe('/episodes/e1');
    expect(chatRefLink({ kind: 'bulletin', id: 'b1', title: 'x' })).toBe('/bulletins/b1');
  });
});

describe('groups', () => {
  const change = (before: Conversation | null, after: Partial<Conversation>, actor: string, canCreate = true) => conversationChangeError(before, { ...group, ...after } as Conversation, actor, canCreate, users);

  it('are created by people allowed to, with themselves and at least one colleague', () => {
    expect(change(null, {}, 'a')).toBeNull();
    expect(change(null, {}, 'a', false)).toContain('صلاحياتك');
    expect(change(null, { memberIds: ['b', 'c'] }, 'a')).toContain('عضو فيها');
    expect(change(null, { memberIds: ['a'] }, 'a')).toContain('عضوين');
    expect(change(null, { name: ' ' }, 'a')).toContain('اسم المجموعة');
    expect(change(null, { memberIds: ['a', 'ghost'] }, 'a')).toContain('غير موجود');
    expect(change(null, { memberIds: ['a', 'b', 'b'] }, 'a')).toContain('غير صالحة');
  });

  it('are renamed and staffed by their owner only', () => {
    expect(change(group, { name: 'اسم جديد', memberIds: ['a', 'b', 'c'] }, 'a')).toBeNull();
    expect(change(group, { name: 'اسم جديد' }, 'b')).toContain('لمنشئها');
    expect(change(group, { memberIds: ['a', 'b', 'c'] }, 'b')).toContain('لمنشئها');
    expect(change(group, { memberIds: ['a', 'b', 'c'] }, 'c')).toContain('لست عضواً');
    expect(change(group, { memberIds: ['b'] }, 'a')).toContain('ملكية');
  });

  it('let a member leave, and nothing else', () => {
    const three = { ...group, memberIds: ['a', 'b', 'c'] };
    expect(change(three, { memberIds: ['a', 'c'] }, 'b')).toBeNull();
    expect(change(three, { memberIds: ['a'] }, 'b')).toContain('لمنشئها');
    expect(change(three, { memberIds: ['a', 'c'], name: 'x' }, 'b')).toContain('لمنشئها');
  });

  it('keep a member who has since left the station from blocking edits', () => {
    const withGone = { ...group, memberIds: ['a', 'b', 'gone'] };
    expect(change(withGone, { memberIds: ['a', 'b', 'gone'], name: 'اسم آخر' }, 'a')).toBeNull();
  });
});

describe('read markers', () => {
  it('belong to their owner and hold known channels', () => {
    expect(chatReadsError({ id: 'a', userId: 'a', seen: { general: '2026-11-19T10:00:00Z' } }, 'a')).toBeNull();
    expect(chatReadsError({ id: 'b', userId: 'b', seen: {} }, 'a')).toContain('مؤشر قراءته');
    expect(chatReadsError({ id: 'a', userId: 'a', seen: { SECRET: 'x' } }, 'a')).toContain('غير صالح');
    expect(chatReadsError({ id: 'a', userId: 'a', seen: [] }, 'a')).toContain('غير صالح');
  });

  it('count private messages until read and open channels only once visited', () => {
    const at = (h: number) => `2026-11-19T${String(h).padStart(2, '0')}:00:00Z`;
    const messages = [
      { id: '1', channel: dmChannel('a', 'b'), text: 'x', userId: 'b', timestamp: at(8) },
      { id: '2', channel: dmChannel('a', 'b'), text: 'x', userId: 'b', timestamp: at(9) },
      { id: '3', channel: dmChannel('a', 'b'), text: 'x', userId: 'a', timestamp: at(10) },
      { id: '4', channel: 'general', text: 'x', userId: 'b', timestamp: at(9) },
      { id: '5', channel: 'montage', text: 'x', userId: 'b', timestamp: at(9) },
    ];
    expect(Object.fromEntries(unreadByChannel(messages, undefined, 'a'))).toEqual({ [dmChannel('a', 'b')]: 2 });
    const reads = { id: 'a', userId: 'a', seen: { [dmChannel('a', 'b')]: at(8), general: at(7) } };
    expect(Object.fromEntries(unreadByChannel(messages, reads, 'a'))).toEqual({ [dmChannel('a', 'b')]: 1, general: 1 });
  });
});
