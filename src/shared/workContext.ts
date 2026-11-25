import { ENTITY_ID_PATTERN } from './collections';
import { isFilterObject, sanitizeNewsFilterDefinition, type SavedNewsFilterDefinition } from './savedNewsFilters';

export interface WorkContext {
  schemaVersion: 1;
  definition: SavedNewsFilterDefinition;
  page: number;
  anchorId?: string;
  anchorOffset?: number;
}

export const WORK_SECTION_KEYS = ['my-news', 'my-review', 'my-tasks', 'my-personal-tasks', 'my-personal-notes', 'my-dept-requests', 'my-episodes', 'my-bulletins', 'my-sent-requests', 'my-plan', 'my-mentions', 'my-card-steps'] as const;
export type WorkSectionKey = typeof WORK_SECTION_KEYS[number];
export interface WorkSectionPreferences { order: WorkSectionKey[]; hidden: WorkSectionKey[] }

export function sanitizeWorkContext(value: unknown): WorkContext {
  const raw = isFilterObject(value) && value.schemaVersion === 1 ? value : {};
  const context: WorkContext = {
    schemaVersion: 1,
    definition: sanitizeNewsFilterDefinition(raw.definition),
    page: typeof raw.page === 'number' && Number.isInteger(raw.page) && raw.page >= 0 && raw.page <= 100000 ? raw.page : 0,
  };
  if (typeof raw.anchorId === 'string' && ENTITY_ID_PATTERN.test(raw.anchorId)) {
    context.anchorId = raw.anchorId;
    if (typeof raw.anchorOffset === 'number' && Number.isInteger(raw.anchorOffset) && Math.abs(raw.anchorOffset) <= 2048) {
      context.anchorOffset = raw.anchorOffset;
    }
  }
  return context;
}

export function sanitizeWorkSections(value: unknown): WorkSectionPreferences {
  const raw = isFilterObject(value) ? value : {};
  const keys = (value: unknown): WorkSectionKey[] => Array.isArray(value)
    ? [...new Set(value.filter((key): key is WorkSectionKey => typeof key === 'string' && WORK_SECTION_KEYS.includes(key as WorkSectionKey)))] : [];
  return { order: [...new Set([...keys(raw.order), ...WORK_SECTION_KEYS])], hidden: keys(raw.hidden) };
}

type ContextStorage = Pick<Storage, 'getItem'> & Partial<Pick<Storage, 'setItem'>>;
export type QueueFilterValue = string | boolean;
export type QueueFilterScope = 'cards' | 'tasks' | 'department-work' | 'requests';
export const queueFilterKey = (userId: string, scope: QueueFilterScope, field: string) =>
  `nrcs_queue_filters:v1:${encodeURIComponent(userId)}:${scope}:${encodeURIComponent(field)}`;

export function sanitizeQueueFilter<T extends QueueFilterValue>(value: unknown, fallback: T, options?: readonly string[]): T {
  if (typeof value !== typeof fallback) return fallback;
  if (typeof value === 'string' && (value.length > 1000 || (options && value !== fallback && !options.includes(value)))) return fallback;
  return value as T;
}

export function readQueueFilter<T extends QueueFilterValue>(storage: ContextStorage, userId: string, scope: QueueFilterScope, field: string, fallback: T): T {
  if (!userId) return fallback;
  try {
    const raw = JSON.parse(storage.getItem(queueFilterKey(userId, scope, field)) || 'null');
    return isFilterObject(raw) && raw.schemaVersion === 1 ? sanitizeQueueFilter(raw.value, fallback) : fallback;
  } catch { return fallback; }
}

export function writeQueueFilter(storage: ContextStorage, userId: string, scope: QueueFilterScope, field: string, value: QueueFilterValue): boolean {
  if (!userId) return false;
  try {
    if (!storage.setItem) return false;
    storage.setItem(queueFilterKey(userId, scope, field), JSON.stringify({ schemaVersion: 1, value }));
    return true;
  } catch { return false; }
}

export const workContextKey = (userId: string, scope: string) => `nrcs_news_context:${userId}:${scope}`;

export function readWorkContext(storage: ContextStorage, userId: string, scope: string): WorkContext {
  const fallback = () => sanitizeWorkContext({ schemaVersion: 1, definition: { activeTab: scope } });
  try {
    const raw = JSON.parse(storage.getItem(workContextKey(userId, scope)) || 'null');
    if (!isFilterObject(raw)) return fallback();
    if (raw.schemaVersion === undefined) {
      return sanitizeWorkContext({ schemaVersion: 1, definition: { activeTab: scope, ...raw }, page: raw.page });
    }
    if (raw.schemaVersion !== 1) return fallback();
    return sanitizeWorkContext({ ...raw, definition: { activeTab: scope, ...(isFilterObject(raw.definition) ? raw.definition : {}) } });
  } catch { return fallback(); }
}

export function writeWorkContext(storage: ContextStorage, userId: string, scope: string, value: unknown): boolean {
  try {
    if (!storage.setItem) return false;
    storage.setItem(workContextKey(userId, scope), JSON.stringify(sanitizeWorkContext(value)));
    return true;
  } catch { return false; }
}

export function workContextPage(context: WorkContext, resultIds: string[], pageSize: number): number {
  const size = Number.isInteger(pageSize) && pageSize > 0 ? pageSize : 50;
  if (context.anchorId) {
    const index = resultIds.indexOf(context.anchorId);
    return index < 0 ? 0 : Math.floor(index / size);
  }
  return Math.min(Math.max(0, context.page), Math.max(0, Math.ceil(resultIds.length / size) - 1));
}
