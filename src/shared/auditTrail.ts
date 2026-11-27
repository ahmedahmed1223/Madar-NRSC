/**
 * The administrative audit trail: what the server records when accounts, roles, settings and
 * stations change, written as readable Arabic «before ← after» text, and the Arabic names of every
 * audit action (shown in «سجل التدقيق», its filters and the CSV export).
 *
 * Only the server writes audit entries; clients cannot create them (see the auditLogs policy).
 */
import { ALL_PERMISSIONS, findUserRole, type RoleDefinition } from './rbac';
import { screenLabel } from './screens';
import { stationsOf, type Station } from './stations';
import { departmentName, departmentsOf, type Department } from './departments';
import { stepTypesOf } from './productionCards';

/** Arabic names of every audit action type the server writes (older rows' types included). */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  CREATE: 'إنشاء', UPDATE: 'تعديل', DELETE: 'حذف', RESTORE: 'استعادة', PUBLISH: 'نشر', UNPUBLISH: 'إلغاء نشر',
  STATUS_CHANGE: 'تغيير حالة', LOGIN: 'تسجيل دخول', LOGOUT: 'تسجيل خروج', LOGIN_FAILED: 'محاولة دخول فاشلة',
  SETTINGS_UPDATE: 'تعديل إعدادات', SECURITY_VIOLATION: 'محاولة غير مصرح بها', PASSWORD_CHANGE: 'تغيير كلمة المرور',
  PASSWORD_RESET: 'إصدار كلمة مرور مؤقتة',
  '2FA_ENABLED': 'تفعيل التحقق بخطوتين', '2FA_DISABLED': 'إلغاء التحقق بخطوتين', '2FA_RESET': 'إلغاء التحقق بخطوتين من الإدارة',
  TWO_FACTOR_ENABLED: 'تفعيل التحقق بخطوتين', TWO_FACTOR_DISABLED: 'إلغاء التحقق بخطوتين',
  SESSIONS_REVOKED: 'إنهاء الجلسات',
  DB_BACKUP: 'نسخة احتياطية', BACKUP_CREATE: 'نسخة احتياطية', DB_BACKUP_DOWNLOAD: 'تنزيل نسخة احتياطية', DB_BACKUP_FAILED: 'فشل النسخ الاحتياطي',
  DB_EXPORT: 'تنزيل قاعدة البيانات', DB_RESET: 'إعادة تهيئة البيانات', DB_RESET_FAILED: 'فشل إعادة التهيئة',
  DB_RESTORE: 'استعادة نسخة احتياطية', DB_RESTORE_FAILED: 'فشل استعادة نسخة', DB_CONFIRM_FAILED: 'فشل تأكيد الهوية',
  DEMO_DATA_REMOVED: 'حذف البيانات التجريبية', NEWS_REACTIVATE: 'إعادة خبر من الأرشيف',
  USER_CREATE: 'إضافة مستخدم', USER_UPDATE: 'تعديل بيانات مستخدم', USER_DELETE: 'حذف مستخدم',
  USER_SUSPEND: 'تجميد حساب', USER_ACTIVATE: 'إعادة تنشيط حساب',
  ROLE_CHANGE: 'تغيير دور مستخدم', PERMISSION_OVERRIDE: 'استثناءات الصلاحيات',
  USER_STATION_CHANGE: 'نقل مستخدم بين المحطات', USER_DEPARTMENT_CHANGE: 'نقل مستخدم بين الأقسام', MANAGED_SCOPE_CHANGE: 'محطات المدير العام',
  ROLE_CREATE: 'إنشاء دور', ROLE_UPDATE: 'تعديل دور', ROLE_DELETE: 'حذف دور', PERMISSIONS_UPDATED: 'تعديل الصلاحيات',
  STATION_CHANGE: 'تعديل المحطات', STATION_REMOVE: 'حذف محطة', DEPARTMENT_CHANGE: 'تعديل الأقسام الإدارية',
  BROADCAST_LOCK: 'تفعيل قفل البث', BROADCAST_UNLOCK: 'رفع قفل البث',
  STORAGE_UPDATE: 'تعديل التخزين',
};
export const auditActionName = (action: string) => AUDIT_ACTION_LABELS[action] || action;

export interface AuditEntryDraft {
  actionType: string;
  targetEntity: string;
  targetId: string;
  severity: 'INFO' | 'WARNING' | 'SECURITY';
  details: string;
}

