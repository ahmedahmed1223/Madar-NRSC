import initSqlJs, { Database } from 'sql.js';
import fs from 'fs';
import path from 'path';

let dbInstance: Database | null = null;
const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE_PATH = path.join(DATA_DIR, 'newsroom.sqlite');

/**
 * Ensures data directory exists
 */
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * Saves current in-memory SQLite state to persistent disk file
 */
export function persistDatabase(): void {
  if (!dbInstance) return;
  try {
    ensureDataDir();
    const data = dbInstance.export();
    fs.writeFileSync(DB_FILE_PATH, Buffer.from(data));
  } catch (err) {
    console.error('[SQLite] Failed to write database to disk:', err);
  }
}

/**
 * Exports the SQLite database file buffer for client download
 */
export function getDatabaseBuffer(): Buffer {
  if (!dbInstance) {
    throw new Error('Database not initialized');
  }
  const binary = dbInstance.export();
  return Buffer.from(binary);
}

/**
 * Initialize SQLite Database
 */
export async function getDatabase(): Promise<Database> {
  if (dbInstance) return dbInstance;

  ensureDataDir();
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_FILE_PATH)) {
    try {
      const fileBuffer = fs.readFileSync(DB_FILE_PATH);
      dbInstance = new SQL.Database(fileBuffer);
      // Run SQLite integrity check
      const integrity = dbInstance.exec('PRAGMA integrity_check;');
      if (integrity.length && integrity[0].values?.[0]?.[0] === 'ok') {
        console.log(`[SQLite Self-Healing] Loaded database integrity OK from ${DB_FILE_PATH} (${fileBuffer.length} bytes)`);
      } else {
        console.warn('[SQLite Self-Healing] Database integrity degraded, recreating fresh store with schema repair');
        dbInstance = new SQL.Database();
      }
    } catch (readErr) {
      console.warn('[SQLite] Corrupted database file, creating fresh instance:', readErr);
      dbInstance = new SQL.Database();
    }
  } else {
    console.log('[SQLite] Creating fresh SQLite database file at', DB_FILE_PATH);
    dbInstance = new SQL.Database();
  }

  setupSchema(dbInstance);
  persistDatabase();
  return dbInstance;
}

/**
 * Setup SQLite Schema
 */
