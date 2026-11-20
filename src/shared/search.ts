import { foldArabic, matchesSearch } from './arabicSearch';

/**
 * Search that works the way Arabic newsrooms type: ignores diacritics and tatweel, treats
 * أ/إ/آ/ٱ as ا, ة as ه, ى as ي, ؤ/ئ as و/ي, and Arabic-Indic/Persian digits as 0-9. Several words
 * must all appear (in any of the fields, in any order). The matching itself lives in
 * ./arabicSearch (prefixes such as و/ب/ال, plural and pronoun endings, "exact phrases" and
 * -excluded words).
 */
export function normalizeArabic(text: unknown): string {
  return foldArabic(text);
}

export function matchesQuery(query: string, ...fields: unknown[]): boolean {
  return matchesSearch(query, ...fields);
}
