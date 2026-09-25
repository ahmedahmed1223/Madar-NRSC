import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import type { Express } from 'express';
import request from 'supertest';
import { loadConfig } from '../src/server/config';
import { NewsroomDatabase } from '../src/server/db';
import { seedDatabase } from '../src/server/seed';
import { createApp } from '../src/server/app';
import { setLogLevel } from '../src/server/logger';

export const DEMO_PASSWORD = 'Madar@Demo2026';

export async function createTestServer(env: Record<string, string> = {}) {
  setLogLevel('error');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nrcs-test-'));
  const config = loadConfig({
    NODE_ENV: 'test',
    DATA_DIR: dir,
    SEED_DEMO_DATA: 'true',
    DEMO_USER_PASSWORD: DEMO_PASSWORD,
    LOGIN_RATE_LIMIT_PER_15MIN: '1000',
    RATE_LIMIT_PER_MINUTE: '100000',
    BACKUP_INTERVAL_HOURS: '0',
    ...env,
  });
  const db = new NewsroomDatabase(config.dataDir);
  await seedDatabase(db, config);
  const { app } = createApp(db, config);
  return {
    app,
    db,
    config,
    dir,
    close() {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Logs in and returns a supertest agent that keeps the session cookie. */
export async function loginAgent(app: Express, email: string, password = DEMO_PASSWORD) {
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/login').set('X-NRCS-Client', 'web').send({ email, password });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}

/** Starts the app on an ephemeral port (for fetch-based clients such as DataStore). */
export function listen(app: Express) {
  return new Promise<{ baseUrl: string; close: () => Promise<void> }>((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((r) => {
            server.closeAllConnections?.();
            server.close(() => r());
          }),
      });
    });
  });
}
