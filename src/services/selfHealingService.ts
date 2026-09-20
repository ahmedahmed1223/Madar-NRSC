import { NewsItem, Program, Episode, RundownSegment, Guest, EpisodeGuest, EditorialTask, MediaFile, AuditLog, SystemSettings } from '../types';
import {
  INITIAL_NEWS,
  INITIAL_PROGRAMS,
  INITIAL_EPISODES,
  INITIAL_GUESTS,
  INITIAL_TASKS,
  INITIAL_MEDIA_FILES,
  INITIAL_AUDIT_LOGS,
  INITIAL_CATEGORIES,
  INITIAL_SOURCES,
  INITIAL_PROGRAM_TYPES,
} from './mockData';

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

      // 2. Validate and Repair News Collection
      const newsKey = 'nrcs_news_v1';
      let rawNews = localStorage.getItem(newsKey);
      let newsList: NewsItem[] = [];

      if (!rawNews) {
        newsList = INITIAL_NEWS;
        localStorage.setItem(newsKey, JSON.stringify(newsList));
        repairs.push('تم استرجاع جدول الأخبار الأولي تلقائياً');
      } else {
        try {
          newsList = JSON.parse(rawNews);
          if (!Array.isArray(newsList)) throw new Error('News is not an array');
        } catch {
          newsList = INITIAL_NEWS;
          localStorage.setItem(newsKey, JSON.stringify(newsList));
          repairs.push('تم إصلاح تلف بيانات جدول الأخبار واستعادته من نقطة الأمان');
          schemaFixed++;
        }
      }

      // Normalize & Sanitize News Items
      let newsModified = false;
      newsList = newsList.map((item, idx) => {
        let itemFixed = false;
        const sanitized: NewsItem = { ...item };

        if (!sanitized.id) {
          sanitized.id = `nws-auto-${Date.now()}-${idx}`;
          itemFixed = true;
        }
        if (!sanitized.title || typeof sanitized.title !== 'string') {
          sanitized.title = 'خبر بدون عنوان (تمت معالجته ذاتياً)';
          itemFixed = true;
        }
        if (!sanitized.priority) {
          sanitized.priority = 'NORMAL';
          itemFixed = true;
        }
        if (!sanitized.status) {
          sanitized.status = 'DRAFT';
          itemFixed = true;
        }
        if (!Array.isArray(sanitized.keywords)) {
          sanitized.keywords = [];
          itemFixed = true;
        }
        if (typeof sanitized.viewsCount !== 'number' || isNaN(sanitized.viewsCount)) {
          sanitized.viewsCount = 0;
          itemFixed = true;
        }
        if (!sanitized.createdAt) {
          sanitized.createdAt = new Date().toISOString();
          itemFixed = true;
        }
        if (!sanitized.updatedAt) {
          sanitized.updatedAt = new Date().toISOString();
          itemFixed = true;
        }

        if (itemFixed) {
          newsModified = true;
          schemaFixed++;
        }
        return sanitized;
      });

      if (newsModified) {
        localStorage.setItem(newsKey, JSON.stringify(newsList));
        repairs.push('تمت مطابقة وتصحيح حقول الأخبار غير المكتملة');
      }
      newsCount = newsList.length;

      // 3. Validate and Repair Episodes & Rundowns
      const epKey = 'nrcs_episodes_v1';
      let rawEp = localStorage.getItem(epKey);
      let epList: Episode[] = [];

      if (!rawEp) {
        epList = INITIAL_EPISODES;
        localStorage.setItem(epKey, JSON.stringify(epList));
        repairs.push('تمت إعادة تهيئة سجل الحلقات الأولي');
      } else {
        try {
          epList = JSON.parse(rawEp);
          if (!Array.isArray(epList)) throw new Error('Episodes is not an array');
        } catch {
          epList = INITIAL_EPISODES;
          localStorage.setItem(epKey, JSON.stringify(epList));
          repairs.push('تم إصلاح تلف بيانات الحلقات واستعادتها بأمان');
          schemaFixed++;
        }
      }

      let epModified = false;
      epList = epList.map((ep, idx) => {
        let epFixed = false;
        const sEp: Episode = { ...ep };

        if (!sEp.id) {
          sEp.id = `ep-auto-${Date.now()}-${idx}`;
          epFixed = true;
        }
        if (!sEp.title) {
          sEp.title = `حلقة ${sEp.episodeNumber || idx + 1}`;
          epFixed = true;
        }
        if (!Array.isArray(sEp.guests)) {
          sEp.guests = [];
          epFixed = true;
        }
        if (!Array.isArray(sEp.questions)) {
          sEp.questions = [];
          epFixed = true;
        }

        // Sanitize Guests objects inside episode
        sEp.guests = sEp.guests.map((g: any, gIdx: number): EpisodeGuest => {
          if (!g.guestId && !g.id) {
            schemaFixed++;
            return {
              id: `ep-gst-${gIdx}`,
              guestId: `gst-ref-${gIdx}`,
              guestName: g.guestName || g.fullName || 'ضيف بدون اسم',
              fullName: g.fullName || g.guestName || 'ضيف بدون اسم',
              connectionType: g.connectionType || 'STUDIO',
              segmentTopic: g.segmentTopic || 'مشاركة حوارية',
              arrivalStatus: g.arrivalStatus || 'CONFIRMED',
            };
          }
          return {
            id: g.id || `ep-gst-${gIdx}`,
            guestId: g.guestId || g.id,
            guestName: g.guestName || g.fullName || 'ضيف استوديو',
            fullName: g.fullName || g.guestName || 'ضيف استوديو',
            guestAvatar: g.guestAvatar || g.avatarUrl,
            avatarUrl: g.avatarUrl || g.guestAvatar,
            organization: g.organization,
            jobTitle: g.jobTitle,
            connectionType: g.connectionType || 'STUDIO',
            segmentTopic: g.segmentTopic || 'مشاركة حوارية',
            arrivalStatus: g.arrivalStatus || 'CONFIRMED',
          };
        });

        // Validate and Recalculate Rundown Segments Math
        if (!Array.isArray(sEp.rundown)) {
          sEp.rundown = [];
          epFixed = true;
        } else {
          rundownsCount += sEp.rundown.length;
          let cumulativeSec = 0;
          let rundownNeedsSync = false;

          sEp.rundown = sEp.rundown.map((seg, sIdx) => {
            const duration = Math.max(5, Number(seg.durationSeconds) || 60);
            const startSec = cumulativeSec;
            const endSec = startSec + duration;
            cumulativeSec = endSec;

            const expectedStart = this.formatSeconds(startSec);
            const expectedEnd = this.formatSeconds(endSec);
            const expectedOrder = sIdx + 1;

            if (
              seg.startTimeOffset !== expectedStart ||
              seg.endTimeOffset !== expectedEnd ||
              seg.orderIndex !== expectedOrder ||
              !seg.id
            ) {
              rundownNeedsSync = true;
              timingFixed++;
            }

            return {
              ...seg,
              id: seg.id || `seg-auto-${Date.now()}-${sIdx}`,
              orderIndex: expectedOrder,
              durationSeconds: duration,
              startTimeOffset: expectedStart,
              endTimeOffset: expectedEnd,
              segmentType: seg.segmentType || 'REPORT',
              title: seg.title || `فقرة #${expectedOrder}`,
            };
          });

          if (rundownNeedsSync) {
            epFixed = true;
          }
        }

        if (epFixed) {
          epModified = true;
        }
        return sEp;
      });

      if (epModified) {
        localStorage.setItem(epKey, JSON.stringify(epList));
        if (timingFixed > 0) {
          repairs.push(`تمت إعادة حساب وتصحيح التوقيتات الدقيقة لـ ${timingFixed} فقرة في جداول الرانداون`);
        }
      }
      episodesCount = epList.length;

      // 4. Validate Programs Collection
      const progKey = 'nrcs_programs_v1';
      let rawProg = localStorage.getItem(progKey);
      if (!rawProg) {
        localStorage.setItem(progKey, JSON.stringify(INITIAL_PROGRAMS));
        repairs.push('تم استرجاع دليل البرامج الأساسي');
      }

      // 5. Validate Guests Directory
      const gstKey = 'nrcs_guests_v1';
      let rawGst = localStorage.getItem(gstKey);
      if (!rawGst) {
        localStorage.setItem(gstKey, JSON.stringify(INITIAL_GUESTS));
        repairs.push('تم استرجاع دليل الضيوف الأساسي');
      } else {
        try {
          const gsts = JSON.parse(rawGst);
          guestsCount = Array.isArray(gsts) ? gsts.length : 0;
        } catch {
          localStorage.setItem(gstKey, JSON.stringify(INITIAL_GUESTS));
          schemaFixed++;
        }
      }

      // 6. Validate Categories & Sources
      if (!localStorage.getItem('nrcs_categories_v1')) {
        localStorage.setItem('nrcs_categories_v1', JSON.stringify(INITIAL_CATEGORIES));
      }
      if (!localStorage.getItem('nrcs_sources_v1')) {
        localStorage.setItem('nrcs_sources_v1', JSON.stringify(INITIAL_SOURCES));
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
    const timestamp = new Date().toLocaleTimeString('ar-SA', { hour12: false });
    this.autoRepairLogs.unshift(`[${timestamp}] ${msg}`);
    if (this.autoRepairLogs.length > 40) this.autoRepairLogs.pop();
  }

  private formatSeconds(totalSec: number): string {
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
}

export const selfHealingService = new SelfHealingEngine();
