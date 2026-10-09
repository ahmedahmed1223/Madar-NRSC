import crypto from 'node:crypto';
import { ErrorJournal, safeErrorMessage } from './errorJournal';
import { currentCorrelationId } from './requestCorrelation';
type Level = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let threshold: Level = 'info';
const since = new Date().toISOString();
const recentErrors: { id: string; at: string; message: string }[] = [];
let journal: ErrorJournal | null = null;
export function setErrorJournal(value: ErrorJournal | null) { journal = value; }
export function errorJournalHealth(): 'ok' | 'degraded' | 'memory' { return journal?.health() ?? 'memory'; }
export function getRecentErrors() {
  return { ...(journal?.snapshot() ?? { since, entries: recentErrors.map(entry => ({ ...entry })) }), journalHealth: errorJournalHealth() };
}

export function setLogLevel(level: Level) {
  threshold = level;
}

function write(level: Level, msg: string, fields?: Record<string, unknown>) {
  if (level === 'error') {
    const entry = { id: currentCorrelationId() ?? crypto.randomUUID(), at: new Date().toISOString(), message: safeErrorMessage(msg) };
    journal?.append(entry);
    recentErrors.unshift(entry);
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
