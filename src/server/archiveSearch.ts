import type { NewsroomDatabase } from './db';
import { SETTLED_NEWS_STATUSES } from '../shared/collections';
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
  v: number;
  d: any;
}

const SETTLED = new Set<string>(SETTLED_NEWS_STATUSES);
const htmlText = (html: unknown) => String(html || '').replace(/<[^>]*>/g, ' ');

// Normalised text is kept per row id + version, so repeated searches only parse JSON.
const index = createSearchIndex<ArchiveRow>({
  id: (r) => r.id,
  version: (r) => r.v,
  title: (r) => [r.d.title, r.d.shortTitle, r.d.keywords],
  body: (r) => [r.d.summary, r.d.locationName, htmlText(r.d.content)],
});

const toItem = (r: ArchiveRow): ArchiveItem => ({
  id: r.id,
  title: r.d.title || '',
  summary: r.d.summary || '',
  status: r.d.status,
  categoryName: r.d.categoryName || '',
  authorName: r.d.authorName || '',
  publishDate: r.d.publishDate || null,
  updatedAt: r.d.__updatedAt || r.d.updatedAt || '',
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
  // The archive window: settled stories whose row was not touched since `beforeIso`. The row's own
  // updated_at is what the SQL search compares, so read it from the unfiltered listing.
  const settledIds = new Map<string, string>();
  for (let page = 0; ; page++) {
    const chunk = db.searchNewsArchive(beforeIso, '', 1000, page * 1000);
    chunk.items.forEach((i) => settledIds.set(i.id, i.updatedAt));
    if (chunk.items.length < 1000) break;
  }
  if (!settledIds.size) return { total: 0, items: [] };
  const rows: ArchiveRow[] = [];
  for (const row of db.listCollection('news')) {
    if (!settledIds.has(row.id) || !row.d || row.d.deletedAt || !SETTLED.has(row.d.status)) continue;
    rows.push({ id: row.id, v: row.v, d: { ...row.d, __updatedAt: settledIds.get(row.id) } });
  }
  const hits = index
    .search(rows, q)
    .sort((a, b) => b.score - a.score || toItem(b.item).updatedAt.localeCompare(toItem(a.item).updatedAt));
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