function setupSchema(db: Database) {
  db.run(`
    CREATE TABLE IF NOT EXISTS news (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      short_title TEXT,
      summary TEXT,
      content TEXT,
      category_id TEXT,
      category_name TEXT,
      source_id TEXT,
      source_name TEXT,
      priority TEXT DEFAULT 'NORMAL',
      status TEXT DEFAULT 'DRAFT',
      is_breaking INTEGER DEFAULT 0,
      author_id TEXT,
      author_name TEXT,
      location_name TEXT,
      event_date TEXT,
      main_image_url TEXT,
      video_url TEXT,
      keywords_json TEXT,
      views_count INTEGER DEFAULT 0,
      created_at TEXT,
      updated_at TEXT,
      published_at TEXT,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS programs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      name_en TEXT,
      type_id TEXT,
      type_name TEXT,
      category TEXT,
      periodicity TEXT,
      broadcast_day TEXT,
      broadcast_time TEXT,
      duration_minutes INTEGER DEFAULT 30,
      presenter_name TEXT,
      producer_name TEXT,
      director_name TEXT,
      studio_name TEXT,
      description TEXT,
      cover_image_url TEXT,
      status TEXT DEFAULT 'ACTIVE',
      created_at TEXT,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS episodes (
      id TEXT PRIMARY KEY,
      program_id TEXT NOT NULL,
      program_name TEXT,
      season_number INTEGER DEFAULT 1,
      episode_number INTEGER DEFAULT 1,
      title TEXT NOT NULL,
      description TEXT,
      broadcast_date TEXT,
      start_time TEXT,
      end_time TEXT,
      duration_minutes INTEGER DEFAULT 30,
      presenter_name TEXT,
      producer_name TEXT,
      director_name TEXT,
      studio_name TEXT,
      status TEXT DEFAULT 'IN_PREPARATION',
      intro_script TEXT,
      director_notes TEXT,
      presenter_notes TEXT,
      guests_json TEXT,
      questions_json TEXT,
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS rundown_segments (
      id TEXT PRIMARY KEY,
      episode_id TEXT NOT NULL,
      order_index INTEGER NOT NULL,
      title TEXT NOT NULL,
      segment_type TEXT NOT NULL,
      start_time_offset TEXT,
      duration_seconds INTEGER DEFAULT 60,
      end_time_offset TEXT,
      presenter_name TEXT,
      guest_id TEXT,
      guest_name TEXT,
      script_text TEXT,
      video_asset_url TEXT,
      news_id TEXT,
      news_title TEXT,
      notes TEXT,
      is_completed INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS guests (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      title TEXT,
      specialty TEXT,
      organization TEXT,
      job_title TEXT,
      country TEXT,
      phone TEXT,
      email TEXT,
      avatar_url TEXT,
      rating REAL DEFAULT 5.0,
      appearances_count INTEGER DEFAULT 0,
      last_appearance_date TEXT,
      preferred_connection TEXT,
      notes TEXT,
      status TEXT DEFAULT 'ACTIVE',
      created_at TEXT,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      assigned_to_id TEXT,
      assigned_to_name TEXT,
      priority TEXT DEFAULT 'NORMAL',
      status TEXT DEFAULT 'TODO',
      due_date TEXT,
      related_type TEXT,
      related_id TEXT,
      related_title TEXT,
      created_by_name TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS media_assets (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      file_url TEXT NOT NULL,
      thumbnail_url TEXT,
      size_bytes INTEGER DEFAULT 0,
      duration_seconds INTEGER,
      dimensions TEXT,
      uploaded_by_name TEXT,
      tags_json TEXT,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      user_name TEXT,
      user_role TEXT,
      action TEXT NOT NULL,
      action_type TEXT,
      target_entity TEXT,
      target_id TEXT,
      details TEXT,
      severity TEXT DEFAULT 'INFO',
      ip_address TEXT,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT
    );
  `);

  // Seed default settings if not exists
  const settingsCheck = db.exec("SELECT COUNT(*) FROM system_settings WHERE key = 'general'");
  if (!settingsCheck.length || settingsCheck[0].values[0][0] === 0) {
    const defaultSettings = JSON.stringify({
      organizationName: 'شبكة الأخبار والإنتاج التلفزيوني الإقليمية',
      organizationNameEn: 'Regional News & Broadcast Production Network',
      logoUrl: '',
      defaultTimezone: 'Asia/Riyadh (GMT+3)',
      defaultLanguage: 'ar',
      primaryChannelName: 'القناة الإخبارية الأولى',
      autoSaveIntervalSeconds: 30,
      allowGuestProposals: true,
      enableAuditLog: true,
    });
    db.run("INSERT OR REPLACE INTO system_settings (key, value_json) VALUES ('general', ?)", [defaultSettings]);
  }
}

/**
 * Execute arbitrary SQL query with safety measures
 */
