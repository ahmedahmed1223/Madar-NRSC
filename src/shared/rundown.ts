import type { RundownSegment } from '../types/index';

/** Format seconds into HH:MM:SS. */
export function formatSecondsToTime(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/** Convert HH:MM:SS or MM:SS to seconds. */
export function parseTimeToSeconds(timeStr: string): number {
  if (!timeStr) return 0;
  const parts = timeStr.split(':').map(Number);
  if (parts.some((p) => Number.isNaN(p))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return Number(timeStr) || 0;
}

/** Cumulative rundown timing: each segment starts where the previous one ends. */
export function recalculateRundown(segments: RundownSegment[]): RundownSegment[] {
  let cumulativeSeconds = 0;
  return segments.map((seg, idx) => {
    const duration = Math.max(0, Number(seg.durationSeconds) || 0);
    const startSec = cumulativeSeconds;
    const endSec = startSec + duration;
    cumulativeSeconds = endSec;
    return {
      ...seg,
      durationSeconds: duration,
      orderIndex: idx + 1,
      startTimeOffset: formatSecondsToTime(startSec),
      endTimeOffset: formatSecondsToTime(endSec),
    };
  });
}
