import { newId } from '../shared/ids';
import { DEFAULT_BREAKING_HOURS } from '../shared/newsWorkflow';
import type { NewsItem } from '../types/index';
import type { NewsroomDatabase } from './db';
import { changeBus } from './sync';
import { logger } from './logger';
import { localDateString } from '../shared/dates';
import { BulletinFormat, bulletinFromFormat, isScheduledOn, scheduledBulletinId } from '../shared/bulletins';

const SYSTEM_ACTOR = { id: 'system', name: 'النشر المجدول', role: 'SUPER_ADMIN' as const };

/**
 * Publishes every SCHEDULED story whose time has come. Runs on the server so a story
 * goes out on time even when nobody has the newsroom open. Returns the published ids.
 */
export function publishDueScheduledNews(db: NewsroomDatabase, now = new Date()): string[] {
  const published: string[] = [];
  const nowIso = now.toISOString();

  db.transaction(() => {
    for (const row of db.listCollection('news')) {
      const item = row.d as NewsItem;
      if (item.status !== 'SCHEDULED' || item.deletedAt || !item.scheduledDate) continue;
      const due = new Date(item.scheduledDate).getTime();
      if (!Number.isFinite(due) || due > now.getTime()) continue;
      // Never publish ahead of an embargo (it waits for the embargo to lift).
      if (item.embargoUntil && Date.parse(item.embargoUntil) > now.getTime()) continue;

      const updated: NewsItem = {
        ...item,
        status: 'PUBLISHED',
        publishDate: item.publishDate || nowIso,
        publishedById: SYSTEM_ACTOR.id,
        publishedByName: SYSTEM_ACTOR.name,
        updatedAt: nowIso,
        workflowLogs: [
          ...(item.workflowLogs || []),
          {
            id: newId('log'),
            newsId: item.id,
            fromStatus: 'SCHEDULED',
            toStatus: 'PUBLISHED',
            changedBy: SYSTEM_ACTOR,
            comment: `نُشر تلقائياً في الموعد المجدول (${item.scheduledDate})`,
            timestamp: nowIso,
          },
        ],
      };
      if (updated.isBreaking) {
        updated.breakingUntil = new Date(now.getTime() + DEFAULT_BREAKING_HOURS * 3600_000).toISOString();
      }

      db.recordHistory('news', item.id, row.v, item, null, SYSTEM_ACTOR.name);
      db.writeRow('news', item.id, updated, row.p, null);

      const auditId = newId('aud');
      db.writeRow(
        'auditLogs',
        auditId,
        {
          id: auditId,
          userId: SYSTEM_ACTOR.id,
          userName: SYSTEM_ACTOR.name,
          userRole: SYSTEM_ACTOR.role,
          actionType: 'PUBLISH',
          targetEntity: 'NEWS',
          targetId: item.id,
          severity: 'INFO',
          details: `نشر مجدول تلقائي: ${item.title}`,
          ipAddress: 'server',
          timestamp: nowIso,
        },
        db.positionBounds('auditLogs').min - 1,
        null
      );
      published.push(item.id);
    }
  });

  if (published.length) {
    logger.info('scheduled news published', { count: published.length, ids: published });
    changeBus.emit('rev', db.currentRev());
  }
  return published;
}

/**
 * Creates the day's bulletins for formats set to create automatically (today and tomorrow),
 * so the desk finds them ready to fill. Ids are stable per format and day, so a bulletin is
 * never created twice, and one the desk deleted is not brought back.
 */
export function createScheduledBulletins(db: NewsroomDatabase, now = new Date()): string[] {
  const created: string[] = [];
  const days = [0, 1].map((d) => localDateString(new Date(now.getTime() + d * 86400_000)));
  db.transaction(() => {
    for (const row of db.listCollection('bulletinFormats')) {
      const f = row.d as BulletinFormat;
      if (!f || f.deletedAt || !f.autoCreate) continue;
      for (const date of days) {
        if (!isScheduledOn(f, date)) continue;
        const id = scheduledBulletinId(f.id, date);
        if (db.getRow('bulletins', id)) continue;
        const { bulletin, stories } = bulletinFromFormat(f, date, id, newId, now.toISOString());
        db.writeRow('bulletins', id, bulletin, db.positionBounds('bulletins').max + 1, null);
        stories.forEach((s) => db.writeRow('bulletinStories', s.id, s, db.positionBounds('bulletinStories').max + 1, null));
        created.push(id);
      }
    }
  });
  if (created.length) {
    logger.info('scheduled bulletins created', { ids: created });
    changeBus.emit('rev', db.currentRev());
  }
  return created;
}
