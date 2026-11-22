import { ENTITY_ID_PATTERN, type CollectionName } from './collections';

export const MODULE_IDS = ['programmes', 'assignments'] as const;
export type ModuleId = typeof MODULE_IDS[number];
export type ModuleMode = 'everyone' | 'selected' | 'disabled';
export type ModuleRule = { mode: ModuleMode; roleIds?: string[]; userIds?: string[] };
export type ModuleAccessSettings = Partial<Record<ModuleId, ModuleRule>>;
export type ModuleAvailability = Record<ModuleId, boolean>;

export const MODULE_LABELS: Record<ModuleId, string> = { programmes: 'البرامج والحلقات', assignments: 'التكليفات' };
export const MODULE_UNAVAILABLE = 'هذه الوحدة غير متاحة لهذا الحساب';

export function moduleRule(settings: ModuleAccessSettings | undefined, id: ModuleId): ModuleRule {
  return settings?.[id] ?? { mode: 'everyone' };
}

export function allowsModule(settings: ModuleAccessSettings | undefined, id: ModuleId, userId: string, roleId?: string): boolean {
  const rule = moduleRule(settings, id);
  return rule.mode === 'everyone' || rule.mode === 'selected' &&
    (rule.userIds?.includes(userId) === true || roleId !== undefined && rule.roleIds?.includes(roleId) === true);
}

function validIds(ids: unknown): boolean {
  return ids === undefined || Array.isArray(ids) && ids.length <= 5_000 &&
    ids.every(id => typeof id === 'string' && ENTITY_ID_PATTERN.test(id)) && new Set(ids).size === ids.length;
}

export function moduleAccessError(value: unknown): string | null {
  if (value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'إعدادات الوحدات غير صالحة';
  for (const [id, entry] of Object.entries(value)) {
    if (!MODULE_IDS.includes(id as ModuleId) || !entry || typeof entry !== 'object' || Array.isArray(entry)) return 'إعدادات الوحدات غير صالحة';
    const rule = entry as ModuleRule;
    if (Object.keys(rule).some(key => key !== 'mode' && key !== 'roleIds' && key !== 'userIds') ||
        !['everyone', 'selected', 'disabled'].includes(rule.mode) || !validIds(rule.roleIds) || !validIds(rule.userIds)) {
      return 'نوع إتاحة الوحدة أو قائمة المستخدمين والأدوار غير صالحة';
    }
    if (rule.mode === 'selected' && !rule.roleIds?.length && !rule.userIds?.length) return 'اختر دورًا أو مستخدمًا واحدًا على الأقل لكل وحدة مقيّدة';
  }
  return null;
}

const COLLECTION_MODULES: Partial<Record<CollectionName, ModuleId>> = {
  programs: 'programmes', episodes: 'programmes', programTypes: 'programmes',
  productionCards: 'assignments', workflowTemplates: 'assignments',
};

export function moduleForCollection(collection: CollectionName): ModuleId | undefined {
  return COLLECTION_MODULES[collection];
}

export function moduleForScreen(screen: string): ModuleId | undefined {
  switch (screen) {
    case 'programs':
    case 'program-detail':
    case 'program_detail':
    case 'episodes':
    case 'episode-workspace': return 'programmes';
    case 'cards': return 'assignments';
    default: return undefined;
  }
}

export function moduleForLink(link: unknown): ModuleId | undefined {
  return typeof link === 'string' && link.startsWith('/') ? moduleForScreen(link.split(/[/?#]/)[1] ?? '') : undefined;
}

/** Some collections are shared by bulletins and programmes. Resolve those records by parent. */
export function moduleForRecord(collection: CollectionName, id: string | undefined, data: any, isEpisode: (id: string) => boolean): ModuleId | undefined {
  const own = moduleForCollection(collection);
  if (own) return own;
  if (collection === 'notifications') return moduleForLink(data?.linkUrl);
  if (collection === 'editLocks' && (data?.collection === 'episodes' || id?.startsWith('episodes:'))) return 'programmes';
  if (collection === 'onAir' || collection === 'offlineAirSessions' || collection === 'cues') {
    const showId = data?.episodeId ?? data?.showId ?? (collection === 'onAir' ? id : undefined);
    if (typeof showId === 'string' && isEpisode(showId)) return 'programmes';
  }
  return undefined;
}
