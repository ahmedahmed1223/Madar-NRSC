/**
 * Search that works the way Arabic newsrooms type: ignores diacritics and tatweel, treats
 * أ/إ/آ/ٱ as ا, ة as ه, ى as ي, ؤ/ئ as و/ي, and Arabic-Indic digits as 0-9. Several words
 * must all appear (in any of the fields, in any order).
 */
export function normalizeArabic(text: unknown): string {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '') // tashkeel + tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/\s+/g, ' ')
    .trim();
}

export function matchesQuery(query: string, ...fields: unknown[]): boolean {
  const q = normalizeArabic(query);
  if (!q) return true;
  const hay = normalizeArabic(fields.flat().filter((f) => f != null).join(' \u0001 '));
  return q.split(' ').every((word) => hay.includes(word));
}
