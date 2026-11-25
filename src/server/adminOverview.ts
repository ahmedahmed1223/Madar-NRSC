import fs from 'fs';
import type { AppConfig } from './config';
import type { NewsroomDatabase } from './db';
import { jobRuns } from './jobs';
import { cardState, isCardLate } from '../shared/productionCards';
import { evaluatePermission, type RoleDefinition } from '../shared/rbac';
import { departmentsOf } from '../shared/departments';
import { stationsOf } from '../shared/stations';
import type { AdminOverview } from '../shared/adminOverview';
import { deploymentWarnings } from './deploymentChecks';

/** Permissions whose holders should protect their account with two-step verification. */
const PRIVILEGED = ['system.settings', 'system.database_manage', 'users.manage_roles_permissions', 'users.suspend_delete'];
const LOW_DISK_BYTES = 2 * 1024 ** 3;

/** One read-only report for the administrator: who is signed in, storage, people, content and background jobs. */
export function adminOverview(db: NewsroomDatabase, config: AppConfig, now = Date.now()): AdminOverview {
  const users = db.listCollection('users').map((r) => r.d).filter((u) => u && !u.deletedAt);
  const names = new Map<string, string>(users.map((u) => [u.id, u.fullName]));
  const roles = db.listCollection('roles').map((r) => r.d) as RoleDefinition[];
  const stations = stationsOf(db.getRow('settings', 'singleton')?.d);

  const byUser = new Map<string, AdminOverview['sessions']['list'][number]>();
  const sessions = db.listSessions(new Date(now).toISOString());
  for (const s of sessions) {
    const row = byUser.get(s.userId);
    if (!row) byUser.set(s.userId, { userId: s.userId, name: names.get(s.userId) || 'حساب محذوف', devices: 1, lastSeenAt: s.lastSeenAt, ip: s.ip, agent: s.userAgent });
    else {
      row.devices += 1;
      if (s.lastSeenAt > row.lastSeenAt) Object.assign(row, { lastSeenAt: s.lastSeenAt, ip: s.ip, agent: s.userAgent });
    }
  }
  const list = [...byUser.values()].sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
  const recently = new Date(now - 5 * 60_000).toISOString();

  const uploads = db.uploadsSummary();
  const unused = db.findOrphanUploads(0);
  let disk: AdminOverview['storage']['disk'];
  try {
    const stat = fs.statfsSync(config.dataDir);
    disk = { freeBytes: Number(stat.bavail) * Number(stat.bsize), totalBytes: Number(stat.blocks) * Number(stat.bsize) };
  } catch {
    // Not reported on this platform.
  }

  const active = users.filter((u) => u.isActive !== false);
  const credentials = new Map(active.map((u) => [u.id, db.getCredentials(u.id)]));
  const privilegedWithout2fa = active
    .filter((u) => PRIVILEGED.some((p) => evaluatePermission(u, p, roles, departmentsOf(db.getRow('settings', 'singleton')?.d))) && !credentials.get(u.id)?.totpEnabled)
    .map((u) => ({ id: u.id, name: u.fullName }));

  const cards = db.listCollection('productionCards').map((r) => r.d).filter((c) => c && !c.deletedAt && c.status === 'OPEN');
  const states = cards.map((c) => cardState(c, now));
  const messages = db.messageSummary();
  const notificationsWaiting = db.listCollection('notifications').filter((r) => r.d && !r.d.isRead).length;

  const jobs = jobRuns();
  const alerts: AdminOverview['alerts'] = deploymentWarnings(db, config).map(({ level, text }) => ({ level, text }));
  if (!db.isHealthy()) alerts.push({ level: 'error', text: 'فحص قاعدة البيانات لم ينجح؛ راجع «قاعدة البيانات» وأنشئ نسخة احتياطية.' });
  jobs.filter((j) => j.ok === false).forEach((j) => alerts.push({ level: 'error', text: `المهمة الدورية «${j.name}» فشلت في آخر تشغيل.` }));
  if (disk && disk.freeBytes < LOW_DISK_BYTES) alerts.push({ level: 'error', text: 'المساحة الحرة على قرص البيانات أقل من 2 غ.ب.' });
  if (config.backupIntervalHours <= 0) alerts.push({ level: 'warning', text: 'النسخ الاحتياطي الدوري معطل (BACKUP_INTERVAL_HOURS).' });
  if (privilegedWithout2fa.length) alerts.push({ level: 'warning', text: `${privilegedWithout2fa.length} من أصحاب الصلاحيات الإدارية بلا تحقق بخطوتين.` });
  const noStation = active.filter((u) => !stations.some((s) => s.id === u.stationId)).length;
  if (stations.length && noStation > active.length / 2) alerts.push({ level: 'warning', text: `${noStation} من الزملاء بلا محطة؛ لن تُنسب أعمالهم لمحطة في «الأعباء والأداء».` });

  return {
    generatedAt: new Date(now).toISOString(),
    sessions: { users: list.length, devices: sessions.length, activeNow: list.filter((s) => s.lastSeenAt >= recently).length, list },
    storage: { databaseBytes: db.stats().fileSizeBytes, uploads, unused: { files: unused.length, bytes: unused.reduce((sum, u) => sum + u.sizeBytes, 0) }, disk },
    people: {
      active: active.length,
      suspended: users.length - active.length,
      withoutStation: noStation,
      locked: active.filter((u) => (credentials.get(u.id)?.lockedUntil || '') > new Date(now).toISOString()).length,
      mustChangePassword: active.filter((u) => credentials.get(u.id)?.mustChangePassword).length,
      privilegedWithout2fa,
    },
    content: {
      stations: stations.length,
      openCards: cards.length,
      blockedCards: states.filter((s) => s === 'BLOCKED').length,
      // A blocked card past its deadline is late too.
      lateCards: cards.filter((c) => isCardLate(c, now)).length,
      messages: messages.count,
      oldestMessageAt: messages.oldestAt,
      groups: db.listCollection('conversations').filter((r) => r.d && !r.d.deletedAt).length,
      notificationsWaiting,
    },
    jobs,
    alerts,
  };
}