const list = (items: string[]) => items.join('، ');
const q = (v: unknown) => `«${v === undefined || v === null || v === '' ? '—' : String(v)}»`;
const permName = (code: string) => ALL_PERMISSIONS.find((p) => p.code === code)?.nameAr || code;
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function roleLabel(user: any, roles: RoleDefinition[]) {
  if (!user) return '—';
  return findUserRole(user, roles)?.nameAr || user.role || '—';
}

function stationLabel(stations: Station[], id?: string | null) {
  if (!id) return 'بدون محطة (إدارة مركزية)';
  return stations.find((s) => s.id === id)?.name || 'محطة محذوفة';
}

/** «منح: …؛ منع: …؛ أُلغي: …» for per-user permission exceptions. */
export function overridesDiff(before: string[] = [], after: string[] = []): string {
  const added = after.filter((p) => !before.includes(p));
  const removed = before.filter((p) => !after.includes(p));
  const parts: string[] = [];
  const grants = added.filter((p) => !p.startsWith('!'));
  const denies = added.filter((p) => p.startsWith('!')).map((p) => p.slice(1));
  if (grants.length) parts.push(`منح: ${list(grants.map(permName))}`);
  if (denies.length) parts.push(`منع: ${list(denies.map(permName))}`);
  if (removed.length) parts.push(`أُلغي الاستثناء: ${list(removed.map((p) => permName(p.replace(/^!/, ''))))}`);
  return parts.join('؛ ') || 'بلا تغيير';
}

/** Audit entries for a change to a user account (create, delete, role, exceptions, suspension, station, department, profile). */
export function userAuditEntries(before: any, after: any, ctx: { roles: RoleDefinition[]; stations: Station[]; groups?: { id: string; name: string }[] }): AuditEntryDraft[] {
  const target = after ?? before;
  const name = target?.fullName || target?.email || target?.id;
  const base = { targetEntity: 'USER', targetId: String(target?.id || '') };
  const out: AuditEntryDraft[] = [];
  if (!before && after) {
    const privileged = ['SUPER_ADMIN', 'ADMIN'].includes(after.role) || !!after.customRoleId || (after.customPermissions?.length ?? 0) > 0;
    out.push({ ...base, actionType: 'USER_CREATE', severity: privileged ? 'SECURITY' : 'INFO',
      details: `إضافة مستخدم: ${name} — الدور: ${roleLabel(after, ctx.roles)}، المحطة: ${stationLabel(ctx.stations, after.stationId)}، القسم: ${departmentName(after.departmentId)}${after.customPermissions?.length ? `، استثناءات: ${overridesDiff([], after.customPermissions)}` : ''}` });
    return out;
  }
  if (before && (!after || (after.deletedAt && !before.deletedAt))) {
    out.push({ ...base, actionType: 'USER_DELETE', severity: 'WARNING', details: `حذف حساب المستخدم: ${name} (${roleLabel(before, ctx.roles)})` });
    return out;
  }
  if (!before || !after) return out;
  if (!same(before.role, after.role) || !same(before.customRoleId, after.customRoleId)) {
    out.push({ ...base, actionType: 'ROLE_CHANGE', severity: 'SECURITY', details: `تغيير دور ${name}: ${q(roleLabel(before, ctx.roles))} ← ${q(roleLabel(after, ctx.roles))}` });
  }
  if (!same(before.customPermissions || [], after.customPermissions || [])) {
    out.push({ ...base, actionType: 'PERMISSION_OVERRIDE', severity: 'SECURITY', details: `استثناءات صلاحيات ${name}: ${overridesDiff(before.customPermissions, after.customPermissions)}` });
  }
  if ((before.isActive !== false) !== (after.isActive !== false)) {
    out.push(after.isActive === false
      ? { ...base, actionType: 'USER_SUSPEND', severity: 'SECURITY', details: `تجميد حساب ${name} (أُنهيت جلساته)` }
      : { ...base, actionType: 'USER_ACTIVATE', severity: 'SECURITY', details: `إعادة تنشيط حساب ${name}` });
  }
  if (!same(before.stationId || null, after.stationId || null)) {
    out.push({ ...base, actionType: 'USER_STATION_CHANGE', severity: 'INFO', details: `نقل ${name}: ${q(stationLabel(ctx.stations, before.stationId))} ← ${q(stationLabel(ctx.stations, after.stationId))}` });
  }
  if (!same(before.departmentId || null, after.departmentId || null)) {
    out.push({ ...base, actionType: 'USER_DEPARTMENT_CHANGE', severity: 'INFO', details: `نقل ${name} بين الأقسام: ${q(departmentName(before.departmentId))} ← ${q(departmentName(after.departmentId))}` });
  }
  if (!same(before.managedStationIds || [], after.managedStationIds || []) || !same(before.managedGroupIds || [], after.managedGroupIds || [])) {
    const describe = (u: any) => [
      ...(u.managedStationIds || []).map((id: string) => stationLabel(ctx.stations, id)),
      ...(u.managedGroupIds || []).map((id: string) => `مجموعة ${ctx.groups?.find((g) => g.id === id)?.name || id}`),
    ];
    out.push({ ...base, actionType: 'MANAGED_SCOPE_CHANGE', severity: 'SECURITY', details: `ما يتابعه ${name}: ${q(list(describe(before)) || 'محطته فقط')} ← ${q(list(describe(after)) || 'محطته فقط')}` });
  }
  const PROFILE: Record<string, string> = { fullName: 'الاسم', fullNameEn: 'الاسم بالإنجليزية', email: 'البريد الإلكتروني', phone: 'الهاتف', jobTitle: 'المسمى الوظيفي', staffId: 'الرقم الوظيفي', bio: 'النبذة', avatarUrl: 'الصورة' };
  const profile = Object.keys(PROFILE).filter((k) => !same(before[k], after[k]));
  if (profile.length) {
    const detail = profile.map((k) => (k === 'email' || k === 'fullName' || k === 'jobTitle' ? `${PROFILE[k]} (${q(before[k])} ← ${q(after[k])})` : PROFILE[k]));
    out.push({ ...base, actionType: 'USER_UPDATE', severity: profile.includes('email') ? 'SECURITY' : 'INFO', details: `تعديل بيانات ${name}: ${list(detail)}` });
  }
  return out;
}

