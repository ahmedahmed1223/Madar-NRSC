import { ENTITY_ID_PATTERN } from './collections';
import { isFilterObject, sanitizeNewsFilterDefinition, type SavedNewsFilterDefinition } from './savedNewsFilters';

export interface WorkContext {
  schemaVersion: 1;
  definition: SavedNewsFilterDefinition;
  page: number;
  anchorId?: string;
}

export const WORK_SECTION_KEYS = ['my-news', 'my-review', 'my-tasks', 'my-dept-requests', 'my-episodes', 'my-bulletins', 'my-sent-requests', 'my-plan', 'my-mentions'] as const;
export type WorkSectionKey = typeof WORK_SECTION_KEYS[number];
export interface WorkSectionPreferences { order: WorkSectionKey[]; hidden: WorkSectionKey[] }

export function sanitizeWorkContext(value: unknown): WorkContext {
  const raw = isFilterObject(value) && value.schemaVersion === 1 ? value : {};
  const context: WorkContext = {
    schemaVersion: 1,
    definition: sanitizeNewsFilterDefinition(raw.definition),
    page: typeof raw.page === 'number' && Number.isInteger(raw.page) && raw.page >= 0 && raw.page <= 100000 ? raw.page : 0,
  };
  if (typeof raw.anchorId === 'string' && ENTITY_ID_PATTERN.test(raw.anchorId)) context.anchorId = raw.anchorId;
  return context;
}

export function sanitizeWorkSections(value: unknown): WorkSectionPreferences {
  const raw = isFilterObject(value) ? value : {};
  const keys = (value: unknown): WorkSectionKey[] => Array.isArray(value)
    ? [...new Set(value.filter((key): key is WorkSectionKey => typeof key === 'string' && WORK_SECTION_KEYS.includes(key as WorkSectionKey)))] : [];
  return { order: [...new Set([...keys(raw.order), ...WORK_SECTION_KEYS])], hidden: keys(raw.hidden) };
}
