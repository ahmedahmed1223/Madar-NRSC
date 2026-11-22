import { useState } from 'react';
import type { User } from '../../types';
import type { ChatMessage } from '../../shared/chat';
import type { MessageActionContext } from '../../shared/messageActions';
import { newId } from '../../shared/ids';
import { apiService } from '../../services/api';
import { apiFetch } from '../../services/http';
import { confirmSaved } from '../../services/confirmSave';
import { notify } from '../../services/notify';
import { dataStore } from '../../services/dataStore';
import { RbacService } from '../../services/rbacService';
import { Modal } from '../common/Modal';
import { CardFormPage } from '../cards/CardFormPage';
import { RequestFormPage } from '../requests/RequestFormPage';

const options = [
  { id: 'news', permission: 'news.create', screen: 'news', label: 'إنشاء مسودة خبر' },
  { id: 'card', permission: 'cards.manage', screen: 'cards', label: 'إعداد تكليف إنتاجي' },
  { id: 'request', permission: 'requests.create', screen: 'requests', label: 'إعداد طلب لقسم' },
  { id: 'library', permission: 'media.upload', screen: 'media', label: 'حفظ المرفقات في مكتبتي' },
] as const;

type Action = (typeof options)[number]['id'];

const control = 'min-h-11 rounded-lg border border-slate-300 px-3 py-2 text-start text-xs font-bold text-blue-700 hover:bg-blue-50 disabled:opacity-50';
const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function MessageActionsDialog({ message, user, onClose, onNavigate }: { message: ChatMessage; user: User; onClose: () => void; onNavigate: (path: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [include, setInclude] = useState(false);
  const [draft, setDraft] = useState<{ action: 'card' | 'request'; data: MessageActionContext }>();
  const [workIds] = useState(() => ({ news: newId('nws'), card: newId('crd'), request: newId('req') }));
  const hasFiles = !!message.attachments?.length;
  const canKeep = hasFiles && RbacService.hasPermission(user, 'media.upload') && RbacService.hasPermission(user, 'media.view');
  const allowed = options.filter(option => RbacService.hasPermission(user, option.permission) && RbacService.canOpenScreen(user, option.screen) && (option.id !== 'library' || canKeep));

  function finish(path: string) {
    onClose();
    onNavigate(path);
  }

  async function act(action: Action) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const { data } = await apiFetch<{ data: MessageActionContext }>(`/api/v1/chat/actions/messages/${encodeURIComponent(message.id)}`, {
        method: 'POST', json: { action, workId: action === 'library' ? undefined : workIds[action], includeAttachments: action === 'library' || (canKeep && include) },
      });
      if (data.mediaIds.length) await dataStore.pull();
      if (action === 'library') {
        if (!data.mediaIds.length) throw new Error('المرفقات الأصلية غير متاحة');
        notify({ type: 'success', message: 'حُفظت مراجع المرفقات في مكتبتك' });
        finish(`/media/${encodeURIComponent(data.mediaIds[0])}`);
      } else if (action === 'news') {
        const content = data.text.split(/\r?\n/).filter(line => line.trim()).map(line => `<p>${escapeHtml(line)}</p>`).join('');
        const saved = apiService.saveNews({ id: workIds.news, title: data.suggestedTitle, status: 'DRAFT', content, mediaIds: data.mediaIds, messageOrigin: data.origin });
        if (await confirmSaved('news', saved.id, 'أُنشئت مسودة الخبر')) finish(`/news/${encodeURIComponent(saved.id)}`);
        else setError('لم يؤكد الخادم حفظ المسودة بعد.');
      } else setDraft({ action, data });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'تعذر تنفيذ إجراء الرسالة');
    } finally {
      setBusy(false);
    }
  }

  if (draft?.action === 'card') return <CardFormPage isOpen currentUser={user} users={apiService.getUsers()}
    onClose={onClose} onSaved={card => finish(`/cards/${encodeURIComponent(card.id)}`)}
    draft={{ id: workIds.card, title: draft.data.suggestedTitle, brief: draft.data.text, mediaIds: draft.data.mediaIds, messageOrigin: draft.data.origin }} />;
  if (draft?.action === 'request') return <RequestFormPage isOpen onClose={onClose}
    draft={{ id: workIds.request, title: draft.data.suggestedTitle, details: draft.data.text, sourceMediaIds: draft.data.montageMediaIds, messageOrigin: draft.data.origin }}
    onCreated={text => { notify({ type: 'success', message: text }); finish('/requests'); }} />;

  return <Modal isOpen title="إجراءات الرسالة" subtitle={message.userName ? `من ${message.userName}` : undefined} maxWidth="sm"
    onClose={() => { if (!busy) onClose(); }}>
    <div className="space-y-3 text-sm">
      {!!message.text.trim() && <p className="max-h-36 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-100 p-2 [overflow-wrap:anywhere]">{message.text}</p>}
      {canKeep && allowed.some(option => option.id !== 'library') && <label className="flex items-center gap-2 text-xs text-slate-800">
        <input type="checkbox" checked={include} disabled={busy} onChange={event => setInclude(event.target.checked)} /> مشاركة المرفقات مع من يستطيع فتح العمل المرتبط
      </label>}
      <div className="grid gap-2 sm:grid-cols-2">
        {!!message.text.trim() && <button type="button" className={control} disabled={busy} onClick={async () => {
          try { await navigator.clipboard.writeText(message.text); notify({ type: 'success', message: 'نُسخ نص الرسالة' }); onClose(); }
          catch { setError('تعذر نسخ نص الرسالة'); }
        }}>نسخ النص</button>}
        {allowed.map(option => <button type="button" className={control} disabled={busy} key={option.id} onClick={() => void act(option.id)}>{option.label}</button>)}
      </div>
      {error && <p role="alert" className="text-xs font-bold text-rose-700">{error}</p>}
      {busy && <p role="status" className="text-xs text-slate-700">جارٍ تجهيز الإجراء…</p>}
    </div>
  </Modal>;
}
