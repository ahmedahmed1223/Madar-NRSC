import http from 'http';
import type { AddressInfo } from 'net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestServer, loginAgent } from '../helpers';
import { ingestFeed, parseFeed, pollWires, toPlainText } from '../../src/server/wires';

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>وكالة الاختبار</title>
<item><title>قمة &amp; اتفاق</title><link>https://example.org/a</link><guid>a-1</guid>
<description><![CDATA[<p>نص <b>الخبر</b></p><script>alert(1)</script><img src=x onerror=alert(2)>]]></description>
<pubDate>${new Date().toUTCString()}</pubDate><category>سياسة</category></item>
<item><title>رابط خطر</title><link>javascript:alert(1)</link><guid>a-2</guid></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Atom Agency</title>
<entry><id>urn:1</id><title type="html">Markets &lt;b&gt;rally&lt;/b&gt;</title>
<link rel="alternate" href="https://example.org/m"/><updated>${new Date().toISOString()}</updated><summary>Stocks up</summary></entry></feed>`;

let server: Awaited<ReturnType<typeof createTestServer>>;
let feedServer: http.Server;
let feedUrl = '';
const H = { 'X-NRCS-Client': 'web' };

beforeAll(async () => {
  server = await createTestServer();
  feedServer = http.createServer((req, res) => {
    if (req.url === '/redirect') {
      res.writeHead(302, { Location: '/rss' });
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': 'application/rss+xml' });
    res.end(RSS);
  });
  await new Promise<void>((r) => feedServer.listen(0, '127.0.0.1', r));
  feedUrl = `http://127.0.0.1:${(feedServer.address() as AddressInfo).port}/redirect`;
});
afterAll(() => {
  feedServer.close();
  server.close();
});

describe('feed parsing', () => {
  it('reads RSS as plain text and drops unsafe links', () => {
    const feed = parseFeed(RSS);
    expect(feed.title).toBe('وكالة الاختبار');
    expect(feed.items[0].title).toBe('قمة & اتفاق');
    expect(feed.items[0].summary).toBe('نص الخبر');
    expect(feed.items[0].categories).toEqual(['سياسة']);
    expect(feed.items[1].link).toBeUndefined();
  });

  it('reads Atom feeds', () => {
    const feed = parseFeed(ATOM);
    expect(feed.items[0]).toMatchObject({ guid: 'urn:1', title: 'Markets rally', link: 'https://example.org/m', summary: 'Stocks up' });
  });

  it('rejects documents that are not feeds', () => {
    expect(() => parseFeed('<html><body>hi</body></html>')).toThrow();
    expect(toPlainText('<a href="x">a</a> &lt;script&gt;', 50)).toBe('a');
  });
});

describe('wire ingestion', () => {
  it('stores each item once', () => {
    const cfg = { pollMinutes: 5, retentionDays: 3, allowPrivateHosts: false };
    const feed = parseFeed(RSS);
    const src = { id: 'src-t', name: 'اختبار' };
    expect(ingestFeed(server.db, src, feed, cfg)).toBe(2);
    expect(ingestFeed(server.db, src, feed, cfg)).toBe(0);
  });

  it('skips items older than the retention window', () => {
    const old = RSS.replace(/<pubDate>.*?<\/pubDate>/, '<pubDate>Mon, 01 Jan 2001 00:00:00 GMT</pubDate>').replace(/a-1/, 'old-1');
    const n = ingestFeed(server.db, { id: 'src-old', name: 'x' }, parseFeed(old), { pollMinutes: 5, retentionDays: 3, allowPrivateHosts: false });
    expect(n).toBe(1); // only the undated item (treated as fetched now)
  });

  it('polls enabled sources end to end (following redirects)', async () => {
    const src = server.db.listCollection('sources')[0];
    server.db.writeRow('sources', src.id, { ...src.d, feedUrl, feedEnabled: true }, src.p, null);
    const [status] = await pollWires(server.db, { pollMinutes: 5, retentionDays: 3, allowPrivateHosts: true });
    expect(status.ok).toBe(true);
    expect(status.added).toBe(2);
    const wires = server.db.listCollection('wires').filter((w) => w.d.sourceId === src.id);
    expect(wires.map((w) => w.d.title)).toContain('قمة & اتفاق');
  });

  it('blocks internal addresses unless explicitly allowed', async () => {
    const [status] = await pollWires(server.db, { pollMinutes: 5, retentionDays: 3, allowPrivateHosts: false });
    expect(status.ok).toBe(false);
    expect(status.message).toContain('عنوان داخلي');

    const admin = await loginAgent(server.app, 'admin@akhbar.tv');
    const res = await admin.post('/api/v1/wires/test').set(H).send({ url: 'http://169.254.169.254/latest/meta-data' });
    expect(res.status).toBe(422);
  });

  it('wires are read-only for clients', async () => {
    const editor = await loginAgent(server.app, 'editor@akhbar.tv');
    const res = await editor.post('/api/v1/data/sync').set(H).send({ ops: [{ c: 'wires', op: 'upsert', id: 'wire-x', d: { id: 'wire-x', title: 'fake' } }] });
    expect(res.body.results[0].code).toBe('FORBIDDEN');
    const data = await editor.get('/api/v1/data');
    expect(data.body.collections.wires.length).toBeGreaterThan(0);
  });
});
