import { useEffect, useState, useSyncExternalStore } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { useLiveData } from '../../hooks/useLiveData';
import { apiService } from '../../services/api';
import { isCueActive, isCueForUser, isPresenterAccount, isPresenterInstructionRecipient } from '../../shared/onair';
import type { User } from '../../types';

let audio: AudioContext | undefined;
let soundEnabled = false;
const subscribers = new Set<() => void>();
const subscribe = (listener: () => void) => {
  subscribers.add(listener);
  return () => { subscribers.delete(listener); };
};
const isSoundEnabled = () => soundEnabled;
const played = new Map<string, number>();

async function toggleSound() {
  if (!soundEnabled) {
    audio ??= new AudioContext();
    await audio.resume();
    if (audio.state !== 'running') throw new Error();
  }
  soundEnabled = !soundEnabled;
  subscribers.forEach(listener => listener());
}

function playInstruction(id: string, expiresAt: string) {
  const now = Date.now();
  for (const [playedId, expires] of played) if (expires <= now) played.delete(playedId);
  if (played.has(id)) return;
  played.set(id, Date.parse(expiresAt));
  if (!soundEnabled || !audio || audio.state !== 'running') return;
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  const start = audio.currentTime;
  oscillator.frequency.value = 520;
  gain.gain.setValueAtTime(0.001, start);
  gain.gain.exponentialRampToValueAtTime(0.025, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, start + 0.2);
  oscillator.connect(gain).connect(audio.destination);
  oscillator.start(start);
  oscillator.stop(start + 0.2);
}

export function PresenterInstructionSound({ user }: { user: User }) {
  const enabled = useSyncExternalStore(subscribe, isSoundEnabled, () => false);
  const [failed, setFailed] = useState(false);
  if (!isPresenterAccount(user)) return null;
  const toggle = async () => {
    try { await toggleSound(); setFailed(false); }
    catch { setFailed(true); }
  };
  const Icon = enabled ? Volume2 : VolumeX;
  return (
    <div className="inline-flex flex-wrap items-center gap-2">
      <button type="button" onClick={toggle} aria-pressed={enabled} title="صوت توجيهات المخرج على هذا الجهاز" className="min-h-11 inline-flex items-center gap-2 rounded-lg border border-zinc-600 bg-zinc-900 px-3 text-xs font-bold text-zinc-100">
        <Icon className="size-4" aria-hidden="true" /> صوت التوجيهات
      </button>
      {failed && <span role="status" className="text-xs text-amber-300">تعذر تشغيل الصوت على هذا الجهاز.</span>}
    </div>
  );
}

export function PresenterInstruction({ user, showId, mirror = false, studio = false }: { user: User; showId?: string; mirror?: boolean; studio?: boolean }) {
  useLiveData(['cues'], 1000);
  const cue = apiService.getCues()
    .filter(c => c.expiresAt && showId && c.episodeId === showId && isCueActive(c) && !c.acks.some(a => a.userId === user.id))
    .filter(c => isCueForUser(c, user) || (studio && c.fromId === user.id && c.targetDepartmentIds.includes('studio')))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const shouldPlay = !!cue && isPresenterInstructionRecipient(cue, user);

  useEffect(() => {
    if (shouldPlay && cue?.expiresAt) playInstruction(cue.id, cue.expiresAt);
  }, [cue?.id, cue?.expiresAt, shouldPlay]);

  if (!cue) return null;
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-3 border border-amber-400/75 bg-zinc-900 px-4 py-2 text-amber-100" data-testid="presenter-instruction">
      <div role="alert" className={`min-w-0 flex-1 break-words ${mirror ? 'scale-x-[-1]' : ''}`}>
        <p className="text-xs font-bold text-amber-300">توجيه المخرج</p>
        <p className="text-xl font-bold leading-tight sm:text-3xl">{cue.message}</p>
      </div>
      {cue.fromId !== user.id && <button type="button" onClick={() => apiService.ackCue(cue.id)} className="min-h-11 shrink-0 rounded-lg border border-amber-400/75 px-3 text-xs font-bold">تم الاستلام</button>}
    </div>
  );
}
