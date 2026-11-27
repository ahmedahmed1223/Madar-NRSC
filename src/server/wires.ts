import crypto from 'crypto';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import { XMLParser } from 'fast-xml-parser';
import type { NewsroomDatabase } from './db';
import type { WireItem } from '../types/index';
import { changeBus } from './sync';
import { logger } from './logger';
import { alertForWires } from './notifications';
import { isFlashWire } from '../shared/notifications';
import { isPublicNetworkAddress, lookupPublicAddress } from './networkDestinations';

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

function checkedFeedUrl(raw: string, allowPrivate: boolean): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('رابط الخلاصة غير صالح');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('يُسمح فقط بروابط http و https');
  if (url.username || url.password) throw new Error('لا يُسمح ببيانات الدخول داخل الرابط');
  // Node bypasses lookup for literal addresses.
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!allowPrivate && isIP(host) && !isPublicNetworkAddress(host)) {
    throw new Error('الرابط يشير إلى عنوان داخلي أو غير عام');
  }
  return url;
}

function openFeed(url: URL, allowPrivate: boolean): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = request(url, {
      agent: false,
      lookup: allowPrivate ? undefined : lookupPublicAddress,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        'User-Agent': 'Madar-NRCS/1.0 (+wire desk)',
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
      },
    }, resolve);
    req.once('error', reject);
    req.end();
  });
}

const feedDecoders = new Map([
  ['gzip', createGunzip], ['deflate', createInflate], ['br', createBrotliDecompress],
]);

export async function fetchFeed(rawUrl: string, allowPrivate: boolean): Promise<string> {
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = checkedFeedUrl(current, allowPrivate);
    const res = await openFeed(url, allowPrivate);
    try {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        current = new URL(res.headers.location, url).toString();
        continue;
      }
      if (status < 200 || status >= 300) throw new Error(`استجاب مصدر الخلاصة بالرمز ${status}`);
      const declared = Number(res.headers['content-length'] ?? 0);
      if (declared > MAX_FEED_BYTES) throw new Error('حجم الخلاصة يتجاوز الحد المسموح');
      const encoding = res.headers['content-encoding']?.toLowerCase() || 'identity';
      const decoder = feedDecoders.get(encoding)?.();
      if (!decoder && encoding !== 'identity') throw new Error('ترميز ضغط الخلاصة غير مدعوم');
      if (decoder) res.once('error', error => decoder.destroy(error));
      const stream = decoder ? res.pipe(decoder) : res;
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of stream) {
        size += chunk.length;
        if (size > MAX_FEED_BYTES) throw new Error('حجم الخلاصة يتجاوز الحد المسموح');
        chunks.push(chunk);
      }
      return Buffer.concat(chunks).toString('utf8');
    } finally {
      res.destroy();
    }
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
  if (moduleRule(db.getRow('settings', 'singleton')?.d?.moduleAccess, 'news').mode === 'disabled') return Promise.resolve(getFeedStatus());
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
        status.message = status.added ? `أضيفت ${status.added} مادة جديدة` : 'لا جديد';
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
import { moduleRule } from '../shared/moduleAccess';
