import { messageEntryPath } from '../../shared/chat';
import type { MessageActionOrigin } from '../../shared/messageActions';
import { navigateTo } from '../../services/uiEvents';

export function MessageOriginLabel({ origin }: { origin?: MessageActionOrigin }) {
  if (!origin) return null;
  const path = origin.channel && messageEntryPath(origin.channel, origin.messageId);
  return <p className="text-xs text-slate-600">
    المصدر: رسالة من <bdi className="font-semibold">{origin.senderName}</bdi>
    {path && <button type="button" className="ms-2 min-h-9 font-bold text-blue-700 hover:underline" onClick={() => navigateTo.emit(path)}>فتح الرسالة الأصلية</button>}
  </p>;
}