/** Audit entries for a change to a role definition: what was granted or withdrawn, and which screens. */
export function roleAuditEntries(before: RoleDefinition | null, after: RoleDefinition | null): AuditEntryDraft[] {
  const role = after ?? before;
  if (!role) return [];
  const base = { targetEntity: 'ROLE', targetId: role.id };
  const label = `${role.nameAr} (${role.roleCode})`;
  if (!before && after) {
    return [{ ...base, actionType: 'ROLE_CREATE', severity: 'SECURITY', details: `إنشاء دور ${label} بـ ${after.permissions?.length || 0} صلاحية${Array.isArray(after.screens) ? `، الصفحات: ${list(after.screens.map(screenLabel))}` : '، كل الصفحات التي تسمح بها صلاحياته'}` }];
  }
  if (before && !after) return [{ ...base, actionType: 'ROLE_DELETE', severity: 'SECURITY', details: `حذف دور ${label}` }];
  const parts: string[] = [];
  if (before!.roleCode !== after!.roleCode) parts.push(`الرمز ${q(before!.roleCode)} ← ${q(after!.roleCode)}`);
  if (before!.nameAr !== after!.nameAr) parts.push(`الاسم ${q(before!.nameAr)} ← ${q(after!.nameAr)}`);
  const bp = before!.permissions || [];
  const ap = after!.permissions || [];
  const granted = ap.filter((p) => !bp.includes(p));
  const withdrawn = bp.filter((p) => !ap.includes(p));
  if (granted.length) parts.push(`أُضيفت: ${list(granted.map(permName))}`);
  if (withdrawn.length) parts.push(`سُحبت: ${list(withdrawn.map(permName))}`);
  if (!same(before!.screens, after!.screens)) {
    const bs = Array.isArray(before!.screens) ? before!.screens : null;
    const as = Array.isArray(after!.screens) ? after!.screens : null;
    if (!bs || !as) parts.push(`الصفحات: ${as ? list(as.map(screenLabel)) : 'كل ما تسمح به الصلاحيات'}`);
    else {
      const opened = as.filter((s) => !bs.includes(s));
      const closed = bs.filter((s) => !as.includes(s));
      if (opened.length) parts.push(`صفحات أُضيفت: ${list(opened.map(screenLabel))}`);
      if (closed.length) parts.push(`صفحات حُجبت: ${list(closed.map(screenLabel))}`);
    }
  }
  if (!parts.length) return [];
  return [{ ...base, actionType: 'ROLE_UPDATE', severity: 'SECURITY', details: `تعديل دور ${label}: ${parts.join('؛ ')}` }];
}

