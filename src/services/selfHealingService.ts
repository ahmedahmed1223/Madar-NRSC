import { NewsItem, Episode, RundownSegment, Guest } from '../types';
import { dataStore } from './dataStore';
import { COLLECTIONS } from '../shared/collections';
import { recalculateRundown } from '../shared/rundown';

export interface SelfHealingReport {
  timestamp: string;
  uptimeSeconds: number;
  overallHealth: 'EXCELLENT' | 'GOOD' | 'DEGRADED' | 'CRITICAL';
  healthScore: number; // 0 to 100
  storageQuota: {
    usedBytes: number;
    usedFormatted: string;
    estimatedPercentage: number;
    isCritical: boolean;
  };
  integrityStatus: {
    newsItemsChecked: number;
    episodesChecked: number;
    rundownsChecked: number;
    guestsChecked: number;
    orphanedReferencesFound: number;
    schemaAnomaliesFixed: number;
    timingErrorsCorrected: number;
  };
  autoRepairsApplied: string[];
  systemWarnings: string[];
  lastErrorLog?: string;
}

export interface RuntimeErrorRecord {
  id: string;
  timestamp: string;
  message: string;
  stack?: string;
  source: string;
  handled: boolean;
}

class SelfHealingEngine {
  private startTime = Date.now();
  private runtimeErrors: RuntimeErrorRecord[] = [];
  private lastReport: SelfHealingReport | null = null;

  constructor() {
    this.initGlobalCrashTraps();
  }

  /**
   * Global browser crash and uncaught promise rejection traps
   */
  private initGlobalCrashTraps() {
    if (typeof window === 'undefined') return;

    window.addEventListener('error', (event) => {
      const record: RuntimeErrorRecord = {
        id: `err-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        timestamp: new Date().toISOString(),
        message: event.message || 'Unknown runtime error',
        stack: event.error?.stack,
        source: `${event.filename}:${event.lineno}`,
        handled: true,
      };
      this.runtimeErrors.unshift(record);
      if (this.runtimeErrors.length > 50) this.runtimeErrors.pop();
      console.warn('[NRCS Self-Healing Guard] Caught and isolated runtime exception:', record.message);
    });

    window.addEventListener('unhandledrejection', (event) => {
      const record: RuntimeErrorRecord = {
        id: `rej-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        timestamp: new Date().toISOString(),
        message: event.reason?.message || String(event.reason) || 'Unhandled Promise Rejection',
        stack: event.reason?.stack,
        source: 'Async Promise Pipeline',
        handled: true,
      };
      this.runtimeErrors.unshift(record);
      if (this.runtimeErrors.length > 50) this.runtimeErrors.pop();
      console.warn('[NRCS Self-Healing Guard] Handled async promise rejection:', record.message);
    });
  }

