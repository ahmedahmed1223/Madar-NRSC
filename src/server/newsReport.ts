import { managerScope, stationFilterMatcher, stationGroupsOf } from '../shared/managerToday';
import { stationsOf } from '../shared/stations';
import type { NewsReport, NewsReportCounts } from '../shared/newsReport';
import type { AuthContext } from './auth';
import type { NewsroomDatabase } from './db';

const counts = (): NewsReportCounts => ({ total: 0, published: 0, approved: 0, review: 0, drafts: 0 });
const statusKeys: Record<string, keyof Omit<NewsReportCounts, 'total'>> = {
  PUBLISHED: 'published', APPROVED: 'approved', UNDER_REVIEW: 'review', DRAFT: 'drafts',
};

export function summarizeNewsReport(
  db: NewsroomDatabase,
  auth: AuthContext,
  filters: { since?: string; station: string; category: string },
): NewsReport {
  const settings = db.getRow('settings', 'singleton')?.d;
  const stations = stationsOf(settings);
  const allGroups = stationGroupsOf(settings);
  const scope = managerScope(auth.user, stations, auth.can('workload.view_all'), allGroups);
  const groups = allGroups.filter(group => group.stationIds.some(id => scope.has(id)));
  const matchesStation = stationFilterMatcher(filters.station, groups);
  const seesAll = stations.every(station => scope.has(station.id));
  const totals = counts();
  const byStation: Record<string, NewsReportCounts> = Object.create(null);
  const byCategory: Record<string, number> = Object.create(null);
  let categoryTotal = 0;
  let approvalCount = 0;
  let approvalMs = 0;
  for (const row of db.newsReportGroups(filters.since)) {
    if ((!seesAll && !scope.has(row.stationId ?? '')) || !matchesStation(row.stationId)) continue;
    categoryTotal += row.total;
    if (row.categoryId) byCategory[row.categoryId] = (byCategory[row.categoryId] ?? 0) + row.total;
    if (filters.category !== 'ALL' && filters.category !== row.categoryId) continue;
    const station = row.stationId && scope.has(row.stationId) ? (byStation[row.stationId] ??= counts()) : null;
    totals.total += row.total;
    if (station) station.total += row.total;
    const key = row.status && Object.hasOwn(statusKeys, row.status) ? statusKeys[row.status] : null;
    if (key) {
      totals[key] += row.total;
      if (station) station[key] += row.total;
    }
    approvalCount += row.approvalCount;
    approvalMs += row.approvalMs;
  }
  return { totals, byStation, byCategory, categoryTotal, avgApprovalMinutes: approvalCount ? Math.round(approvalMs / approvalCount / 60_000) : null };
}
