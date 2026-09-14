import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import {
  getDatabase,
  getDatabaseStats,
  getDatabaseBuffer,
  executeRawQuery,
  seedDatabaseIfEmpty,
  persistDatabase,
  createDatabaseBackup,
  listDatabaseBackups,
  restoreDatabaseBackup,
  generateEpisodeMosXml,
} from './src/server/db';
import {
  INITIAL_NEWS,
  INITIAL_PROGRAMS,
  INITIAL_EPISODES,
  INITIAL_GUESTS,
  INITIAL_TASKS,
  INITIAL_MEDIA_FILES,
  INITIAL_AUDIT_LOGS,
} from './src/services/mockData';

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '10mb' }));

// In-memory backend database state
const backendStore = {
  systemStatus: 'ONLINE',
  version: '2.5.0',
  initializedAt: new Date().toISOString(),
};

// Request logger
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.path.startsWith('/api')) {
    console.log(`[API ${req.method}] ${req.path}`);
  }
  next();
});

// Health check with SQLite status
app.get('/api/health', async (req: Request, res: Response) => {
  try {
    const dbStats = await getDatabaseStats();
    res.json({
      status: 'ok',
      systemStatus: backendStore.systemStatus,
      version: backendStore.version,
      timestamp: new Date().toISOString(),
      broadcastStation: 'شبكة الأخبار والإنتاج التلفزيوني الإقليمية',
      database: {
        engine: dbStats.engine,
        isHealthy: dbStats.isHealthy,
        fileSize: dbStats.fileSizeFormatted,
        totalTables: dbStats.totalTables,
        totalRows: dbStats.totalRows,
      },
    });
  } catch (err: any) {
    res.json({
      status: 'ok',
      systemStatus: 'ONLINE_FALLBACK',
      timestamp: new Date().toISOString(),
      databaseError: err?.message,
    });
  }
});

// --- SQLITE DATABASE MANAGEMENT APIS ---

