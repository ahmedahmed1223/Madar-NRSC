type Level = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let threshold: Level = 'info';
const since = new Date().toISOString();
const recentErrors: { id: string; at: string; message: string }[] = [];
let sequence = 0;
// Only fixed operational labels are exposed; raw error fields remain server-side.
const SAFE_ERROR_MESSAGES = new Set(['housekeeping failed', 'wire polling failed', 'scheduled publishing failed',
  'scheduled bulletins failed', 'notification delivery failed', 'complete backup failed', 'unhandled rejection',
  'failed to start server', 'gemini request failed', 'unhandled error', 'upload write failed', 'manual backup failed']);
export function getRecentErrors() {
  return { since, entries: recentErrors.map(entry => ({ ...entry })) };
}

export function setLogLevel(level: Level) {
  threshold = level;
}

function write(level: Level, msg: string, fields?: Record<string, unknown>) {
  if (level === 'error') {
    recentErrors.unshift({ id: String(++sequence), at: new Date().toISOString(), message: SAFE_ERROR_MESSAGES.has(msg) ? msg : 'server error' });
    recentErrors.length = Math.min(recentErrors.length, 100);
  }
  if (ORDER[level] < ORDER[threshold]) return;
  const line = JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields });
  if (level === 'error' || level === 'warn') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

export const logger = {
  debug: (msg: string, fields?: Record<string, unknown>) => write('debug', msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => write('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => write('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => write('error', msg, fields),
};
