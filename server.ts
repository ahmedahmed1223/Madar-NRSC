import 'dotenv/config';
import express, { Request, Response } from 'express';
import path from 'path';
import { loadConfig } from './src/server/config';
import { logger, setLogLevel, setErrorJournal } from './src/server/logger';
import { ErrorJournal } from './src/server/errorJournal';
import { openConfiguredDatabase } from './src/server/openDatabase';
import { seedDatabase } from './src/server/seed';
import { createApp } from './src/server/app';
import { removeUpload } from './src/server/uploads';
import { createScheduledBulletins, publishDueScheduledNews } from './src/server/scheduler';
import { approveDueBulletinMedia } from './src/server/bulletinMediaReview';
import { sendDuePersonalTaskReminders } from './src/server/personalTaskReminders';
import { sendDueWorkReminders } from './src/server/workReminders';
import { sendShiftGapNotices } from './src/server/shiftGapNotices';
import { sendDueGuestTechnicalInvitations } from './src/server/guestTechInvitations';
import { startAutoMediaTranscription } from './src/server/autoMediaTranscription';
import { runRetention } from './src/server/retention';
import { pollWires } from './src/server/wires';
import { deliverPending, initializeNotificationDelivery } from './src/server/delivery';
import { cleanupBackupStaging, createFullBackup } from './src/server/backupDelivery';
import { deploymentWarnings, scanDemoPasswords } from './src/server/deploymentChecks';
import { cleanupRehearsals, databaseOperationLock, DatabaseOperationBusy } from './src/server/databaseRecovery';
import { reconcileBackupIncidents } from './src/server/backupIncidents';
import { backupStatus, nextBackupDelayMs } from './src/server/databaseDiagnostics';
import { changeBus } from './src/server/sync';
import { recordJob, registerJob, trackJob } from './src/server/jobs';
import { runStorageSync } from './src/server/storage';

/** Periodic jobs as the administrator's overview names them. */
const JOBS = { publish: 'النشر المجدول', bulletins: 'إنشاء النشرات المجدولة', housekeeping: 'التنظيف الدوري', wires: 'جلب البرقيات', delivery: 'إرسال التنبيهات', backup: 'النسخ الاحتياطي', storage: 'نسخ الملفات إلى التخزين' };

