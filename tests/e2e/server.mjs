// Starts the built server on a fresh demo database for the browser tests.
import fs from 'fs';
import path from 'path';
import { build } from 'esbuild';

await build({ entryPoints: ['tests/e2e/offline-test-entry.ts'], bundle: true, format: 'esm', platform: 'browser', outfile: 'dist/offline-store-test.js' });

const port = Number(process.env.E2E_PORT || 3990);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid E2E_PORT');
const dataDir = path.resolve('tests/e2e/.data', String(port));
fs.rmSync(dataDir, { recursive: true, force: true });
fs.mkdirSync(dataDir, { recursive: true });

// Run in this process so browser-test teardown does not leave a child holding its pipes open.
Object.assign(process.env, {
    PORT: String(port),
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
await import('../../dist/server.cjs');
