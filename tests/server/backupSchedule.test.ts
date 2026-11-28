import { afterEach, expect, it, vi } from 'vitest';
import { startBackupSchedule } from '../../src/server/backupSchedule';

afterEach(() => vi.useRealTimers());

it('pauses a pending scheduled run and resumes without restarting the server', async () => {
  vi.useFakeTimers();
  let intervalHours = 24;
  const status = () => ({ intervalHours, lastDelivery: null, lastAttempt: null });
  const run = vi.fn(async () => {});
  const stop = startBackupSchedule(status, run);
  try {
    intervalHours = 0;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(run).not.toHaveBeenCalled();
    intervalHours = 24;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(run).toHaveBeenCalledTimes(1);
  } finally {
    stop();
  }
  await vi.advanceTimersByTimeAsync(60_000);
  expect(run).toHaveBeenCalledTimes(1);
});

it('starts paused and leaves execution disabled as long as the preference is off', async () => {
  vi.useFakeTimers();
  const run = vi.fn(async () => {});
  const stop = startBackupSchedule(() => ({ intervalHours: 0, lastDelivery: null, lastAttempt: null }), run);
  try {
    await vi.advanceTimersByTimeAsync(300_000);
    expect(run).not.toHaveBeenCalled();
  } finally {
    stop();
  }
});

it('reschedules from a successful manual backup before the next automatic run', async () => {
  vi.useFakeTimers();
  const hour = 3_600_000;
  let lastDelivery = { at: new Date(Date.now() - 23 * hour).toISOString(), status: 'ok' as const };
  const run = vi.fn(async () => {});
  const stop = startBackupSchedule(() => ({ intervalHours: 24, lastDelivery, lastAttempt: null }), run);
  try {
    await vi.advanceTimersByTimeAsync(hour / 2);
    lastDelivery = { ...lastDelivery, at: new Date().toISOString() };
    await vi.advanceTimersByTimeAsync(hour / 2);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(23.5 * hour);
    expect(run).toHaveBeenCalledTimes(1);
  } finally {
    stop();
  }
});
