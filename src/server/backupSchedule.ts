import type { BackupStatus } from '../shared/databaseDiagnostics';
import { nextBackupDelayMs } from './databaseDiagnostics';

type ScheduleStatus = Pick<BackupStatus, 'intervalHours' | 'lastDelivery' | 'lastAttempt'>;
const PAUSED_POLL_MS = 60_000;

export function startBackupSchedule(status: () => ScheduleStatus, run: () => Promise<unknown>): () => void {
  let timer: ReturnType<typeof setTimeout>;
  let stopped = false;
  const schedule = () => {
    if (stopped) return;
    const { intervalHours, lastDelivery, lastAttempt } = status();
    const delay = nextBackupDelayMs(intervalHours, lastDelivery, lastAttempt);
    if (delay === null) {
      timer = setTimeout(schedule, PAUSED_POLL_MS);
      return;
    }
    timer = setTimeout(() => {
      const current = status();
      if (current.intervalHours !== intervalHours || current.lastDelivery?.at !== lastDelivery?.at ||
          current.lastAttempt?.at !== lastAttempt?.at) return schedule();
      void run().finally(schedule);
    }, delay);
  };
  schedule();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
