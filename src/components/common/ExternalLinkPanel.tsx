import { useState } from 'react';
import { apiFetch } from '../../services/http';
import { appLocale, zoneOptions } from '../../shared/dateFormat';

type Props = { kind: 'upload' } | { kind: 'guest'; episodeId: string; guestId: string } | { kind: 'guest'; bulletinStoryId: string; guestId: string };
type Link = { path: string; expiresAt: string; emailed?: boolean };

export function ExternalLinkPanel(props: Props) {
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<Link>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const url = link ? new URL(link.path, window.location.origin).href : '';
  const create = async (email: boolean) => {
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await apiFetch<{ data: Link }>('/api/v1/external-intake/links', {
        method: 'POST', body: JSON.stringify({ ...props, email }),
      });
      setLink(response.data);
      setMessage(response.data.emailed ? 'أُرسل الرابط إلى بريد الضيف.' : '');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'تعذر إنشاء الرابط.'); }
    finally { setBusy(false); }
  };
  return (
    <div className="w-full min-w-0">
      <button type="button" aria-expanded={open} className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold text-blue-700" onClick={() => setOpen(!open)}>
        {props.kind === 'upload' ? 'رابط رفع خارجي' : 'رابط الفحص الذاتي'}
      </button>
      {open && <div className="mt-2 space-y-2 rounded-xl border border-slate-200 bg-white p-3 text-sm">
        <p>{props.kind === 'upload' ? 'يتيح الرابط رفع ملف فيديو أو صوت واحد إلى المكتبة خلال 24 ساعة.' : 'يفحص الضيف جهازه دون حساب ويرسل النتيجة إلى هذه الحلقة.'}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => void create(false)} className="min-h-11 rounded-lg bg-blue-700 px-3 text-xs font-bold text-white disabled:opacity-50">إنشاء الرابط</button>
          {props.kind === 'guest' && <button type="button" disabled={busy} onClick={() => void create(true)} className="min-h-11 rounded-lg border border-slate-300 px-3 text-xs font-bold disabled:opacity-50">إرسال إلى بريد الضيف</button>}
        </div>
        {link && <div className="space-y-2">
          <label className="block">رابط المشاركة<input dir="ltr" className="mt-1 w-full rounded-md border border-slate-300 p-2" value={url} readOnly onFocus={event => event.target.select()} /></label>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="min-h-11 rounded-md border border-slate-300 px-3" onClick={async () => {
              try { await navigator.clipboard.writeText(url); setMessage('نُسخ الرابط.'); }
              catch { setMessage('حدد الرابط في الحقل لنسخه.'); }
            }}>نسخ الرابط</button>
            <span className="text-xs text-slate-600">ينتهي في {new Date(link.expiresAt).toLocaleString(appLocale(), { ...zoneOptions(), dateStyle: 'short', timeStyle: 'short' })}</span>
          </div>
        </div>}
        {message && <p role="status" className="text-emerald-800">{message}</p>}
        {error && <p role="alert" className="text-rose-800">{error}</p>}
      </div>}
    </div>
  );
}
