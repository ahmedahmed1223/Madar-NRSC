import type { NewsroomDatabase } from './db';
import { buildVocabulary, createSearchIndex, didYouMean, parseQuery } from '../shared/arabicSearch';

/**
 * Archive search with the same Arabic matching as the newsroom screens (hamza/ة/ى variants,
 * diacritics, attached و/ب/ال, plural endings, "exact phrases", -excluded words), best match first,
 * newest first on equal relevance. Symbol-only queries keep the literal SQL search.
 */

export interface ArchiveItem {
  id: string;
  title: string;
  summary: string;
  status: string;
  categoryName: string;
  authorName: string;
  publishDate: string | null;
  updatedAt: string;
}

interface ArchiveRow {
  id: string;
  d: any;
  updatedAt: string;
}

const htmlText = (html: unknown) => String(html || '').replace(/<[^>]*>/g, ' ');

// The shared bounded text cache remains valid across database restores.
const index = createSearchIndex<ArchiveRow>({
  id: (r) => r.id,
  title: (r) => [r.d.title, r.d.shortTitle],
  body: (r) => [r.d.keywords, r.d.summary, r.d.locationName, htmlText(r.d.content)],
});

const toItem = (r: ArchiveRow): ArchiveItem => ({
  id: r.id,
  title: r.d.title || '',
  summary: r.d.summary || '',
  status: r.d.status,
  categoryName: r.d.categoryName || '',
  authorName: r.d.authorName || '',
  publishDate: r.d.publishDate || null,
  updatedAt: r.updatedAt,
});

export function searchArchive(
  db: NewsroomDatabase,
  beforeIso: string,
  query: string,
  limit: number,
  offset: number
): { total: number; items: ArchiveItem[]; suggestion?: string } {
  const q = query.trim();
  if (!q || parseQuery(q).empty) return db.searchNewsArchive(beforeIso, q, limit, offset);
  // The database supplies newest first. The relevance sort preserves that order on ties.
  const rows = db.listNewsArchive(beforeIso);
  if (!rows.length) return { total: 0, items: [] };
  const hits = index.search(rows, q);
  const result: { total: number; items: ArchiveItem[]; suggestion?: string } = {
    total: hits.length,
    items: hits.slice(offset, offset + limit).map((h) => toItem(h.item)),
  };
  if (hits.length <= 2 && offset === 0) {
    const vocab = buildVocabulary(rows.flatMap((r) => [r.d.title, r.d.summary, ...(Array.isArray(r.d.keywords) ? r.d.keywords : [])]));
    const fixed = didYouMean(q, vocab);
    if (fixed && index.count(rows, fixed) > hits.length) result.suggestion = fixed;
  }
  return result;
}
