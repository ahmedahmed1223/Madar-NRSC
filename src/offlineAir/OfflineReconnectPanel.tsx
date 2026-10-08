import { useState } from 'react';
import type { OfflineAirPacket } from '../shared/offlineAir';
import type { OfflineAirSession } from '../shared/offlineAirSession';
export function OfflineReconnectPanel({ packet, session }: { packet: OfflineAirPacket; session: OfflineAirSession }) {
  const [server, setServer] = useState<any>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false);
  const [imported, setImported] = useState(false);
  async function compare() {
    setBusy(true); setError(''); setConsent(false);
    try {
      const response = await fetch(`/api/v1/air-offline/state/${encodeURIComponent(packet.show.id)}`, { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'يلزم تسجيل الدخول أو استعادة الاتصال');
      if (result.dbId !== packet.dbId || result.userId !== packet.userId) throw new Error('تختلف هوية المستخدم أو قاعدة البيانات');
      setServer(result);
    } catch (error: any) { setServer(null); setError(error.message || 'الخادم غير متاح'); }
    finally { setBusy(false); }
  }
  async function importLog() {
    if (!consent || !server || session.status !== 'ENDED') return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/v1/air-offline/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-NRCS-Client': 'web' }, body: JSON.stringify({ sessionId: session.sessionId, packetId: packet.packetId, dbId: packet.dbId, showId: packet.show.id, preparedAt: packet.preparedAt, proof: packet.proof, events: session.events }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'فشل استيراد السجل');
      setImported(true);
    } catch (error: any) { setError(error.message); }
    finally { setBusy(false); }
  }
  return <section aria-label="مراجعة الاتصال واستيراد السجل"><h2>مراجعة نسخة الفريق</h2><button disabled={busy} onClick={() => void compare()}>فحص الاتصال ومقارنة البث</button>{error && <p role="alert">{error}</p>}{server && <><p>بث الخادم: {server.state?.status || 'لم يبدأ'} · الفقرة {server.state?.currentSegmentId || 'لا توجد'}</p><p>التشغيل المحلي: {session.status} · {session.events.length} إجراء</p><a href="/on-air" target="_blank" rel="noopener">فتح بث الفريق الحالي</a>{session.status === 'ENDED' && <><label><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)}/>أوافق على استيراد تقرير محلي منفصل دون تغيير بث الفريق</label><button disabled={busy || !consent || imported} onClick={() => void importLog()}>استيراد السجل المحلي</button></>}</>}{imported && <p role="status">استُورد السجل المحلي دون تغيير البث المشترك</p>}</section>;
}
