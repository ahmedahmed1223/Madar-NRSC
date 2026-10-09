import fs from 'node:fs';
import path from 'node:path';
import type { RecentServerError, RecentServerErrors } from '../shared/databaseDiagnostics';

const LIMIT = 1048576;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SAFE = new Set(['housekeeping failed', 'wire polling failed', 'scheduled publishing failed',
  'scheduled bulletins failed', 'notification delivery failed', 'complete backup failed', 'unhandled rejection',
  'failed to start server', 'gemini request failed', 'unhandled error', 'upload write failed', 'manual backup failed', 'server error']);
export const safeErrorMessage = (message: string) => SAFE.has(message) ? message : 'server error';

export class ErrorJournal {
  private entries: RecentServerError[] = [];
  private queue: RecentServerError[] = [];
  private writing: Promise<void> | null = null;
  private degraded = false;
  private closed = false;
  private since = new Date().toISOString();
  private constructor(private directory: string) {}
  static async open(directory: string): Promise<ErrorJournal> {
    const journal = new ErrorJournal(directory);
    try {
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      if (!fs.lstatSync(directory).isDirectory() || fs.lstatSync(directory).isSymbolicLink()) throw new Error('Unsafe journal directory');
      for (let index = 4; index >= 0; index--) {
        const file = journal.file(index);
        if (!fs.existsSync(file)) continue;
        journal.checkFile(file);
        if (fs.statSync(file).size > LIMIT) { journal.degraded = true; continue; }
        const contents = await fs.promises.readFile(file, 'utf8');
        // Ignore incomplete trailing records; terminate them before the next append.
        for (const line of contents.split('\n').slice(0, -1)) {
          if (line.length > 1024) continue;
          try {
            const value = JSON.parse(line);
            if (typeof value.id !== 'string' || !UUID.test(value.id) || typeof value.message !== 'string' || !SAFE.has(value.message) ||
              typeof value.at !== 'string' || !Number.isFinite(Date.parse(value.at)) || new Date(value.at).toISOString() !== value.at) continue;
            journal.remember({ id: value.id, at: value.at, message: value.message });
          } catch { /* A malformed record must not prevent recovery of the following records. */ }
        }
        if (index === 0 && contents && !contents.endsWith('\n') && Buffer.byteLength(contents) < LIMIT) await fs.promises.appendFile(file, '\n');
      }
      if (journal.entries.length) journal.since = journal.entries[journal.entries.length - 1].at;
    } catch { journal.degraded = true; }
    return journal;
  }
  private file(index = 0) { return path.join(this.directory, index ? `errors.${index}.jsonl` : 'errors.jsonl'); }
  private checkFile(file: string) {
    if (fs.existsSync(file) && (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink())) throw new Error('Unsafe journal file');
  }
  private remember(entry: RecentServerError) { this.entries.unshift(entry); this.entries.length = Math.min(this.entries.length, 100); }
  snapshot(): RecentServerErrors { return { since: this.since, entries: this.entries.map(entry => ({ ...entry })) }; }
  health(): 'ok' | 'degraded' { return this.degraded ? 'degraded' : 'ok'; }
  append(entry: RecentServerError): void {
    if (this.closed) return;
    if (!UUID.test(entry.id) || !Number.isFinite(Date.parse(entry.at))) { this.degraded = true; return; }
    const safe = { id: entry.id, at: new Date(entry.at).toISOString(), message: safeErrorMessage(entry.message) };
    this.remember(safe);
    if (this.queue.length >= 1000) { this.degraded = true; return; }
    this.queue.push(safe);
    if (!this.writing) this.writing = Promise.resolve().then(() => this.drain()).finally(() => { this.writing = null; });
  }
  private async drain() {
    while (this.queue.length) {
      const line = JSON.stringify(this.queue.shift()) + '\n';
      try {
        if (fs.lstatSync(this.directory).isSymbolicLink()) throw new Error('Unsafe journal directory');
        for (let index = 0; index <= 4; index++) this.checkFile(this.file(index));
        const size = fs.existsSync(this.file()) ? fs.statSync(this.file()).size : 0;
        if (size + Buffer.byteLength(line) > LIMIT) {
          if (fs.existsSync(this.file(4))) await fs.promises.unlink(this.file(4));
          for (let index = 3; index >= 0; index--) if (fs.existsSync(this.file(index))) await fs.promises.rename(this.file(index), this.file(index + 1));
        }
        await fs.promises.appendFile(this.file(), line, { mode: 0o600 });
      } catch {
        this.degraded = true;
        this.queue.length = 0;
        process.stderr.write(JSON.stringify({ level: 'warn', msg: 'error journal unavailable' }) + '\n');
      }
    }
  }
  async flush(): Promise<void> { await this.writing; }
  async close(): Promise<void> { this.closed = true; await this.flush(); }
}
