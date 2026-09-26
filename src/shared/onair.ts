/** Live broadcast coordination shared by the server (authority) and every screen. */
import { departmentIdOf } from './departments';

export interface OnAirLogEntry {
  segmentId: string;
  title: string;
  startedAt: string;
  endedAt?: string;
}

/** One row per episode (id = episodeId). Times are stamped by the server. */
export interface OnAirState {
  id: string;
  episodeId: string;
  episodeTitle: string;
  programName?: string;
  status: 'LIVE' | 'ENDED';
  startedAt: string;
  endedAt?: string;
  currentSegmentId: string;
  segmentStartedAt: string;
  operatorId?: string;
  operatorName?: string;
  log: OnAirLogEntry[];
}

/** Directors and the control room run the show; managers with onair.control may too. */
export function canControlOnAir(user: { departmentId?: string; department?: string } | null | undefined, can: (p: string) => boolean): boolean {
  if (!user) return false;
  return can('onair.control') || ['direction', 'control'].includes(departmentIdOf(user));
}

const playable = (rundown: any[]) => (rundown || []).filter((s) => s && s.id);

export interface LiveTiming {
  index: number;
  current: any | null;
  next: any | null;
  /** Seconds since the current segment started. */
  elapsed: number;
  /** Planned seconds left in the current segment (negative = overrunning). */
  remaining: number;
  /** Seconds the show is behind (+) or ahead (-) of the rundown plan. */
  drift: number;
  /** Seconds on air since the show started. */
  onAirSeconds: number;
}

export function liveTiming(state: OnAirState | null | undefined, episode: any, now = Date.now()): LiveTiming | null {
  if (!state || !episode) return null;
  const rundown = playable(episode.rundown);
  const index = rundown.findIndex((s) => s.id === state.currentSegmentId);
  const current = index >= 0 ? rundown[index] : null;
  const end = state.status === 'ENDED' && state.endedAt ? new Date(state.endedAt).getTime() : now;
  const segStart = new Date(state.segmentStartedAt).getTime();
  const showStart = new Date(state.startedAt).getTime();
  const elapsed = Math.max(0, Math.round((end - segStart) / 1000));
  const planned = Number(current?.durationSeconds) || 0;
  const plannedStart = rundown.slice(0, Math.max(index, 0)).reduce((sum, s) => sum + (Number(s.durationSeconds) || 0), 0);
  const actualStart = Math.round((segStart - showStart) / 1000);
  const overrun = Math.max(0, elapsed - planned);
  return {
    index,
    current,
    next: index >= 0 ? rundown[index + 1] || null : null,
    elapsed,
    remaining: planned - elapsed,
    drift: actualStart - plannedStart + overrun,
    onAirSeconds: Math.max(0, Math.round((end - showStart) / 1000)),
  };
}

export const formatClock = (seconds: number) => {
  const sign = seconds < 0 ? '-' : '';
  const s = Math.abs(Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${sign}${h ? `${h}:` : ''}${pad(m)}:${pad(sec)}`;
};

// ---------------------------------------------------------------------------
// On-air alerts (cues)
// ---------------------------------------------------------------------------

export interface Cue {
  id: string;
  episodeId?: string;
  /** Empty = everyone. */
  targetDepartmentIds: string[];
  message: string;
  level: 'info' | 'standby' | 'urgent';
  fromId: string;
  fromName: string;
  createdAt: string;
  acks: { userId: string; userName: string; at: string }[];
}

export const CUE_PRESETS: { message: string; level: Cue['level'] }[] = [
  { message: 'استعداد — الفقرة التالية بعد دقيقة', level: 'standby' },
  { message: 'دقيقة واحدة متبقية', level: 'standby' },
  { message: '30 ثانية', level: 'urgent' },
  { message: 'اختصر الفقرة', level: 'urgent' },
  { message: 'مدّ الفقرة', level: 'info' },
  { message: 'الضيف جاهز على الخط؟', level: 'info' },
  { message: 'تحقق من الصوت', level: 'urgent' },
  { message: 'الشارة جاهزة؟', level: 'standby' },
];

/** Alerts stay prominent for a few minutes; older ones are history. */
export const CUE_ACTIVE_MS = 10 * 60 * 1000;

export function isCueForUser(cue: Cue, user: { id: string; departmentId?: string; department?: string }): boolean {
  if (cue.fromId === user.id) return false;
  return cue.targetDepartmentIds.length === 0 || cue.targetDepartmentIds.includes(departmentIdOf(user));
}
