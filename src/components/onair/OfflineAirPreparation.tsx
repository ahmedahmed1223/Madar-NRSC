import React, { useEffect, useRef, useState } from 'react';
import { Download, Lock, Trash2, X } from 'lucide-react';
import { apiFetch } from '../../services/http';
import { authClient } from '../../services/authClient';
import { ensureOfflineShell } from '../../services/offlineAirShell';
import { savePacket, listPacketMetadata, deletePacket, exportEncryptedPacket, type OfflinePacketMetadata } from '../../services/offlineAirStore';
import type { OfflineAirPacket } from '../../shared/offlineAir';
import { confirmDialog } from '../../services/dialogs';

export function OfflineAirPreparation({ showId, userId }: { showId: string; userId: string }) {
  const [secret, setSecret] = useState('');
  const [consent, setConsent] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [ready, setReady] = useState<OfflinePacketMetadata | null>(null);
  const [saved, setSaved] = useState<OfflinePacketMetadata[]>([]);
  const generation = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const refresh = () => listPacketMetadata().then(rows => setSaved(rows.filter(row => row.userId === userId && row.showId === showId))).catch(() => setError('تعذر قراءة التخزين المحلي'));
  useEffect(() => {
    setReady(null); setSecret(''); setConsent(false); setProgress(''); setError(''); void refresh();
    return () => { generation.current++; abort.current?.abort(); };
  }, [showId, userId]);
  async function prepare(event: React.FormEvent) {
    event.preventDefault(); if (progress || !consent || secret.length < 8) return;
    const token = ++generation.current;
    abort.current = new AbortController();
    const current = () => token === generation.current && authClient.getSession()?.user.id === userId;
    let packetId: string | null = null;
    setError(''); setReady(null); setProgress('تنزيل نسخة الخادم المؤكدة');
    try {
      const result = await apiFetch<{ packet: OfflineAirPacket }>(`/api/v1/air-offline/packet/${encodeURIComponent(showId)}`, { signal: abort.current.signal });
      if (!current()) return;
      if (result.packet.userId !== userId) throw new Error('تغير المستخدم أثناء التجهيز');
      setProgress('تجهيز ملفات شاشة الأوفلاين');
      const shell = await ensureOfflineShell();
      if (!current()) return;
      setProgress('تشفير النسخة والتحقق من حفظها');
      packetId = result.packet.packetId;
      const metadata = await savePacket({ ...result.packet, shellVersion: shell.version }, secret);
      if (!current()) { await deletePacket(packetId); return; }
      setReady(metadata); setSecret(''); await refresh();
    } catch (error: any) { if (current()) setError(error?.message || 'تعذر تجهيز النسخة؛ بقيت النسخ السابقة محفوظة'); }
    finally { if (token === generation.current) setProgress(''); }
  }
  const download = async (row: OfflinePacketMetadata) => {
    try {
      const url = URL.createObjectURL(await exportEncryptedPacket(row.packetId));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `offline-air-${row.packetId}.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setError('تعذر تصدير النسخة المحلية'); }
  };
  return <section aria-label="تجهيز الهواء دون اتصال" className="border-t border-slate-200 pt-4 space-y-3">
    <h3 className="text-base font-bold">نسخة الهواء المحلية</h3>
    <form onSubmit={prepare} className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-sm">كلمة فتح النسخة<input aria-label="كلمة فتح النسخة" type="password" autoComplete="new-password" minLength={8} required disabled={!!progress} value={secret} onChange={event => setSecret(event.target.value)} className="min-h-11 border border-slate-300 rounded-md px-3"/></label>
      <label className="flex items-center gap-2 min-h-11 text-sm"><input type="checkbox" checked={consent} disabled={!!progress} onChange={event => setConsent(event.target.checked)}/>أوافق على حفظ نسخة مشفرة على هذا الجهاز</label>
      <button type="submit" disabled={!!progress || !consent || secret.length < 8} className="min-h-11 px-3 rounded-md bg-emerald-700 text-white disabled:opacity-50 flex items-center gap-2"><Lock size={18}/>تجهيز النسخة</button>
      {progress && <button type="button" onClick={() => { generation.current++; abort.current?.abort(); setProgress(''); }} className="min-h-11 px-3 rounded-md border flex items-center gap-2"><X size={18}/>إلغاء التجهيز</button>}
    </form>
    {progress && <p role="status" className="text-sm">{progress}</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {ready && <p role="status" className="text-sm text-emerald-700">تحقق حفظ النسخة وغلاف القراءة دون اتصال</p>}
    {saved.map(row => <div key={row.packetId} className="flex flex-wrap items-center gap-3 text-sm">
      <time dateTime={row.preparedAt}>{new Date(row.preparedAt).toLocaleString('ar')}</time>
      <a href={`/offline-air.html?packet=${encodeURIComponent(row.packetId)}`} target="_blank" rel="noopener" className="min-h-11 inline-flex items-center text-blue-700 underline">فتح النسخة المحلية</a>
      <button type="button" title="تصدير النسخة المشفرة" aria-label="تصدير النسخة المشفرة" onClick={() => void download(row)} className="min-h-11 min-w-11 grid place-items-center border rounded-md"><Download size={18}/></button>
      <button type="button" title="حذف النسخة المحلية" aria-label="حذف النسخة المحلية" className="min-h-11 min-w-11 grid place-items-center border rounded-md" onClick={async () => {
        if (!await confirmDialog({ title: 'حذف النسخة المحلية', message: 'صدّر النسخة المشفرة أولاً للاحتفاظ بأي تشغيل محلي غير مستورد. الحذف لا يغير بث الفريق.', confirmLabel: 'حذف النسخة', danger: true })) return;
        try { await deletePacket(row.packetId); if (ready?.packetId === row.packetId) setReady(null); await refresh(); } catch { setError('تعذر حذف النسخة'); }
      }}><Trash2 size={18}/></button>
    </div>)}
  </section>;
}
