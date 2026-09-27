import { NewsItem, Program, Episode, RundownSegment, Guest, EpisodeGuest, EditorialTask, MediaFile, AuditLog, SystemSettings } from '../types';
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
  private autoRepairLogs: string[] = [];
  private runtimeErrors: RuntimeErrorRecord[] = [];
  private lastReport: SelfHealingReport | null = null;
  private isAutoHealingRunning = false;

  constructor() {
    this.initGlobalCrashTraps();
    // Run initial health audit lazily on startup
    if (typeof window !== 'undefined') {
      setTimeout(() => {
        this.runFullDiagnosticsAndRepair(false);
      }, 2000);

      // Periodic 24/7 integrity watchdog every 3 minutes
      setInterval(() => {
        this.runPeriodicWatchdog();
      }, 180000);
    }
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

  public getAutoRepairLogs(): string[] {
    return [...this.autoRepairLogs];
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
   * Storage quota auto-trimming & garbage collection
   */
  public performGarbageCollection(): number {
    if (typeof localStorage === 'undefined') return 0;
    let freedBytes = 0;
    const initialMetrics = this.getStorageMetrics();

    try {
      // 1. Trim audit logs to latest 100 items if oversized
      const auditKey = 'nrcs_audit_v1';
      const rawAudit = localStorage.getItem(auditKey);
      if (rawAudit) {
        try {
          const parsed = JSON.parse(rawAudit);
          if (Array.isArray(parsed) && parsed.length > 100) {
            const trimmed = parsed.slice(0, 100);
            localStorage.setItem(auditKey, JSON.stringify(trimmed));
            this.logRepair(`تم تقليص سجلات التدقيق القديمة من ${parsed.length} إلى 100 سجل لتوفير مساحة التخزين`);
          }
        } catch {}
      }

      // 2. Trim activity logs to latest 80 items
      const actKey = 'nrcs_activity_v1';
      const rawAct = localStorage.getItem(actKey);
      if (rawAct) {
        try {
          const parsed = JSON.parse(rawAct);
          if (Array.isArray(parsed) && parsed.length > 80) {
            const trimmed = parsed.slice(0, 80);
            localStorage.setItem(actKey, JSON.stringify(trimmed));
            this.logRepair(`تم تحسين حجم سجل الأنشطة المباشرة`);
          }
        } catch {}
      }

      // 3. Remove stale temporary editor auto-save snapshots older than 24h
      const vaultKey = 'nrcs_editor_vault_v1';
      const rawVault = localStorage.getItem(vaultKey);
      if (rawVault) {
        try {
          const parsed = JSON.parse(rawVault);
          const now = Date.now();
          const oneDayMs = 24 * 60 * 60 * 1000;
          let pruned = 0;
          Object.keys(parsed).forEach((k) => {
            if (now - (parsed[k]?.timestamp || 0) > oneDayMs) {
              delete parsed[k];
              pruned++;
            }
          });
          if (pruned > 0) {
            localStorage.setItem(vaultKey, JSON.stringify(parsed));
            this.logRepair(`تم تنظيف ${pruned} مسودة مؤقتة منتهية الصلاحية`);
          }
        } catch {}
      }
    } catch (e: any) {
      console.warn('[NRCS Self-Healing] GC Warning:', e);
    }

    const postMetrics = this.getStorageMetrics();
    freedBytes = Math.max(0, initialMetrics.usedBytes - postMetrics.usedBytes);
    return freedBytes;
  }

  /**
   * Background periodic watchdog (quiet)
   */
  private runPeriodicWatchdog() {
    if (this.isAutoHealingRunning) return;
    this.runFullDiagnosticsAndRepair(false);
  }

  /**
   * Comprehensive Diagnostics & Self-Healing Execution
   */
  public runFullDiagnosticsAndRepair(logUserActivity = true): SelfHealingReport {
    this.isAutoHealingRunning = true;
    const repairs: string[] = [];
    const warnings: string[] = [];

    let newsCount = 0;
    let episodesCount = 0;
    let rundownsCount = 0;
    let guestsCount = 0;
    let orphanedCount = 0;
    let schemaFixed = 0;
    let timingFixed = 0;

    try {
      // 1. Storage Quota Check & GC if needed
      const storage = this.getStorageMetrics();
      if (storage.isCritical) {
        const freed = this.performGarbageCollection();
        repairs.push(`تم تفعيل التفريغ التلقائي (GC) واستعادة ${(freed / 1024).toFixed(1)} KB من الذاكرة`);
      }

      // 2-4. Integrity audit of the shared collections. This is strictly read-only:
      // every browser runs it, so writing "repairs" here would make concurrent users
      // overwrite each other. Anomalies are reported; the server remains the source of truth.
      if (dataStore.isReady()) {
        const newsList = dataStore.get<NewsItem[]>(COLLECTIONS.news.storageKey, []);
        newsCount = newsList.length;
        newsList.forEach((item) => {
          if (!item.id || !item.title || !item.status || !Array.isArray(item.keywords)) schemaFixed++;
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
            if (seg.startTimeOffset !== segments[i].startTimeOffset || seg.endTimeOffset !== segments[i].endTimeOffset) timingFixed++;
          });
          (ep.guests || []).forEach((g: any) => {
            const ref = g.guestId || g.id;
            if (ref && !guestIds.has(ref) && !String(ref).startsWith('ep-gst')) orphanedCount++;
          });
        });

        if (schemaFixed > 0) warnings.push(`تم رصد ${schemaFixed} خبر بحقول ناقصة، يرجى مراجعتها`);
        if (timingFixed > 0) warnings.push(`تم رصد ${timingFixed} فقرة بتوقيت غير متطابق؛ يُعاد حسابها تلقائياً عند حفظ الرانداون`);
        if (orphanedCount > 0) warnings.push(`تم رصد ${orphanedCount} ضيف مرتبط بحلقات وغير موجود في سجل الضيوف`);
      }

    } catch (criticalErr: any) {
      warnings.push(`خطأ استثنائي أثناء الفحص: ${criticalErr.message}`);
    } finally {
      this.isAutoHealingRunning = false;
    }

    // Calculate Health Score (100 - penalties)
    let score = 100;
    const postStorage = this.getStorageMetrics();
    if (postStorage.estimatedPercentage > 80) score -= 10;
    if (warnings.length > 0) score -= 15;
    if (this.runtimeErrors.length > 5) score -= 5;
    score = Math.max(60, Math.min(100, score));

    let overallHealth: 'EXCELLENT' | 'GOOD' | 'DEGRADED' | 'CRITICAL' = 'EXCELLENT';
    if (score >= 95) overallHealth = 'EXCELLENT';
    else if (score >= 80) overallHealth = 'GOOD';
    else if (score >= 65) overallHealth = 'DEGRADED';
    else overallHealth = 'CRITICAL';

    repairs.forEach((r) => this.logRepair(r));

    const report: SelfHealingReport = {
      timestamp: new Date().toISOString(),
      uptimeSeconds: this.getUptimeSeconds(),
      overallHealth,
      healthScore: score,
      storageQuota: postStorage,
      integrityStatus: {
        newsItemsChecked: newsCount,
        episodesChecked: episodesCount,
        rundownsChecked: rundownsCount,
        guestsChecked: guestsCount,
        orphanedReferencesFound: orphanedCount,
        schemaAnomaliesFixed: schemaFixed,
        timingErrorsCorrected: timingFixed,
      },
      autoRepairsApplied: repairs,
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

  private logRepair(msg: string) {
    const timestamp = new Date().toLocaleTimeString('ar-EG-u-nu-latn', { hour12: false });
    this.autoRepairLogs.unshift(`[${timestamp}] ${msg}`);
    if (this.autoRepairLogs.length > 40) this.autoRepairLogs.pop();
  }
}

export const selfHealingService = new SelfHealingEngine();
