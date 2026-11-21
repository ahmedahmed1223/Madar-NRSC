import type { CardStep, ProductionCard } from './productionCards';

type Interval = { from: number; to: number };

const instant = (value?: string) => {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? time : null;
};

export function stepLaborMinutes(step: Pick<CardStep, 'spentMinutes' | 'timeLog'>): number | null {
  const sessions = (step.timeLog || []).filter(entry => Number.isFinite(entry.minutes) && entry.minutes > 0);
  const total = typeof step.spentMinutes === 'number' && Number.isFinite(step.spentMinutes) && step.spentMinutes >= 0 ? step.spentMinutes : null;
  if (!sessions.length) return total;
  // Imported cards can carry a lifetime total that predates the current session log.
  return Math.max(total || 0, sessions.reduce((sum, entry) => sum + entry.minutes, 0));
}

function combinedMinutes(intervals: Interval[]) {
  let end = -Infinity;
  let duration = 0;
  for (const window of intervals.sort((a, b) => a.from - b.from)) {
    if (window.to <= end) continue;
    duration += window.to - Math.max(end, window.from);
    end = window.to;
  }
  return duration / 60_000;
}

export function cardExecutionTiming(card: Pick<ProductionCard, 'status' | 'createdAt' | 'closedAt' | 'steps' | 'log'>, now: number) {
  const steps = card.steps || [];
  const required = steps.filter(step => step.status !== 'SKIPPED');
  const events = (card.log || []).flatMap(entry => {
    const at = instant(entry.at);
    return entry.kind === 'STEP' && entry.stepId && entry.toStatus && at !== null && at <= now ? [{ ...entry, stepId: entry.stepId, toStatus: entry.toStatus, at }] : [];
  }).sort((a, b) => a.at - b.at);
  const elapsedStarts = [
    ...steps.filter(step => !step.doneAt || step.startedAt !== step.doneAt)
      .map(step => instant(step.startedAt)).filter(time => time !== null && time <= now),
    ...events.filter(entry => entry.toStatus === 'IN_PROGRESS').map(entry => entry.at),
  ];
  const start = elapsedStarts.length ? Math.min(...elapsedStarts) : null;
  const finished = required.length > 0 && required.every(step => step.status === 'DONE');
  const completionTimes = required.map(step => instant(step.doneAt)).filter(time => time !== null && time <= now);
  const finishedAt = finished && completionTimes.length === required.length ? Math.max(...completionTimes) : null;
  const closedAt = instant(card.closedAt);
  const end = finishedAt ?? (card.status === 'OPEN' && !finished ? now : closedAt);

  const waits: Interval[] = [];
  const created = instant(card.createdAt);
  const registered = new Set(events.filter(entry => !entry.fromStatus && (entry.toStatus === 'TODO' || entry.toStatus === 'BLOCKED')).map(entry => entry.stepId));
  const observedPastWork = events.some(entry => [entry.fromStatus, entry.toStatus].some(status => status === 'IN_PROGRESS' || status === 'DONE'));
  const legacyStepLog = (card.log || []).some(entry => entry.kind === 'STEP' && entry.stepId && !entry.toStatus);
  const neverStarted = card.status === 'OPEN' && !observedPastWork && required.length > 0
    && required.every(step => (step.status === 'TODO' || step.status === 'BLOCKED') && !step.doneAt && (!legacyStepLog || registered.has(step.id)));
  const beforeWork = start ?? (neverStarted ? now : null);
  if (created !== null && beforeWork !== null && created <= beforeWork) waits.push({ from: created, to: beforeWork });
  const blocked = new Map<string, number>();
  for (const entry of events) {
    if (entry.toStatus === 'BLOCKED') {
      if (!blocked.has(entry.stepId)) blocked.set(entry.stepId, entry.at);
      continue;
    }
    const since = blocked.get(entry.stepId);
    if (since === undefined) continue;
    if (end === null || entry.at <= end) waits.push({ from: since, to: entry.at });
    blocked.delete(entry.stepId);
  }
  for (const step of steps) {
    const since = blocked.get(step.id);
    if (step.status === 'BLOCKED' && since !== undefined && end !== null && end >= since) waits.push({ from: since, to: end });
  }

  const labor = steps.map(stepLaborMinutes).filter(minutes => minutes !== null);
  return {
    laborMinutes: labor.length ? labor.reduce((sum, minutes) => sum + minutes, 0) : null,
    elapsedMinutes: start !== null && end !== null && end >= start && end <= now ? (end - start) / 60_000 : null,
    waitingMinutes: waits.length ? combinedMinutes(waits) : null,
  };
}
