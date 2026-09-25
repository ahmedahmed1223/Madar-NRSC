import 'dotenv/config';
import express, { Request, Response } from 'express';
import path from 'path';
import { loadConfig } from './src/server/config';
import { logger, setLogLevel } from './src/server/logger';
import { NewsroomDatabase } from './src/server/db';
import { seedDatabase } from './src/server/seed';
import { createApp } from './src/server/app';

async function main() {
  const config = loadConfig();
  setLogLevel(config.logLevel);

  const db = new NewsroomDatabase(config.dataDir);
  await seedDatabase(db, config);
  logger.info('database ready', { file: db.filePath, rev: db.currentRev() });

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
        db.purgeTombstones(30 * 24 * 60 * 60 * 1000);
      } catch (err) {
        logger.error('housekeeping failed', { error: String(err) });
      }
    }, 60 * 60 * 1000)
  );
  if (config.backupIntervalHours > 0) {
    timers.push(
      setInterval(() => {
        db.createBackup('auto', config.backupRetention)
          .then((b) => logger.info('scheduled backup created', { file: b.fileName }))
          .catch((err) => logger.error('scheduled backup failed', { error: String(err) }));
      }, config.backupIntervalHours * 60 * 60 * 1000)
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
    setTimeout(() => server.closeAllConnections?.(), 2_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => logger.error('unhandled rejection', { reason: String(reason) }));
}

main().catch((err) => {
  logger.error('failed to start server', { error: String(err?.stack || err) });
  process.exit(1);
});
