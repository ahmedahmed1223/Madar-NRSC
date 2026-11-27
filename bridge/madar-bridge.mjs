#!/usr/bin/env node
/**
 * «جسر مدار» — Madar bridge for the station's shared folder (SMB / Windows share / NAS).
 *
 * Runs on any computer inside the station's network that can open the shared folder
 * (Windows: \\fileserver\news works directly; Linux/macOS: mount the share first, e.g.
 * `mount -t cifs //fileserver/news /mnt/news -o username=...`). It needs Node.js 20+ and nothing else.
 *
 * What it does, all initiated from inside the network (no inbound ports are opened):
 *   - copies library files that local colleagues chose to keep in the shared folder;
 *   - sends a file from the shared folder to «مدار» when someone opens it over the internet;
 *   - reports the folder's file list (names, sizes, dates) so the library can search it.
 *
 * Settings (environment variables or --name=value arguments):
 *   MADAR_URL            address of «مدار», e.g. https://madar.example.com
 *   MADAR_BRIDGE_TOKEN   the token issued in «الإعدادات ← التخزين» (shown once)
 *   SHARE_PATH           the shared folder as this computer sees it
 *   INDEX_MINUTES        how often the folder is re-listed (default 30; 0 = never)
 *   POLL_SECONDS         how often to ask for work (default 5)
 *   INDEX_MAX_FILES      upper bound for the listing (default 200000)
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';

const VERSION = '1.1.0';
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
  const [k, ...v] = a.slice(2).split('=');
  return [k.toUpperCase().replace(/-/g, '_'), v.join('=')];
}));
const opt = (name, fallback) => args[name] ?? process.env[name] ?? fallback;

const RAW_URL = String(opt('MADAR_URL', ''));
const TOKEN = String(opt('MADAR_BRIDGE_TOKEN', ''));
const SHARE_PATH = String(opt('SHARE_PATH', ''));
const ONCE = 'ONCE' in args;
const shutdown = new AbortController();
const timings = { api: 20_000, transfer: 30 * 60_000 };
const timers = [];

function log(...parts) {
  console.log(new Date().toISOString(), ...parts);
}

function configError(message) {
  console.error(message);
  process.exit(2);
}

function numberSetting(name, fallback, min, max) {
  const n = Number(opt(name, fallback));
  if (!Number.isInteger(n) || n < min || n > max) configError(`${name} must be an integer between ${min} and ${max}.`);
  return n;
}

if (!RAW_URL || !TOKEN || !SHARE_PATH) configError('MADAR_URL, MADAR_BRIDGE_TOKEN and SHARE_PATH are required.');
let url;
try { url = new URL(RAW_URL); }
catch { configError('MADAR_URL must be an HTTPS URL.'); }
const loopback = ['127.0.0.1', '[::1]'].includes(url.hostname);
if ((url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash) {
  configError('MADAR_URL must use HTTPS (HTTP is supported only for loopback testing).');
}
const BASE = url.href.replace(/\/+$/, '');
const INDEX_MINUTES = numberSetting('INDEX_MINUTES', 30, 0, 35_000);
const POLL_SECONDS = numberSetting('POLL_SECONDS', 5, 2, 300);
const INDEX_MAX_FILES = numberSetting('INDEX_MAX_FILES', 200000, 1, 10_000_000);

let SHARE;
try {
  // Match fs.promises.realpath when Windows resolves a short-name or UNC path.
  SHARE = fs.realpathSync.native(path.resolve(SHARE_PATH));
  if (!fs.statSync(SHARE).isDirectory()) throw new Error();
} catch {
  configError(`The shared folder is not reachable: ${SHARE_PATH}`);
}

const headers = (extra = {}) => ({ authorization: `Bearer ${TOKEN}`, 'x-nrcs-client': 'web', ...extra });

function fetchBridge(target, options, timeout = timings.api) {
  const signal = AbortSignal.any([shutdown.signal, AbortSignal.timeout(timeout)]);
  return fetch(target, { ...options, signal, redirect: 'error' });
}

async function api(method, route, body) {
  const res = await fetchBridge(BASE + route, {
    method,
    headers: headers(body ? { 'content-type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return json.data;
}

function relativeParts(rel) {
  if (rel === '') return [];
  if (typeof rel !== 'string') throw new Error('invalid share path');
  const parts = rel.split(/[\\/]/);
  if (parts.some(part => !part || /[:\0]/.test(part) || /[. ]$/.test(part))) throw new Error('invalid share path');
  return parts;
}

async function checkedPath(full, expected) {
  const state = await fs.promises.lstat(full);
  if (expected === 'file' ? !state.isFile() : !state.isDirectory()) throw new Error('invalid path type in shared folder');
  const actual = await fs.promises.realpath(full);
  const relative = path.relative(SHARE, actual);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('path outside the shared folder');
  return actual;
}

async function shareDirectory(parts, create = false) {
  let current = await checkedPath(SHARE, 'directory');
  for (const part of parts) {
    const next = path.join(current, part);
    if (create) {
      try { await fs.promises.mkdir(next); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    current = await checkedPath(next, 'directory');
  }
  return current;
}

async function publishCopy(tmp, dir, name) {
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  for (let i = 1; ; i++) {
    shutdown.signal.throwIfAborted();
    dir = await checkedPath(dir, 'directory');
    const candidate = path.join(dir, i === 1 ? name : `${base} (${i})${ext}`);
    try {
      try { await fs.promises.link(tmp, candidate); }
      catch (error) {
        if (!['EPERM', 'ENOTSUP', 'ENOSYS', 'EOPNOTSUPP', 'EXDEV'].includes(error.code)) throw error;
        await fs.promises.copyFile(tmp, candidate, fs.constants.COPYFILE_EXCL);
      }
      return candidate;
    } catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
}

async function copyToShare(job) {
  let tmp;
  try {
    const dir = await shareDirectory(relativeParts(job.folder), true);
    const name = path.win32.basename(job.name);
    if (relativeParts(name).length !== 1) throw new Error('invalid filename in shared folder');
    const res = await fetchBridge(`${BASE}/api/v1/bridge/files/${encodeURIComponent(job.uploadId)}`, { headers: headers() }, timings.transfer);
    if (!res.ok || !res.body) throw new Error(`download failed (HTTP ${res.status})`);
    tmp = path.join(await checkedPath(dir, 'directory'), `.${randomUUID()}.madar-part`);
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp, { flags: 'wx' }));
    const dest = await publishCopy(await checkedPath(tmp, 'file'), dir, name);
    const rel = path.relative(SHARE, dest).split(path.sep).join('/');
    await api('POST', `/api/v1/bridge/copies/${encodeURIComponent(job.uploadId)}`, { ok: true, path: rel });
    log('saved', rel);
  } catch (err) {
    if (shutdown.signal.aborted) return;
    log('copy failed', job.name, String(err.message || err));
    await api('POST', `/api/v1/bridge/copies/${encodeURIComponent(job.uploadId)}`, { ok: false, error: String(err.message || err).slice(0, 200) }).catch(() => undefined);
  } finally {
    if (tmp) {
      const stillInside = await checkedPath(tmp, 'file').catch(() => undefined);
      if (stillInside) await fs.promises.unlink(stillInside).catch(() => undefined);
    }
  }
}

async function sendFromShare(job) {
  const url = `${BASE}/api/v1/bridge/fetches/${encodeURIComponent(job.uploadId)}`;
  try {
    const parts = relativeParts(job.path);
    const name = parts.pop();
    if (!name) throw new Error('invalid filename in shared folder');
    const full = await checkedPath(path.join(await shareDirectory(parts), name), 'file');
    const file = await fs.promises.open(full, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    try {
      const stat = await file.stat();
      if (!stat.isFile()) throw new Error('invalid file in shared folder');
      const res = await fetchBridge(url, {
        method: 'PUT',
        headers: headers({ 'content-type': 'application/octet-stream', 'content-length': String(stat.size) }),
        body: Readable.toWeb(file.createReadStream({ autoClose: false })),
        duplex: 'half',
      }, timings.transfer);
      await res.body?.cancel();
      if (!res.ok) throw new Error(`upload failed (HTTP ${res.status})`);
    } finally { await file.close(); }
    log('sent', job.path);
  } catch (err) {
    if (shutdown.signal.aborted) return;
    log('fetch failed', job.path, String(err.message || err));
    await fetchBridge(url, { method: 'PUT', headers: headers({ 'x-fetch-error': encodeURIComponent(String(err.code === 'ENOENT' ? 'الملف لم يعد موجوداً في المجلد المشترك' : err.message || err).slice(0, 200)) }) })
      .then(res => res.body?.cancel()).catch(() => undefined);
  }
}

async function* walk(dir) {
  let entries;
  try {
    entries = await fs.promises.readdir(await checkedPath(dir, 'directory'), { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    shutdown.signal.throwIfAborted();
    if (e.name.startsWith('.') || e.name.startsWith('~$') || e.name.endsWith('.madar-part') || /^(\$RECYCLE\.BIN|System Volume Information|Thumbs\.db|desktop\.ini)$/i.test(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.isFile()) yield full;
  }
}

let indexing = false;
async function indexShare() {
  if (indexing) return;
  indexing = true;
  const scanStartedAt = new Date().toISOString();
  let batch = [];
  let count = 0;
  try {
    for await (const full of walk(SHARE)) {
      if (count >= INDEX_MAX_FILES) break;
      const stat = await checkedPath(full, 'file').then(file => fs.promises.stat(file)).catch(() => null);
      if (!stat) continue;
      batch.push({ path: path.relative(SHARE, full).split(path.sep).join('/'), name: path.basename(full), size: stat.size, modifiedAt: stat.mtime.toISOString() });
      count++;
      if (batch.length >= 1000) {
        await api('POST', '/api/v1/bridge/index', { files: batch, scanStartedAt, finished: false });
        batch = [];
      }
    }
    await api('POST', '/api/v1/bridge/index', { files: batch, scanStartedAt, finished: true });
    log(`indexed ${count} files`);
  } catch (err) {
    if (!shutdown.signal.aborted) log('indexing failed', String(err.message || err));
  } finally {
    indexing = false;
  }
}

async function tick() {
  const jobs = await api('GET', '/api/v1/bridge/jobs');
  for (const job of jobs.copies || []) {
    shutdown.signal.throwIfAborted();
    await copyToShare(job);
  }
  for (const job of jobs.fetches || []) {
    shutdown.signal.throwIfAborted();
    await sendFromShare(job);
  }
  return (jobs.copies || []).length + (jobs.fetches || []).length;
}

async function main() {
  log(`«جسر مدار» ${VERSION} → ${BASE}, shared folder ${SHARE}`);
  await api('POST', '/api/v1/bridge/heartbeat', { version: VERSION });
  if (ONCE) {
    await tick();
    if (INDEX_MINUTES > 0) await indexShare();
    return;
  }
  timers.push(setInterval(() => api('POST', '/api/v1/bridge/heartbeat', { version: VERSION }).catch(err => {
    if (!shutdown.signal.aborted) log('heartbeat failed', err.message);
  }), 30_000));
  if (INDEX_MINUTES > 0) {
    void indexShare();
    timers.push(setInterval(indexShare, INDEX_MINUTES * 60_000));
  }
  let backoff = POLL_SECONDS;
  while (!shutdown.signal.aborted) {
    try {
      const n = await tick();
      backoff = POLL_SECONDS;
      if (n) continue;
    } catch (err) {
      if (shutdown.signal.aborted) break;
      if (err.status === 401) {
        console.error('The bridge token was refused: issue a new one in «الإعدادات ← التخزين».');
        process.exitCode = 3;
        break;
      }
      log('server unreachable:', String(err.message || err));
      backoff = Math.min(backoff * 2, 300);
    }
    await delay(backoff * 1000, undefined, { signal: shutdown.signal }).catch(error => {
      if (!shutdown.signal.aborted) throw error;
    });
  }
}

function stop() {
  shutdown.abort();
  for (const timer of timers) clearInterval(timer);
}

process.once('SIGTERM', stop);
process.once('SIGINT', stop);
main().catch(err => {
  if (shutdown.signal.aborted) return;
  console.error(err);
  process.exitCode = err.status === 401 ? 3 : 1;
}).finally(stop);