const SETTING_LABELS: Record<string, string> = {
  organizationName: 'اسم المؤسسة', organizationNameEn: 'الاسم بالإنجليزية', primaryChannelName: 'القناة الرئيسية', defaultTimezone: 'المنطقة الزمنية',
  dateTime: 'التاريخ والوقت', defaultSegmentDurationSeconds: 'مدة الفقرة الافتراضية', defaultNewsPriority: 'أولوية الخبر الافتراضية',
  breakingDurationHours: 'مدة العاجل', newsTemplates: 'قوالب الأخبار', cardStepTypes: 'أنواع مهام البطاقات', setup: 'الإعداد السريع',
  storage: 'التخزين', onAirDisplayMode: 'عرض الهواء', studioDisplayMode: 'عرض الاستديو', allowOfflineScriptEdits: 'التعديل المحلي على الهواء',
  moduleAccess: 'إتاحة الوحدات', colorPalette: 'ألوان الواجهة',
  logoUrl: 'الشعار', allowGuestProposals: 'مقترحات الضيوف', autoSaveIntervalSeconds: 'الحفظ التلقائي', defaultLanguage: 'اللغة',
};
const SCALAR = new Set(['organizationName', 'organizationNameEn', 'primaryChannelName', 'defaultTimezone', 'defaultSegmentDurationSeconds', 'defaultNewsPriority', 'breakingDurationHours', 'onAirDisplayMode', 'studioDisplayMode']);
/** Sections described elsewhere (stations, departments) or not worth an entry. */
const NOT_SETTINGS = new Set(['stations', 'stationsArchive', 'stationGroups', 'departments', 'id', 'updatedAt']);

/** A readable account of what changed in the shared settings (never raw JSON). */
export function settingsAuditEntries(before: any, after: any): AuditEntryDraft[] {
  const out: AuditEntryDraft[] = [];
  const keys = [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])].filter((k) => !NOT_SETTINGS.has(k) && !same(before?.[k], after?.[k]));
  if (keys.length) {
    const parts = keys.map((k) => {
      const label = SETTING_LABELS[k] || k;
      if (SCALAR.has(k)) return `${label}: ${q(before?.[k])} ← ${q(after?.[k])}`;
      if (k === 'newsTemplates') return `${label}: ${(before?.[k] || []).length} ← ${(after?.[k] || []).length} قالباً`;
      if (k === 'cardStepTypes') {
        const b = stepTypesOf(before);
        const a = stepTypesOf(after);
        const added = a.filter((t) => !b.some((x) => x.id === t.id)).map((t) => t.name);
        const removed = b.filter((t) => !a.some((x) => x.id === t.id)).map((t) => t.name);
        const changed = a.filter((t) => b.some((x) => x.id === t.id && (x.name !== t.name || x.weight !== t.weight))).map((t) => {
          const x = b.find((y) => y.id === t.id)!;
          return x.name !== t.name ? `${x.name} ← ${t.name}` : `${t.name}: الوزن ${x.weight} ← ${t.weight}`;
        });
        return `${label} (${[added.length ? `أُضيف: ${list(added)}` : '', removed.length ? `حُذف: ${list(removed)}` : '', changed.length ? `عُدّل: ${list(changed)}` : ''].filter(Boolean).join('؛ ') || 'إعادة ترتيب'})`;
      }
      return label;
    });
    out.push({ actionType: 'SETTINGS_UPDATE', targetEntity: 'SETTINGS', targetId: 'singleton', severity: keys.includes('storage') || keys.includes('moduleAccess') ? 'SECURITY' : 'INFO', details: `تعديل الإعدادات: ${parts.join('؛ ')}` });
  }
  const stations = stationsAuditText(before, after);
  if (stations) out.push({ actionType: 'STATION_CHANGE', targetEntity: 'STATION', targetId: 'stations', severity: 'WARNING', details: stations });
  const departments = departmentsAuditText(before, after);
  if (departments) out.push({ actionType: 'DEPARTMENT_CHANGE', targetEntity: 'DEPARTMENT', targetId: 'departments', severity: 'INFO', details: departments });
  return out;
}

