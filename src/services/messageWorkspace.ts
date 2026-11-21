import { useSyncExternalStore } from 'react';
import { parseChannel, publicMessageOrigin } from '../shared/chat';

interface Draft { text: string; urgent: boolean }
interface Workspace { publicChannel: string | null; drafts: ReadonlyMap<string, Draft> }
const empty: Workspace = { publicChannel: null, drafts: new Map() };
const accounts = new Map<string, Workspace>();
const positions = new Map<string, Map<string, string>>();
const listeners = new Set<() => void>();

const read = (userId: string) => accounts.get(userId) ?? empty;
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

function update(userId: string, next: Workspace) {
  if (!userId) return;
  accounts.set(userId, next);
  listeners.forEach(listener => listener());
}

export function useMessageWorkspace(userId: string) {
  return useSyncExternalStore(subscribe, () => read(userId));
}

export function selectPublicMessageChannel(userId: string, channel: string) {
  const kind = parseChannel(channel)?.kind;
  const current = read(userId);
  if ((kind === 'general' || kind === 'department') && current.publicChannel !== channel) update(userId, { ...current, publicChannel: channel });
}

export function saveMessageDraft(userId: string, channel: string, draft: Draft) {
  const current = read(userId);
  const drafts = new Map(current.drafts);
  if (draft.text || draft.urgent) drafts.set(channel, draft);
  else drafts.delete(channel);
  update(userId, { ...current, drafts });
}

export function clearSentMessageDraft(userId: string, channel: string, sent: Draft) {
  const current = read(userId).drafts.get(channel);
  if (current?.text === sent.text && current.urgent === sent.urgent) saveMessageDraft(userId, channel, { text: '', urgent: false });
}

export const messagePosition = (userId: string, channel: string) => positions.get(userId)?.get(channel);

export function rememberMessagePosition(userId: string, channel: string, list: HTMLElement, latest: boolean) {
  if (!userId) return;
  if (latest) { positions.get(userId)?.delete(channel); return; }
  const top = list.getBoundingClientRect().top;
  const first = Array.from(list.querySelectorAll<HTMLElement>('[data-chat-message]')).find(row => row.getBoundingClientRect().bottom > top);
  const id = first?.dataset.chatMessage;
  if (!id) return;
  const saved = positions.get(userId) || new Map<string, string>();
  saved.set(channel, id);
  positions.set(userId, saved);
}

export function scrollToMessage(list: HTMLElement, id: string) {
  const row = Array.from(list.querySelectorAll<HTMLElement>('[data-chat-message]')).find(row => row.dataset.chatMessage === id);
  if (!row) return false;
  list.scrollTop += row.getBoundingClientRect().top - list.getBoundingClientRect().top;
  return true;
}

export interface MessageTaskOrigin { channel: string; messageId: string; label: string; suggestedTitle: string }
const taskOrigins = new Map<string, MessageTaskOrigin>();

export function queueMessageTask(userId: string, origin: MessageTaskOrigin) {
  if (publicMessageOrigin(origin.channel, origin.messageId)) taskOrigins.set(userId, origin);
}

export function takeMessageTask(userId: string) {
  const origin = taskOrigins.get(userId);
  taskOrigins.delete(userId);
  return origin;
}
