import { afterEach, describe, expect, it } from 'vitest';
import { archiveRemovedStations, managedScopeError, rememberStationSettings, stationGroupsError, stationName, stationScope, type Station } from '../../src/shared/stations';
import { applyDepartments, DEFAULT_DEPARTMENTS, DEPARTMENTS, departmentHead, departmentName, departmentsAtStation, departmentsError, isDepartmentId, removedDepartmentsInUse } from '../../src/shared/departments';
import { temporaryPassword, validatePasswordStrength, webRandom } from '../../src/shared/passwords';
import { auditActionName, overridesDiff, readableAuditDetails, roleAuditEntries, settingsAuditEntries, userAuditEntries } from '../../src/shared/auditTrail';
import { settingsError } from '../../src/shared/settings';
import { DEFAULT_ROLE_DEFINITIONS } from '../../src/shared/rbac';
import { sectionOrderFor } from '../../src/shared/navigation';

const ids = (set: Set<string>) => [...set].sort();
const stations: Station[] = [
  { id: 'hq', name: 'الرئيسية', isMain: true },
  { id: 'a', name: 'أ', linkedIds: [] },
  { id: 'b', name: 'ب', linkedIds: ['c'] },
  { id: 'c', name: 'ج', linkedIds: [] },
  { id: 'd', name: 'د', linkedIds: [] },
];

afterEach(() => {
  applyDepartments(DEFAULT_DEPARTMENTS.map((d) => ({ ...d })));
  rememberStationSettings(null);
});

describe('station scope', () => {
  it('gives central management everything and a removed station nothing', () => {
    expect(ids(stationScope(stations, undefined))).toEqual(['a', 'b', 'c', 'd', 'hq']);
    expect(ids(stationScope(stations, { stationId: '' }))).toEqual(['a', 'b', 'c', 'd', 'hq']);
    expect(ids(stationScope(stations, 'gone'))).toEqual([]);
    expect(ids(stationScope(stations, { stationId: 'gone' }))).toEqual([]);
  });

  it('scopes a general manager to the stations and groups given to them, plus the main station', () => {
    const groups = [{ id: 'south', name: 'الجنوب', stationIds: ['b', 'd'] }];
    expect(ids(stationScope(stations, { managedStationIds: ['a'] }, groups))).toEqual(['a', 'hq']);
    expect(ids(stationScope(stations, { managedGroupIds: ['south'] }, groups))).toEqual(['b', 'd', 'hq']);
    expect(ids(stationScope(stations, { stationId: 'a', managedGroupIds: ['south'] }, groups))).toEqual(['a', 'b', 'd', 'hq']);
    // Nothing given: their own station, as for anyone else.
    expect(ids(stationScope(stations, { stationId: 'a', managedStationIds: [] }, groups))).toEqual(['a', 'hq']);
    // Groups remembered from the settings are used when none are passed.
    rememberStationSettings({ stationGroups: groups });
    expect(ids(stationScope(stations, { managedGroupIds: ['south'] }))).toEqual(['b', 'd', 'hq']);
  });

  it('validates groups and what a general manager follows', () => {
    expect(stationGroupsError([{ id: 'g', name: 'الشمال', stationIds: ['a', 'b'] }], stations)).toBeNull();
    expect(stationGroupsError([{ id: 'g', name: 'الشمال', stationIds: ['x'] }], stations)).toContain('غير موجودة');
    expect(stationGroupsError([{ id: 'g', name: '' , stationIds: [] }], stations)).toContain('اسم');
    expect(stationGroupsError([{ id: 'g', name: 'أ', stationIds: [] }, { id: 'h', name: ' أ ', stationIds: [] }], stations)).toContain('مكرر');
    expect(managedScopeError({ managedStationIds: ['a'] }, stations, [])).toBeNull();
    expect(managedScopeError({ managedStationIds: ['x'] }, stations, [])).not.toBeNull();
    expect(managedScopeError({ managedGroupIds: ['g'] }, stations, [])).not.toBeNull();
    const base = { organizationName: 'مدار', defaultTimezone: 'Asia/Gaza', enableAuditLog: true } as any;
    expect(settingsError({ ...base, stations, stationGroups: [{ id: 'g', name: 'م', stationIds: ['zz'] }] })).toContain('غير موجودة');
  });

  it('keeps a removed station’s name for history', () => {
    const archive = archiveRemovedStations(stations, stations.filter((s) => s.id !== 'd'), [], '2026-11-19T00:00:00Z');
    expect(archive).toEqual([{ id: 'd', name: 'د', removedAt: '2026-11-19T00:00:00Z' }]);
    expect(stationName(stations.slice(0, 4), 'd', archive)).toContain('د');
    expect(stationName(stations.slice(0, 4), 'zz', archive)).toBe('بدون محطة');
    // Re-adding the same id takes it out of the archive.
    expect(archiveRemovedStations(stations.slice(0, 4), stations, archive)).toEqual([]);
  });
});

