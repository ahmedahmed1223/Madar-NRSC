import { describe, expect, it } from 'vitest';
import { isMyTask, relatedTaskPath, TASK_BOARD_COLUMNS, TASK_STATUS_OPTIONS } from '../../src/services/taskBoard';
import { roleHolders, roleInUseError } from '../../src/services/roleUsage';
import { normalizeOverrides, overrideStateOf, sameOverrides, setOverride } from '../../src/services/permissionOverrides';
import { computeEffectivePermissions, type RoleDefinition } from '../../src/shared/rbac';
import { csvCell, toCsv } from '../../src/services/csvExport';
import { filterLogRows, inDayRange, logUsers } from '../../src/services/logFilters';

describe('task board helpers', () => {
  it('offers every task status on the board and in the filter', () => {
    const board = TASK_BOARD_COLUMNS.map((c) => c.status);
    expect(board).toEqual(expect.arrayContaining(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED', 'COMPLETED', 'CANCELLED']));
    expect(TASK_STATUS_OPTIONS.map((o) => o.value)).toEqual(board);
    expect(TASK_BOARD_COLUMNS.find((c) => c.status === 'CANCELLED')?.collapsible).toBe(true);
  });

  it('recognises my tasks under either assignee field', () => {
    expect(isMyTask({ assigneeId: 'u1' }, 'u1')).toBe(true);
    expect(isMyTask({ assignedToId: 'u1' }, 'u1')).toBe(true);
    expect(isMyTask({ assigneeId: 'u2' }, 'u1')).toBe(false);
    expect(isMyTask({}, 'u1')).toBe(false);
  });

  it('links a task to the record it came from', () => {
    expect(relatedTaskPath({ relatedEntityType: 'BULLETIN', relatedEntityId: 'b1' })).toBe('/bulletins/b1');
    expect(relatedTaskPath({ relatedEntityType: 'NEWS', relatedEntityId: 'n1' })).toBe('/news/n1');
    expect(relatedTaskPath({ relatedEntityType: 'EPISODE', relatedEntityId: 'e1' })).toBe('/episodes/e1');
    expect(relatedTaskPath({ relatedEntityType: 'BULLETIN_STORY', relatedEntityId: 's1' }, (id) => (id === 's1' ? 'b9' : undefined))).toBe('/bulletins/b9');
    expect(relatedTaskPath({ relatedEntityType: 'BULLETIN_STORY', relatedEntityId: 'gone' }, () => undefined)).toBeNull();
    expect(relatedTaskPath({ relatedEntityType: 'GENERAL', relatedEntityId: 'x' })).toBeNull();
    expect(relatedTaskPath({ relatedEntityType: 'NEWS' })).toBeNull();
    expect(relatedTaskPath({ relatedEntityType: 'NEWS', relatedEntityId: 'a/b' })).toBe('/news/a%2Fb');
  });
});

describe('role usage', () => {
  const role = { id: 'role_custom', roleCode: 'DESK_LEAD', nameAr: 'رئيس الديسك' };
  const users = [
    { role: 'JOURNALIST', customRoleId: 'role_custom' },
    { role: 'DESK_LEAD' },
    { role: 'DESK_LEAD', deletedAt: '2026-01-01T00:00:00Z' },
    { role: 'EDITOR' },
  ] as any[];

  it('counts holders by custom role id or role code, ignoring deleted accounts', () => {
    expect(roleHolders(role, users)).toHaveLength(2);
    expect(roleInUseError(role, [])).toBeNull();
  });

  it('refuses with an Arabic message naming how many hold the role', () => {
    expect(roleInUseError(role, users)).toContain('مستخدمان');
    expect(roleInUseError(role, users.slice(0, 1))).toContain('مستخدم واحد');
    const many = Array.from({ length: 5 }, () => ({ role: 'DESK_LEAD' })) as any[];
    expect(roleInUseError(role, many)).toContain('5 مستخدمين');
    expect(roleInUseError(role, many)).toContain('رئيس الديسك');
  });
});

describe('per-user permission overrides', () => {
  it('reads and writes the three states', () => {
    expect(overrideStateOf(undefined, 'news.publish')).toBe('role');
    expect(overrideStateOf(['news.publish'], 'news.publish')).toBe('grant');
    expect(overrideStateOf(['!news.publish'], 'news.publish')).toBe('deny');
    expect(overrideStateOf(['news.publish', '!news.publish'], 'news.publish')).toBe('deny');

    let list = setOverride([], 'news.publish', 'grant');
    expect(list).toEqual(['news.publish']);
    list = setOverride(list, 'news.publish', 'deny');
    expect(list).toEqual(['!news.publish']);
    list = setOverride(['tasks.view', ...list], 'news.publish', 'role');
    expect(list).toEqual(['tasks.view']);
  });

  it('compares lists regardless of order', () => {
    expect(sameOverrides(['b', 'a'], ['a', 'b'])).toBe(true);
    expect(sameOverrides(undefined, [])).toBe(true);
    expect(sameOverrides(['a'], ['!a'])).toBe(false);
    expect(normalizeOverrides(['b', 'a', 'a'])).toEqual(['a', 'b']);
  });

  it('feeds computeEffectivePermissions: grant adds, deny removes', () => {
    const roles: RoleDefinition[] = [{ id: 'r', roleCode: 'JOURNALIST', nameAr: 'صحفي', permissions: ['news.view', 'news.create'] } as any];
    const custom = setOverride(setOverride([], 'news.create', 'deny'), 'tasks.view', 'grant');
    const perms = computeEffectivePermissions({ role: 'JOURNALIST', isActive: true, customPermissions: custom } as any, roles);
    expect(perms).toContain('news.view');
    expect(perms).toContain('tasks.view');
    expect(perms).not.toContain('news.create');
  });
});

describe('CSV export', () => {
  it('quotes cells, escapes quotes and starts with a byte-order mark', () => {
    expect(csvCell('قال "نعم"')).toBe('"قال ""نعم"""');
    expect(csvCell(null)).toBe('""');
    expect(csvCell(12)).toBe('"12"');
    const csv = toCsv([['أ', 'ب'], [1, 2]]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1)).toBe('"أ","ب"\r\n"1","2"');
  });

  it('neutralises spreadsheet formulas but keeps signed numbers', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvCell('@SUM(A1)')).toBe('"\'@SUM(A1)"');
    expect(csvCell('-5')).toBe('"-5"');
    expect(csvCell('+3.5')).toBe('"+3.5"');
  });
});

