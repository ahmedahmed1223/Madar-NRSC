export interface RecentServerError { id: string; at: string; message: string }
export interface RecentServerErrors { since: string; entries: RecentServerError[] }
export interface BackupStatus {
  lastSnapshotAt: string | null;
  lastAttempt: { at: string; status: 'ok' | 'failed' } | null;
  lastDelivery: { at: string; status: 'ok' | 'failed' } | null;
  intervalHours: number;
  overdue: boolean;
  count: number;
}
export interface BackupVerification { valid: true; fileName: string; checkedAt: string; sha256: string }
export interface BackupRehearsal {
  fileName: string; sha256: string; checkedAt: string; version: string;
  compatible: true; counts: Record<string, number>; mediaVerified: false;
}
export interface DatabaseDiagnosticReport {
  version: string; generatedAt: string; uptimeSeconds: number; ready: boolean;
  backup: BackupStatus; errors: RecentServerErrors;
}
