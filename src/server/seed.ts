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
  INITIAL_PROGRAM_TYPES,
  INITIAL_PROGRAMS,
  INITIAL_SETTINGS,
  INITIAL_SOURCES,
  INITIAL_STORIES,
  INITIAL_TASKS,
  INITIAL_USERS,
} from '../services/mockData';
import { demoBulletin, INITIAL_BULLETIN_FORMATS } from '../services/demoBulletins';
import { demoBookings, demoDiary, INITIAL_RESOURCES } from '../services/demoPlanning';
import { localDateString } from '../shared/dates';
import type { AppConfig } from './config';
import type { NewsroomDatabase } from './db';
import { departmentIdOf, departmentName } from '../shared/departments';
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
  ['episodes', INITIAL_EPISODES],
  ['guests', INITIAL_GUESTS],
  ['tasks', INITIAL_TASKS],
  ['media', INITIAL_MEDIA_FILES],
  ['notifications', INITIAL_NOTIFICATIONS],
  ['activityLogs', INITIAL_ACTIVITY_LOGS],
  ['auditLogs', INITIAL_AUDIT_LOGS],
  ['bulletinFormats', INITIAL_BULLETIN_FORMATS],
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
    if (!db.getRow('broadcastState', SINGLETON_ID)) db.writeRow('broadcastState', SINGLETON_ID, { liveLock: false }, 0, null);
  });

  // Once an administrator removed the demo data it is never seeded again.
  const demoAllowed = config.seedDemoData && db.getMeta('demo_removed') !== '1';
  if (demoAllowed && db.getMeta('demo_seeded') !== '1') {
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
  reconcileTwoFactorFlags(db);
  migrateRoleDefaults(db);
  migrateToDepartments(db);
  ensureSystemRoles(db);
  grantNewPermissions(db);
  if (demoAllowed) {
    await ensureDemoUsers(db, config);
    seedDemoBulletins(db);
    seedDemoPlanning(db);
  }
}

/** Demo planning diary, resources and bookings (added once to demo databases). */
function seedDemoPlanning(db: NewsroomDatabase) {
  if (db.getMeta('demo_planning') === '1') return;
  db.transaction(() => {
    const today = localDateString();
    seedList(db, 'resources', INITIAL_RESOURCES);
    seedList(db, 'diary', demoDiary(today));
    seedList(db, 'bookings', demoBookings(today));
    db.setMeta('demo_planning', '1');
  });
}

/** Demo accounts added after a demo database was created (e.g. the crew account) are added once. */
async function ensureDemoUsers(db: NewsroomDatabase, config: AppConfig) {
  const missing = INITIAL_USERS.filter((u) => !db.getRow('users', u.id, true) && !db.getCredentialsByEmail(u.email) && db.getMeta(`demo_user:${u.id}`) !== '1');
  if (!missing.length) return;
  const hash = await hashPassword(config.demoUserPassword);
  db.transaction(() => {
    for (const u of missing) {
      db.writeRow('users', u.id, u, db.positionBounds('users').max + 1, null);
      db.setPassword(u.id, u.email.toLowerCase(), hash, false);
      db.setMeta(`demo_user:${u.id}`, '1');
    }
  });
}

/** Sign-in cards for demo installations: the real accounts (name, e-mail, role) as they are now. */
export function demoAccounts(db: NewsroomDatabase) {
  if (db.getMeta('demo_removed') === '1') return [];
  const roles = db.listCollection('roles').map((r) => r.d);
  return INITIAL_USERS.map((u) => db.getRow('users', u.id)?.d)
    .filter((u: any) => u && u.isActive !== false && db.getCredentialsByEmail(u.email))
    .map((u: any) => {
      const role = roles.find((r: any) => (u.customRoleId ? r.id === u.customRoleId : r.roleCode === u.role));
      return { email: u.email, fullName: u.fullName, jobTitle: u.jobTitle, roleName: String(role?.nameAr || u.role).split(' (')[0], department: u.department };
    });
}

/** Demo bulletins arrived after the first demo release: added once to demo databases. */
function seedDemoBulletins(db: NewsroomDatabase) {
  if (db.getMeta('demo_bulletins') === '1') return;
  db.transaction(() => {
    seedList(db, 'bulletinFormats', INITIAL_BULLETIN_FORMATS);
    if (db.countCollection('bulletins') === 0) {
      const { bulletin, stories } = demoBulletin(localDateString());
      db.writeRow('bulletins', bulletin.id, bulletin, 0, null);
      stories.forEach((st, i) => db.writeRow('bulletinStories', st.id, st, i, null));
    }
    db.setMeta('demo_bulletins', '1');
  });
}

