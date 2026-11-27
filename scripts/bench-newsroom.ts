import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { performance } from 'node:perf_hooks';
import { loadConfig } from '../src/server/config';
import { NewsroomDatabase } from '../src/server/db';
import { seedDatabase } from '../src/server/seed';
import { createApp } from '../src/server/app';
import { setLogLevel } from '../src/server/logger';

const DEMO_PASSWORD = 'Madar@Bench2026';
const CSRF_HEADERS = { 'X-NRCS-Client': 'web', 'Content-Type': 'application/json' };

interface BenchResult {
  name: string;
  iterations: number;
  p50Ms: number;
  p95Ms: number;
  avgMs: number;
  avgPayloadKb: number;
  notes: string;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function summarize(name: string, samples: number[], payloadBytes: number[], notes: string): BenchResult {
  const sorted = [...samples].sort((a, b) => a - b);
  const avgMs = samples.reduce((a, b) => a + b, 0) / Math.max(1, samples.length);
  const avgBytes = payloadBytes.reduce((a, b) => a + b, 0) / Math.max(1, payloadBytes.length);
  return {
    name,
    iterations: samples.length,
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    avgMs,
    avgPayloadKb: avgBytes / 1024,
    notes,
  };
}

async function benchLoop(
  name: string,
  warmup: number,
  iterations: number,
  fn: (i: number) => Promise<{ bytes: number }>,
  notes: string,
): Promise<BenchResult> {
  for (let i = 0; i < warmup; i++) {
    await fn(-1 - i);
  }
  const samples: number[] = [];
  const bytes: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    const res = await fn(i);
    samples.push(performance.now() - start);
    bytes.push(res.bytes);
  }
  return summarize(name, samples, bytes, notes);
}

