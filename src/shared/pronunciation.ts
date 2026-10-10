import { normalizeArabic } from './search';
import { plainText } from './bulletins';
export interface PronunciationTerm {
  id: string; term: string; pronunciation: string; note: string; enabled: boolean;
  createdBy?: string; createdAt?: string; updatedBy?: string; updatedAt?: string;
}
export type PronunciationNote = Pick<PronunciationTerm, 'term' | 'pronunciation' | 'note'>;
export function pronunciationDraftConflict(original: PronunciationTerm, current?: PronunciationTerm): string | null {
  if (!current) return 'حذف زميل هذا الاسم؛ المسودة باقية ولا يمكن إعادته تلقائياً';
  const fields: (keyof PronunciationTerm)[] = ['id', 'term', 'pronunciation', 'note', 'enabled', 'createdBy', 'createdAt', 'updatedBy', 'updatedAt'];
  return fields.some(field => original[field] !== current[field]) ? 'تغير الاسم عند زميل؛ المسودة باقية. ألغِ التحرير وافتح النسخة الحالية للمراجعة' : null;
}
export function pronunciationError(value: any): string | null {
  if (!value || typeof value.enabled !== 'boolean') return 'بيانات قاموس النطق غير صالحة';
  for (const [field, max, required] of [['term', 200, true], ['pronunciation', 300, true], ['note', 1000, false]] as const) {
    if (typeof value[field] !== 'string' || value[field].length > max || (required && !value[field].trim())) return 'الاسم أو النطق أو الملاحظة غير صالح';
  }
  return null;
}

export function matchingPronunciations(script: string, terms: PronunciationTerm[], limit = 200): PronunciationNote[] {
  const text = normalizeArabic(plainText(script));
  const result: PronunciationNote[] = [];
  const seen = new Set<string>();
  const cap = Number.isFinite(limit) ? Math.max(0, Math.min(200, Math.floor(limit))) : 200;
  for (const term of terms) {
    if (result.length >= cap) break;
    if (!term.enabled || pronunciationError(term)) continue;
    const normalized = normalizeArabic(term.term);
    if (!normalized || seen.has(normalized)) continue;
    const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, 'u').test(text)) {
      seen.add(normalized); result.push({ term: term.term, pronunciation: term.pronunciation, note: term.note });
    }
  }
  return result;
}