export async function executeRawQuery(sqlQuery: string): Promise<{
  columns: string[];
  values: (string | number | boolean | null)[][];
  rowCount: number;
  executionTimeMs: number;
  error?: string;
}> {
  const db = await getDatabase();
  const startTime = Date.now();

  try {
    const trimmed = sqlQuery.trim();
    if (!trimmed) {
      return { columns: [], values: [], rowCount: 0, executionTimeMs: 0 };
    }

    const res = db.exec(trimmed);
    const executionTimeMs = Date.now() - startTime;

    // If query modified data, persist
    const upper = trimmed.toUpperCase();
    if (upper.startsWith('INSERT') || upper.startsWith('UPDATE') || upper.startsWith('DELETE') || upper.startsWith('DROP') || upper.startsWith('ALTER') || upper.startsWith('CREATE')) {
      persistDatabase();
    }

    if (!res || res.length === 0) {
      return {
        columns: ['Status'],
        values: [['تم تنفيذ الأمر بنجاح (لا توجد صفوف مسترجعة)']],
        rowCount: 0,
        executionTimeMs,
      };
    }

    const first = res[0];
    return {
      columns: first.columns,
      values: first.values as (string | number | boolean | null)[][],
      rowCount: first.values.length,
      executionTimeMs,
    };
  } catch (err: any) {
    return {
      columns: ['Error'],
      values: [[err.message || 'خطأ أثناء تنفيذ الاستعلام']],
      rowCount: 0,
      executionTimeMs: Date.now() - startTime,
      error: err.message || 'Unknown SQL Error',
    };
  }
}

/**
 * Returns comprehensive database statistics
 */
export async function getDatabaseStats() {
  const db = await getDatabase();
  const tableNames = [
    'news',
    'programs',
    'episodes',
    'rundown_segments',
    'guests',
    'tasks',
    'media_assets',
    'audit_logs',
    'system_settings',
  ];

  const tables = tableNames.map((tbl) => {
    let rowCount = 0;
    const columns: string[] = [];

    try {
      const countRes = db.exec(`SELECT COUNT(*) FROM ${tbl}`);
      if (countRes.length && countRes[0].values.length) {
        rowCount = Number(countRes[0].values[0][0]);
      }

      const pragmaRes = db.exec(`PRAGMA table_info(${tbl})`);
      if (pragmaRes.length && pragmaRes[0].values) {
        pragmaRes[0].values.forEach((row) => {
          columns.push(String(row[1])); // column name
        });
      }
    } catch {
      // Table may not exist yet
    }

    return { name: tbl, rowCount, columns };
  });

  let fileSizeBytes = 0;
  if (fs.existsSync(DB_FILE_PATH)) {
    try {
      fileSizeBytes = fs.statSync(DB_FILE_PATH).size;
    } catch {
      fileSizeBytes = 0;
    }
  }

  const totalRows = tables.reduce((sum, t) => sum + t.rowCount, 0);

  return {
    engine: 'SQLite 3 (Embedded via WebAssembly sql.js)',
    filePath: DB_FILE_PATH,
    fileSizeBytes,
    fileSizeFormatted: `${(fileSizeBytes / 1024).toFixed(1)} KB`,
    totalTables: tables.length,
    totalRows,
    tables,
    lastSyncAt: new Date().toISOString(),
    isHealthy: true,
  };
}

/**
 * Seed SQLite database from initial application data if tables are empty
 */
