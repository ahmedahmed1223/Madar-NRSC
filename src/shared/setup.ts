/**
 * The administrator's quick setup: six steps that take a fresh installation to a working
 * newsroom. A step counts as done when the system shows it (stations configured, categories,
 * a team), or when the administrator confirmed it in the wizard.
 */

export const SETUP_STEPS = [
  { id: 'organization', title: 'المؤسسة', hint: 'اسم المؤسسة والقناة والمنطقة الزمنية' },
  { id: 'stations', title: 'المحطات', hint: 'المحطة الرئيسية والفروع وارتباطها' },
  { id: 'categories', title: 'الأقسام الصحفية', hint: 'تصنيفات الأخبار' },
  { id: 'team', title: 'الفريق', hint: 'حسابات الزملاء وأدوارهم ومحطاتهم' },
  { id: 'security', title: 'الأمان والنسخ', hint: 'التحقق بخطوتين والنسخ الاحتياطي' },
  { id: 'finish', title: 'الانتهاء', hint: 'مراجعة ما بقي' },
] as const;

export type SetupStepId = (typeof SETUP_STEPS)[number]['id'];

export interface SetupState {
  /** Steps the administrator confirmed in the wizard. */
  confirmed?: SetupStepId[];
  completedAt?: string;
  completedByName?: string;
}

export function setupStateError(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'حالة الإعداد غير صالحة';
  const state = value as SetupState;
  const ids = SETUP_STEPS.map((s) => s.id) as string[];
  if (state.confirmed !== undefined && (!Array.isArray(state.confirmed) || state.confirmed.some((id) => !ids.includes(id)))) return 'خطوات الإعداد غير معروفة';
  if (state.completedAt !== undefined && (typeof state.completedAt !== 'string' || !Number.isFinite(Date.parse(state.completedAt)))) return 'تاريخ إكمال الإعداد غير صالح';
  if (state.completedByName !== undefined && (typeof state.completedByName !== 'string' || state.completedByName.length > 120)) return 'اسم من أكمل الإعداد غير صالح';
  return null;
}

export interface SetupFacts {
  setup?: SetupState;
  /** Stations were saved (not only the defaults). */
  stationsConfigured: boolean;
  categories: number;
  /** Active accounts other than demo accounts. */
  teamMembers: number;
  /** The administrator protects their account with two-step verification. */
  adminTwoFactor: boolean;
  /** Periodic backups are on. */
  backups: boolean;
}

/** Which steps are done, from what the system shows and what was confirmed. */
export function setupProgress(facts: SetupFacts): Record<SetupStepId, boolean> {
  const confirmed = new Set(facts.setup?.confirmed || []);
  return {
    organization: confirmed.has('organization'),
    stations: facts.stationsConfigured || confirmed.has('stations'),
    categories: facts.categories > 0,
    team: facts.teamMembers > 1 || confirmed.has('team'),
    security: (facts.adminTwoFactor && facts.backups) || confirmed.has('security'),
    finish: !!facts.setup?.completedAt,
  };
}

export const setupDoneCount = (progress: Record<SetupStepId, boolean>) => SETUP_STEPS.filter((s) => s.id !== 'finish' && progress[s.id]).length;
