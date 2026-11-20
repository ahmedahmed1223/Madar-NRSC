import { ENTITY_ID_PATTERN, type EntityRow } from './collections';
import { NEWS_STATUS_LABELS } from './newsWorkflow';
import type { NewsStatus } from '../types';

export interface SavedNewsFilterDefinition {
  activeTab: 'ALL' | 'BREAKING' | 'TRASH' | NewsStatus;
  searchQuery: string;
  selectedCategory: string;
  selectedSource?: string;
  selectedPriority: string;
  onlyMine: boolean;
  authorId: string;
  fromDate: string;
  toDate: string;
}

export interface SavedNewsFilter {
  id: string;
  ownerId: string;
  schemaVersion: 1;
  name: string;
  definition: SavedNewsFilterDefinition;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export type SavedNewsFilterRow = Omit<EntityRow, 'd'> & { d: SavedNewsFilter };
export type SavedNewsFilterInput = Pick<SavedNewsFilter, 'id' | 'schemaVersion' | 'name' | 'definition' | 'pinned'>;

export const DEFAULT_NEWS_FILTER: SavedNewsFilterDefinition = {
  activeTab: 'ALL', searchQuery: '', selectedCategory: 'ALL', selectedPriority: 'ALL',
  onlyMine: false, authorId: 'ALL', fromDate: '', toDate: '',
};

const tabs = new Set(['ALL', 'BREAKING', 'TRASH', ...Object.keys(NEWS_STATUS_LABELS)]);
const priorities = new Set(['ALL', 'LOW', 'NORMAL', 'MEDIUM', 'HIGH', 'URGENT', 'CRITICAL']);
const fields = Object.keys(DEFAULT_NEWS_FILTER);
const recordFields = new Set(['id', 'ownerId', 'schemaVersion', 'name', 'definition', 'pinned', 'createdAt', 'updatedAt']);

export function isFilterObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function validDay(value: unknown): value is string {
  if (value === '') return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validField(key: string, value: unknown): boolean {
  switch (key) {
    case 'activeTab': return typeof value === 'string' && tabs.has(value);
    case 'selectedPriority': return typeof value === 'string' && priorities.has(value);
    case 'onlyMine': return typeof value === 'boolean';
    case 'searchQuery': return typeof value === 'string' && value.length <= 200;
    case 'selectedCategory': return typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\u0000-\u001f<>]/.test(value);
    case 'selectedSource':
    case 'authorId': return typeof value === 'string' && ENTITY_ID_PATTERN.test(value);
    case 'fromDate':
    case 'toDate': return validDay(value);
    default: return false;
  }
}

export function newsFilterDefinitionError(value: unknown): string | null {
  if (!isFilterObject(value)) return 'تعريف الفلتر غير صالح';
  if (Object.keys(value).some(key => !fields.includes(key) && key !== 'selectedSource')) return 'تعريف الفلتر يحتوي حقولاً غير مدعومة';
  for (const key of fields) if (!validField(key, value[key])) return `قيمة حقل الفلتر غير صالحة: ${key}`;
  if (value.selectedSource !== undefined && !validField('selectedSource', value.selectedSource)) return 'معرّف المصدر غير صالح';
  if (value.fromDate && value.toDate && String(value.fromDate) > String(value.toDate)) return 'تاريخ البداية يجب ألا يتجاوز تاريخ النهاية';
  return null;
}

export function sanitizeNewsFilterDefinition(value: unknown): SavedNewsFilterDefinition {
  const next = { ...DEFAULT_NEWS_FILTER };
  if (!isFilterObject(value)) return next;
  for (const key of fields) {
    if (validField(key, value[key])) Object.assign(next, { [key]: value[key] });
  }
  if (typeof value.selectedSource === 'string' && ENTITY_ID_PATTERN.test(value.selectedSource)) next.selectedSource = value.selectedSource;
  if (next.fromDate && next.toDate && next.fromDate > next.toDate) {
    next.fromDate = '';
    next.toDate = '';
  }
  return next;
}

export function savedNewsFilterError(value: unknown): string | null {
  if (!isFilterObject(value) || Object.keys(value).some(key => !recordFields.has(key))) return 'بيانات الفلتر غير صالحة';
  if (value.schemaVersion !== 1) return 'إصدار الفلتر غير مدعوم';
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.trim().length > 80) return 'اسم الفلتر مطلوب وبحد أقصى 80 حرفاً';
  if (typeof value.pinned !== 'boolean') return 'قيمة تثبيت الفلتر غير صالحة';
  for (const key of ['id', 'ownerId']) {
    if (value[key] !== undefined && (typeof value[key] !== 'string' || !ENTITY_ID_PATTERN.test(value[key] as string))) return 'معرّف الفلتر غير صالح';
  }
  for (const key of ['createdAt', 'updatedAt']) {
    if (value[key] !== undefined && (typeof value[key] !== 'string' || !Number.isFinite(Date.parse(value[key] as string)))) return 'تاريخ الفلتر غير صالح';
  }
  return newsFilterDefinitionError(value.definition);
}
