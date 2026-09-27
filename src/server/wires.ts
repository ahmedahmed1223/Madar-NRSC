import crypto from 'crypto';
import dns from 'dns/promises';
import net from 'net';
import { XMLParser } from 'fast-xml-parser';
import type { NewsroomDatabase } from './db';
import type { WireItem } from '../types/index';
import { changeBus } from './sync';
import { logger } from './logger';
import { alertForWires } from './notifications';
import { isFlashWire } from '../shared/notifications';

export interface WireConfig {
  pollMinutes: number;
  retentionDays: number;
  allowPrivateHosts: boolean;
}

export interface FeedStatus {
  sourceId: string;
  sourceName: string;
  feedUrl: string;
  ok: boolean;
  message: string;
  added: number;
  itemCount: number;
  checkedAt: string;
}

export interface ParsedFeed {
  title: string;
  items: { guid: string; title: string; summary: string; link?: string; publishedAt?: string; categories: string[] }[];
}

const FETCH_TIMEOUT_MS = 15_000;
const MAX_FEED_BYTES = 3 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const MAX_ITEMS_PER_FEED = 100;

/** Last poll result per source (kept in memory; refreshed on every poll). */
const feedStatus = new Map<string, FeedStatus>();
export const getFeedStatus = () => [...feedStatus.values()];

// ---------- text helpers ----------

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', laquo: '«', raquo: '»' };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? m;
  });
}

/** Feed text is untrusted HTML: keep plain text only. */
export function toPlainText(value: unknown, max: number): string {
  let s = textOf(value);
  s = s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/p>/gi, '\n').replace(/<[^>]*>/g, ' ');
  s = decodeEntities(decodeEntities(s)).replace(/<[^>]*>/g, ' ');
  s = s.replace(/[ \t\r\f\v]+/g, ' ').replace(/\s*\n\s*/g, '\n').replace(/\n{2,}/g, '\n').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function textOf(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return textOf(value[0]);
  if (typeof value === 'object') return textOf((value as any)['#text'] ?? '');
  return '';
}

const asArray = <T>(v: T | T[] | undefined): T[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);

function safeHttpUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const u = new URL(value.trim());
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

function isoDate(value: unknown): string | undefined {
  const t = Date.parse(textOf(value));
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
}

// ---------- parsing ----------

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  processEntities: true,
  htmlEntities: true,
  trimValues: true,
  parseTagValue: false,
  removeNSPrefix: true,
});

/** Parses RSS 2.0, RSS 1.0 (RDF) and Atom feeds. */
export function parseFeed(xml: string): ParsedFeed {
  let doc: any;
  try {
    doc = parser.parse(xml);
  } catch {
    throw new Error('محتوى الخلاصة ليس XML صالحاً');
  }
  if (doc?.rss?.channel || doc?.RDF) {
    const channel = doc.rss?.channel ?? doc.RDF?.channel ?? {};
    const rawItems = asArray(doc.rss?.channel?.item ?? doc.RDF?.item);
    return {
      title: toPlainText(channel.title, 200),
      items: rawItems.map((it: any) => {
        const link = safeHttpUrl(textOf(it.link));
        return {
          guid: textOf(it.guid) || link || textOf(it.title),
          title: toPlainText(it.title, 300),
          summary: toPlainText(it.description ?? it.encoded ?? '', 2000),
          link,
          publishedAt: isoDate(it.pubDate ?? it.date),
          categories: asArray(it.category).map((c) => toPlainText(c, 60)).filter(Boolean).slice(0, 8),
        };
      }),
    };
  }
  if (doc?.feed) {
    const feed = doc.feed;
    return {
      title: toPlainText(feed.title, 200),
      items: asArray(feed.entry).map((e: any) => {
        const links = asArray(e.link);
        const alt = links.find((l: any) => !l?.['@_rel'] || l['@_rel'] === 'alternate') ?? links[0];
        const link = safeHttpUrl(typeof alt === 'string' ? alt : alt?.['@_href']);
        return {
          guid: textOf(e.id) || link || textOf(e.title),
          title: toPlainText(e.title, 300),
          summary: toPlainText(e.summary ?? e.content ?? '', 2000),
          link,
          publishedAt: isoDate(e.published ?? e.updated),
          categories: asArray(e.category).map((c: any) => toPlainText(c?.['@_term'] ?? c, 60)).filter(Boolean).slice(0, 8),
        };
      }),
    };
  }
  throw new Error('صيغة الخلاصة غير مدعومة (المدعوم: RSS و Atom)');
}

// ---------- fetching (SSRF-safe) ----------

function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7));
  return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80');
}

