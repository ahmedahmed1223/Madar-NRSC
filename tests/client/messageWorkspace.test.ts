import { describe, expect, it } from 'vitest';
import { queueMessageTask, takeMessageTask } from '../../src/services/messageWorkspace';
import { messageEntryPath, splitMessageFocus } from '../../src/shared/chat';
import { parsePath, routeToPath } from '../../src/services/router';
import { relatedTaskPath } from '../../src/services/taskBoard';

describe('message-linked work', () => {
  it('preserves a public message URL through the router and task link', () => {
    const path = messageEntryPath('st:beirut', 'msg-1');
    const { view, id } = parsePath(path);
    expect(splitMessageFocus(id)).toEqual({ channel: 'st:beirut', messageId: 'msg-1' });
    expect(routeToPath({ nav: view, focusId: id })).toBe(path);
    expect(relatedTaskPath({ relatedEntityType: 'MESSAGE', relatedEntityId: id! })).toBe(path);
    expect(relatedTaskPath({ relatedEntityType: 'MESSAGE', relatedEntityId: 'dm:alice:bob/entry/msg-2' })).toBeNull();
  });

  it('offers a public message draft to the initiating account once', () => {
    const origin = { channel: 'field', messageId: 'msg-source', label: 'المراسلون', suggestedTitle: 'متابعة' };
    queueMessageTask('a', origin);
    queueMessageTask('b', { ...origin, channel: 'dm:alice:bob' });
    expect(takeMessageTask('b')).toBeUndefined();
    expect(takeMessageTask('a')).toEqual(origin);
    expect(takeMessageTask('a')).toBeUndefined();
  });
});
