import { managerScope, stationFilterMatcher, stationGroupsOf } from '../shared/managerToday';
import { stationsOf } from '../shared/stations';
import type { NewsReport, NewsReportCounts } from '../shared/newsReport';
import { moduleAllowed } from './moduleAccess';
import type { AuthContext } from './auth';
import type { NewsroomDatabase } from './db';

const counts = (): NewsReportCounts => ({ total: 0, published: 0, approved: 0, review: 0, drafts: 0 });
const statusKeys: Record<string, keyof Omit<NewsReportCounts, 'total'>> = {
  PUBLISHED: 'published', APPROVED: 'approved', UNDER_REVIEW: 'review', DRAFT: 'drafts',
};

type NewsReportFilters = { since?: string; station: string; category: string };

function newsReportScope(db: NewsroomDatabase, auth: AuthContext, filters: NewsReportFilters) {
  const settings = db.getRow('settings', 'singleton')?.d;
  const stations = stationsOf(settings);
  const allGroups = stationGroupsOf(settings);
  const scope = managerScope(auth.user, stations, auth.can('workload.view_all'), allGroups);
  const groups = allGroups.filter(group => group.stationIds.some(id => scope.has(id)));
  const matchesStation = stationFilterMatcher(filters.station, groups);
  const seesAll = stations.every(station => scope.has(station.id));
  return { scope, includes: (stationId: string | null) => (seesAll || scope.has(stationId ?? '')) && matchesStation(stationId) && moduleAllowed(auth, 'news', stationId ?? undefined) };
}

export function listNewsReportRecords(db: NewsroomDatabase, auth: AuthContext, filters: NewsReportFilters, status: string, page: number) {
  const { includes } = newsReportScope(db, auth, filters);
  const stations = [...new Set(db.newsReportGroups(filters.since).map(row => row.stationId).filter(includes))];
  const rows = db.newsReportRecords({ ...filters, stations, status, offset: (page - 1) * 30, limit: 31 });
  return { rows: rows.slice(0, 30), hasMore: rows.length > 30 };
}

export function summarizeNewsReport(db: NewsroomDatabase, auth: AuthContext, filters: NewsReportFilters): NewsReport {
  const { scope, includes } = newsReportScope(db, auth, filters);
  const totals = counts();
  const byStation: Record<string, NewsReportCounts> = Object.create(null);
  const byCategory: Record<string, number> = Object.create(null);
  let categoryTotal = 0;
  let approvalCount = 0;
  let approvalMs = 0;
  for (const row of db.newsReportGroups(filters.since)) {
    if (!includes(row.stationId)) continue;
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
