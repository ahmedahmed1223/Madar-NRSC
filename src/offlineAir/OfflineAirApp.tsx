import React, { useEffect, useRef, useState } from 'react';
import { Play, Pause, ChevronLeft, ChevronRight, Lock, Download } from 'lucide-react';
import { listPacketMetadata, unlockPacket, saveLocalState, exportEncryptedPacket, type OfflinePacketMetadata } from '../services/offlineAirStore';
import { createLocalSession, reduceLocalSession, localTiming, offlineClockJump, type OfflineAirSession, type OfflineAirAction } from '../shared/offlineAirSession';
import type { OfflineAirPacket } from '../shared/offlineAir';
import { plainText } from '../shared/bulletins';
import { OfflineReconnectPanel } from './OfflineReconnectPanel';
import { OfflineViewerControls } from './OfflineViewerControls';
import { OfflineScriptDrafts, type OfflineScriptDraft } from './OfflineScriptDrafts';

export function OfflineAirApp() {
  const [metadata, setMetadata] = useState<OfflinePacketMetadata[]>([]);
  const [id, setId] = useState(new URLSearchParams(location.search).get('packet') || '');
  const [secret, setSecret] = useState('');
  const [unlocked, setUnlocked] = useState<{ packet: OfflineAirPacket; key: CryptoKey } | null>(null);
  const generation = useRef(0);
  const guard = useRef(false);
  const [drafts, setDrafts] = useState<Record<string, OfflineScriptDraft>>({});
  const [session, setSession] = useState<OfflineAirSession | null>(null);
  const [readingIndex, setReadingIndex] = useState(0);
  const [font, setFont] = useState(32);
  const clock = useRef({ wall: Date.now(), monotonic: performance.now() });
  const [clockHeld, setClockHeld] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { void listPacketMetadata().then(setMetadata).catch(() => setError('تعذر فتح التخزين المحلي')); }, []);
  useEffect(() => {
    const timer = setInterval(() => {
      const wall = Date.now(), monotonic = performance.now();
      const expected = Math.round(clock.current.wall + monotonic - clock.current.monotonic);
      const jumped = offlineClockJump(clock.current.wall, clock.current.monotonic, wall, monotonic);
      clock.current = { wall, monotonic };
      if (jumped && session?.status === 'RUNNING' && unlocked && !clockHeld && !guard.current) {
        setClockHeld(true); setNow(expected); guard.current = true;
        const paused = reduceLocalSession(session, 'PAUSE', Math.max(session.checkpointAt, expected));
        const token = generation.current;
        void saveLocalState(unlocked.packet.packetId, unlocked.key, { session: paused, drafts, readingIndex, clockHeld: true })
          .then(() => { if (token === generation.current) setSession(paused); })
          .catch(() => setError('تغير وقت الجهاز وتعذر حفظ الإيقاف؛ أبق الشاشة مفتوحة وراجع التخزين'))
          .finally(() => { guard.current = false; });
      } else if (!clockHeld) setNow(wall);
    }, 250);
    return () => clearInterval(timer);
  }, [session, unlocked, clockHeld, drafts, readingIndex]);
  useEffect(() => {
    const channel = new BroadcastChannel('madar-offline-air');
    channel.onmessage = event => { if (event.data?.type === 'logout') { generation.current++; setUnlocked(null); setSession(null); setDrafts({}); setSecret(''); setMetadata(rows => rows.filter(row => row.userId !== event.data.userId)); } };
    return () => channel.close();
  }, [unlocked?.packet.userId]);
  async function unlock(event: React.FormEvent) {
    event.preventDefault(); const token = generation.current; setBusy(true); setError('');
    try {
      const result = await unlockPacket(id, secret);
      if (token !== generation.current) return;
      setDrafts(result.local?.drafts || {});
      const restored = result.local?.session as OfflineAirSession | undefined;
      if (restored && (restored.packetId !== result.packet.packetId || restored.version !== 1)) throw new Error();
      if (restored && (restored.index < 0 || restored.index >= result.packet.show.segments.length || !Array.isArray(restored.events) || restored.events.length > 2000 || JSON.stringify(restored.segments) !== JSON.stringify(createLocalSession(result.packet, Date.now()).segments))) throw new Error('سجل محلي غير صالح');
      setSession(restored ? { ...restored, canOperate: result.packet.canOperate } : createLocalSession(result.packet, Date.now()));
      setClockHeld(!!result.local?.clockHeld || !!restored && Date.now() < restored.checkpointAt);
      clock.current = { wall: Date.now(), monotonic: performance.now() };
      const savedReading = result.local?.readingIndex;
      setReadingIndex(Number.isInteger(savedReading) && savedReading >= 0 && savedReading < result.packet.show.segments.length ? savedReading : restored?.index || 0); setUnlocked(result); setSecret('');
    } catch { setError('تعذر فتح النسخة؛ تحقق من كلمة الفتح أو اختر نسخة أخرى'); }
    finally { setBusy(false); }
  }
  async function operate(action: OfflineAirAction) {
    if (!session || !unlocked || busy || guard.current || clockHeld) return;
    guard.current = true;
    setBusy(true); setError('');
    try {
      const next = reduceLocalSession(session, action, Date.now());
      if (next === session) return;
      const token = generation.current;
      await saveLocalState(unlocked.packet.packetId, unlocked.key, { session: next, drafts, readingIndex: next.index, clockHeld });
      if (token === generation.current) { setSession(next); setReadingIndex(next.index); }
    } catch { setError('لم تُحفظ العملية؛ لم يتغير التشغيل المحلي. تحقق من مساحة الجهاز'); }
    finally { guard.current = false; setBusy(false); }
  }
  async function selectReading(index: number) {
    if (!unlocked || !session || guard.current) return;
    const next = Math.max(0, Math.min(unlocked.packet.show.segments.length - 1, index));
    const token = generation.current;
    guard.current = true;
    try {
      await saveLocalState(unlocked.packet.packetId, unlocked.key, { session, drafts, readingIndex: next, clockHeld });
      if (token === generation.current) setReadingIndex(next);
    } catch { setError('تعذر حفظ موضع القراءة؛ تحقق من مساحة الجهاز'); }
    finally { guard.current = false; }
  }
  async function exportLocal() {
    if (!unlocked || guard.current) return;
    try {
      const url = URL.createObjectURL(await exportEncryptedPacket(unlocked.packet.packetId));
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `offline-air-${unlocked.packet.packetId}.json`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setError('تعذر تصدير النسخة المحلية'); }
  }
  if (!unlocked || !session) return <main className="unlock"><h1>الهواء المحلي</h1><form onSubmit={unlock}><label>النسخة المحفوظة<select aria-label="النسخة المحفوظة" value={id} onChange={event => setId(event.target.value)}><option value="">اختر النسخة</option>{metadata.map(row => <option key={row.packetId} value={row.packetId}>{row.preparedAt} · {row.showId}</option>)}</select></label><label>كلمة فتح النسخة<input aria-label="كلمة فتح النسخة" type="password" autoComplete="off" minLength={8} required value={secret} onChange={event => setSecret(event.target.value)}/></label><button type="submit" disabled={busy || !id}>فتح النسخة</button>{error && <p role="alert">{error}</p>}</form></main>;
  const segment = unlocked.packet.show.segments[readingIndex];
  const timing = localTiming(session, now);
  const viewerControls = <OfflineViewerControls onMove={delta => void selectReading(readingIndex + delta)} onFont={delta => setFont(value => Math.max(22, Math.min(60, value + delta)))}/>;
  const reconnect = <OfflineReconnectPanel packet={unlocked.packet} session={session}/>;
  return <main><header><h1>{unlocked.packet.show.title}</h1><span>تشغيل محلي منفصل عن بث الفريق</span>{viewerControls}<button type="button" aria-label="تصدير النسخة المشفرة" title="تصدير النسخة المشفرة" onClick={() => void exportLocal()}><Download size={18}/></button><button type="button" onClick={() => { generation.current++; setUnlocked(null); setSession(null); setDrafts({}); }}><Lock size={18}/> قفل النسخة</button></header>{error && <p role="alert">{error}</p>}{(clockHeld || timing.clockReview) && <section role="alert"><p>تغير وقت الجهاز؛ راجع الساعة قبل استئناف التوقيت المحلي</p><button onClick={async () => {
      if (Date.now() < session.checkpointAt) { setError('صحح الساعة أولاً للحفاظ على ترتيب السجل'); return; }
      if (guard.current) return; guard.current = true;
      try {
        const paused = reduceLocalSession(session, 'PAUSE', session.checkpointAt);
        const next = { ...paused, checkpointAt: Date.now() };
        await saveLocalState(unlocked.packet.packetId, unlocked.key, { session: next, drafts, readingIndex, clockHeld: false });
        setSession(next); setClockHeld(false);
      } catch { setError('تعذر حفظ مراجعة الساعة'); } finally { guard.current = false; }
    }}>راجعت ساعة الجهاز</button></section>}<nav aria-label="فقرات الحلقة"><button type="button" aria-label="الفقرة السابقة" disabled={!readingIndex} onClick={() => void selectReading(readingIndex - 1)}><ChevronRight/></button><select aria-label="الفقرة المعروضة" value={readingIndex} onChange={event => void selectReading(Number(event.target.value))}>{unlocked.packet.show.segments.map((row, index) => <option key={row.id} value={index}>{index + 1}. {row.title}</option>)}</select><button type="button" aria-label="الفقرة التالية" disabled={readingIndex >= unlocked.packet.show.segments.length - 1} onClick={() => void selectReading(readingIndex + 1)}><ChevronLeft/></button><label>حجم الخط<input aria-label="حجم الخط" type="range" min="22" max="60" value={font} onChange={event => setFont(Number(event.target.value))}/></label></nav><h2>{segment?.title}</h2><article tabIndex={0} aria-label="نص الحلقة المحلي" style={{ fontSize: font }}>{(drafts[segment?.id]?.script ?? segment?.script) ? plainText(drafts[segment?.id]?.script ?? segment.script) : 'لا يوجد نص معتمد لهذه الفقرة'}</article>{segment?.notes && <aside>{segment.notes}</aside>}{unlocked.packet.canOperate && <footer><output>{session.status} · {Math.floor(timing.elapsed)} ثانية</output><button disabled={busy || !['READY','PAUSED'].includes(session.status)} onClick={() => void operate(session.status === 'READY' ? 'START' : 'RESUME')}><Play size={18}/> تشغيل محلي</button><button disabled={busy || session.status !== 'RUNNING'} onClick={() => void operate('PAUSE')}><Pause size={18}/> إيقاف مؤقت</button><button disabled={busy || session.index >= session.segments.length - 1} onClick={() => void operate('NEXT')}>الفقرة التالية محلياً</button><button disabled={busy || session.status === 'READY' || session.status === 'ENDED'} onClick={() => void operate('END')}>إنهاء محلي</button></footer>}<OfflineScriptDrafts key={segment.id} packet={unlocked.packet} segmentId={segment.id} draft={drafts[segment.id]} onSave={async value => {
      if (guard.current) throw new Error('عملية حفظ أخرى قيد التنفيذ');
      guard.current = true;
      try {
        const next = { ...drafts }; if (value) next[segment.id] = value; else delete next[segment.id];
        const token = generation.current;
        await saveLocalState(unlocked.packet.packetId, unlocked.key, { session, drafts: next, readingIndex, clockHeld });
        if (token === generation.current) setDrafts(next);
      } finally { guard.current = false; }
    }}/>{reconnect}</main>;
}
