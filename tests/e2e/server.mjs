// Starts the built server on a fresh demo database for the browser tests.
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

if (process.env.E2E_OFFLINE_FIXTURE_READY !== 'true') {
  await build({ entryPoints: ['tests/e2e/offline-test-entry.ts'], bundle: true, format: 'esm', platform: 'browser', outfile: 'dist/offline-store-test.js' });
}

const port = Number(process.env.E2E_PORT || 3990);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid E2E_PORT');
const dataRoot = path.resolve('.e2e-fixtures');
fs.mkdirSync(dataRoot, { recursive: true });
const requestedDir = process.env.E2E_TEST_DATA_DIR;
const dataDir = requestedDir ? path.resolve(requestedDir) : fs.mkdtempSync(path.join(dataRoot, `${port}-`));
if (path.dirname(dataDir) !== dataRoot) throw new Error('The browser test data directory must be inside .e2e-fixtures.');

const distDir = path.resolve(process.env.E2E_DIST_DIR || 'dist');

// Run in this process so browser-test teardown does not leave a child holding its pipes open.
Object.assign(process.env, {
    PORT: String(port),
    HOST: '127.0.0.1',
    DATA_DIR: dataDir,
    NODE_ENV: 'production',
    SESSION_SECRET: 'e2e-session-secret-0123456789abcdef0123456789',
    COOKIE_SECURE: 'false',
    SEED_DEMO_DATA: 'true',
    // Production refuses demo accounts unless this is set on purpose (browser tests use them).
    ALLOW_DEMO_IN_PRODUCTION: 'true',
    WIRE_POLL_MINUTES: '0',
    NOTIFY_DELIVERY_SECONDS: '0',
    BACKUP_INTERVAL_HOURS: '0',
    RATE_LIMIT_PER_MINUTE: '100000',
    LOGIN_RATE_LIMIT_PER_15MIN: '1000',
    LOG_LEVEL: 'warn',
});
process.chdir(path.dirname(distDir));
await import(pathToFileURL(path.resolve(distDir, '../dist-server/server.cjs')).href);