describe('log filters', () => {
  const rows = [
    { id: '1', userId: 'u1', userName: 'سارة', at: '2026-03-01T10:00:00Z' },
    { id: '2', userId: 'u2', userName: 'أحمد', at: '2026-03-05T10:00:00Z' },
    { id: '3', userId: 'u1', userName: 'سارة', at: '2026-03-10T10:00:00Z' },
    { id: '4', userId: 'u2', userName: 'أحمد', at: undefined },
  ];
  const timeOf = (r: (typeof rows)[number]) => r.at;
  const userOf = (r: (typeof rows)[number]) => r.userId;

  it('keeps rows within an inclusive day range', () => {
    expect(inDayRange('2026-03-05T10:00:00Z', '', '')).toBe(true);
    expect(inDayRange(undefined, '', '')).toBe(true);
    expect(inDayRange(undefined, '2026-03-01', '')).toBe(false);
    expect(inDayRange('2026-03-05T10:00:00Z', '2026-03-05', '2026-03-05')).toBe(true);
    expect(inDayRange('2026-03-05T10:00:00Z', '2026-03-06', '')).toBe(false);
    expect(inDayRange('not a date', '2026-03-01', '')).toBe(false);
  });

  it('filters by user and dates, newest first', () => {
    expect(filterLogRows(rows, { fromDay: '', toDay: '', userId: 'ALL' }, timeOf, userOf).map((r) => r.id)).toEqual(['3', '2', '1', '4']);
    expect(filterLogRows(rows, { fromDay: '', toDay: '', userId: 'u1' }, timeOf, userOf).map((r) => r.id)).toEqual(['3', '1']);
    expect(filterLogRows(rows, { fromDay: '2026-03-02', toDay: '2026-03-09', userId: '' }, timeOf, userOf).map((r) => r.id)).toEqual(['2']);
  });

  it('lists the people found in the rows once each', () => {
    expect(logUsers(rows, userOf, (r) => r.userName)).toHaveLength(2);
  });
});