describe('administrative departments', () => {
  it('follows the settings list (rename, add, archive) while ids stay stable', () => {
    applyDepartments([{ id: 'newsroom', name: 'غرفة الأخبار' }, { id: 'social', name: 'السوشيال ميديا', stationIds: ['a'] }, { id: 'montage', name: 'المونتاج', archived: true }]);
    expect(departmentName('newsroom')).toBe('غرفة الأخبار');
    expect(DEPARTMENTS.map((d) => d.id)).toEqual(['newsroom', 'social']);
    expect(isDepartmentId('montage')).toBe(true); // archived, still known for history
    expect(departmentName('montage')).toContain('مؤرشف');
    expect(departmentsAtStation('b').map((d) => d.id)).toEqual(['newsroom']);
    expect(departmentsAtStation('a').map((d) => d.id)).toEqual(['newsroom', 'social']);
  });

  it('finds the head up the parents', () => {
    const list = [{ id: 'production', name: 'الإنتاج', headUserId: 'u1' }, { id: 'montage', name: 'المونتاج', parentId: 'production' }, { id: 'gfx', name: 'جرافيكس', parentId: 'montage', headUserId: 'u2' }];
    expect(departmentHead('montage', list)).toBe('u1');
    expect(departmentHead('gfx', list)).toBe('u2');
    expect(departmentHead('none', list)).toBeUndefined();
  });

  it('rejects malformed lists, unknown parents, cycles, unknown stations and heads', () => {
    expect(departmentsError(DEFAULT_DEPARTMENTS as any)).toBeNull();
    expect(departmentsError([])).not.toBeNull();
    expect(departmentsError([{ id: 'a', name: 'أ' }, { id: 'b', name: ' أ ' }])).toContain('مكرر');
    expect(departmentsError([{ id: 'a b', name: 'أ' }])).toContain('معرّف');
    expect(departmentsError([{ id: 'a', name: 'أ', parentId: 'zz' }])).toContain('غير موجود');
    expect(departmentsError([{ id: 'a', name: 'أ', parentId: 'b' }, { id: 'b', name: 'ب', parentId: 'a' }])).toContain('دائري');
    expect(departmentsError([{ id: 'a', name: 'أ', stationIds: ['x'] }], { stationIds: ['y'] })).toContain('محطات');
    expect(departmentsError([{ id: 'a', name: 'أ', headUserId: 'u9' }], { userIds: ['u1'] })).toContain('رئيس');
    expect(departmentsError([{ id: 'a', name: 'أ', archived: true }])).toContain('نشط');
    expect(removedDepartmentsInUse([{ id: 'a', name: 'أ' }, { id: 'b', name: 'ب' }], [{ id: 'a', name: 'أ' }], (id) => (id === 'b' ? 3 : 0))).toEqual([{ id: 'b', name: 'ب', uses: 3 }]);
  });
});

describe('passwords', () => {
  it('generates temporary passwords that pass the rule and have no look-alike characters', () => {
    for (let i = 0; i < 50; i++) {
      const p = temporaryPassword(webRandom);
      expect(validatePasswordStrength(p)).toBeNull();
      expect(p).not.toMatch(/[Il1O0o]/);
    }
    expect(validatePasswordStrength('abcdefghij')).toContain('حروف وأرقام');
  });
});

describe('audit trail texts', () => {
  const roles = DEFAULT_ROLE_DEFINITIONS;
  it('translates every action the server writes', () => {
    for (const code of ['2FA_ENABLED', '2FA_RESET', 'DB_BACKUP', 'SESSIONS_REVOKED', 'DB_CONFIRM_FAILED', 'DB_RESTORE_FAILED', 'ROLE_UPDATE', 'STATION_REMOVE', 'DB_BACKUP_DOWNLOAD']) {
      expect(auditActionName(code)).toMatch(/[؀-ۿ]/);
    }
  });

  it('reads like a sentence: before ← after', () => {
    const before = { id: 'u', fullName: 'سلمى', role: 'JOURNALIST', isActive: true, customPermissions: [] };
    const entries = userAuditEntries(before, { ...before, role: 'EDITOR', isActive: false }, { roles, stations: [] });
    expect(entries.map((e) => e.actionType)).toEqual(['ROLE_CHANGE', 'USER_SUSPEND']);
    expect(entries[0].details).toContain('←');
    expect(overridesDiff([], ['news.create', '!news.publish'])).toMatch(/منح: .+؛ منع: .+/);
    const role = roles[2];
    expect(roleAuditEntries(role, { ...role, permissions: role.permissions.slice(1) })[0].details).toContain('سُحبت');
    const settings = settingsAuditEntries({ organizationName: 'أ', stations: [{ id: 'a', name: 'أ' }] }, { organizationName: 'ب', stations: [{ id: 'a', name: 'أ' }, { id: 'b', name: 'ب' }] });
    expect(settings.map((e) => e.actionType)).toEqual(['SETTINGS_UPDATE', 'STATION_CHANGE']);
    expect(settings[1].details).toContain('أُضيفت: ب');
    expect(readableAuditDetails('[{"field":"stations","before":[],"after":[]}]')).toBe('تعديل الإعدادات: المحطات');
  });
});

describe('general manager role', () => {
  it('is a manager-level system role without the all-stations workload view', () => {
    const gm = DEFAULT_ROLE_DEFINITIONS.find((r) => r.roleCode === 'GENERAL_MANAGER')!;
    expect(gm.isSystemRole).toBe(true);
    expect(gm.permissions).toEqual(expect.arrayContaining(['cards.manage', 'workload.view', 'bulletins.approve', 'reports.export']));
    expect(gm.permissions).not.toContain('workload.view_all');
    // The rail puts administration right after «عملي», as for other managers.
    expect(sectionOrderFor({ role: 'GENERAL_MANAGER' } as any).slice(0, 2)).toEqual(['work', 'admin']);
  });
});