async function main() {
  setLogLevel('error');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'madar-bench-'));
  const config = loadConfig({
    NODE_ENV: 'test',
    DATA_DIR: dir,
    DATABASE_ENGINE: 'sqlite',
    SEED_DEMO_DATA: 'true',
    DEMO_USER_PASSWORD: DEMO_PASSWORD,
    LOGIN_RATE_LIMIT_PER_15MIN: '1000',
    RATE_LIMIT_PER_MINUTE: '100000',
    BACKUP_INTERVAL_HOURS: '0',
    NEWS_ACTIVE_DAYS: '90',
  });

  const db = new NewsroomDatabase(config.dataDir);
  await seedDatabase(db, config);

  const seedStart = performance.now();
  const stations = [
    { id: 'st-bench-main', name: 'المحطة الرئيسية — الرياض', isMain: true, linkedIds: [] as string[] },
    { id: 'st-bench-jeddah', name: 'محطة جدة', isMain: false, linkedIds: ['st-bench-main'] },
    { id: 'st-bench-cairo', name: 'محطة القاهرة', isMain: false, linkedIds: ['st-bench-main'] },
  ];

  const categories = [
    { id: 'cat-bench-pol', nameAr: 'الشؤون السياسية', slug: 'bench-pol', color: '#1d4ed8' },
    { id: 'cat-bench-eco', nameAr: 'الاقتصاد والأسواق', slug: 'bench-eco', color: '#047857' },
    { id: 'cat-bench-tech', nameAr: 'التقنية والابتكار', slug: 'bench-tech', color: '#6d28d9' },
    { id: 'cat-bench-sport', nameAr: 'الرياضة الدولية', slug: 'bench-sport', color: '#b45309' },
    { id: 'cat-bench-cult', nameAr: 'الثقافة والمجتمع', slug: 'bench-cult', color: '#be123c' },
  ];

  const arabicTopics = [
    ['قمة المناخ الدولية', 'اتفقت الوفود المشاركة في مؤتمر الطاقة المتجددة على خفض الانبعاثات الكربونية ودعم التحول الأخضر.'],
    ['أسواق النفط العالمية', 'سجلت أسعار الخام ارتفاعاً طفيفاً مع ترقب قرارات البنوك المركزية بشأن أسعار الفائدة والتضخم.'],
    ['الذكاء الاصطناعي في الإعلام', 'أطلقت غرف الأخبار أدوات تحليل فورية لدعم الصحفيين في تدقيق المعلومات وصياغة التقارير الميدانية.'],
    ['البنية التحتية والنقل', 'افتتح مشروع القطار الكهربائي السريع لربط المحافظات وتسهيل حركة الركاب والبضائع خلال الموسم.'],
    ['السياحة والتراث العربي', 'شهدت المهرجانات الثقافية إقبالاً واسعاً من الزوار مع عروض فنية ومعارض توثق التاريخ المحلي.'],
  ];

  const now = Date.now();
  const baseBookingDay = new Date(now + 2 * 86_400_000);
  baseBookingDay.setUTCHours(8, 0, 0, 0);
  const updateTsStmt = (db as unknown as { db: { prepare: (sql: string) => { run: (ts: string, id: string) => void } } }).db.prepare(
    `UPDATE entities SET updated_at = ? WHERE collection = 'news' AND id = ?`,
  );

  db.transaction(() => {
    // 1. Stations in settings
    const settingsRow = db.getRow('settings', 'singleton');
    const settingsData = { ...(settingsRow?.d ?? {}), stations };
    db.writeRow('settings', 'singleton', settingsData, settingsRow?.p ?? 0, null);

    // 2. Reference categories
    for (let i = 0; i < categories.length; i++) {
      db.writeRow('categories', categories[i].id, categories[i], 100 + i, null);
    }

    // 3. 20 users across 3 stations
    for (let i = 0; i < 20; i++) {
      const id = `usr-bench-${i}`;
      const st = stations[i % stations.length];
      db.writeRow('users', id, {
        id,
        fullName: `محرر تجريبي ${i + 1}`,
        email: `bench.user.${i}@akhbar.tv`,
        role: i % 4 === 0 ? 'EDITOR' : 'JOURNALIST',
        department: i % 2 === 0 ? 'الأخبار' : 'البرامج',
        stationId: st.id,
        isActive: true,
      }, 200 + i, null);
    }

    // 4. 2,000 archived news (180..540 days ago)
    for (let i = 0; i < 2000; i++) {
      const id = `nws-bench-arch-${i}`;
      const cat = categories[i % categories.length];
      const topic = arabicTopics[i % arabicTopics.length];
      const st = stations[i % stations.length];
      const daysAgo = 180 + (i % 360);
      const ts = new Date(now - daysAgo * 86_400_000).toISOString();
      db.writeRow('news', id, {
        id,
        title: `${topic[0]} — تقرير رقم ${i + 1}`,
        summary: `${topic[1]} متابعة ميدانية من ${st.name}.`,
        content: `<p>${topic[1]}</p><p>تفاصيل التغطية الصحفية الشاملة للحدث رقم ${i + 1} ضمن قسم ${cat.nameAr}.</p>`,
        status: 'PUBLISHED',
        categoryId: cat.id,
        categoryName: cat.nameAr,
        authorId: `usr-bench-${i % 20}`,
        authorName: `محرر تجريبي ${(i % 20) + 1}`,
        stationId: st.id,
        publishDate: ts,
        createdAt: ts,
        updatedAt: ts,
        tags: ['أرشيف', cat.slug],
      }, 1000 + i, null);
      updateTsStmt.run(ts, id);
    }

    // 5. 500 tasks across users/stations
    for (let i = 0; i < 500; i++) {
      const id = `tsk-bench-${i}`;
      const st = stations[i % stations.length];
      const due = new Date(now + ((i % 30) - 5) * 86_400_000).toISOString();
      db.writeRow('tasks', id, {
        id,
        title: `مهمة تحريرية ${i + 1}`,
        description: `متابعة التقرير وتجهيز المواد المرئية للمحطة ${st.name}`,
        status: i % 3 === 0 ? 'IN_PROGRESS' : i % 3 === 1 ? 'TODO' : 'COMPLETED',
        priority: i % 4 === 0 ? 'HIGH' : 'MEDIUM',
        assigneeId: `usr-bench-${i % 20}`,
        stationId: st.id,
        dueDate: due,
        createdAt: new Date(now - (i % 14) * 86_400_000).toISOString(),
      }, 500 + i, null);
    }

    // 6. 8 resources + 200 bookings (25 per resource, non-overlapping)
    const resources = Array.from({ length: 8 }, (_, idx) => ({
      id: `res-bench-${idx}`,
      name: `استوديو الأخبار ${idx + 1}`,
      type: idx % 2 === 0 ? 'STUDIO' : 'EDIT_SUITE',
      stationId: stations[idx % stations.length].id,
      isActive: true,
    }));
    for (let i = 0; i < resources.length; i++) {
      db.writeRow('resources', resources[i].id, resources[i], 100 + i, null);
    }

    for (let i = 0; i < 200; i++) {
      const resourceIndex = i % resources.length;
      const slotIndex = Math.floor(i / resources.length);
      const startMs = baseBookingDay.getTime() + slotIndex * 2 * 3_600_000;
      const endMs = startMs + 3_600_000;
      db.writeRow('bookings', `bkg-bench-${i}`, {
        id: `bkg-bench-${i}`,
        resourceId: resources[resourceIndex].id,
        title: `حجز بث ${i + 1}`,
        start: new Date(startMs).toISOString(),
        end: new Date(endMs).toISOString(),
        status: 'CONFIRMED',
        bookedById: `usr-bench-${i % 20}`,
        createdAt: new Date(now).toISOString(),
      }, 200 + i, null);
    }
  });

  const seedMs = performance.now() - seedStart;

  const { app } = createApp(db, config);
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  try {
    const { port } = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${port}`;

    // Login as admin
    const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: CSRF_HEADERS,
      body: JSON.stringify({ email: 'admin@akhbar.tv', password: DEMO_PASSWORD }),
    });
    if (!loginRes.ok) {
      throw new Error(`Admin login failed: ${loginRes.status} ${await loginRes.text()}`);
    }
    const rawCookie = loginRes.headers.get('set-cookie') || '';
    const cookie = rawCookie.split(';')[0];
    if (!cookie) throw new Error('Missing session cookie from login');

    const authHeaders = { ...CSRF_HEADERS, Cookie: cookie };

    const results: BenchResult[] = [];

    // Benchmark 1: Session bootstrap (GET /api/v1/data)
    results.push(await benchLoop(
      'Session bootstrap (GET /api/v1/data)',
      3,
      20,
      async () => {
        const res = await fetch(`${baseUrl}/api/v1/data`, { headers: { Cookie: cookie } });
        const buf = await res.arrayBuffer();
        if (!res.ok) throw new Error(`GET /api/v1/data failed: ${res.status}`);
        return { bytes: buf.byteLength };
      },
      '500 tasks, 200 bookings, 20 users, 3 stations (2,000 news in archive)',
    ));

    // Benchmark 2: Sync write batch (POST /api/v1/data/sync — 10 ops)
    results.push(await benchLoop(
      'Sync write batch (10 ops)',
      2,
      20,
      async (i) => {
        const tag = i < 0 ? `w${-i}` : `m${i}`;
        const ops = Array.from({ length: 10 }, (_, k) => ({
          c: k < 5 ? 'news' : 'tasks',
          op: 'upsert',
          id: k < 5 ? `nws-bench-sync-${tag}-${k}` : `tsk-bench-sync-${tag}-${k}`,
          d: k < 5
            ? {
                title: `خبر متزامن ${tag}-${k}`,
                summary: 'ملخص قياس الأداء',
                content: '<p>نص تجريبي</p>',
                status: 'DRAFT',
                categoryId: 'cat-bench-pol',
                categoryName: 'الشؤون السياسية',
                authorId: 'usr-1',
                stationId: 'st-bench-main',
              }
            : {
                title: `مهمة متزامنة ${tag}-${k}`,
                status: 'TODO',
                priority: 'MEDIUM',
                assigneeId: 'usr-bench-1',
                stationId: 'st-bench-main',
              },
        }));
        const res = await fetch(`${baseUrl}/api/v1/data/sync`, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ ops }),
        });
        const text = await res.text();
        if (!res.ok) throw new Error(`Sync batch failed: ${res.status} ${text}`);
        const parsed = JSON.parse(text);
        if (!parsed.results?.every((r: { ok: boolean }) => r.ok)) {
          throw new Error(`Sync batch had failed ops: ${text}`);
        }
        return { bytes: Buffer.byteLength(text) };
      },
      '5 news + 5 task upserts per atomic sync request',
    ));

    // Benchmark 3: Booking conflict check on indexed resource
    const conflictStart = new Date(baseBookingDay.getTime() + 10 * 2 * 3_600_000 + 15 * 60_000).toISOString();
    const conflictEnd = new Date(baseBookingDay.getTime() + 10 * 2 * 3_600_000 + 45 * 60_000).toISOString();
    results.push(await benchLoop(
      'Booking conflict check (indexed resource)',
      3,
      30,
      async (i) => {
        const res = await fetch(`${baseUrl}/api/v1/data/sync`, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            ops: [{
              c: 'bookings',
              op: 'upsert',
              id: `bkg-bench-clash-${i}`,
              d: {
                resourceId: 'res-bench-0',
                title: 'حجز متعارض للقياس',
                start: conflictStart,
                end: conflictEnd,
                status: 'CONFIRMED',
                bookedById: 'usr-1',
              },
            }],
          }),
        });
        const text = await res.text();
        if (!res.ok) throw new Error(`Booking conflict request failed: ${res.status} ${text}`);
        const parsed = JSON.parse(text);
        if (parsed.results?.[0]?.code !== 'INVALID' || !String(parsed.results?.[0]?.message || '').includes('محجوز')) {
          throw new Error(`Expected booking clash INVALID, got: ${text}`);
        }
        return { bytes: Buffer.byteLength(text) };
      },
      'Indexed lookup on res-bench-0 (25 bookings/resource, 200 total)',
    ));

    // Benchmark 4: Archive Arabic search (GET /api/v1/archive/news?q=...)
    const arabicQueries = ['المناخ', 'النفط العالمية', 'الذكاء الاصطناعي', 'القطار الكهربائي', 'التراث العربي'];
    results.push(await benchLoop(
      'Archive Arabic search (GET /api/v1/archive/news)',
      3,
      30,
      async (i) => {
        const q = arabicQueries[Math.abs(i) % arabicQueries.length];
        const res = await fetch(`${baseUrl}/api/v1/archive/news?q=${encodeURIComponent(q)}&pageSize=20`, {
          headers: { Cookie: cookie },
        });
        const text = await res.text();
        if (!res.ok) throw new Error(`Archive search failed: ${res.status} ${text}`);
        const parsed = JSON.parse(text);
        if (!parsed.data?.total || parsed.data.total < 100) {
          throw new Error(`Expected >=100 archive matches for "${q}", got ${parsed.data?.total}`);
        }
        return { bytes: Buffer.byteLength(text) };
      },
      'FTS5 + Arabic ranking over 2,000 archived stories',
    ));

    // Benchmark 5: Reference rename propagation
    results.push(await benchLoop(
      'Reference rename propagation (category -> ~400 news)',
      1,
      10,
      async (i) => {
        const current = db.getRow('categories', 'cat-bench-eco');
        if (!current) throw new Error('Missing cat-bench-eco');
        const nextName = `الاقتصاد والأسواق (تحديث ${i + 100})`;
        const res = await fetch(`${baseUrl}/api/v1/data/sync`, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            ops: [{
              c: 'categories',
              op: 'upsert',
              id: 'cat-bench-eco',
              baseV: current.v,
              d: { ...current.d, nameAr: nextName },
            }],
          }),
        });
        const text = await res.text();
        if (!res.ok) throw new Error(`Reference rename failed: ${res.status} ${text}`);
        const parsed = JSON.parse(text);
        if (!parsed.results?.[0]?.ok) throw new Error(`Reference rename rejected: ${text}`);
        return { bytes: Buffer.byteLength(text) };
      },
      'Indexed listByJsonField + atomic update of 400 referencing news rows',
    ));

    // Print report
    console.log('\nMadar NRCS Newsroom Performance Benchmark (SQLite WAL)');
    console.log(`Dataset seeded in ${seedMs.toFixed(1)} ms: 2,000 archived news, 500 tasks, 200 bookings, 20 users, 3 stations\n`);
    console.log('| Benchmark | Runs | p50 (ms) | p95 (ms) | Avg (ms) | Avg Payload (KB) | Notes |');
    console.log('|---|---:|---:|---:|---:|---:|---|');
    for (const r of results) {
      console.log(
        `| ${r.name} | ${r.iterations} | ${r.p50Ms.toFixed(2)} | ${r.p95Ms.toFixed(2)} | ${r.avgMs.toFixed(2)} | ${r.avgPayloadKb.toFixed(1)} | ${r.notes} |`,
      );
    }
    console.log('');
  } finally {
    await new Promise<void>((resolve) => {
      server.closeAllConnections?.();
      server.close(() => resolve());
    });
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
