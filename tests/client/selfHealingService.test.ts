import { afterEach, describe, expect, it, vi } from 'vitest';

describe('selfHealingService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('does not schedule background setTimeout or setInterval watchdog loops on startup', async () => {
    const addEventListener = vi.fn();
    const setTimeoutSpy = vi.fn();
    const setIntervalSpy = vi.fn();
    vi.stubGlobal('window', { addEventListener });
    vi.stubGlobal('setTimeout', setTimeoutSpy);
    vi.stubGlobal('setInterval', setIntervalSpy);

    const { selfHealingService } = await import('../../src/services/selfHealingService');

    expect(setTimeoutSpy).not.toHaveBeenCalled();
    expect(setIntervalSpy).not.toHaveBeenCalled();
    expect('performGarbageCollection' in selfHealingService).toBe(false);
  });

  it('keeps runtime error logging, uptime, and on-demand read-only diagnostics working', async () => {
    const { selfHealingService } = await import('../../src/services/selfHealingService');

    selfHealingService.logRuntimeError(new Error('boom'), 'TestSuite');
    const errors = selfHealingService.getRuntimeErrors();
    expect(errors[0]?.message).toBe('boom');
    expect(errors[0]?.source).toBe('TestSuite');
    expect(selfHealingService.getUptimeSeconds()).toBeGreaterThanOrEqual(0);

    const report = selfHealingService.runFullDiagnosticsAndRepair(false);
    expect(report.overallHealth).toBe('EXCELLENT');
    expect(report.autoRepairsApplied).toEqual([]);
    expect(report.lastErrorLog).toBe('boom');
  });
});
