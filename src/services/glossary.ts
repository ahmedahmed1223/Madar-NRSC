import { apiService } from './api';
import { normalizeArabic } from '../shared/search';

/**
 * Names and terms the newsroom already uses (colleagues, guests, places, keywords, sources,
 * programmes, coverages), for autocomplete while writing. Rebuilt at most every 30 seconds.
 */
let cache: { at: number; terms: string[] } | null = null;

export function newsroomGlossary(): string[] {
  if (cache && Date.now() - cache.at < 30_000) return cache.terms;
  const add = new Map<string, string>();
  const put = (v: unknown) => {
    const t = String(v ?? '').replace(/\s+/g, ' ').trim();
    if (t.length < 3 || t.length > 60) return;
    const k = normalizeArabic(t);
    if (!add.has(k)) add.set(k, t);
  };
  try {
    apiService.getUsers().forEach((u) => put(u.fullName));
    apiService.getGuests().forEach((g: any) => {
      put(g.fullName);
      put(g.title);
      put(g.organization);
    });
    apiService.getNews().forEach((n: any) => {
      (n.keywords || []).forEach(put);
      put(n.locationName);
    });
    apiService.getStories().forEach((s: any) => {
      put(s.title);
      (s.keywords || []).forEach(put);
      put(s.locationName);
    });
    apiService.getCategories().forEach((c: any) => put(c.nameAr));
    apiService.getNewsSources().forEach((s: any) => put(s.name));
    apiService.getPrograms().forEach((p: any) => put(p.name));
    apiService.getDiary().forEach((d) => put(d.location));
  } catch {
    // Data not loaded yet: no suggestions.
  }
  cache = { at: Date.now(), terms: [...add.values()] };
  return cache.terms;
}

/** Terms that continue what is being typed (prefix of any word in the term), best first. */
export function completionsFor(fragment: string, limit = 5): string[] {
  const q = normalizeArabic(fragment);
  if (q.length < 2) return [];
  const out: { term: string; score: number }[] = [];
  for (const term of newsroomGlossary()) {
    const n = normalizeArabic(term);
    if (n === q) continue;
    if (n.startsWith(q)) out.push({ term, score: 0 });
    else if (n.split(' ').some((w) => w.startsWith(q) || w.replace(/^ال/, '').startsWith(q))) out.push({ term, score: 1 });
  }
  return out
    .sort((a, b) => a.score - b.score || a.term.length - b.term.length)
    .slice(0, limit)
    .map((x) => x.term);
}
