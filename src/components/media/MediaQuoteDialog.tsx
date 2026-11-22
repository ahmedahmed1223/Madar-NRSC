import { useState } from 'react';
import type { MediaAsset, User } from '../../types';
import { mediaTimecode, type MediaTranscriptSegment } from '../../shared/mediaEditorial';
import { newId } from '../../shared/ids';
import { apiService } from '../../services/api';
import { RbacService } from '../../services/rbacService';
import { confirmSaved } from '../../services/confirmSave';
import { notify } from '../../services/notify';
import { navigateTo } from '../../services/uiEvents';
import { Modal } from '../common/Modal';
import { RequestFormPage } from '../requests/RequestFormPage';

type Props = { asset: MediaAsset; segment: MediaTranscriptSegment; user: User; onClose: () => void };
const button = 'min-h-11 px-3 rounded-lg border border-slate-300 text-blue-700 text-xs font-bold disabled:opacity-50';
const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function MediaQuoteDialog({ asset, segment, user, onClose }: Props) {
  const [id] = useState(() => newId('nws'));
  const [request, setRequest] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const start = mediaTimecode(segment.start);
  const end = mediaTimecode(segment.end);
  const title = asset.title || asset.fileName || 'مادة وسائط';
  const source = `المصدر: ${title}\nالدخول ${start} – الخروج ${end}`;
  const canNews = RbacService.hasPermission(user, 'news.create') && RbacService.canOpenScreen(user, 'news');
  const canRequest = RbacService.hasPermission(user, 'requests.create') && RbacService.canOpenScreen(user, 'requests');

  async function news() {
    setBusy(true);
    setError('');
    try {
      const draft = apiService.saveNews({ id, title: `مقتطف من ${title}`.slice(0, 160), status: 'DRAFT',
        content: `<p>${escape(segment.text)}</p>`, internalNotes: source, mediaIds: [asset.id] });
      if (await confirmSaved('news', draft.id, 'أُنشئت مسودة بالمقتطف')) {
        onClose();
        navigateTo.emit(`/news/${encodeURIComponent(draft.id)}`);
      } else setError('لم يؤكد الخادم حفظ المسودة.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'تعذر حفظ مسودة الخبر');
    } finally {
      setBusy(false);
    }
  }

  if (request) return <RequestFormPage isOpen onClose={onClose}
    draft={{ type: 'MONTAGE', title: `مونتاج مقتطف من ${title}`.slice(0, 160), details: `${source}\n\n${segment.text}`, sourceMediaIds: [asset.id] }}
    onCreated={text => { notify({ type: 'success', message: text }); navigateTo.emit('/requests'); }} />;

  return <Modal isOpen onClose={() => { if (!busy) onClose(); }} title="نقل مقتطف من التفريغ" subtitle={title} maxWidth="sm">
    <div className="space-y-3">
      <p className="text-xs font-mono text-slate-600" dir="ltr">{start} – {end}</p>
      <p className="max-h-36 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-100 p-2 text-sm [overflow-wrap:anywhere]">{segment.text}</p>
      <div className="flex flex-wrap gap-2">
        {canNews && <button type="button" disabled={busy} onClick={() => void news()} className={button}>إنشاء مسودة خبر</button>}
        {canRequest && <button type="button" disabled={busy} onClick={() => setRequest(true)} className={button}>إعداد طلب مونتاج</button>}
      </div>
      {error && <p role="alert" className="text-xs font-bold text-rose-700">{error}</p>}
    </div>
  </Modal>;
}
