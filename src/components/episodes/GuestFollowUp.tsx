import React, { useRef, useState } from 'react';
import { Save, RefreshCw } from 'lucide-react';
import type { EpisodeGuest, User } from '../../types';
import { fromLocalInputValue, toLocalInputValue } from '../../shared/dates';
import { basisZone } from '../../shared/dateFormat';
import { guestFollowUpWarnings, technicalCheckStatuses } from '../../shared/guestFollowUp';

const labels = { NOT_REQUIRED: 'غير مطلوب', PENDING: 'بانتظار الاختبار', PASSED: 'نجح', FAILED: 'يحتاج معالجة' };
type Props = { guest: EpisodeGuest; users: User[]; canEdit: boolean; onSave: (patch: Partial<EpisodeGuest>) => boolean | Promise<boolean> };
export function GuestFollowUp({ guest, users, canEdit, onSave }: Props) {
  const [draft, setDraft] = useState<Partial<EpisodeGuest> | null>(null);
  const value = { ...guest, ...draft };
  const [busy, setBusy] = useState(false);
  const guard = useRef(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const change = (patch: Partial<EpisodeGuest>) => { setDraft(prev => ({ ...prev, ...patch })); setSaved(false); };
  const save = async () => {
    if (guard.current || !canEdit || !draft) return;
    guard.current = true; setBusy(true); setError('');
    try {
      if (await onSave(draft)) { setDraft(null); setSaved(true); }
      else setError('لم يؤكد الخادم الحفظ؛ القيم باقية لإعادة المحاولة');
    } catch (e) { setError(e instanceof Error ? e.message : 'تعذر حفظ متابعة الضيف'); }
    finally { guard.current = false; setBusy(false); }
  };
  const owner = users.find(u => u.id === value.contactOwnerId);
  return <section aria-label={`متابعة ${guest.guestName}`} className="border-t border-slate-200 pt-3 space-y-2">
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      <label className="text-xs font-semibold">مسؤول التواصل<select disabled={!canEdit || busy} value={value.contactOwnerId || ''} onChange={e => change({ contactOwnerId: e.target.value || undefined })} className="block w-full min-h-11 border border-slate-300 rounded px-2 bg-white">
        <option value="">غير محدد</option>
        {value.contactOwnerId && (!owner || owner.isActive === false || owner.deletedAt) && <option value={value.contactOwnerId}>{owner?.fullName || 'مسؤول سابق'} (غير نشط)</option>}
        {users.filter(u => u.isActive !== false && !u.deletedAt).map(u => <option key={u.id} value={u.id}>{u.fullName}</option>)}
      </select></label>
      <label className="text-xs font-semibold">نتيجة الاختبار الفني<select disabled={!canEdit || busy} value={value.technicalCheckStatus || 'NOT_REQUIRED'} onChange={e => change({ technicalCheckStatus: e.target.value as EpisodeGuest['technicalCheckStatus'] })} className="block w-full min-h-11 border border-slate-300 rounded px-2 bg-white">
        {technicalCheckStatuses.map(s => <option key={s} value={s}>{labels[s]}</option>)}
      </select></label>
      <label className="text-xs font-semibold">موعد الاختبار الفني<input disabled={!canEdit || busy} type="datetime-local" value={value.technicalCheckAt ? toLocalInputValue(value.technicalCheckAt) : ''} onChange={e => change({ technicalCheckAt: e.target.value ? fromLocalInputValue(e.target.value) : undefined })} className="block w-full min-h-11 border border-slate-300 rounded px-2 bg-white" /><span className="text-slate-500 font-normal">{basisZone() || Intl.DateTimeFormat().resolvedOptions().timeZone}</span></label>
      <label className="text-xs font-semibold">ملاحظة الاختبار الفني<textarea disabled={!canEdit || busy} rows={2} maxLength={1000} value={value.technicalCheckNote || ''} onChange={e => change({ technicalCheckNote: e.target.value })} className="block w-full border border-slate-300 rounded p-2 bg-white" /></label>
    </div>
    {guestFollowUpWarnings(value).map(w => <p key={w} className="text-xs text-amber-800">{w}</p>)}
    {error && <p role="alert" className="text-xs text-rose-700">{error}</p>}
    {saved && <p role="status" className="text-xs text-emerald-700">تم حفظ متابعة الضيف على الخادم</p>}
    {canEdit && draft && <button type="button" disabled={busy} onClick={() => void save()} className="min-h-11 px-3 flex items-center gap-2 bg-blue-600 text-white rounded disabled:opacity-50">{error ? <RefreshCw size={16} /> : <Save size={16} />}{busy ? 'جارٍ الحفظ...' : error ? 'إعادة محاولة حفظ المتابعة' : 'حفظ متابعة الضيف'}</button>}
  </section>;
}
