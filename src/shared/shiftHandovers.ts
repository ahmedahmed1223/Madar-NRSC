import { ENTITY_ID_PATTERN, type EntityRow } from './collections';
import { isDepartmentId, type DepartmentId } from './departments';
import { SHIFTS, type ShiftId } from './roster';
import { isFilterObject } from './savedNewsFilters';

export const HANDOVER_REFERENCE_COLLECTIONS = ['news', 'bulletinStories', 'bulletins', 'episodes', 'tasks', 'requests'] as const;
export type HandoverReferenceCollection = typeof HANDOVER_REFERENCE_COLLECTIONS[number];
export interface HandoverReference { collection: HandoverReferenceCollection; id: string; note: string }
export interface HandoverDraftInput {
  id: string; schemaVersion: 1; departmentId: DepartmentId;
  sourceDate: string; sourceShift: ShiftId; recipientDate: string; recipientShift: ShiftId;
  title: string; note: string; references: HandoverReference[]; supersedesId?: string;
}
export interface ShiftHandover extends HandoverDraftInput {
  authorId: string; authorName: string; createdAt: string; updatedAt: string;
  state: 'DRAFT' | 'PUBLISHED'; publishedAt?: string; lastRemindedAt?: string;
}
export type ProjectedReference = ({ available: true; title: string } & HandoverReference) | { available: false };
export interface HandoverReceipt { id: string; publicationId: string; userId: string; userName: string; createdAt: string; note: string }
export type HandoverRow = Omit<EntityRow, 'd'> & { d: Omit<ShiftHandover, 'references' | 'lastRemindedAt'> & { references: ProjectedReference[] }; receipts: HandoverReceipt[]; recipients: { userId: string; userName: string; received: boolean }[]; canAcknowledge: boolean; canPublish: boolean; canRemind: boolean };

const fields = new Set(['id', 'schemaVersion', 'departmentId', 'sourceDate', 'sourceShift', 'recipientDate', 'recipientShift', 'title', 'note', 'references', 'supersedesId']);
export const handoverPlainText = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max && !/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
export function handoverDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function handoverDraftError(value: unknown): string | null {
  if (!isFilterObject(value) || Object.keys(value).some(key => !fields.has(key))) return 'حقول تسليم الوردية غير صالحة';
  if (typeof value.id !== 'string' || !ENTITY_ID_PATTERN.test(value.id) || value.schemaVersion !== 1) return 'معرّف أو إصدار التسليم غير صالح';
  if (!isDepartmentId(value.departmentId)) return 'اختر قسماً صالحاً';
  if (!handoverDate(value.sourceDate) || !handoverDate(value.recipientDate)) return 'اختر تاريخاً صالحاً';
  if (![value.sourceShift, value.recipientShift].every(shift => SHIFTS.some(s => s.id === shift))) return 'اختر وردية صالحة';
  if (!handoverPlainText(value.title, 120) || !value.title.trim() || !handoverPlainText(value.note, 2000)) return 'العنوان أو الملاحظات غير صالحة';
  if (value.supersedesId !== undefined && (typeof value.supersedesId !== 'string' || !ENTITY_ID_PATTERN.test(value.supersedesId) || value.supersedesId === value.id)) return 'مرجع التصحيح غير صالح';
  if (!Array.isArray(value.references) || value.references.length > 30) return 'يسمح بثلاثين مرجعاً كحد أقصى';
  const seen = new Set<string>();
  for (const ref of value.references) {
    if (!isFilterObject(ref) || Object.keys(ref).some(k => !['collection', 'id', 'note'].includes(k)) || !HANDOVER_REFERENCE_COLLECTIONS.includes(ref.collection as HandoverReferenceCollection) || typeof ref.id !== 'string' || !ENTITY_ID_PATTERN.test(ref.id) || !handoverPlainText(ref.note, 500)) return 'مرجع التسليم غير صالح';
    const key = `${ref.collection}:${ref.id}`;
    if (seen.has(key)) return 'لا يمكن تكرار المرجع';
    seen.add(key);
  }
  return null;
}
