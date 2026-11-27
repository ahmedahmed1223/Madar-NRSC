import type { OnAirState } from './onair';
import { asRunShow } from './asrun';

export interface BroadcastArchiveItem {
  id: string;
  title: string;
  plannedSeconds: number;
  script: string;
  guestNames: string[];
  disposition?: 'DEFERRED' | 'KILLED';
  stationId?: string;
  departmentId?: string;
  newsId?: string;
  categoryId?: string;
  countsForOutput?: boolean;
}

export interface BroadcastCorrectionRequest {
  id: string;
  startedAt: string;
  segmentId: string;
  segmentTitle: string;
  airedAt: string;
  newsId?: string;
  correctionId?: string;
  reason: string;
  actorId: string;
  actorName: string;
  createdAt: string;
}

export type BroadcastWithArchive = OnAirState & {
  archivedPlan?: BroadcastArchiveItem[];
  correctionRequests?: BroadcastCorrectionRequest[];
};

export function broadcastOutcomes(state: BroadcastWithArchive, fallback: BroadcastArchiveItem[] = []) {
  const plan = state.archivedPlan || fallback;
  const rundown = plan.map(item => ({ id: item.id, durationSeconds: item.plannedSeconds }));
  const actual = asRunShow(state, { rundown }).rows;
  const byId = new Map(plan.map(item => [item.id, item]));
  const played = new Set(actual.map(row => row.segmentId));
  const aired = actual.map(row => ({ item: byId.get(row.segmentId), id: row.segmentId, title: row.title, status: 'AIRED' as const, actual: row }));
  const remaining = plan.filter(item => !played.has(item.id)).map(item => ({
    item, id: item.id, title: item.title, status: item.disposition || 'NOT_AIRED' as const, actual: undefined,
  }));
  return [...aired, ...remaining];
}

export const AIR_OUTCOME_LABELS = {
  AIRED: 'أُذيعت',
  DEFERRED: 'مؤجلة',
  KILLED: 'مسقطة',
  NOT_AIRED: 'لم تُذع',
};

export function airingSummary(states: BroadcastWithArchive[], accepts: (state: BroadcastWithArchive, item: BroadcastArchiveItem) => boolean) {
  const groups = new Map<string, { stationId?: string; departmentId?: string; prepared: number; aired: number; killed: number; deferred: number }>();
  for (const state of states) {
    if (state.status !== 'ENDED' || !state.archivedPlan) continue;
    const aired = new Set((state.log || []).map(segment => segment.segmentId));
    for (const item of state.archivedPlan) {
      if (item.countsForOutput === false || !accepts(state, item)) continue;
      const { stationId, departmentId } = item;
      const key = JSON.stringify([stationId, departmentId]);
      const group = groups.get(key) || { stationId, departmentId, prepared: 0, aired: 0, killed: 0, deferred: 0 };
      group.prepared++;
      if (aired.has(item.id)) group.aired++;
      else if (item.disposition === 'KILLED') group.killed++;
      else if (item.disposition === 'DEFERRED') group.deferred++;
      groups.set(key, group);
    }
  }
  return [...groups.values()].sort((a, b) => b.prepared - a.prepared);
}
