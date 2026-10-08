import { useEffect, useState } from 'react';
import type { OfflineAirPacket } from '../shared/offlineAir';
import { plainText } from '../shared/bulletins';
export interface OfflineScriptDraft { segmentId: string; baseline: string; script: string; baseV: number; collection: 'episodes' | 'bulletinStories'; id: string; }
export function OfflineScriptDrafts({ packet, segmentId, draft, onSave }: { packet: OfflineAirPacket; segmentId: string; draft?: OfflineScriptDraft; onSave: (value: OfflineScriptDraft | null) => Promise<void> }) {
  const segment = packet.show.segments.find(row => row.id === segmentId)!;
  const base = packet.baseRows.find(row => row.segmentId === segmentId);
  const [text, setText] = useState(draft?.script ?? plainText(segment.script));
  const [current, setCurrent] = useState<any>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => { setText(draft?.script ?? plainText(segment.script)); setCurrent(null); setConsent(false); setError(''); }, [segmentId]);
  async function request(url: string, body?: unknown) {
    const response = await fetch(url, { cache: 'no-store', ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-NRCS-Client': 'web' }, body: JSON.stringify(body) } : {}) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || 'تعذر الاتصال بالخادم'); return result;
  }
  async function compare() {
    if (!base) return; setBusy(true); setError(''); setConsent(false);
    try {
      const result = await request(`/api/v1/air-offline/draft-target/${base.collection}/${encodeURIComponent(base.id)}`);
      if (result.dbId !== packet.dbId || result.userId !== packet.userId) throw new Error('تغير المستخدم أو قاعدة البيانات');
      setCurrent(result.row);
    } catch (error: any) { setError(error.message); } finally { setBusy(false); }
  }
  async function apply() {
    if (!draft || !current || !consent || current.v !== draft.baseV) return;
    setBusy(true); setError(''); let held: any = null;
    try {
      const lockId = `${draft.collection}:${draft.id}`;
      const me = await request('/api/v1/auth/me');
      if (me.user?.id !== packet.userId) throw new Error('تغير المستخدم أثناء المقارنة؛ لم تطبق المسودة');
      const bootstrap = await request('/api/v1/data');
      if (bootstrap.dbId !== packet.dbId) throw new Error('تغيرت قاعدة البيانات');
      const existing = bootstrap.collections.editLocks.find((row: any) => row.id === lockId);
      if (existing?.d.userId !== packet.userId && Date.parse(existing?.d.expiresAt || '') > Date.now()) throw new Error('المادة قيد التحرير لدى زميل؛ لم يتم الاستيلاء على قفله');
      const locks = await request('/api/v1/data/sync', { ops: [{ c: 'editLocks', op: 'upsert', id: lockId, ...(existing ? { baseV: existing.v } : {}), d: { id: lockId, collection: draft.collection, entityId: draft.id, heartbeat: Date.now() } }] });
      if (!locks.results[0].ok) throw new Error(locks.results[0].message);
      held = locks.results[0].row;
      await request('/api/v1/air-offline/apply-draft', { ...draft, userId: packet.userId, dbId: packet.dbId });
      setCurrent(null); setConsent(false); setSaved(true);
    } catch (error: any) { setError(error.message); }
    finally {
      if (held) await request('/api/v1/data/sync', { ops: [{ c: 'editLocks', op: 'delete', id: held.id, baseV: held.v }] }).catch(() => setError('تعذر تحرير القفل؛ سينتهي تلقائياً'));
      setBusy(false);
    }
  }
  if (!packet.canEdit || !base || base.collection === 'bulletins') return null;
  const remoteScript = current?.c === 'episodes' ? current.d.rundown?.find((row: any) => row.id === segmentId)?.scriptText : current?.d.script;
  return <section aria-label="مسودة النص المحلية"><h2>مسودة محلية منفصلة</h2><label>النص المحلي<textarea aria-label="النص المحلي" value={text} maxLength={20000} disabled={busy} onChange={event => { setText(event.target.value); setSaved(false); }}/></label><button disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await onSave({ segmentId, baseline: segment.script, script: text, baseV: base.v, collection: base.collection as 'episodes' | 'bulletinStories', id: base.id }); setSaved(true); } catch { setError('تعذر حفظ المسودة على الجهاز'); } finally { setBusy(false); } }}>حفظ محلي</button><button disabled={busy} onClick={async () => { try { await onSave(null); setText(plainText(segment.script)); } catch { setError('تعذر التراجع عن المسودة'); } }}>استعادة النص المنزّل</button>{saved && <p role="status">حُفظ النص دون نشره تلقائياً</p>}{draft && <button disabled={busy} onClick={() => void compare()}>مقارنة نسخة الخادم</button>}{current && <><h3>النص الحالي على الخادم</h3><pre>{plainText(remoteScript || '')}</pre>{current.v !== base.v ? <p role="alert">تغيرت نسخة الخادم؛ احتفظ بالمسودة وراجع تعديل الزميل</p> : <><label><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)}/>أوافق على تطبيق المسودة بعد المقارنة</label><button disabled={busy || !consent} onClick={() => void apply()}>تطبيق على الخادم</button></>}</>}{error && <p role="alert">{error}</p>}</section>;
}