/** Permissions added after roles were first stored: granted once to the system roles that need them. */
const NEW_PERMISSION_GRANTS: Record<string, string[]> = {
  'roster.manage': ['SUPER_ADMIN', 'ADMIN', 'EDITOR', 'PRODUCER'],
  'requests.create': ['SUPER_ADMIN', 'ADMIN', 'EDITOR', 'JOURNALIST', 'PRODUCER', 'PRESENTER', 'REPORTER', 'MEDIA', 'CREW'],
  'requests.manage': ['SUPER_ADMIN', 'ADMIN', 'EDITOR', 'PRODUCER'],
  'onair.control': ['SUPER_ADMIN', 'ADMIN', 'PRODUCER'],
  'bulletins.edit': ['SUPER_ADMIN', 'ADMIN', 'EDITOR', 'JOURNALIST', 'PRODUCER', 'REPORTER'],
  'bulletins.approve': ['SUPER_ADMIN', 'ADMIN', 'EDITOR'],
  'bulletins.manage': ['SUPER_ADMIN', 'ADMIN', 'EDITOR', 'PRODUCER'],
  'diary.manage': ['SUPER_ADMIN', 'ADMIN', 'EDITOR', 'PRODUCER'],
  'resources.book': ['SUPER_ADMIN', 'ADMIN', 'EDITOR', 'JOURNALIST', 'PRODUCER', 'REPORTER', 'MEDIA', 'CREW'],
  'resources.manage': ['SUPER_ADMIN', 'ADMIN', 'EDITOR', 'PRODUCER'],
};

/** System roles introduced after a database was created are added once. */
function ensureSystemRoles(db: NewsroomDatabase) {
  const existing = new Set(db.listCollection('roles').map((r) => r.d?.roleCode));
  const missing = DEFAULT_ROLE_DEFINITIONS.filter((r) => !existing.has(r.roleCode));
  if (!missing.length) return;
  db.transaction(() => {
    missing.forEach((role) => db.writeRow('roles', role.id, role, db.positionBounds('roles').max + 1, null));
  });
}

function grantNewPermissions(db: NewsroomDatabase) {
  for (const [code, roleCodes] of Object.entries(NEW_PERMISSION_GRANTS)) {
    const key = `perm_grant:${code}`;
    if (db.getMeta(key) === '1') continue;
    db.transaction(() => {
      for (const row of db.listCollection('roles')) {
        const role = row.d;
        if (!role?.isSystemRole || !roleCodes.includes(role.roleCode)) continue;
        const perms: string[] = role.permissions || [];
        if (!perms.includes(code)) db.writeRow('roles', row.id, { ...role, permissions: [...perms, code] }, row.p, null);
      }
      db.setMeta(key, '1');
    });
  }
}

/**
 * Newsroom/programmes focus: structured departments on users; program evaluations, guest ratings,
 * security clearances and the old shift field are retired.
 */
function migrateToDepartments(db: NewsroomDatabase) {
  if (db.getMeta('departments_migration') === '1') return;
  db.transaction(() => {
    for (const row of db.listCollection('users')) {
      const { securityClearance: _c, shift: _s, ...user } = row.d || {};
      const departmentId = departmentIdOf(user);
      const customPermissions = Array.isArray(user.customPermissions)
        ? user.customPermissions.filter((p: string) => p !== 'episodes.evaluate')
        : user.customPermissions;
      db.writeRow('users', row.id, { ...user, departmentId, department: departmentName(departmentId), customPermissions }, row.p, null);
    }
    for (const row of db.listCollection('roles')) {
      const perms: string[] = row.d?.permissions || [];
      if (perms.includes('episodes.evaluate')) {
        db.writeRow('roles', row.id, { ...row.d, permissions: perms.filter((p) => p !== 'episodes.evaluate') }, row.p, null);
      }
    }
    for (const row of db.listCollection('guests')) {
      if (row.d && 'rating' in row.d) {
        const { rating: _r, ...guest } = row.d;
        db.writeRow('guests', row.id, guest, row.p, null);
      }
    }
    db.dropRetiredCollection('programEvaluations');
    db.setMeta('departments_migration', '1');
  });
}

/**
 * One-off fixes to stored system roles. Producers could create stories but never
 * edit them again (news.edit_own was missing).
 */
