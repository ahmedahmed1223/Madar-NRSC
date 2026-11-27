import { findDepartmentId, type Department } from './departments';
import { ENTITY_ID_PATTERN, type CollectionName } from './collections';

/** Stable keys in user settings, the API and the offline cache. */
export const MODULE_LABELS = {
  programmes: 'البرامج والحلقات', assignments: 'التكليفات', news: 'الأخبار والتحرير',
  bulletins: 'النشرات', tasks: 'المهام', requests: 'طلبات الأقسام', personalTasks: 'المهام الشخصية',
  media: 'مكتبة الوسائط', messaging: 'المراسلات', planning: 'التخطيط والمناوبات', reports: 'التقارير',
  editorialAi: 'المساعد التحريري للأخبار', transcription: 'تفريغ الوسائط',
} as const;
export type ModuleId = keyof typeof MODULE_LABELS;
export const MODULE_IDS = Object.keys(MODULE_LABELS) as ModuleId[];
export const FEATURE_PARENTS: Partial<Record<ModuleId, ModuleId>> = { editorialAi: 'news', transcription: 'media' };
export type ModuleMode = 'everyone' | 'selected' | 'disabled' | 'finishing';
export type ModuleAudience = { roleIds?: string[]; userIds?: string[]; stationIds?: string[]; departmentIds?: string[] };
export type ModuleScope = { stationId?: string; departmentId?: string; descendants?: boolean; mode: ModuleMode; audiences?: ModuleAudience[] };
export type ModuleRule = { mode: ModuleMode; roleIds?: string[]; userIds?: string[]; audiences?: ModuleAudience[]; scopes?: ModuleScope[] };
export type ModuleAccessSettings = Partial<Record<ModuleId, ModuleRule>>;
export type ModuleAvailability = Record<ModuleId, boolean> & { assignmentIntake?: boolean };
export type ModuleSubject = { id: string; stationId?: string | null; departmentId?: string; departmentAncestors?: string[]; roleId?: string };

export function moduleSubject(user: { id: string; stationId?: string | null; departmentId?: string; department?: string }, roleId?: string, departments?: readonly Department[]): ModuleSubject {
  const departmentId = departments ? findDepartmentId(user, departments) : user.departmentId;
  const ancestors = new Set<string>();
  let parentId = departments?.find(department => department.id === departmentId)?.parentId;
  while (parentId && parentId !== departmentId && !ancestors.has(parentId)) {
    ancestors.add(parentId);
    const current = parentId;
    parentId = departments?.find(department => department.id === current)?.parentId;
  }
  return { id: user.id, stationId: user.stationId, departmentId, departmentAncestors: [...ancestors], roleId };
}

export const MODULE_UNAVAILABLE = 'هذه الوحدة غير متاحة لهذا الحساب';

export function moduleRule(settings: ModuleAccessSettings | undefined, id: ModuleId): ModuleRule {
  return settings?.[id] ?? { mode: 'everyone' };
}

const audienceKeys = {
  roleIds: 'roleId', userIds: 'id', stationIds: 'stationId', departmentIds: 'departmentId',
} as const;
const dimensions = Object.keys(audienceKeys) as (keyof ModuleAudience)[];

function matchesAudience(rule: ModuleAudience, subject: ModuleSubject): boolean {
  return dimensions.every(key => !rule[key]?.length || rule[key]!.includes(subject[audienceKeys[key]] ?? ''));
}

export function moduleRestrictions(settings: ModuleAccessSettings | undefined, id: ModuleId, subject: ModuleSubject, recordStationId?: string): (ModuleRule | ModuleScope)[] {
  const rule = moduleRule(settings, id);
  return [rule, ...(rule.scopes ?? []).filter(scope =>
    (!scope.stationId || scope.stationId === subject.stationId || scope.stationId === recordStationId) &&
    (!scope.departmentId || scope.departmentId === subject.departmentId || scope.descendants && subject.departmentAncestors?.includes(scope.departmentId)))];
}

export function allowsModule(settings: ModuleAccessSettings | undefined, id: ModuleId, user: string | ModuleSubject, roleId?: string, recordStationId?: string): boolean {
  const subject = typeof user === 'string' ? { id: user, roleId } : user;
  const parent = FEATURE_PARENTS[id];
  if (parent && !allowsModule(settings, parent, subject, undefined, recordStationId)) return false;
  return moduleRestrictions(settings, id, subject, recordStationId).every(rule => {
    if (rule.mode === 'disabled') return false;
    if (rule.mode !== 'selected') return true;
    return ('userIds' in rule && rule.userIds?.includes(subject.id)) ||
      ('roleIds' in rule && !!subject.roleId && rule.roleIds?.includes(subject.roleId)) ||
      rule.audiences?.some(audience => matchesAudience(audience, subject)) === true;
  });
}

export function moduleAllowsNewWork(settings: ModuleAccessSettings | undefined, id: ModuleId, subject: ModuleSubject, recordStationId?: string): boolean {
  return allowsModule(settings, id, subject, undefined, recordStationId) &&
    moduleRestrictions(settings, id, subject, recordStationId).every(rule => rule.mode !== 'finishing');
}

function validIds(ids: unknown): boolean {
  return ids === undefined || Array.isArray(ids) && ids.length <= 5_000 &&
    ids.every(id => typeof id === 'string' && ENTITY_ID_PATTERN.test(id)) && new Set(ids).size === ids.length;
}

function audiencesValid(value: unknown): boolean {
  return value === undefined || Array.isArray(value) && value.length <= 100 && value.every(audience =>
    audience && typeof audience === 'object' && !Array.isArray(audience) &&
    Object.keys(audience).every(key => dimensions.includes(key as keyof ModuleAudience)) &&
    dimensions.every(key => validIds(audience[key])) && dimensions.some(key => audience[key]?.length)
  );
}