function stationsAuditText(before: any, after: any): string | null {
  if (same(before?.stations, after?.stations) && same(before?.stationGroups, after?.stationGroups)) return null;
  const b: Station[] = stationsOf(before);
  const a: Station[] = stationsOf(after);
  const parts: string[] = [];
  const added = a.filter((s) => !b.some((x) => x.id === s.id)).map((s) => s.name);
  const removed = b.filter((s) => !a.some((x) => x.id === s.id)).map((s) => s.name);
  const renamed = a.filter((s) => b.some((x) => x.id === s.id && x.name !== s.name)).map((s) => `${b.find((x) => x.id === s.id)!.name} ← ${s.name}`);
  if (added.length) parts.push(`أُضيفت: ${list(added)}`);
  if (removed.length) parts.push(`حُذفت: ${list(removed)}`);
  if (renamed.length) parts.push(`أُعيدت تسمية: ${list(renamed)}`);
  const mainBefore = b.find((s) => s.isMain)?.name;
  const mainAfter = a.find((s) => s.isMain)?.name;
  if (mainBefore !== mainAfter) parts.push(`المحطة الرئيسية: ${q(mainBefore || 'لا توجد')} ← ${q(mainAfter || 'لا توجد')}`);
  const links = a.filter((s) => { const x = b.find((y) => y.id === s.id); return x && !same(x.linkedIds, s.linkedIds); }).map((s) => s.name);
  if (links.length) parts.push(`تغيّر ارتباط: ${list(links)}`);
  if (!same(before?.stationGroups, after?.stationGroups)) {
    const groups = (after?.stationGroups || []).map((g: any) => `${g.name} (${list((g.stationIds || []).map((id: string) => stationLabel(a, id)))})`);
    parts.push(`مجموعات المحطات: ${groups.length ? list(groups) : 'لا توجد'}`);
  }
  return parts.length ? `تعديل المحطات: ${parts.join('؛ ')}` : null;
}

function departmentsAuditText(before: any, after: any): string | null {
  if (same(before?.departments, after?.departments)) return null;
  const b: Department[] = departmentsOf(before);
  const a: Department[] = departmentsOf(after);
  const name = (l: Department[], id?: string) => l.find((d) => d.id === id)?.name || '—';
  const parts: string[] = [];
  const added = a.filter((d) => !b.some((x) => x.id === d.id)).map((d) => d.name);
  const removed = b.filter((d) => !a.some((x) => x.id === d.id)).map((d) => d.name);
  if (added.length) parts.push(`أُضيف: ${list(added)}`);
  if (removed.length) parts.push(`حُذف: ${list(removed)}`);
  for (const d of a) {
    const x = b.find((y) => y.id === d.id);
    if (!x) continue;
    if (x.name !== d.name) parts.push(`إعادة تسمية ${q(x.name)} ← ${q(d.name)}`);
    if (!!x.archived !== !!d.archived) parts.push(`${d.archived ? 'أرشفة' : 'إعادة تفعيل'} ${q(d.name)}`);
    if ((x.parentId || '') !== (d.parentId || '')) parts.push(`${q(d.name)} تحت ${q(d.parentId ? name(a, d.parentId) : 'لا شيء')}`);
    if ((x.headUserId || '') !== (d.headUserId || '')) parts.push(`رئيس ${q(d.name)} تغيّر`);
    if (!same(x.stationIds || [], d.stationIds || [])) parts.push(`محطات ${q(d.name)} تغيّرت`);
  }
  return parts.length ? `تعديل الأقسام الإدارية: ${parts.join('؛ ')}` : null;
}

/** Older SETTINGS_UPDATE rows stored raw JSON; they are shown as the list of changed sections. */
export function readableAuditDetails(details: string): string {
  const text = String(details || '');
  if (!text.startsWith('[{') || !text.includes('"field"')) return text;
  try {
    const rows = JSON.parse(text) as { field: string }[];
    return `تعديل الإعدادات: ${list(rows.map((r) => SETTING_LABELS[r.field] || (r.field === 'stations' ? 'المحطات' : r.field)))}`;
  } catch {
    return text;
  }
}
