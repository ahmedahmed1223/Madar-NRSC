import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ShieldCheck } from 'lucide-react';
import { Modal } from '../common/Modal';
import { apiService } from '../../services/api';
import type { DbStats } from '../../types';

export type DatabaseOperation = 'restore' | 'reset' | 'download' | 'export';

const TITLES: Record<DatabaseOperation, string> = {
  restore: 'تأكيد استعادة قاعدة البيانات',
  reset: 'تأكيد إعادة تهيئة قاعدة البيانات',
  download: 'تأكيد تنزيل ملف النسخة الاحتياطية',
  export: 'تأكيد تنزيل ملف قاعدة البيانات',
};

/**
 * Re-confirms the administrator's identity (password, and the authenticator code when enabled)
 * before restoring, resetting, or taking a full copy of the database off the server. A download
 * starts once the server issued its one-time link; every download is audited.
 */
export function DatabaseOperationConfirmation({ action, fileName, totpRequired, onClose, onComplete }: {
  action: DatabaseOperation; fileName?: string; totpRequired: boolean;
  onClose: () => void; onComplete: (stats?: DbStats) => void;
}) {
  const isDownload = action === 'download' || action === 'export';
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [airEnded, setAirEnded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const passwordInput = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => { if (error && !busy) passwordInput.current?.focus(); }, [error, busy]);
  const close = () => { if (!submitting.current) { setPassword(''); setTotp(''); onClose(); } };
  async function submit(event: React.FormEvent) {
    event.preventDefault(); event.stopPropagation();
    if (submitting.current || !password || (!isDownload && !airEnded) || (totpRequired && !totp)) return;
    submitting.current = true; setBusy(true); setError('');
    form.current?.focus();
    try {
      if (isDownload) {
        const url = await apiService.confirmedDownloadUrl(action, { fileName, password, totp: totpRequired ? totp : undefined });
        setPassword(''); setTotp('');
        const link = document.createElement('a');
        link.href = url;
        link.download = '';
        document.body.appendChild(link);
        link.click();
        link.remove();
        onComplete();
        return;
      }
      const confirmation = await apiService.confirmDatabaseOperation({ action, fileName, password, totp: totpRequired ? totp : undefined });
      setPassword(''); setTotp('');
      const stats = action === 'restore'
        ? await apiService.restoreBackup(fileName!, confirmation.token, true)
        : await apiService.resetDatabase(confirmation.token, true);
      onComplete(stats);
    } catch (failure) {
      setPassword(''); setTotp('');
      setError(failure instanceof Error ? failure.message : 'تعذر تنفيذ العملية؛ أعد تأكيد هويتك');
    } finally { submitting.current = false; setBusy(false); }
  }
  return createPortal(<Modal isOpen onClose={close} title={TITLES[action]} maxWidth="lg">
    <form ref={form} tabIndex={-1} onSubmit={event => void submit(event)} className="space-y-4" dir="rtl" onKeyDown={event => {
      if ((event.ctrlKey || event.metaKey) && ['s', 'Enter'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); }
    }}>
      <p className="text-sm text-slate-700">{isDownload ? 'الملف يحوي كل البيانات ومعها بصمات كلمات المرور وأسرار التحقق بخطوتين؛ احفظه في مكان آمن. يُسجَّل التنزيل في سجل التدقيق.' : 'سيتم استبدال بيانات المحتوى الحالية بعد إنشاء نسخة أمان. لا تنفذ العملية أثناء الهواء.'}</p>
      {fileName && <p dir="ltr" className="font-mono text-xs break-all text-slate-600">{fileName}</p>}
      <label className="block text-sm font-medium">كلمة المرور الحالية<input ref={passwordInput} type="password" autoComplete="current-password" required maxLength={200} disabled={busy} value={password} onChange={event => setPassword(event.target.value)} className="mt-2 w-full min-h-11 border border-slate-300 rounded-md px-3"/></label>
      {totpRequired && <label className="block text-sm font-medium">رمز المصادقة الثنائية<input type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required disabled={busy} value={totp} onChange={event => setTotp(event.target.value.replace(/\D/g, ''))} className="mt-2 w-full min-h-11 border border-slate-300 rounded-md px-3" dir="ltr"/></label>}
      {!isDownload && <label className="flex items-start gap-3 min-h-11 text-sm leading-6"><input type="checkbox" checked={airEnded} disabled={busy} onChange={event => setAirEnded(event.target.checked)} className="mt-1 h-5 w-5 shrink-0"/><span>أكدت انتهاء جميع جلسات الهواء، بما فيها الجلسات المحلية غير المتصلة</span></label>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {busy && <p role="status" className="text-sm">{isDownload ? 'جارٍ التحقق من هويتك…' : 'جار التحقق وتنفيذ العملية؛ انتظر تأكيد الخادم...'}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={close} disabled={busy} className="min-h-11 px-4 border border-slate-300 rounded-md text-sm disabled:opacity-50">إلغاء</button>
        <button type="submit" disabled={busy || !password || (!isDownload && !airEnded) || (totpRequired && totp.length !== 6)} className={`min-h-11 px-4 ${isDownload ? 'bg-indigo-700' : 'bg-red-700'} text-white rounded-md inline-flex items-center gap-2 text-sm disabled:opacity-50`}><ShieldCheck size={18}/>{action === 'restore' ? 'تأكيد وتنفيذ الاستعادة' : action === 'reset' ? 'تأكيد وتنفيذ إعادة التهيئة' : 'تأكيد الهوية والتنزيل'}</button>
      </div>
    </form>
  </Modal>, document.body);
}
