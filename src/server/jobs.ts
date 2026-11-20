/**
 * Last run of each periodic job, kept in memory so the administrator's overview can show that
 * the background work is alive (and what failed, without details that belong in the server log).
 */
export interface JobRun {
  name: string;
  everyMinutes?: number;
  lastRunAt?: string;
  ok?: boolean;
  error?: string;
}

const runs = new Map<string, JobRun>();

/** Announces a job before its first run, so the overview lists it as "not run yet". */
export function registerJob(name: string, everyMinutes?: number) {
  if (!runs.has(name)) runs.set(name, { name, everyMinutes });
}

/** Records the outcome of one run. */
export function recordJob(name: string, error?: unknown) {
  runs.set(name, { ...runs.get(name), name, lastRunAt: new Date().toISOString(), ok: !error, error: error ? 'فشل آخر تشغيل؛ التفاصيل في سجل الخادم' : undefined });
}

/** Runs a job and records how it went; the error is passed on to the caller's own handling. */
export async function trackJob<T>(name: string, run: () => T | Promise<T>): Promise<T> {
  try {
    const result = await run();
    recordJob(name);
    return result;
  } catch (err) {
    recordJob(name, err);
    throw err;
  }
}

export const jobRuns = (): JobRun[] => [...runs.values()];
export const resetJobRuns = () => runs.clear();