function modeValid(id: string, mode: unknown): boolean {
  return mode === 'everyone' || mode === 'selected' || mode === 'disabled' || id === 'assignments' && mode === 'finishing';
}

function validScope(id: string, value: unknown): value is ModuleScope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const scope = value as ModuleScope;
  return Object.keys(scope).every(key => ['stationId', 'departmentId', 'descendants', 'mode', 'audiences'].includes(key)) &&
    !!(scope.stationId || scope.departmentId) &&
    (scope.descendants === undefined || !!scope.departmentId && typeof scope.descendants === 'boolean') &&
    [scope.stationId, scope.departmentId].every(key => key === undefined || typeof key === 'string' && ENTITY_ID_PATTERN.test(key)) &&
    modeValid(id, scope.mode) && audiencesValid(scope.audiences) && (scope.mode !== 'selected' || !!scope.audiences?.length);
}

export function moduleAccessError(value: unknown): string | null {
  if (value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'إعدادات الوحدات غير صالحة';
  for (const [id, entry] of Object.entries(value)) {
    if (!MODULE_IDS.includes(id as ModuleId) || !entry || typeof entry !== 'object' || Array.isArray(entry)) return 'إعدادات الوحدات غير صالحة';
    const rule = entry as ModuleRule;
    if (Object.keys(rule).some(key => !['mode', 'roleIds', 'userIds', 'audiences', 'scopes'].includes(key)) ||
        !modeValid(id, rule.mode) || !validIds(rule.roleIds) || !validIds(rule.userIds) || !audiencesValid(rule.audiences) ||
        (rule.scopes !== undefined && (!Array.isArray(rule.scopes) || rule.scopes.length > 100 || !rule.scopes.every(scope => validScope(id, scope)) ||
          new Set(rule.scopes.map(scope => JSON.stringify([scope.stationId, scope.departmentId]))).size !== rule.scopes.length))) {
      return 'نوع إتاحة الوحدة أو قواعد الجمهور غير صالحة';
    }
    if (rule.mode === 'selected' && !rule.roleIds?.length && !rule.userIds?.length && !rule.audiences?.length) return 'اختر جمهوراً واحداً على الأقل لكل وحدة مقيّدة';
  }
  return null;
}

const COLLECTION_MODULES: Partial<Record<CollectionName, ModuleId>> = {
  programs: 'programmes', episodes: 'programmes', programTypes: 'programmes',
  productionCards: 'assignments', workflowTemplates: 'assignments',
  news: 'news', newsCorrections: 'news', stories: 'news', breaking: 'news', wires: 'news', savedNewsFilters: 'news',
  bulletins: 'bulletins', bulletinStories: 'bulletins', bulletinFormats: 'bulletins',
  tasks: 'tasks', requests: 'requests', personalTasks: 'personalTasks', media: 'media', mediaFolders: 'media',
  messages: 'messaging', chatPins: 'messaging', conversations: 'messaging', chatReads: 'messaging',
  diary: 'planning', bookings: 'planning', resources: 'planning', roster: 'planning',
  shiftHandovers: 'planning', handoverReceipts: 'planning',
};

const SCREEN_MODULES = new Map<string, ModuleId>(Object.entries({
  programs: 'programmes', 'program-detail': 'programmes', program_detail: 'programmes', episodes: 'programmes', 'episode-workspace': 'programmes',
  cards: 'assignments', news: 'news', 'news-editor': 'news', wires: 'news', breaking: 'news', stories: 'news', wallboard: 'news',
  bulletins: 'bulletins', tasks: 'tasks', requests: 'requests', 'personal-tasks': 'personalTasks', media: 'media', messages: 'messaging',
  diary: 'planning', bookings: 'planning', roster: 'planning', reports: 'reports',
} satisfies Record<string, ModuleId>));

export function moduleForCollection(collection: CollectionName): ModuleId | undefined {
  return COLLECTION_MODULES[collection];
}

export function moduleForScreen(screen: string): ModuleId | undefined {
  return SCREEN_MODULES.get(screen);
}

export function moduleForLink(link: unknown): ModuleId | undefined {
  return typeof link === 'string' && link.startsWith('/') ? moduleForScreen(link.split(/[/?#]/)[1] ?? '') : undefined;
}

/** Some collections are shared by bulletins and programmes. Resolve those records by parent. */
export function moduleForRecord(collection: CollectionName, id: string | undefined, data: any, isEpisode: (id: string) => boolean): ModuleId | undefined {
  const own = moduleForCollection(collection);
  if (own) return own;
  if (collection === 'notifications') return moduleForLink(data?.linkUrl);
  if (collection === 'comments') {
    if (['news', 'story'].includes(data?.target?.kind)) return 'news';
    if (['episode', 'segment'].includes(data?.target?.kind)) return 'programmes';
    if (data?.target?.kind === 'bulletinStory') return 'bulletins';
  }
  if (collection === 'editLocks' || collection === 'reviewThreads') {
    const target = data?.collection ?? data?.targetCollection ?? data?.entityType ?? (collection === 'editLocks' ? id?.split(':')[0] : undefined);
    if (typeof target === 'string' && Object.hasOwn(COLLECTION_MODULES, target)) return moduleForCollection(target as CollectionName);
  }
  if (collection === 'onAir' || collection === 'offlineAirSessions' || collection === 'cues') {
    const showId = data?.episodeId ?? data?.showId ?? (collection === 'onAir' ? id : undefined);
    if (typeof showId === 'string') return isEpisode(showId) ? 'programmes' : 'bulletins';
  }
  return undefined;
}
