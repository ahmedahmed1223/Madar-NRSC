import type { User } from '../types/index';
import { CollectionName, SINGLETON_ID } from '../shared/collections';
import { DEFAULT_ROLE_DEFINITIONS } from '../shared/rbac';
import { newId } from '../shared/ids';
import {
  INITIAL_ACTIVITY_LOGS,
  INITIAL_AUDIT_LOGS,
  INITIAL_BREAKING_NEWS,
  INITIAL_CATEGORIES,
  INITIAL_EPISODES,
  INITIAL_GUESTS,
  INITIAL_MEDIA_FILES,
  INITIAL_NEWS,
  INITIAL_NOTIFICATIONS,
  INITIAL_PROGRAM_EVALUATIONS,
  INITIAL_PROGRAM_TYPES,
  INITIAL_PROGRAMS,
  INITIAL_SETTINGS,
  INITIAL_SOURCES,
  INITIAL_STORIES,
  INITIAL_TASKS,
  INITIAL_USERS,
} from '../services/mockData';
import type { AppConfig } from './config';
import type { NewsroomDatabase } from './db';
import { generatePassword, hashPassword } from './auth';
import { logger } from './logger';

/** Reference data every installation needs. */
const BASE_COLLECTIONS: [CollectionName, any[]][] = [
  ['roles', DEFAULT_ROLE_DEFINITIONS],
  ['categories', INITIAL_CATEGORIES],
  ['sources', INITIAL_SOURCES],
  ['programTypes', INITIAL_PROGRAM_TYPES],
];

/** Sample newsroom content, only for demos and development. */
export const DEMO_COLLECTIONS: [CollectionName, any[]][] = [
  ['news', INITIAL_NEWS],
  ['stories', INITIAL_STORIES],
  ['breaking', INITIAL_BREAKING_NEWS],
  ['programs', INITIAL_PROGRAMS],
  ['programEvaluations', INITIAL_PROGRAM_EVALUATIONS],
  ['episodes', INITIAL_EPISODES],
  ['guests', INITIAL_GUESTS],
  ['tasks', INITIAL_TASKS],
  ['media', INITIAL_MEDIA_FILES],
  ['notifications', INITIAL_NOTIFICATIONS],
  ['activityLogs', INITIAL_ACTIVITY_LOGS],
  ['auditLogs', INITIAL_AUDIT_LOGS],
];

function seedList(db: NewsroomDatabase, collection: CollectionName, items: any[]) {
  if (db.countCollection(collection) > 0) return;
  items.forEach((item, idx) => {
    if (item && typeof item.id === 'string') db.writeRow(collection, item.id, item, idx, null);
  });
  logger.info('seeded collection', { collection, count: items.length });
}

export async function seedDatabase(db: NewsroomDatabase, config: AppConfig) {
  db.transaction(() => {
    BASE_COLLECTIONS.forEach(([c, items]) => seedList(db, c, items));
    if (!db.getRow('settings', SINGLETON_ID)) db.writeRow('settings', SINGLETON_ID, INITIAL_SETTINGS, 0, null);
  });

  if (config.seedDemoData && db.getMeta('demo_seeded') !== '1') {
    const demoHash = await hashPassword(config.demoUserPassword);
    db.transaction(() => {
      DEMO_COLLECTIONS.forEach(([c, items]) => seedList(db, c, items));
      if (db.countCollection('users') === 0) {
        INITIAL_USERS.forEach((u, idx) => {
          db.writeRow('users', u.id, u, idx, null);
          if (!db.getCredentialsByEmail(u.email)) db.setPassword(u.id, u.email.toLowerCase(), demoHash, false);
        });
        logger.warn('demo users created with the shared DEMO_USER_PASSWORD; never enable SEED_DEMO_DATA in production');
      }
      db.setMeta('demo_seeded', '1');
    });
  }

  await ensureAdministrator(db, config);
}

/** Guarantees at least one account can sign in on a fresh installation. */
async function ensureAdministrator(db: NewsroomDatabase, config: AppConfig) {
  if (db.countCredentials() > 0) return;

  const email = (config.admin.email || 'admin@madar.local').toLowerCase();
  const generated = !config.admin.password;
  const password = config.admin.password || generatePassword();
  const hash = await hashPassword(password);

  db.transaction(() => {
    let userId = db.findUserIdByEmail(email);
    if (!userId) {
      userId = newId('usr');
      const admin: User = {
        id: userId,
        fullName: config.admin.name,
        email,
        role: 'SUPER_ADMIN',
        avatarUrl: '/icon.svg',
        jobTitle: 'مدير النظام',
        department: 'الإدارة العامة والتحرير',
        securityClearance: 'TOP_SECRET',
        isActive: true,
        createdAt: new Date().toISOString(),
      };
      db.writeRow('users', userId, admin, -1, null);
    }
    db.setPassword(userId, email, hash, generated);
  });

  if (generated) {
    // Printed exactly once; the admin is forced to change it at first sign-in.
    logger.warn('initial administrator created with a generated password (change it at first login)', {
      email,
      password,
    });
  } else {
    logger.info('initial administrator created', { email });
  }
}