async function main() {
  const config = loadConfig();
  setLogLevel(config.logLevel);
  const journal = await ErrorJournal.open(path.join(config.dataDir, 'error-journal'));
  setErrorJournal(journal);

  const db = openConfiguredDatabase(config.dataDir, config.database);
  await cleanupRehearsals(path.join(config.dataDir, 'rehearsals'));
  await cleanupBackupStaging(db, config).catch(() => logger.warn('local backup staging cleanup failed'));
  await seedDatabase(db, config);
  logger.info('database ready', { engine: db.engine, rev: db.currentRev() });
  if (process.env.K_SERVICE) {
    // Runtime state, uploads, and backups need a persistent volume with both engines.
    logger.warn('running on Cloud Run: use one active instance and keep DATA_DIR on a persistent volume', {
      dataDir: config.dataDir,
      dbId: db.dbId,
    });
  }

  const { app } = createApp(db, config);

  if (!config.isProduction) {
    // Loaded lazily so production images do not need Vite.
    const { createServer } = await import('vite');
    const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use((req, res, next) => {
      if (/(?:\.map|\/server\.cjs)$/i.test(req.path)) {
        res.sendStatus(404);
        return;
      }
      next();
    });
    app.use(
      express.static(distPath, {
        index: false,
        extensions: false,
        setHeaders: (res, filePath) => {
          if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          } else {
            res.setHeader('Cache-Control', 'no-cache');
          }
        },
      })
    );
    app.get('/{*splat}', (_req: Request, res: Response) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(distPath, 'index.html'), { dotfiles: 'allow' });
    });
  }

  // Housekeeping: expired sessions, old tombstones, scheduled backups.
  const timers: NodeJS.Timeout[] = [];
  const backupSchedule = { stopped: false };
  const backgroundJobs = new Map<string, Promise<unknown>>();
  let shuttingDown = false;
  const backgroundJob = (name: string, work: () => Promise<unknown>) => () => {
    if (shuttingDown) return Promise.resolve();
    const active = backgroundJobs.get(name);
    if (active) return active;
    const pending = Promise.resolve().then(work).finally(() => backgroundJobs.delete(name));
    backgroundJobs.set(name, pending);
    return pending;
  };
  registerJob(JOBS.publish, 0.5);
  registerJob(JOBS.bulletins, 10);
  registerJob(JOBS.housekeeping, 60);
  if (config.deliverySeconds > 0) initializeNotificationDelivery(db);
  const checkBackupIncidents = backgroundJob('backup-incidents', async () => {
    try {
      const before = db.currentRev();
      await reconcileBackupIncidents(db, backupStatus(db, config.backupIntervalHours));
      const after = db.currentRev();
      if (after !== before) changeBus.emit('rev', after);
    } catch { logger.warn('backup incident notifications unavailable'); }
  });
  timers.push(setInterval(checkBackupIncidents, 60000));
  await checkBackupIncidents();
  timers.push(
    setInterval(() => {
      try {
        db.purgeExpiredSessions();
        runRetention(db, config.dataDir, { ...config.retention, wireDays: config.wires.retentionDays });
        db.purgeTombstones(30 * 24 * 60 * 60 * 1000);
        // Files uploaded but never attached to a media record or a message (abandoned forms).
        db.findOrphanUploads(24 * 60 * 60 * 1000).forEach((u) => removeUpload(db, config.dataDir, u.id));
        recordJob(JOBS.housekeeping);
      } catch (err) {
        recordJob(JOBS.housekeeping, err);
        logger.error('housekeeping failed', { error: String(err) });
      }
    }, 60 * 60 * 1000)
  );
  // Agency wire feeds.
  if (config.wires.pollMinutes > 0) {
    registerJob(JOBS.wires, config.wires.pollMinutes);
    const poll = backgroundJob(JOBS.wires, () => trackJob(JOBS.wires, () => pollWires(db, config.wires))
      .catch((err) => logger.error('wire polling failed', { error: String(err) })));
    timers.push(setInterval(poll, config.wires.pollMinutes * 60 * 1000));
    timers.push(setTimeout(poll, 5_000).unref());
  }
  // Library files to Dropbox / Google Drive / the shared folder.
  if (config.storageSyncSeconds > 0) {
    registerJob(JOBS.storage, config.storageSyncSeconds / 60);
    const copy = backgroundJob(JOBS.storage, () => trackJob(JOBS.storage, () => runStorageSync(db, config))
      .catch((err) => logger.error('storage copy failed', { error: String(err) })));
    timers.push(setInterval(copy, config.storageSyncSeconds * 1000));
  }
  // Scheduled publishing: checked every 30 seconds.
  timers.push(
    setInterval(() => {
      try {
        publishDueScheduledNews(db);
        recordJob(JOBS.publish);
      } catch (err) {
        recordJob(JOBS.publish, err);
        logger.error('scheduled publishing failed', { error: String(err) });
      }
    }, 30_000)
  );
  publishDueScheduledNews(db);
  const reminderJob = 'تذكيرات المهام الشخصية';
  registerJob(reminderJob, 0.5);
  const remind = () => {
    try {
      sendDuePersonalTaskReminders(db);
      recordJob(reminderJob);
    } catch (error) {
      recordJob(reminderJob, error);
      logger.error('personal task reminders failed', { error: String(error) });
    }
  };
  timers.push(setInterval(remind, 30_000));
  remind();
  const workReminderJob = 'تذكيرات التكليفات والمهام';
  registerJob(workReminderJob, 0.5);
  const remindWork = () => {
    try {
      sendDueWorkReminders(db);
      recordJob(workReminderJob);
    } catch (error) {
      recordJob(workReminderJob, error);
      logger.error('work reminders failed', { error: String(error) });
    }
  };
  timers.push(setInterval(remindWork, 30_000));
  remindWork();
  const shiftGapJob = 'رصد نواقص مناوبات البث';
  registerJob(shiftGapJob, 5);
  const checkShiftGaps = () => {
    try {
      sendShiftGapNotices(db);
      recordJob(shiftGapJob);
    } catch (error) {
      recordJob(shiftGapJob, error);
      logger.error('shift gap checks failed', { error: String(error) });
    }
  };
  timers.push(setInterval(checkShiftGaps, 5 * 60_000));
  checkShiftGaps();
  if (config.autoGuestTechnicalEmail && config.mail && config.appUrl) {
    const guestJob = 'الفحص التقني قبل البث';
    registerJob(guestJob, 1);
    const invite = backgroundJob(guestJob, async () => {
      try { await trackJob(guestJob, () => sendDueGuestTechnicalInvitations(db, config)); }
      catch (error) { logger.error('guest technical invitations failed', { error: String(error) }); }
    });
    timers.push(setInterval(invite, 60_000));
    void invite();
  }
  const stopMediaTranscription = startAutoMediaTranscription(db, config, () => changeBus.emit('rev', db.currentRev()));
  // Scheduled bulletins (only formats set to create automatically).
  const scheduleBulletins = () => {
    try {
      createScheduledBulletins(db);
      recordJob(JOBS.bulletins);
    } catch (err) {
      recordJob(JOBS.bulletins, err);
      logger.error('scheduled bulletins failed', { error: String(err) });
    }
  };
  timers.push(setInterval(scheduleBulletins, 10 * 60 * 1000));
  scheduleBulletins();

  const updateMediaPreviews = () => {
    try {
      if (approveDueBulletinMedia(db)) changeBus.emit('rev', db.currentRev());
    } catch (error) { logger.error('scheduled bulletin media review failed', { error: String(error) }); }
  };
  timers.push(setInterval(updateMediaPreviews, 10_000));
  updateMediaPreviews();

  // E-mail and phone/desktop push for new notifications (per-colleague preferences).
  if (config.deliverySeconds > 0) {
    registerJob(JOBS.delivery, config.deliverySeconds / 60);
    const deliver = backgroundJob(JOBS.delivery, () => trackJob(JOBS.delivery, async () => {
      const revision = db.currentRev();
      const result = await deliverPending(db, config);
      if (db.currentRev() !== revision) changeBus.emit('rev', db.currentRev());
      return result;
    }).catch((err) => logger.error('notification delivery failed', { error: String(err) })));
    timers.push(setInterval(deliver, config.deliverySeconds * 1000));
    deliver();
  }

  if (config.backupIntervalHours > 0) {
    registerJob(JOBS.backup, config.backupIntervalHours * 60);
    const backup = backgroundJob(JOBS.backup, async () => {
      try {
        await databaseOperationLock(db).run(async () => {
        // Same full bundle as «نسخة احتياطية كاملة الآن» (database + uploads + SHA-256 manifest).
        const result = await createFullBackup(db, config, 'auto');
        recordJob(JOBS.backup);
        logger.info('complete backup created and delivered', { file: result.file.fileName, bundle: result.bundle, uploads: result.uploads });
        });
      } catch (err) {
        if (err instanceof DatabaseOperationBusy) return;
        recordJob(JOBS.backup, err);
        logger.error('complete backup failed', { error: String(err) });
      } finally { await checkBackupIncidents(); }
    });
    const scheduleNextBackup = () => {
      if (backupSchedule.stopped) return;
      const status = backupStatus(db, config.backupIntervalHours, config);
      const delay = nextBackupDelayMs(config.backupIntervalHours, status.lastDelivery, status.lastAttempt);
      if (delay === null) return;
      timers.push(setTimeout(() => {
        void backup().finally(scheduleNextBackup);
      }, delay));
    };
    // Schedule against the last complete delivery, so frequent restarts cannot keep resetting the interval.
    scheduleNextBackup();
  }

  // Deployment settings that put production at risk: loud in the log, and listed in «مراقبة النظام».
  const warnDeployment = () => deploymentWarnings(db, config).forEach((w) => (w.level === 'error' ? logger.error : logger.warn)(`DEPLOYMENT WARNING: ${w.log}`));
  void backgroundJob('scan-demo-passwords', () => scanDemoPasswords(db, config).then(warnDeployment)
    .catch((err) => logger.warn('demo password check failed', { error: String(err) })))();

  const server = app.listen(config.port, config.host, () => {
    logger.info('server listening', { url: `http://localhost:${config.port}`, env: config.isProduction ? 'production' : 'development' });
  });
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.locals.beginShutdown();
    logger.info('shutting down', { signal });
    // The backup timer is recursive; prevent an in-flight backup from scheduling another run.
    backupSchedule.stopped = true;
    timers.forEach(clearInterval);
    stopMediaTranscription();
    const force = setTimeout(() => {
      logger.warn('forcing shutdown after timeout');
      db.close();
      process.exit(1);
    }, 10_000);
    force.unref();
    server.close(async () => {
      await Promise.allSettled(backgroundJobs.values());
      await journal.close();
      db.close();
      logger.info('shutdown complete');
      process.exit(0);
    });
    // Long-lived SSE connections would otherwise keep server.close() waiting.
    server.closeIdleConnections?.();
    // In-flight uploads and writes may finish until the final shutdown deadline.
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => logger.error('unhandled rejection', { reason: String(reason) }));
}

main().catch((err) => {
  logger.error('failed to start server', { error: String(err?.stack || err) });
  process.exit(1);
});
