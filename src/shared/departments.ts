/**
 * Administrative departments of the organisation (غرفة التحرير، الإنتاج، المونتاج…). Users, duty
 * rosters, requests and card steps are routed by these ids. The list lives in the shared settings
 * (`settings.departments`) and is edited by the administrator: departments are added, renamed,
 * placed under a parent department (sub-units), given a head and limited to some stations; a
 * department that is still used is archived, never deleted, and its id never changes.
 *
 * Not to be confused with the news categories («تصنيفات الأخبار»), which classify stories.
 */

export interface Department {
  id: string;
  name: string;
  /** Archived departments keep their name for history but are not offered in forms. */
  archived?: boolean;
  /** Sub-unit of another department (e.g. «المونتاج» under «الإنتاج»). */
  parentId?: string;
  /** Head of the department: hears about requests sent to it. */
  headUserId?: string;
  /** Stations that have this department; absent or empty = every station. */
  stationIds?: string[];
}

export type DepartmentId = string;

/** Starting list of a new installation (ids are stable: users, rosters and requests point at them). */
export const DEFAULT_DEPARTMENTS: readonly Department[] = [
  { id: 'newsroom', name: 'غرفة التحرير' },
  { id: 'production', name: 'الإنتاج' },
  { id: 'montage', name: 'المونتاج' },
  { id: 'graphics', name: 'الجرافيكس' },
  { id: 'direction', name: 'الإخراج' },
  { id: 'control', name: 'الكنترول' },
  { id: 'studio', name: 'الاستديو' },
  { id: 'presenters', name: 'المذيعون' },
  { id: 'field', name: 'المراسلون الميدانيون' },
  { id: 'audio', name: 'الصوت' },
  { id: 'lighting', name: 'الإضاءة' },
  { id: 'archive', name: 'الأرشيف والتوثيق' },
  { id: 'monitoring', name: 'الرصد والمراقبة' },
  { id: 'quality', name: 'الجودة' },
  { id: 'reports', name: 'التقارير' },
];

export const MAX_DEPARTMENTS = 60;
const DEPARTMENT_ID = /^[a-zA-Z0-9_-]{1,40}$/;

/** Every known department, archived ones included (names of history). */
const known: Department[] = DEFAULT_DEPARTMENTS.map((d) => ({ ...d }));
/**
 * The departments offered today (archived ones left out). A live array: it follows the settings,
 * so screens that list DEPARTMENTS always show the administrator's current list.
 */
export const DEPARTMENTS: Department[] = known.filter((d) => !d.archived);

export const DEPARTMENT_IDS: readonly string[] = DEFAULT_DEPARTMENTS.map((d) => d.id);

/** Departments configured for this deployment (the defaults until an administrator edits them). */
export function departmentsOf(settings: { departments?: Department[] } | null | undefined): Department[] {
  return Array.isArray(settings?.departments) && settings!.departments!.length ? settings!.departments! : DEFAULT_DEPARTMENTS.map((d) => ({ ...d }));
}

/** Makes `list` the current departments (called wherever the settings are read, on the client and the server). */
export function applyDepartments(list: Department[]) {
  known.splice(0, known.length, ...list.map((d) => ({ ...d })));
  DEPARTMENTS.splice(0, DEPARTMENTS.length, ...known.filter((d) => !d.archived));
}

export const applyDepartmentSettings = (settings: { departments?: Department[] } | null | undefined) => applyDepartments(departmentsOf(settings));

/** All known departments, archived included. */
export const allDepartments = (): readonly Department[] => known;

export const isDepartmentId = (v: unknown): boolean => typeof v === 'string' && known.some((d) => d.id === v);

export const departmentName = (id?: string | null) => {
  const d = known.find((x) => x.id === id);
  return d ? (d.archived ? `${d.name} (مؤرشف)` : d.name) : 'غير محدد';
};

/** Active departments a colleague of `stationId` can belong to (a department limited to other stations is left out). */
export function departmentsAtStation(stationId: string | null | undefined, list: readonly Department[] = DEPARTMENTS): Department[] {
  return list.filter((d) => !d.archived && (!d.stationIds?.length || !stationId || d.stationIds.includes(stationId)));
}