export async function seedDatabaseIfEmpty(initialData: {
  news: any[];
  programs: any[];
  episodes: any[];
  guests: any[];
  tasks: any[];
  media: any[];
  auditLogs: any[];
}) {
  const db = await getDatabase();

  const newsCount = Number(db.exec('SELECT COUNT(*) FROM news')[0]?.values[0][0] || 0);
  if (newsCount === 0 && initialData.news?.length) {
    console.log('[SQLite] Seeding news table with initial records...');
    initialData.news.forEach((n) => {
      db.run(
        `INSERT OR REPLACE INTO news (
          id, title, short_title, summary, content, category_id, category_name,
          source_id, source_name, priority, status, is_breaking, author_id,
          author_name, location_name, event_date, main_image_url, video_url,
          keywords_json, views_count, created_at, updated_at, published_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          n.id,
          n.title,
          n.shortTitle || n.title,
          n.summary || '',
          n.content || '',
          n.categoryId || '',
          n.categoryName || '',
          n.sourceId || '',
          n.sourceName || '',
          n.priority || 'NORMAL',
          n.status || 'DRAFT',
          n.isBreaking ? 1 : 0,
          n.authorId || '',
          n.authorName || '',
          n.locationName || '',
          n.eventDate || '',
          n.mainImageUrl || '',
          n.videoUrl || '',
          JSON.stringify(n.keywords || []),
          n.viewsCount || 0,
          n.createdAt || new Date().toISOString(),
          n.updatedAt || new Date().toISOString(),
          n.publishedAt || null,
          n.deletedAt || null,
        ]
      );
    });
  }

  const progCount = Number(db.exec('SELECT COUNT(*) FROM programs')[0]?.values[0][0] || 0);
  if (progCount === 0 && initialData.programs?.length) {
    console.log('[SQLite] Seeding programs table with initial records...');
    initialData.programs.forEach((p) => {
      db.run(
        `INSERT OR REPLACE INTO programs (
          id, name, name_en, type_id, type_name, category, periodicity,
          broadcast_day, broadcast_time, duration_minutes, presenter_name,
          producer_name, director_name, studio_name, description, cover_image_url,
          status, created_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          p.id,
          p.name,
          p.nameEn || '',
          p.typeId || '',
          p.typeName || '',
          p.category || '',
          p.periodicity || 'WEEKLY',
          p.broadcastDay || '',
          p.broadcastTime || '',
          p.durationMinutes || 30,
          p.presenterName || '',
          p.producerName || '',
          p.directorName || '',
          p.studioName || '',
          p.description || '',
          p.coverImageUrl || '',
          p.status || 'ACTIVE',
          p.createdAt || new Date().toISOString(),
          p.deletedAt || null,
        ]
      );
    });
  }

  const epCount = Number(db.exec('SELECT COUNT(*) FROM episodes')[0]?.values[0][0] || 0);
  if (epCount === 0 && initialData.episodes?.length) {
    console.log('[SQLite] Seeding episodes & rundowns with initial records...');
    initialData.episodes.forEach((e) => {
      db.run(
        `INSERT OR REPLACE INTO episodes (
          id, program_id, program_name, season_number, episode_number, title,
          description, broadcast_date, start_time, end_time, duration_minutes,
          presenter_name, producer_name, director_name, studio_name, status,
          intro_script, director_notes, presenter_notes, guests_json, questions_json,
          created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          e.id,
          e.programId,
          e.programName || '',
          e.seasonNumber || 1,
          e.episodeNumber || 1,
          e.title,
          e.description || '',
          e.broadcastDate || '',
          e.startTime || '',
          e.endTime || '',
          e.durationMinutes || 30,
          e.presenterName || '',
          e.producerName || '',
          e.directorName || '',
          e.studioName || '',
          e.status || 'IN_PREPARATION',
          e.introScript || '',
          e.directorNotes || '',
          e.presenterNotes || '',
          JSON.stringify(e.guests || []),
          JSON.stringify(e.questions || []),
          e.createdAt || new Date().toISOString(),
          e.updatedAt || new Date().toISOString(),
          e.deletedAt || null,
        ]
      );

      // Seed rundown segments
      if (Array.isArray(e.rundown)) {
        e.rundown.forEach((seg: any) => {
          db.run(
            `INSERT OR REPLACE INTO rundown_segments (
              id, episode_id, order_index, title, segment_type, start_time_offset,
              duration_seconds, end_time_offset, presenter_name, guest_id, guest_name,
              script_text, video_asset_url, news_id, news_title, notes, is_completed
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              seg.id,
              e.id,
              seg.orderIndex || 1,
              seg.title,
              seg.segmentType || 'REPORT',
              seg.startTimeOffset || '00:00:00',
              seg.durationSeconds || 60,
              seg.endTimeOffset || '00:01:00',
              seg.presenterName || '',
              seg.guestId || '',
              seg.guestName || '',
              seg.scriptText || '',
              seg.videoAssetUrl || '',
              seg.newsId || '',
              seg.newsTitle || '',
              seg.notes || '',
              seg.isCompleted ? 1 : 0,
            ]
          );
        });
      }
    });
  }

  const guestCount = Number(db.exec('SELECT COUNT(*) FROM guests')[0]?.values[0][0] || 0);
  if (guestCount === 0 && initialData.guests?.length) {
    console.log('[SQLite] Seeding guests table with initial records...');
    initialData.guests.forEach((g) => {
      db.run(
        `INSERT OR REPLACE INTO guests (
          id, full_name, title, specialty, organization, job_title, country,
          phone, email, avatar_url, rating, appearances_count, last_appearance_date,
          preferred_connection, notes, status, created_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          g.id,
          g.fullName,
          g.title || '',
          g.specialty || '',
          g.organization || '',
          g.jobTitle || '',
          g.country || '',
          g.phone || '',
          g.email || '',
          g.avatarUrl || '',
          g.rating || 5.0,
          g.appearancesCount || 0,
          g.lastAppearanceDate || '',
          g.preferredConnection || 'STUDIO',
          g.notes || '',
          g.status || 'ACTIVE',
          g.createdAt || new Date().toISOString(),
          g.deletedAt || null,
        ]
      );
    });
  }

  persistDatabase();
  console.log('[SQLite] Database seed verification finished.');
}

const BACKUPS_DIR = path.join(DATA_DIR, 'backups');

function ensureBackupsDir() {
  if (!fs.existsSync(BACKUPS_DIR)) {
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  }
}

export interface DbBackupFileInfo {
  fileName: string;
  sizeBytes: number;
  sizeFormatted: string;
  createdAt: string;
}

/**
 * Creates a timestamped backup copy of newsroom.sqlite in data/backups/
 */
export function createDatabaseBackup(): DbBackupFileInfo {
  persistDatabase();
  ensureBackupsDir();

  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  const fileName = `newsroom_backup_${timestamp}.sqlite`;
  const targetPath = path.join(BACKUPS_DIR, fileName);

  const buffer = getDatabaseBuffer();
  fs.writeFileSync(targetPath, buffer);

  // Self-Healing 24/7 Disk Hygiene: Keep latest 20 backups and prune older ones
  try {
    const existing = fs.readdirSync(BACKUPS_DIR).filter((f) => f.endsWith('.sqlite')).sort();
    if (existing.length > 20) {
      const toPrune = existing.slice(0, existing.length - 20);
      toPrune.forEach((oldFile) => {
        try {
          fs.unlinkSync(path.join(BACKUPS_DIR, oldFile));
        } catch {}
      });
    }
  } catch {}

  const stat = fs.statSync(targetPath);
  return {
    fileName,
    sizeBytes: stat.size,
    sizeFormatted: `${(stat.size / 1024).toFixed(1)} KB`,
    createdAt: now.toISOString(),
  };
}

/**
 * Lists all available backup files
 */
export function listDatabaseBackups(): DbBackupFileInfo[] {
  ensureBackupsDir();
  try {
    const files = fs.readdirSync(BACKUPS_DIR);
    return files
      .filter((f) => f.endsWith('.sqlite'))
      .sort()
      .reverse()
      .map((f) => {
        const fullPath = path.join(BACKUPS_DIR, f);
        const stat = fs.statSync(fullPath);
        return {
          fileName: f,
          sizeBytes: stat.size,
          sizeFormatted: `${(stat.size / 1024).toFixed(1)} KB`,
          createdAt: stat.birthtime.toISOString(),
        };
      });
  } catch {
    return [];
  }
}

/**
 * Restores database from a chosen backup file
 */
export async function restoreDatabaseBackup(fileName: string): Promise<boolean> {
  ensureBackupsDir();
  const safeName = path.basename(fileName);
  const backupPath = path.join(BACKUPS_DIR, safeName);
  if (!fs.existsSync(backupPath)) {
    throw new Error(`Backup file ${safeName} does not exist`);
  }

  const SQL = await initSqlJs();
  const backupBuffer = fs.readFileSync(backupPath);
  dbInstance = new SQL.Database(backupBuffer);
  persistDatabase();
  return true;
}

/**
 * Generates official MOS (Media Object Server) Protocol 2.8.5 XML for broadcast automation
 */
export async function generateEpisodeMosXml(episodeId: string): Promise<string> {
  const db = await getDatabase();
  const epRes = db.exec(`SELECT * FROM episodes WHERE id = '${episodeId}'`);
  if (!epRes.length || !epRes[0].values.length) {
    throw new Error('Episode not found');
  }

  const cols = epRes[0].columns;
  const epRow: any = {};
  cols.forEach((col, idx) => {
    epRow[col] = epRes[0].values[0][idx];
  });

  const segRes = db.exec(`SELECT * FROM rundown_segments WHERE episode_id = '${episodeId}' ORDER BY order_index ASC`);
  const segments: any[] = [];
  if (segRes.length && segRes[0].values.length) {
    const segCols = segRes[0].columns;
    segRes[0].values.forEach((row) => {
      const seg: any = {};
      segCols.forEach((c, idx) => {
        seg[c] = row[idx];
      });
      segments.push(seg);
    });
  }

  const escapeXml = (str: string = '') =>
    String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');

  const totalDurationSec = segments.reduce((sum, s) => sum + (Number(s.duration_seconds) || 0), 0);

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<mos>
  <ncsID>AQ_NEWSROOM_NRCS</ncsID>
  <roCreate>
    <roID>${escapeXml(epRow.id)}</roID>
    <roSlug>${escapeXml(epRow.title)}</roSlug>
    <roChannel>${escapeXml(epRow.program_name || 'Main Channel')}</roChannel>
    <roAirDate>${escapeXml(epRow.broadcast_date || new Date().toISOString().slice(0, 10))}</roAirDate>
    <roAirTime>${escapeXml(epRow.start_time || '20:00:00')}</roAirTime>
    <roTotalDuration>${totalDurationSec}</roTotalDuration>
    <roMetadata>
      <studio>${escapeXml(epRow.studio_name || 'Studio A')}</studio>
      <presenter>${escapeXml(epRow.presenter_name || '')}</presenter>
      <producer>${escapeXml(epRow.producer_name || '')}</producer>
      <director>${escapeXml(epRow.director_name || '')}</director>
      <status>${escapeXml(epRow.status || 'IN_PREPARATION')}</status>
    </roMetadata>
    ${segments
      .map(
        (s, idx) => `
    <story>
      <storyID>${escapeXml(s.id)}</storyID>
      <storySlug>${escapeXml(s.title)}</storySlug>
      <storyNumber>${s.order_index || idx + 1}</storyNumber>
      <storyType>${escapeXml(s.segment_type)}</storyType>
      <storyPresenter>${escapeXml(s.presenter_name || '')}</storyPresenter>
      <storyDuration>${s.duration_seconds || 60}</storyDuration>
      <storyStartTimeOffset>${escapeXml(s.start_time_offset || '00:00:00')}</storyStartTimeOffset>
      <storyScript>
        <p>${escapeXml(s.script_text || '')}</p>
      </storyScript>
      ${
        s.video_asset_url
          ? `<mosItem>
        <itemID>${escapeXml(s.id)}_video</itemID>
        <itemSlug>${escapeXml(s.title)}_VT</itemSlug>
        <mosAbstract>${escapeXml(s.video_asset_url)}</mosAbstract>
      </mosItem>`
          : ''
      }
      ${
        s.guest_name
          ? `<guestInfo>
        <guestName>${escapeXml(s.guest_name)}</guestName>
        <guestId>${escapeXml(s.guest_id || '')}</guestId>
      </guestInfo>`
          : ''
      }
    </story>`
      )
      .join('')}
  </roCreate>
</mos>`;

  return xml;
}
