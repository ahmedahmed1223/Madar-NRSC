import { publicMessageOrigin, type ChatMessage } from './chat';

export interface MessageActionOrigin {
  messageId: string;
  channel?: string;
  senderId: string;
  senderName: string;
  timestamp: string;
}

export interface PrivateMessageMedia {
  messageId: string;
  uploadId: string;
  work?: MessageWork;
}

export type MessageWorkCollection = 'news' | 'productionCards' | 'requests';
export interface MessageWork { collection: MessageWorkCollection; id: string }

export function messageWorkMediaIds(collection: MessageWorkCollection, data?: { sourceMediaIds?: string[]; mediaIds?: string[] }): string[] {
  const ids = collection === 'requests' ? data?.sourceMediaIds : data?.mediaIds;
  return Array.isArray(ids) ? ids : [];
}

export interface MessageActionContext {
  origin: MessageActionOrigin;
  text: string;
  suggestedTitle: string;
  mediaIds: string[];
  montageMediaIds: string[];
}

export const messageActionOrigin = (message: ChatMessage): MessageActionOrigin => ({
  messageId: message.id,
  ...(publicMessageOrigin(message.channel, message.id) ? { channel: message.channel } : {}),
  senderId: message.userId || '',
  senderName: message.userName || 'مرسل غير مسجل',
  timestamp: message.timestamp || '',
});

export const MESSAGE_MEDIA_URL_PREFIX = '/api/v1/chat/actions/media/';