function migrateRoleDefaults(db: NewsroomDatabase) {
  if (db.getMeta('roles_migration_2') !== '1') {
    // Presenters may tick questions, not rewrite whole episodes.
    db.transaction(() => {
      for (const row of db.listCollection('roles')) {
        const role = row.d;
        if (role?.roleCode === 'PRESENTER' && role.isSystemRole && role.permissions?.includes('episodes.edit')) {
          db.writeRow('roles', row.id, { ...role, permissions: role.permissions.filter((p: string) => p !== 'episodes.edit') }, row.p, null);
        }
      }
      db.setMeta('roles_migration_2', '1');
    });
  }
  if (db.getMeta('roles_migration') === '1') return;
  db.transaction(() => {
    for (const row of db.listCollection('roles')) {
      const role = row.d;
      if (role?.roleCode === 'PRODUCER' && role.permissions?.includes('news.create') && !role.permissions.includes('news.edit_own')) {
        db.writeRow('roles', row.id, { ...role, permissions: [...role.permissions, 'news.edit_own'] }, row.p, null);
      }
    }
    db.setMeta('roles_migration', '1');
  });
}

/** The user record's twoFactorEnabled flag must mirror real TOTP enrolment (never trust seeded/legacy values). */
function reconcileTwoFactorFlags(db: NewsroomDatabase) {
  db.transaction(() => {
    for (const row of db.listCollection('users')) {
      const actual = !!db.getCredentials(row.id)?.totpEnabled;
      if (!!row.d?.twoFactorEnabled !== actual) db.writeRow('users', row.id, { ...row.d, twoFactorEnabled: actual }, row.p, null);
    }
  });
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
        department: 'غرفة التحرير',
        departmentId: 'newsroom',
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

// ---------- removing demo data ----------

const DEMO_USER_IDS = INITIAL_USERS.map((u) => u.id);

/** Every seeded demo record still in the database (by its fixed id), per collection. */
export function demoInventory(db: NewsroomDatabase): Partial<Record<CollectionName, string[]>> {
  const today = localDateString();
  const planned: [CollectionName, { id: string }[]][] = [
    ...DEMO_COLLECTIONS,
    ['resources', INITIAL_RESOURCES],
    ['diary', demoDiary(today)],
    ['bookings', demoBookings(today)],
  ];
  const out: Partial<Record<CollectionName, string[]>> = {};
  const add = (c: CollectionName, id: string) => {
    if (!db.getRow(c, id)) return;
    (out[c] ||= []).push(id);
  };
  for (const [c, items] of planned) items.forEach((it) => it && typeof it.id === 'string' && add(c, it.id));
  // The demo bulletin and anything generated from the demo formats.
  const formatIds = new Set(INITIAL_BULLETIN_FORMATS.map((f) => f.id));
  const bulletinIds = db
    .listCollection('bulletins')
    .filter((r) => r.id === 'bul-demo-main' || formatIds.has(r.d?.formatId))
    .map((r) => r.id);
  bulletinIds.forEach((id) => add('bulletins', id));
  const bulletinSet = new Set(bulletinIds);
  db.listCollection('bulletinStories')
    .filter((r) => bulletinSet.has(r.d?.bulletinId))
    .forEach((r) => add('bulletinStories', r.id));
  return out;
}

export function demoUsersPresent(db: NewsroomDatabase, exceptUserId?: string): { id: string; fullName: string; email: string }[] {
  return DEMO_USER_IDS.filter((id) => id !== exceptUserId)
    .map((id) => db.getRow('users', id)?.d)
    .filter(Boolean)
    .map((u: any) => ({ id: u.id, fullName: u.fullName, email: u.email }));
}

/**
 * Deletes the seeded demo records (never data people created), optionally the demo accounts
 * (except the administrator doing it), and stops demo data from ever being seeded again.
 */
export function removeDemoData(db: NewsroomDatabase, opts: { includeUsers: boolean; actingUserId: string }) {
  const inventory = demoInventory(db);
  const removed: Record<string, number> = {};
  db.transaction(() => {
    for (const [c, ids] of Object.entries(inventory) as [CollectionName, string[]][]) {
      for (const id of ids) if (db.deleteRow(c, id, opts.actingUserId)) removed[c] = (removed[c] || 0) + 1;
    }
    if (opts.includeUsers) {
      for (const u of demoUsersPresent(db, opts.actingUserId)) {
        db.deleteCredentials(u.id);
        db.deleteUserSessions(u.id);
        db.deleteUserPushSubscriptions(u.id);
        db.deleteRow('notificationPrefs', u.id, opts.actingUserId);
        if (db.deleteRow('users', u.id, opts.actingUserId)) removed.users = (removed.users || 0) + 1;
      }
    }
    db.setMeta('demo_removed', '1');
  });
  return removed;
}
