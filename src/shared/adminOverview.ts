/** What an administrator needs to follow and maintain the system, in one read-only report. */
export interface AdminOverview {
  generatedAt: string;
  sessions: {
    /** Signed-in people (a person may have several devices). */
    users: number;
    devices: number;
    /** Seen in the last five minutes. */
    activeNow: number;
    list: { userId: string; name: string; devices: number; lastSeenAt: string; ip?: string; agent?: string }[];
  };
  storage: {
    databaseBytes: number;
    uploads: { files: number; bytes: number };
    /** Uploads no media record or message points to (removed after a day by the hourly clean-up). */
    unused: { files: number; bytes: number };
    /** Free and total space of the volume holding the data, when the platform reports it. */
    disk?: { freeBytes: number; totalBytes: number };
  };
  people: {
    active: number;
    suspended: number;
    withoutStation: number;
    /** Locked after repeated wrong passwords. */
    locked: number;
    /** Still on the password an administrator set for them. */
    mustChangePassword: number;
    /** Holders of high-risk permissions without two-step verification. */
    privilegedWithout2fa: { id: string; name: string }[];
  };
  content: {
    stations: number;
    openCards: number;
    blockedCards: number;
    lateCards: number;
    messages: number;
    oldestMessageAt?: string;
    groups: number;
    notificationsWaiting: number;
  };
  jobs: { name: string; lastRunAt?: string; ok?: boolean; error?: string; everyMinutes?: number }[];
  /** Things that need the administrator's attention, most serious first. */
  alerts: { level: 'error' | 'warning'; text: string }[];
}

export const bytesLabel = (bytes: number) => {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} غ.ب`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} م.ب`;
  return `${Math.max(0, Math.round(bytes / 1024))} ك.ب`;
};