// Get SQLite Database Statistics
app.get('/api/v1/db/stats', async (req: Request, res: Response) => {
  try {
    const stats = await getDatabaseStats();
    res.json({ success: true, data: stats });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Export & Download the raw SQLite Database File (.sqlite)
app.get('/api/v1/db/export', (req: Request, res: Response) => {
  try {
    persistDatabase();
    const buffer = getDatabaseBuffer();
    const fileName = `newsroom_backup_${new Date().toISOString().slice(0, 10)}.sqlite`;

    res.setHeader('Content-Type', 'application/x-sqlite3');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Execute raw SQL Query via live console
app.post('/api/v1/db/query', async (req: Request, res: Response) => {
  try {
    const { query } = req.body;
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ success: false, error: 'Query string is required' });
    }
    const result = await executeRawQuery(query);
    res.json({ success: !result.error, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Reset / Reseed SQLite Database
app.post('/api/v1/db/reset', async (req: Request, res: Response) => {
  try {
    const db = await getDatabase();
    db.run(`
      DELETE FROM news;
      DELETE FROM programs;
      DELETE FROM episodes;
      DELETE FROM rundown_segments;
      DELETE FROM guests;
      DELETE FROM tasks;
      DELETE FROM media_assets;
      DELETE FROM audit_logs;
    `);
    await seedDatabaseIfEmpty({
      news: INITIAL_NEWS,
      programs: INITIAL_PROGRAMS,
      episodes: INITIAL_EPISODES,
      guests: INITIAL_GUESTS,
      tasks: INITIAL_TASKS,
      media: INITIAL_MEDIA_FILES,
      auditLogs: INITIAL_AUDIT_LOGS,
    });
    const stats = await getDatabaseStats();
    res.json({ success: true, message: 'تمت إعادة تهيئة قاعدة البيانات بنجاح', data: stats });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Database Backups Management
app.get('/api/v1/db/backups', (req: Request, res: Response) => {
  try {
    const backups = listDatabaseBackups();
    res.json({ success: true, data: backups });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/v1/db/backups', (req: Request, res: Response) => {
  try {
    const backup = createDatabaseBackup();
    res.json({ success: true, message: 'تم إنشاء نسخة احتياطية بنجاح', data: backup });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/v1/db/backups/restore', async (req: Request, res: Response) => {
  try {
    const { fileName } = req.body;
    if (!fileName) {
      return res.status(400).json({ success: false, error: 'اسم ملف النسخة الاحتياطية مطلوب' });
    }
    await restoreDatabaseBackup(fileName);
    const stats = await getDatabaseStats();
    res.json({ success: true, message: 'تمت استعادة النسخة الاحتياطية بنجاح', data: stats });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// MOS Protocol XML Export for Broadcast Automation & Prompters
app.get(['/api/v1/episodes/:id/export/mos', '/api/v1/episodes/:id/mos'], async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const xml = await generateEpisodeMosXml(id);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="episode_${id}_mos.xml"`);
    res.send(xml);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Rundown Segments Update Endpoint
app.put('/api/v1/episodes/:id/rundown', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { segments } = req.body;
    if (!Array.isArray(segments)) {
      return res.status(400).json({ success: false, error: 'Segments array is required' });
    }

    const db = await getDatabase();
    // Delete existing rundown segments for this episode
    db.run(`DELETE FROM rundown_segments WHERE episode_id = ?`, [id]);

    // Insert updated segments
    segments.forEach((seg: any, idx: number) => {
      db.run(
        `INSERT INTO rundown_segments (
          id, episode_id, order_index, title, segment_type, start_time_offset,
          duration_seconds, end_time_offset, presenter_name, guest_id, guest_name,
          script_text, video_asset_url, news_id, news_title, notes, is_completed
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          seg.id || `seg-${Date.now()}-${idx}`,
          id,
          seg.orderIndex || idx + 1,
          seg.title || 'فقرة بدون عنوان',
          seg.segmentType || 'REPORT',
          seg.startTimeOffset || '00:00:00',
          Number(seg.durationSeconds) || 60,
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

    // Update episode duration and updated_at in episodes table
    const totalDurationSec = segments.reduce((sum: number, s: any) => sum + (Number(s.durationSeconds) || 0), 0);
    const durationMin = Math.round(totalDurationSec / 60);
    const now = new Date().toISOString();
    db.run(`UPDATE episodes SET duration_minutes = ?, updated_at = ? WHERE id = ?`, [durationMin, now, id]);

    persistDatabase();
    res.json({ success: true, message: 'تم حفظ الرانداون في قاعدة بيانات SQLite بنجاح' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Mock Auth API
app.get('/api/v1/auth/me', (req: Request, res: Response) => {
  res.json({
    success: true,
    user: {
      id: 'usr-1',
      fullName: 'أحمد المنصوري',
      email: 'admin@akhbar.tv',
      role: 'SUPER_ADMIN',
      jobTitle: 'المدير العام لشبكة الأخبار',
    },
  });
});

// Broadcast System Settings API
app.get('/api/v1/settings', async (req: Request, res: Response) => {
  try {
    const db = await getDatabase();
    const row = db.exec("SELECT value_json FROM system_settings WHERE key = 'general'");
    if (row.length && row[0].values.length) {
      const parsed = JSON.parse(String(row[0].values[0][0]));
      return res.json({ success: true, data: parsed });
    }
  } catch (e) {
    // fallback
  }

  res.json({
    success: true,
    data: {
      organizationName: 'شبكة الأخبار والإنتاج التلفزيوني الإقليمية',
      timezone: 'Asia/Riyadh (GMT+3)',
      defaultLanguage: 'ar',
      rundownAutoRecalculate: true,
      breakingNewsMaxActive: 5,
    },
  });
});

app.put('/api/v1/settings', async (req: Request, res: Response) => {
  try {
    const db = await getDatabase();
    const settingsJson = JSON.stringify(req.body);
    db.run("INSERT OR REPLACE INTO system_settings (key, value_json) VALUES ('general', ?)", [settingsJson]);
    persistDatabase();
    res.json({ success: true, data: req.body });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Start server with Vite middleware
async function startServer() {
  // Initialize SQLite database
  try {
    console.log('[NRCS Server] Initializing SQLite database engine...');
    await getDatabase();
    await seedDatabaseIfEmpty({
      news: INITIAL_NEWS,
      programs: INITIAL_PROGRAMS,
      episodes: INITIAL_EPISODES,
      guests: INITIAL_GUESTS,
      tasks: INITIAL_TASKS,
      media: INITIAL_MEDIA_FILES,
      auditLogs: INITIAL_AUDIT_LOGS,
    });
    console.log('[NRCS Server] SQLite database initialized and ready.');
  } catch (dbErr) {
    console.error('[NRCS Server] SQLite initialization error:', dbErr);
  }

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[NRCS Server] Running broadcast newsroom server on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
});