async function assertPublicUrl(raw: string, allowPrivate: boolean): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('رابط الخلاصة غير صالح');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('يُسمح فقط بروابط http و https');
  if (url.username || url.password) throw new Error('لا يُسمح ببيانات الدخول داخل الرابط');
  if (!allowPrivate) {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((a) => a.address);
    if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
      throw new Error('الرابط يشير إلى عنوان داخلي غير مسموح (WIRE_ALLOW_PRIVATE_HOSTS)');
    }
  }
  return url;
}

export async function fetchFeed(rawUrl: string, allowPrivate: boolean): Promise<string> {
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await assertPublicUrl(current, allowPrivate);
    const res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': 'Madar-NRCS/1.0 (+wire desk)', Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5' },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location')!, url).toString();
      continue;
    }
    if (!res.ok) throw new Error(`استجاب مصدر الخلاصة بالرمز ${res.status}`);
    const declared = Number(res.headers.get('content-length') || 0);
    if (declared > MAX_FEED_BYTES) throw new Error('حجم الخلاصة يتجاوز الحد المسموح');
    const reader = res.body?.getReader();
    if (!reader) return '';
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_FEED_BYTES) {
        await reader.cancel();
        throw new Error('حجم الخلاصة يتجاوز الحد المسموح');
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  throw new Error('عدد كبير من إعادات التوجيه');
}

// ---------- ingest ----------

export const wireIdFor = (sourceId: string, guid: string) =>
  `wire-${crypto.createHash('sha256').update(`${sourceId}|${guid}`).digest('hex').slice(0, 24)}`;

/** Stores new items of a parsed feed; returns how many were added. */
export function ingestFeed(db: NewsroomDatabase, source: { id: string; name: string }, feed: ParsedFeed, cfg: WireConfig, now = Date.now()): number {
  const oldest = now - cfg.retentionDays * 24 * 60 * 60 * 1000;
  const added: WireItem[] = [];
  db.transaction(() => {
    for (const item of feed.items.slice(0, MAX_ITEMS_PER_FEED)) {
      if (!item.title || !item.guid) continue;
      const publishedMs = item.publishedAt ? Math.min(Date.parse(item.publishedAt), now) : now;
      if (publishedMs < oldest) continue;
      const id = wireIdFor(source.id, item.guid);
      if (db.getRow('wires', id, true)) continue;
      const wire: WireItem = {
        id,
        sourceId: source.id,
        sourceName: source.name,
        title: item.title,
        summary: item.summary,
        link: item.link,
        categories: item.categories,
        publishedAt: new Date(publishedMs).toISOString(),
        fetchedAt: new Date(now).toISOString(),
      };
      if (isFlashWire(wire)) wire.flash = true;
      // Newest first: lower position sorts earlier.
      db.writeRow('wires', id, wire, -Math.floor(publishedMs / 1000), null);
      added.push(wire);
    }
    // Urgent wires and watch words reach the colleagues who asked for them.
    alertForWires(db, added, now);
  });
  return added.length;
}

let polling: Promise<FeedStatus[]> | null = null;

/** Polls every enabled feed once (concurrent calls share the same run). */
export function pollWires(db: NewsroomDatabase, cfg: WireConfig): Promise<FeedStatus[]> {
  if (polling) return polling;
  polling = (async () => {
    const sources = db.listCollection('sources').map((r) => r.d).filter((s: any) => s?.feedEnabled && s?.feedUrl && !s.deletedAt);
    const results: FeedStatus[] = [];
    let total = 0;
    for (const source of sources) {
      const status: FeedStatus = { sourceId: source.id, sourceName: source.name, feedUrl: source.feedUrl, ok: false, message: '', added: 0, itemCount: 0, checkedAt: new Date().toISOString() };
      try {
        const feed = parseFeed(await fetchFeed(source.feedUrl, cfg.allowPrivateHosts));
        status.itemCount = feed.items.length;
        status.added = ingestFeed(db, source, feed, cfg);
        status.ok = true;
        status.message = status.added ? `أضيفت ${status.added} برقية جديدة` : 'لا جديد';
        total += status.added;
      } catch (err: any) {
        status.message = err?.name === 'TimeoutError' ? 'انتهت مهلة الاتصال بمصدر الخلاصة' : String(err?.message || err);
        logger.warn('wire feed failed', { source: source.name, error: status.message });
      }
      feedStatus.set(source.id, status);
      results.push(status);
    }
    // Forget sources that were removed or disabled.
    for (const id of [...feedStatus.keys()]) if (!sources.some((s: any) => s.id === id)) feedStatus.delete(id);
    if (total) changeBus.emit('rev', db.currentRev());
    return results;
  })().finally(() => {
    polling = null;
  });
  return polling;
}