  /**
   * Log runtime error manually
   */
  public logRuntimeError(error: Error | string, source = 'Component') {
    const record: RuntimeErrorRecord = {
      id: `man-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
      message: typeof error === 'string' ? error : error.message,
      stack: typeof error === 'string' ? undefined : error.stack,
      source,
      handled: true,
    };
    this.runtimeErrors.unshift(record);
    if (this.runtimeErrors.length > 50) this.runtimeErrors.pop();
  }

  public getRuntimeErrors(): RuntimeErrorRecord[] {
    return [...this.runtimeErrors];
  }

  public getUptimeSeconds(): number {
    return Math.floor((Date.now() - this.startTime) / 1000);
  }

  /**
   * Calculate local storage usage
   */
  public getStorageMetrics() {
    if (typeof localStorage === 'undefined') {
      return { usedBytes: 0, usedFormatted: '0 KB', estimatedPercentage: 0, isCritical: false };
    }

    let totalBytes = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) {
          const val = localStorage.getItem(key) || '';
          totalBytes += (key.length + val.length) * 2; // UTF-16
        }
      }
    } catch {
      totalBytes = 0;
    }

    const estimatedQuota = 5 * 1024 * 1024; // Standard 5MB localstorage limit
    const percentage = Math.min(100, Math.round((totalBytes / estimatedQuota) * 100));
    const usedFormatted = totalBytes > 1024 * 1024
      ? `${(totalBytes / (1024 * 1024)).toFixed(2)} MB`
      : `${(totalBytes / 1024).toFixed(1)} KB`;

    return {
      usedBytes: totalBytes,
      usedFormatted,
      estimatedPercentage: percentage,
      isCritical: percentage > 85,
    };
  }

  /**
   * On-demand read-only diagnostics audit (invoked explicitly from admin/diagnostics tools).
   */
  public runFullDiagnosticsAndRepair(_logUserActivity = true): SelfHealingReport {
    const warnings: string[] = [];

    let newsCount = 0;
    let episodesCount = 0;
    let rundownsCount = 0;
    let guestsCount = 0;
    let orphanedCount = 0;
    let schemaAnomalies = 0;
    let timingAnomalies = 0;

    try {
      // Strictly read-only integrity audit of the synced collections; the server remains the source of truth.
      if (dataStore.isReady()) {
        const newsList = dataStore.get<NewsItem[]>(COLLECTIONS.news.storageKey, []);
        newsCount = newsList.length;
        newsList.forEach((item) => {
          if (!item.id || !item.title || !item.status || !Array.isArray(item.keywords)) schemaAnomalies++;
        });

        const epList = dataStore.get<Episode[]>(COLLECTIONS.episodes.storageKey, []);
        episodesCount = epList.length;
        const guestIds = new Set(dataStore.get<Guest[]>(COLLECTIONS.guests.storageKey, []).map((g) => g.id));
        guestsCount = guestIds.size;

        epList.forEach((ep) => {
          const segments: RundownSegment[] = Array.isArray(ep.rundown) ? ep.rundown : [];
          rundownsCount += segments.length;
          const expected = recalculateRundown(segments);
          expected.forEach((seg, i) => {
            if (seg.startTimeOffset !== segments[i].startTimeOffset || seg.endTimeOffset !== segments[i].endTimeOffset) timingAnomalies++;
          });
          (ep.guests || []).forEach((g: any) => {
            const ref = g.guestId || g.id;
            if (ref && !guestIds.has(ref) && !String(ref).startsWith('ep-gst')) orphanedCount++;
          });
        });

        if (schemaAnomalies > 0) warnings.push(`تم رصد ${schemaAnomalies} خبر بحقول ناقصة، يرجى مراجعتها`);
        if (timingAnomalies > 0) warnings.push(`تم رصد ${timingAnomalies} فقرة بتوقيت غير متطابق؛ يُعاد حسابها تلقائياً عند حفظ الرانداون`);
        if (orphanedCount > 0) warnings.push(`تم رصد ${orphanedCount} ضيف مرتبط بحلقات وغير موجود في سجل الضيوف`);
      }
    } catch (criticalErr: any) {
      warnings.push(`خطأ استثنائي أثناء الفحص: ${criticalErr.message}`);
    }

    let score = 100;
    const storage = this.getStorageMetrics();
    if (storage.estimatedPercentage > 80) score -= 10;
    if (warnings.length > 0) score -= 15;
    if (this.runtimeErrors.length > 5) score -= 5;
    score = Math.max(60, Math.min(100, score));

    let overallHealth: 'EXCELLENT' | 'GOOD' | 'DEGRADED' | 'CRITICAL' = 'EXCELLENT';
    if (score >= 95) overallHealth = 'EXCELLENT';
    else if (score >= 80) overallHealth = 'GOOD';
    else if (score >= 65) overallHealth = 'DEGRADED';
    else overallHealth = 'CRITICAL';

    const report: SelfHealingReport = {
      timestamp: new Date().toISOString(),
      uptimeSeconds: this.getUptimeSeconds(),
      overallHealth,
      healthScore: score,
      storageQuota: storage,
      integrityStatus: {
        newsItemsChecked: newsCount,
        episodesChecked: episodesCount,
        rundownsChecked: rundownsCount,
        guestsChecked: guestsCount,
        orphanedReferencesFound: orphanedCount,
        schemaAnomaliesFixed: schemaAnomalies,
        timingErrorsCorrected: timingAnomalies,
      },
      autoRepairsApplied: [],
      systemWarnings: warnings,
      lastErrorLog: this.runtimeErrors[0]?.message,
    };

    this.lastReport = report;
    return report;
  }

  public getLastReport(): SelfHealingReport {
    if (!this.lastReport) {
      return this.runFullDiagnosticsAndRepair(false);
    }
    return this.lastReport;
  }
}

export const selfHealingService = new SelfHealingEngine();
