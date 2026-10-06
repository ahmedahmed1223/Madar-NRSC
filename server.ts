import 'dotenv/config';
import express, { Request, Response } from 'express';
import path from 'path';
import { loadConfig } from './src/server/config';
import { logger, setLogLevel } from './src/server/logger';
import { NewsroomDatabase } from './src/server/db';
import { seedDatabase } from './src/server/seed';
import { createApp } from './src/server/app';
import { removeUpload } from './src/server/uploads';
import { createScheduledBulletins, publishDueScheduledNews } from './src/server/scheduler';
import { runRetention } from './src/server/retention';
import { pollWires } from './src/server/wires';
import { deliverPending } from './src/server/delivery';
import { deliverBackup } from './src/server/backupDelivery';

async function main() {
  const config = loadConfig();
  setLogLevel(config.logLevel);

  const db = new NewsroomDatabase(config.dataDir);
  await seedDatabase(db, config);
  logger.info('database ready', { file: db.filePath, rev: db.currentRev() });
  if (process.env.K_SERVICE) {
    // Cloud Run: every instance has its own disk. SQLite needs exactly one instance and a mounted volume.
    logger.warn('running on Cloud Run: set max-instances=1 and put DATA_DIR on a mounted persistent volume, otherwise saves can disappear between instances', {
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
    app.use(
      express.static(distPath, {
        index: false,
        setHeaders: (res, filePath) => {
          if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          } else {
            res.setHeader('Cache-Control', 'no-cache');
          }
        },
      })
    );
    app.get('*', (_req: Request, res: Response) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Housekeeping: expired sessions, old tombstones, scheduled backups.
  const timers: NodeJS.Timeout[] = [];
  timers.push(
    setInterval(() => {
      try {
        db.purgeExpiredSessions();
        runRetention(db, config.dataDir, { ...config.retention, wireDays: config.wires.retentionDays });
        db.purgeTombstones(30 * 24 * 60 * 60 * 1000);
        // Files uploaded but never attached to a media record (abandoned forms).
        db.findOrphanUploads(24 * 60 * 60 * 1000).forEach((u) => removeUpload(db, config.dataDir, u.id));
      } catch (err) {
        logger.error('housekeeping failed', { error: String(err) });
      }
    }, 60 * 60 * 1000)
  );
  // Agency wire feeds.
  if (config.wires.pollMinutes > 0) {
    const poll = () => pollWires(db, config.wires).catch((err) => logger.error('wire polling failed', { error: String(err) }));
    timers.push(setInterval(poll, config.wires.pollMinutes * 60 * 1000));
    setTimeout(poll, 5_000).unref();
  }
  // Scheduled publishing: checked every 30 seconds.
  timers.push(
    setInterval(() => {
      try {
        publishDueScheduledNews(db);
      } catch (err) {
        logger.error('scheduled publishing failed', { error: String(err) });
      }
    }, 30_000)
  );
  publishDueScheduledNews(db);
  // Scheduled bulletins (only formats set to create automatically).
  const scheduleBulletins = () => {
    try {
      createScheduledBulletins(db);
    } catch (err) {
      logger.error('scheduled bulletins failed', { error: String(err) });
    }
  };
  timers.push(setInterval(scheduleBulletins, 10 * 60 * 1000));
  scheduleBulletins();

  // E-mail and phone/desktop push for new notifications (per-colleague preferences).
  if (config.deliverySeconds > 0) {
    const deliver = () => deliverPending(db, config).catch((err) => logger.error('notification delivery failed', { error: String(err) }));
    timers.push(setInterval(deliver, config.deliverySeconds * 1000));
    deliver();
  }

  if (config.backupIntervalHours > 0) {
    let backingUp = false;
    const backup = async () => {
      if (backingUp) return;
      backingUp = true;
      try {
        const file = await db.createBackup('auto', config.backupRetention);
        const result = await deliverBackup(db, file.fileName, { directory: config.backupDirectory,
          remote: config.backupRemote, retention: config.backupRetention });
        logger.info('complete backup created and delivered', result);
      } catch (err) {
        logger.error('complete backup failed', { error: String(err) });
      } finally { backingUp = false; }
    };
    timers.push(
      setInterval(backup, config.backupIntervalHours * 60 * 60 * 1000)
    );
  }

  const server = app.listen(config.port, config.host, () => {
    logger.info('server listening', { url: `http://localhost:${config.port}`, env: config.isProduction ? 'production' : 'development' });
  });
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.locals.beginShutdown();
    logger.info('shutting down', { signal });
    timers.forEach(clearInterval);
    const force = setTimeout(() => {
      logger.warn('forcing shutdown after timeout');
      db.close();
      process.exit(1);
    }, 10_000);
    force.unref();
    server.close(() => {
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
