export interface NewsReportCounts {
  total: number;
  published: number;
  approved: number;
  review: number;
  drafts: number;
}

export interface NewsReport {
  totals: NewsReportCounts;
  byStation: Record<string, NewsReportCounts>;
  byCategory: Record<string, number>;
  categoryTotal: number;
  avgApprovalMinutes: number | null;
}
