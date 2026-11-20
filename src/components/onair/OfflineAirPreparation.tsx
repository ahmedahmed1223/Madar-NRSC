import React, { useEffect, useRef, useState } from 'react';
import { Download, Lock, Trash2, X } from 'lucide-react';
import { apiFetch } from '../../services/http';
import { authClient } from '../../services/authClient';
import { ensureOfflineShell } from '../../services/offlineAirShell';
import { savePacket, listPacketMetadata, deletePacket, exportEncryptedPacket, type OfflinePacketMetadata } from '../../services/offlineAirStore';
import type { OfflineAirPacket } from '../../shared/offlineAir';
import { confirmDialog } from '../../services/dialogs';
import { appLocale, zoneOptions } from '../../shared/dateFormat';
import { compareOfflineAirSnapshot, fingerprintOfflineAirSnapshot } from '../../shared/offlineAirFreshness';

const freshnessText = {
  MATCHES: 'تطابق آخر بيانات متزامنة',
  CHANGED: 'تختلف عن آخر بيانات متزامنة',
  UNKNOWN: 'تعذر التحقق من الحداثة',
};

export function OfflineAirPreparation({ showId, userId, snapshot, dbId }: { showId: string; userId: string; snapshot?: string; dbId?: string }) {
  const [secret, setSecret] = useState('');
  const [consent, setConsent] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [ready, setReady] = useState<OfflinePacketMetadata | null>(null);
  const [saved, setSaved] = useState<OfflinePacketMetadata[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [comparison, setComparison] = useState<{ snapshot: string; fingerprint: string }>();
  const generation = useRef(0);
  const metadataRequest = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const refresh = async () => {
    const request = ++metadataRequest.current;
    try {
      const rows = await listPacketMetadata();
      if (request !== metadataRequest.current) return;
      setSaved(rows.filter(row => row.userId === userId && row.showId === showId).sort((a, b) => b.preparedAt.localeCompare(a.preparedAt)));
      setLoaded(true);
    } catch {
      if (request === metadataRequest.current) setError('تعذر قراءة التخزين المحلي');
    }
  };
  useEffect(() => {
    setReady(null); setSecret(''); setConsent(false); setProgress(''); setError(''); setSaved([]); setLoaded(false); void refresh();
    return () => { generation.current++; metadataRequest.current++; abort.current?.abort(); };
  }, [showId, userId]);
  useEffect(() => {
    if (!snapshot) return;
    let active = true;
    void fingerprintOfflineAirSnapshot(snapshot).then(fingerprint => {
      if (active) setComparison({ snapshot, fingerprint });
    }).catch(() => {});
    return () => { active = false; };
  }, [snapshot]);
  const currentSnapshot = dbId && comparison && comparison.snapshot === snapshot ? { dbId, snapshotFingerprint: comparison.fingerprint } : null;
  const freshness = (row: OfflinePacketMetadata) => compareOfflineAirSnapshot(row, currentSnapshot);
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
    } catch (error: any) {
      // Our own messages are Arabic; a raw browser or parser error (English) gets a plain Arabic one.
      const message = typeof error?.message === 'string' && /[\u0600-\u06FF]/.test(error.message) ? error.message : '';
      if (current()) setError(message || 'تعذر تجهيز النسخة؛ بقيت النسخ السابقة محفوظة');
    }
    finally { if (token === generation.current) setProgress(''); }
  }
  const download = async (row: OfflinePacketMetadata) => {
    try {
      const url = URL.createObjectURL(await exportEncryptedPacket(row.packetId));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `offline-air-${row.packetId}.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setError('تعذر تصدير النسخة المحلية'); }
  };
  // Collapsed: most shows are never prepared for offline air, and the control board is the first job.
  return <section aria-label="تجهيز الهواء دون اتصال" className="border-t border-slate-200 pt-2">
   <details className="space-y-3">
    <summary className="min-h-11 flex flex-wrap items-center gap-2 cursor-pointer">
      <h3 className="text-base font-bold text-slate-800">نسخة الهواء المحلية</h3>
      {saved[0] ? <span className="text-xs font-semibold text-slate-700">آخر نسخة: {freshnessText[freshness(saved[0])]}</span> : loaded && <span className="text-xs text-slate-600">لا توجد نسخة لهذا البث على الجهاز</span>}
    </summary>
    <form onSubmit={prepare} className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-sm">كلمة فتح النسخة<input aria-label="كلمة فتح النسخة" type="password" autoComplete="new-password" minLength={8} required disabled={!!progress} value={secret} onChange={event => setSecret(event.target.value)} className="min-h-11 border border-slate-300 rounded-xl px-3 bg-white"/></label>
      <label className="flex items-center gap-2 min-h-11 text-sm"><input type="checkbox" checked={consent} disabled={!!progress} onChange={event => setConsent(event.target.checked)}/>أوافق على حفظ نسخة مشفرة على هذا الجهاز</label>
      <button type="submit" disabled={!!progress || !consent || secret.length < 8} className="min-h-11 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold disabled:opacity-50 flex items-center gap-2"><Lock size={18} aria-hidden/>تجهيز النسخة</button>
      {progress && <button type="button" onClick={() => { generation.current++; abort.current?.abort(); setProgress(''); }} className="min-h-11 px-3 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-sm font-semibold flex items-center gap-2"><X size={18} aria-hidden/>إلغاء التجهيز</button>}
    </form>
    {progress && <p role="status" className="text-sm">{progress}</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {ready && <p role="status" className="text-sm text-emerald-700">تحقق حفظ النسخة وغلاف القراءة دون اتصال</p>}
    {saved.map(row => <div key={row.packetId} className="flex flex-wrap items-center gap-3 text-sm">
      <span>جُهزت في <time dateTime={row.preparedAt} className="tabular-nums">{new Date(row.preparedAt).toLocaleString(appLocale(), { ...zoneOptions(), dateStyle: 'medium', timeStyle: 'short' })}</time></span>
      <span className={freshness(row) === 'CHANGED' ? 'font-semibold text-amber-800' : 'text-slate-700'}>{freshnessText[freshness(row)]}</span>
      <a href={`/offline-air.html?packet=${encodeURIComponent(row.packetId)}`} target="_blank" rel="noopener" className="min-h-11 inline-flex items-center text-blue-700 underline">فتح النسخة المحلية</a>
      <button type="button" title="تصدير النسخة المشفرة" aria-label="تصدير النسخة المشفرة" onClick={() => void download(row)} className="min-h-11 min-w-11 grid place-items-center border border-slate-300 rounded-xl hover:bg-slate-50"><Download size={18}/></button>
      <button type="button" title="حذف النسخة المحلية" aria-label="حذف النسخة المحلية" className="min-h-11 min-w-11 grid place-items-center border border-slate-300 rounded-xl text-red-600 hover:bg-red-50" onClick={async () => {
        if (!await confirmDialog({ title: 'حذف النسخة المحلية', message: 'صدّر النسخة المشفرة أولاً للاحتفاظ بأي تشغيل محلي غير مستورد. الحذف لا يغير بث الفريق.', confirmLabel: 'حذف النسخة', danger: true })) return;
        try { await deletePacket(row.packetId); if (ready?.packetId === row.packetId) setReady(null); await refresh(); } catch { setError('تعذر حذف النسخة'); }
      }}><Trash2 size={18}/></button>
    </div>)}
   </details>
  </section>;
}
