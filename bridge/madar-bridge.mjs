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
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const VERSION = '1.0.0';
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
  const [k, ...v] = a.slice(2).split('=');
  return [k.toUpperCase().replace(/-/g, '_'), v.join('=')];
}));
const opt = (name, fallback) => args[name] ?? process.env[name] ?? fallback;

const BASE = String(opt('MADAR_URL', '')).replace(/\/+$/, '');
const TOKEN = String(opt('MADAR_BRIDGE_TOKEN', ''));
const SHARE = path.resolve(String(opt('SHARE_PATH', '')));
const INDEX_MINUTES = Number(opt('INDEX_MINUTES', 30));
const POLL_SECONDS = Math.max(2, Number(opt('POLL_SECONDS', 5)));
const INDEX_MAX_FILES = Number(opt('INDEX_MAX_FILES', 200000));
const ONCE = 'ONCE' in args;

function log(...parts) {
  console.log(new Date().toISOString(), ...parts);
}

if (!BASE || !TOKEN || !opt('SHARE_PATH', '')) {
  console.error('MADAR_URL, MADAR_BRIDGE_TOKEN and SHARE_PATH are required (see the header of this file).');
  process.exit(2);
}
if (!fs.existsSync(SHARE) || !fs.statSync(SHARE).isDirectory()) {
  console.error(`The shared folder is not reachable: ${SHARE}`);
  process.exit(2);
}

const headers = (extra = {}) => ({ authorization: `Bearer ${TOKEN}`, 'x-nrcs-client': 'web', ...extra });

async function api(method, route, body) {
  const res = await fetch(BASE + route, {
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

/** A path inside the share, never outside it. */
function inside(rel) {
  const full = path.resolve(SHARE, ...String(rel).split(/[\\/]+/).filter((p) => p && p !== '.' && p !== '..'));
  if (full !== SHARE && !full.startsWith(SHARE + path.sep)) throw new Error('path outside the shared folder');
  return full;
}

function uniquePath(dir, name) {
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  let candidate = path.join(dir, name);
  for (let i = 2; fs.existsSync(candidate); i++) candidate = path.join(dir, `${base} (${i})${ext}`);
  return candidate;
}

async function copyToShare(job) {
  const dir = inside(job.folder);
  await fs.promises.mkdir(dir, { recursive: true });
  const dest = uniquePath(dir, path.basename(job.name));
  const tmp = `${dest}.madar-part`;
  try {
    const res = await fetch(`${BASE}/api/v1/bridge/files/${encodeURIComponent(job.uploadId)}`, { headers: headers() });
    if (!res.ok || !res.body) throw new Error(`download failed (HTTP ${res.status})`);
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp, { flags: 'wx' }));
    await fs.promises.rename(tmp, dest);
    const rel = path.relative(SHARE, dest).split(path.sep).join('/');
    await api('POST', `/api/v1/bridge/copies/${encodeURIComponent(job.uploadId)}`, { ok: true, path: rel });
    log('saved', rel);
  } catch (err) {
    await fs.promises.rm(tmp, { force: true }).catch(() => undefined);
    log('copy failed', job.name, String(err.message || err));
    await api('POST', `/api/v1/bridge/copies/${encodeURIComponent(job.uploadId)}`, { ok: false, error: String(err.message || err).slice(0, 200) }).catch(() => undefined);
  }
}

async function sendFromShare(job) {
  const url = `${BASE}/api/v1/bridge/fetches/${encodeURIComponent(job.uploadId)}`;
  try {
    const full = inside(job.path);
    const stat = await fs.promises.stat(full);
    const res = await fetch(url, {
      method: 'PUT',
      headers: headers({ 'content-type': 'application/octet-stream', 'content-length': String(stat.size) }),
      body: Readable.toWeb(fs.createReadStream(full)),
      duplex: 'half',
    });
    if (!res.ok) throw new Error(`upload failed (HTTP ${res.status})`);
    log('sent', job.path);
  } catch (err) {
    log('fetch failed', job.path, String(err.message || err));
    await fetch(url, { method: 'PUT', headers: headers({ 'x-fetch-error': encodeURIComponent(String(err.code === 'ENOENT' ? 'الملف لم يعد موجوداً في المجلد المشترك' : err.message || err).slice(0, 200)) }) }).catch(() => undefined);
  }
}

async function* walk(dir) {
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
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
      const stat = await fs.promises.stat(full).catch(() => null);
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
    log('indexing failed', String(err.message || err));
  } finally {
    indexing = false;
  }
}

async function tick() {
  const jobs = await api('GET', '/api/v1/bridge/jobs');
  for (const job of jobs.copies || []) await copyToShare(job);
  for (const job of jobs.fetches || []) await sendFromShare(job);
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
  setInterval(() => api('POST', '/api/v1/bridge/heartbeat', { version: VERSION }).catch((err) => log('heartbeat failed', err.message)), 30_000);
  if (INDEX_MINUTES > 0) {
    void indexShare();
    setInterval(indexShare, INDEX_MINUTES * 60_000);
  }
  let backoff = POLL_SECONDS;
  for (;;) {
    try {
      const n = await tick();
      backoff = POLL_SECONDS;
      if (n) continue;
    } catch (err) {
      if (err.status === 401) {
        console.error('The bridge token was refused: issue a new one in «الإعدادات ← التخزين».');
        process.exit(3);
      }
      log('server unreachable:', String(err.message || err));
      backoff = Math.min(backoff * 2, 300);
    }
    await new Promise((r) => setTimeout(r, backoff * 1000));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