/** The department's own head, else the nearest head up its parents. */
export function departmentHead(id: string | null | undefined, list: readonly Department[] = known): string | undefined {
  const seen = new Set<string>();
  let current = list.find((d) => d.id === id);
  while (current && !seen.has(current.id)) {
    if (current.headUserId) return current.headUserId;
    seen.add(current.id);
    current = current.parentId ? list.find((d) => d.id === current!.parentId) : undefined;
  }
  return undefined;
}

/** Sub-units directly under `id` (top-level departments for no id). */
export const departmentChildren = (id: string | undefined, list: readonly Department[] = known) => list.filter((d) => (d.parentId || undefined) === id);

/** Validation of the departments list in the settings. */
export function departmentsError(value: unknown, ctx: { stationIds?: string[]; userIds?: string[] } = {}): string | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_DEPARTMENTS) return `الأقسام الإدارية: من قسم واحد إلى ${MAX_DEPARTMENTS} قسماً`;
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const d of value) {
    if (!d || typeof d.id !== 'string' || !DEPARTMENT_ID.test(d.id)) return 'معرّف القسم غير صالح';
    if (typeof d.name !== 'string' || !d.name.trim() || d.name.length > 60) return 'اسم القسم مطلوب وبحد أقصى 60 حرفاً';
    const name = d.name.trim().toLocaleLowerCase();
    if (ids.has(d.id) || names.has(name)) return `اسم القسم أو معرّفه مكرر: «${d.name.trim()}»`;
    if (d.archived !== undefined && typeof d.archived !== 'boolean') return 'حالة أرشفة القسم غير صالحة';
    if (d.headUserId !== undefined && d.headUserId !== null && (typeof d.headUserId !== 'string' || (ctx.userIds && !ctx.userIds.includes(d.headUserId)))) return `رئيس قسم «${d.name}» غير موجود`;
    if (d.stationIds !== undefined && (!Array.isArray(d.stationIds) || d.stationIds.some((s: unknown) => typeof s !== 'string' || (ctx.stationIds && !ctx.stationIds.includes(s))))) return `محطات قسم «${d.name}» غير موجودة`;
    ids.add(d.id);
    names.add(name);
  }
  if (!value.some((d) => !d.archived)) return 'يجب أن يبقى قسم نشط واحد على الأقل';
  for (const d of value) {
    if (d.parentId === undefined || d.parentId === null) continue;
    if (typeof d.parentId !== 'string' || !ids.has(d.parentId) || d.parentId === d.id) return `القسم الأعلى لقسم «${d.name}» غير موجود`;
    // No cycles: walking up the parents must end.
    const seen = new Set<string>([d.id]);
    let parent = value.find((x) => x.id === d.parentId);
    while (parent) {
      if (seen.has(parent.id)) return `تسلسل الأقسام دائري عند «${d.name}»`;
      seen.add(parent.id);
      parent = parent.parentId ? value.find((x) => x.id === parent.parentId) : undefined;
    }
  }
  return null;
}

/** Departments removed from the list while something still points at them (they must be archived instead). */
export function removedDepartmentsInUse(before: Department[], after: Department[], usage: (id: string) => number): { id: string; name: string; uses: number }[] {
  const kept = new Set(after.map((d) => d.id));
  return before.filter((d) => !kept.has(d.id)).map((d) => ({ id: d.id, name: d.name, uses: usage(d.id) })).filter((d) => d.uses > 0);
}

/** Maps the free-text departments used before departments became structured. */
const LEGACY: Record<string, string> = {
  'غرفة الأخبار': 'newsroom',
  'الإدارة العامة والتحرير': 'newsroom',
  'القسم الدولي': 'newsroom',
  'القسم الاقتصادي': 'newsroom',
  'التحقيقات والتقارير الخاصة': 'newsroom',
  'الإنتاج والبرامج': 'production',
  'المذيعين والتقديم': 'presenters',
  'المراسلين الميدانيين': 'field',
  'الوسائط والمكتبة': 'archive',
  'إدارة البث والعمليات': 'control',
};

/** Department of a user record, understanding legacy free-text values. */
export function departmentIdOf(user: { departmentId?: string; department?: string } | null | undefined): DepartmentId {
  if (isDepartmentId(user?.departmentId)) return user!.departmentId as DepartmentId;
  const legacy = user?.department ? LEGACY[user.department.trim()] : undefined;
  if (legacy) return legacy;
  const byName = known.find((d) => d.name === user?.department?.trim());
  return byName?.id || 'newsroom';
}
