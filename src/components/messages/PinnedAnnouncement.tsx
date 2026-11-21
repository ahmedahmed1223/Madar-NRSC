import { Pin } from 'lucide-react';
import { useLiveData } from '../../hooks/useLiveData';
import { apiFetch } from '../../services/http';
import { dataStore } from '../../services/dataStore';
import { COLLECTIONS } from '../../shared/collections';
import { messageEntryPath, type ChatPin } from '../../shared/chat';

export async function changeAnnouncementPin(channel: string, messageId: string, remove: boolean) {
  await apiFetch('/api/v1/chat/pin', { method: 'POST', json: { channel, messageId, remove } });
  await dataStore.pull();
}

export function usePinnedAnnouncement(channel: string) {
  useLiveData(['chatPins']);
  return dataStore.get<ChatPin[]>(COLLECTIONS.chatPins.storageKey, []).find(pin => pin.id === channel);
}

export function PinnedAnnouncement({ pin, onOpen, onRemove }: { pin: ChatPin; onOpen: (path: string) => void; onRemove?: () => void }) {
  return <div className="flex items-start gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
    <Pin className="mt-1 size-4 shrink-0 text-blue-700" aria-hidden="true" />
    <div className="min-w-0 flex-1">
      <p className="font-semibold text-slate-900">بلاغ مثبّت</p>
      <button type="button" className="min-h-9 break-words text-start text-blue-700 hover:underline" onClick={() => onOpen(messageEntryPath(pin.id, pin.messageId))}>{pin.excerpt}</button>
    </div>
    {onRemove && <button type="button" className="min-h-11 shrink-0 px-2 hover:underline" onClick={onRemove}>إلغاء التثبيت</button>}
  </div>;
}
