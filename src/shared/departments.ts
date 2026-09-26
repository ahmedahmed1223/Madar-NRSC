/** Production departments of the station; users, duty rosters and requests are routed by these ids. */
export const DEPARTMENTS = [
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
] as const;

export type DepartmentId = (typeof DEPARTMENTS)[number]['id'];

export const DEPARTMENT_IDS = DEPARTMENTS.map((d) => d.id) as readonly DepartmentId[];

export const isDepartmentId = (v: unknown): v is DepartmentId => typeof v === 'string' && (DEPARTMENT_IDS as readonly string[]).includes(v);

export const departmentName = (id?: string | null) => DEPARTMENTS.find((d) => d.id === id)?.name || 'غير محدد';

/** Maps the free-text departments used before departments became structured. */
const LEGACY: Record<string, DepartmentId> = {
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
  const byName = DEPARTMENTS.find((d) => d.name === user?.department?.trim());
  return byName?.id || 'newsroom';
}
