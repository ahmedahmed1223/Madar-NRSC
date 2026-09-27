import React, { useEffect, useRef } from 'react';
import { Megaphone } from 'lucide-react';
import type { User } from '../../types';
import { apiService } from '../../services/api';
import { useLiveData } from '../../hooks/useLiveData';
import { CUE_ACTIVE_MS, isCueForUser } from '../../shared/onair';

/** A short tone so an on-air alert is noticed even when eyes are elsewhere. */
function beep(level: string) {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = level === 'urgent' ? 988 : 660;
    gain.gain.value = 0.08;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + (level === 'urgent' ? 0.45 : 0.25));
    osc.onended = () => ctx.close();
  } catch {
    // audio not allowed yet (no user gesture): the banner is still shown
  }
}

/** Shows on-air alerts sent to this user's department (or everyone) until acknowledged. */
export const CueAlertOverlay: React.FC<{ currentUser: User }> = ({ currentUser }) => {
  useLiveData(['cues'], 15000);
  const beeped = useRef(new Set<string>());
  const pending = apiService
    .getCues()
    .filter((c) => Date.now() - new Date(c.createdAt).getTime() < CUE_ACTIVE_MS)
    .filter((c) => isCueForUser(c, currentUser) && !c.acks.some((a) => a.userId === currentUser.id))
    .slice(0, 3);

  useEffect(() => {
    pending.forEach((c) => {
      if (!beeped.current.has(c.id)) {
        beeped.current.add(c.id);
        beep(c.level);
      }
    });
  });

  if (!pending.length) return null;
  return (
    <div className="theme-fixed fixed top-20 inset-x-0 z-[60] flex flex-col items-center gap-2 px-4 pointer-events-none" aria-live="assertive">
      {pending.map((c) => (
        <div
          key={c.id}
          role="alert"
          className={`pointer-events-auto w-full max-w-xl rounded-2xl shadow-2xl border px-4 py-3 flex items-center gap-3 text-white ${
            c.level === 'urgent' ? 'bg-red-600 border-red-400' : c.level === 'standby' ? 'bg-amber-500 border-amber-300 text-black' : 'bg-sky-700 border-sky-500'
          }`}
        >
          <Megaphone className="w-6 h-6 shrink-0" />
          <div className="flex-1 min-w-0">
            <strong className="block text-base leading-snug">{c.message}</strong>
            <span className="text-[11px] opacity-80">من {c.fromName} · {new Date(c.createdAt).toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          <button type="button" onClick={() => apiService.ackCue(c.id)} className="px-3 py-1.5 rounded-lg bg-white/90 text-slate-900 text-xs font-black shrink-0">
            تم الاستلام
          </button>
        </div>
      ))}
    </div>
  );
};
