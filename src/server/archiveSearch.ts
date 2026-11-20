import type { NewsroomDatabase } from './db';
import { didYouMean, parseQuery } from '../shared/arabicSearch';
import { archiveMatch } from './archiveIndex';

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
  const ranked = db.rankNewsArchive(beforeIso, q, archiveMatch(q), limit, offset);
  const result: { total: number; items: ArchiveItem[]; suggestion?: string } = {
    total: ranked.total,
    items: ranked.items.map(toItem),
  };
  if (ranked.total <= 2 && offset === 0) {
    const fixed = didYouMean(q, db.archiveVocabulary(beforeIso));
    if (fixed && db.rankNewsArchive(beforeIso, fixed, archiveMatch(fixed), 0, 0).total > ranked.total) result.suggestion = fixed;
  }
  return result;
}
