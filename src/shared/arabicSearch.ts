/**
 * Arabic-aware search for the whole newsroom: normalisation, light stemming, a relevance-scored
 * matcher, «هل تقصد» corrections, autocomplete from the newsroom's own words, and highlighting
 * that maps matches back to the original text.
 *
 * Pure functions only (no DOM, no storage): the browser and the server both import this file.
 */

// --- Normalisation ------------------------------------------------------------------------------

/** Harakat, Quranic marks, superscript alef and tatweel. */
const DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;
const IS_DIACRITIC = /^[ؐ-ًؚ-ٰٟۖ-ۭـ]$/;
const WORD_CHAR = /^[\p{L}\p{N}]$/u;

/**
 * Character-level folding: lower case, no diacritics or tatweel, أ/إ/آ/ٱ → ا, ى → ي, ة → ه,
 * ؤ → و, ئ → ي, Persian ی/ک → ي/ك, Arabic-Indic and Persian digits → 0-9, single spaces.
 * Punctuation is kept (see {@link normalizeSearchText} for the version used to match words).
 */
export function foldArabic(text: unknown): string {
  return String(text ?? '')
    .toLowerCase()
    .replace(DIACRITICS, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/[ىیۍ]/g, 'ي')
    .replace(/[ةۀ]/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ک/g, 'ك')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0))
    .replace(/\s+/g, ' ')
    .trim();
}

/** {@link foldArabic} plus punctuation (Latin and Arabic: ، ؛ ؟ « » …) turned into word breaks. */
export function normalizeSearchText(text: unknown): string {
  return foldArabic(text).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Normalised words of a text. */
export function tokenize(text: unknown): string[] {
  const n = normalizeSearchText(text);
  return n ? n.split(' ') : [];
}

// --- Light stemming -----------------------------------------------------------------------------

/** Attached prefixes, longest first, with the shortest remainder that still counts as a word. */
const PREFIXES: ReadonlyArray<readonly [string, number]> = [
  ['وال', 2], ['بال', 2], ['كال', 2], ['فال', 2], ['لل', 2], ['ال', 2],
  ['و', 3], ['ف', 3], ['ب', 3], ['ل', 3], ['ك', 3],
];

/**
 * Suffixes on normalised words (ة is already ه, so ‑ية is ‑يه), longest first. Plural/dual endings
 * need a longer remainder so names such as لبنان or إيران are left alone, and so do a lone ‑ي/‑ة
 * (صحفي is not صحف, دولة is not دول). ‑ية drops only the ة so صحفية, صحفي and الصحفيين meet on صحفي.
 */
const SUFFIXES: ReadonlyArray<readonly [string, number, number]> = [
  // [suffix, minimum remainder, characters to drop]
  ['ات', 4, 2], ['ون', 4, 2], ['ين', 4, 2], ['ان', 4, 2],
  ['يه', 3, 1], ['ها', 3, 2], ['هم', 3, 2], ['هن', 3, 2], ['كم', 3, 2], ['نا', 3, 2],
  ['ي', 4, 1], ['ه', 4, 1],
];

/** Removes one attached prefix (و، ف، ب، ل، ك، ال and their combinations) from a normalised word. */
export function stripPrefix(word: string): string {
  for (const [p, min] of PREFIXES) {
    if (word.startsWith(p) && word.length - p.length >= min) return word.slice(p.length);
  }
  return word;
}

/** Removes one common suffix (plural, dual, pronoun, nisba) from a normalised word. */
export function stripSuffix(word: string): string {
  for (const [s, min, drop] of SUFFIXES) {
    if (word.endsWith(s) && word.length - s.length >= min) return word.slice(0, word.length - drop);
  }
  return word;
}

/** Conservative light stem of a normalised word: one prefix and one suffix at most. */
export function stem(word: string): string {
  return stripSuffix(stripPrefix(word));
}

/** Shorter forms of a query word that may also be searched for (never shorter than 3 letters). */
export function stemCandidates(word: string): string[] {
  const p = stripPrefix(word);
  const out = new Set([p, stripSuffix(word), stripSuffix(p)]);
  out.delete(word);
  return [...out].filter((c) => c.length >= 3);
}

const stripArticle = (w: string) => (w.startsWith('ال') && w.length > 3 ? w.slice(2) : w);

// --- Query parsing ------------------------------------------------------------------------------

export interface ParsedQuery {
  /** Normalised words that must all match (prefix and stem aware). */
  terms: string[];
  /** Stem candidates of each term, same order as `terms`. */
  candidates: string[][];
  /** Normalised "exact phrases" (from "…" or «…») that must appear word for word. */
  phrases: string[];
  /** Normalised words after a leading minus: records containing them are left out. */
  excluded: string[];
  /** Stem candidates of each excluded word. */
  excludedCandidates: string[][];
  /** The terms joined, used for the exact-phrase bonus. */
  joined: string;
  /** True when nothing searchable was typed. */
  empty: boolean;
}

const QUOTED = /["«“”]([^"«»“”]*)["»”“]?/g;
let lastParsed: { raw: string; parsed: ParsedQuery } | null = null;

/** Parses a query: plain words, "quoted phrases" and -excluded words. Memoised for the last query. */
export function parseQuery(raw: string): ParsedQuery {
  if (lastParsed && lastParsed.raw === raw) return lastParsed.parsed;
  const phrases: string[] = [];
  const rest = String(raw ?? '').replace(QUOTED, (_m, inner: string) => {
    const p = normalizeSearchText(inner);
    if (p) phrases.push(p);
    return ' ';
  });
  const terms: string[] = [];
  const excluded: string[] = [];
  for (const piece of rest.split(/\s+/)) {
    if (!piece) continue;
    const negative = /^[-−]/.test(piece) && piece.length > 1;
    const words = tokenize(negative ? piece.slice(1) : piece);
    for (const w of words) {
      const list = negative ? excluded : terms;
      if (!list.includes(w)) list.push(w);
    }
  }
  const parsed: ParsedQuery = {
    terms,
    candidates: terms.map(stemCandidates),
    phrases,
    excluded,
    excludedCandidates: excluded.map(stemCandidates),
    joined: terms.join(' '),
    empty: !terms.length && !phrases.length && !excluded.length,
  };
  lastParsed = { raw, parsed };
  return parsed;
}

// --- Prepared text and matching -----------------------------------------------------------------

/** A searchable text, normalised once. */
export interface PreparedText {
  /** ' ' + normalised text + ' ' so word starts are ' ' + word. */
  hay: string;
  /** The same words with attached prefixes removed (absent for very long texts). */
  bare: string | null;
}

const BARE_LIMIT = 6000;

export function prepareText(...fields: unknown[]): PreparedText {
  const norm = normalizeSearchText(flatJoin(fields));
  const bare = norm.length <= BARE_LIMIT ? ` ${norm.split(' ').map(stripPrefix).join(' ')} ` : null;
  return { hay: ` ${norm} `, bare };
}

function flatJoin(fields: unknown[]): string {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (v == null || v === false) return;
    if (Array.isArray(v)) v.forEach(walk);
    else out.push(String(v));
  };
  fields.forEach(walk);
  return out.join(' \n ');
}

/** How well one query word matches: 4 whole word, 3 word start, 2 stem, 1 inside a word, 0 none. */
export function termLevel(p: PreparedText, term: string, candidates: string[] = stemCandidates(term)): number {
  const { hay, bare } = p;
  if (hay.includes(` ${term} `) || (bare && bare.includes(` ${term} `))) return 4;
  if (hay.includes(` ${term}`) || (bare && bare.includes(` ${term}`))) return 3;
  for (const c of candidates) {
    if (hay.includes(` ${c}`) || (bare && bare.includes(` ${c}`))) return 2;
  }
  return hay.includes(term) ? 1 : 0;
}

/**
 * Relevance of a record, or null when it does not match. Every word must match somewhere; quoted
 * phrases must appear word for word; excluded words must not appear. Matches in the title count
 * three times as much as matches in the body, with bonuses for the whole query as a phrase and for
 * all words in the title. Ties (and recency) are for the caller to break.
 */
export function scorePrepared(q: ParsedQuery, title: PreparedText, body?: PreparedText | null): number | null {
  for (let i = 0; i < q.excluded.length; i++) {
    const x = q.excluded[i];
    const c = q.excludedCandidates[i];
    if (termLevel(title, x, c) >= 2 || (body && termLevel(body, x, c) >= 2)) return null;
  }
  let score = 0;
  let allInTitle = true;
  for (const ph of q.phrases) {
    const needle = ` ${ph} `;
    if (title.hay.includes(needle)) score += 12;
    else if (body && body.hay.includes(needle)) { score += 5; allInTitle = false; }
    else return null;
  }
  for (let i = 0; i < q.terms.length; i++) {
    const t = q.terms[i];
    const c = q.candidates[i];
    const inTitle = termLevel(title, t, c);
    const inBody = body ? termLevel(body, t, c) : 0;
    if (!inTitle && !inBody) return null;
    if (!inTitle) allInTitle = false;
    score += Math.max(inTitle * 3, inBody);
  }
  if (q.terms.length) {
    if (q.terms.length > 1 && title.hay.includes(` ${q.joined}`)) score += 15;
    else if (q.terms.length > 1 && body && body.hay.includes(` ${q.joined}`)) score += 5;
    if (title.hay.trim() === q.joined) score += 20;
  }
  if (allInTitle && (q.terms.length || q.phrases.length)) score += 10;
  return score;
}

// Text-keyed cache, so filtering the same list on every keystroke normalises each record once.
const textCache = new Map<string, PreparedText>();
const TEXT_CACHE_LIMIT = 20000;

function preparedFor(joined: string): PreparedText {
  let p = textCache.get(joined);
  if (!p) {
    if (textCache.size >= TEXT_CACHE_LIMIT) textCache.clear();
    p = prepareText(joined);
    textCache.set(joined, p);
  }
  return p;
}

/** Symbols-only queries (%, ?, #…) are matched literally, as before. */
function literalFallback(query: string, fields: unknown[]): boolean | null {
  const raw = String(query ?? '').trim();
  if (!raw || !/[^\s"«»“”\-−]/.test(raw)) return null;
  return flatJoin(fields).toLowerCase().includes(raw.toLowerCase());
}

/** Relevance of a set of fields (all treated as the title), or null when they do not match. */
export function scoreFields(query: string, ...fields: unknown[]): number | null {
  const q = parseQuery(query);
  if (q.empty) {
    const literal = literalFallback(query, fields);
    return literal === false ? null : 0;
  }
  return scorePrepared(q, preparedFor(flatJoin(fields)));
}

/** True when every query word matches one of the fields (Arabic-normalised, prefix and stem aware). */
export function matchesSearch(query: string, ...fields: unknown[]): boolean {
  return scoreFields(query, ...fields) !== null;
}

// --- Record index (memoised by id + updatedAt) --------------------------------------------------

export interface SearchIndexOptions<T> {
  id: (item: T) => string;
  /** Changes whenever the record's text may have changed (updatedAt, version…). */
  version?: (item: T) => unknown;
  /** Short, important fields (title, name, keywords). */
  title: (item: T) => unknown[];
  /** Longer text (summary, body). */
  body?: (item: T) => unknown[];
}

export interface SearchHit<T> {
  item: T;
  score: number;
}

export interface SearchIndex<T> {
  /** Matching records, best first (stable for equal scores). */
  search(items: readonly T[], query: string): SearchHit<T>[];
  /** Number of matches only. */
  count(items: readonly T[], query: string): number;
}

export function createSearchIndex<T>(opts: SearchIndexOptions<T>): SearchIndex<T> {
  const cache = new Map<string, { ver: unknown; title: PreparedText; body: PreparedText | null }>();
  const prepared = (item: T) => {
    if (!opts.version) {
      // No version to trust: fall back to the text-keyed cache.
      return { title: preparedFor(flatJoin(opts.title(item))), body: opts.body ? preparedFor(flatJoin(opts.body(item))) : null };
    }
    const id = opts.id(item);
    const ver = opts.version(item);
    const hit = cache.get(id);
    if (hit && hit.ver === ver) return hit;
    const entry = { ver, title: prepareText(opts.title(item)), body: opts.body ? prepareText(opts.body(item)) : null };
    cache.set(id, entry);
    return entry;
  };
  const search = (items: readonly T[], query: string): SearchHit<T>[] => {
    const q = parseQuery(query);
    if (q.empty) {
      const out: SearchHit<T>[] = [];
      for (const item of items) {
        const fields = [...opts.title(item), ...(opts.body ? opts.body(item) : [])];
        if (literalFallback(query, fields) !== false) out.push({ item, score: 0 });
      }
      return out;
    }
    const hits: SearchHit<T>[] = [];
    for (const item of items) {
      const p = prepared(item);
      const score = scorePrepared(q, p.title, p.body);
      if (score !== null) hits.push({ item, score });
    }
    return hits.sort((a, b) => b.score - a.score);
  };
  return { search, count: (items, query) => search(items, query).length };
}

// --- Vocabulary ---------------------------------------------------------------------------------

export interface VocabEntry {
  /** Normalised word. */
  key: string;
  /** How the newsroom writes it (with hamza and ة when any record does). */
  display: string;
  count: number;
}

export interface Vocabulary {
  entries: Map<string, VocabEntry>;
  /** Normalised words, sorted, for prefix lookups. */
  keys: string[];
  /** [word without attached prefix, word], sorted by the first, so «مؤت» completes «المؤتمر». */
  bare: Array<[string, string]>;
}

const SURFACE_SPLIT = /[^\p{L}\p{N}ؐ-ًؚ-ٰٟۖ-ۭـ]+/u;
const surfaceRank = (s: string) => (s.match(/[أإآؤئةى]/g) || []).length;

/** Builds the word → frequency list of the newsroom's own texts (titles, names, keywords…). */
export function buildVocabulary(texts: Iterable<unknown>, minLength = 2): Vocabulary {
  const entries = new Map<string, VocabEntry>();
  const keyOf = new Map<string, string>();
  for (const text of texts) {
    if (text == null || text === '') continue;
    for (const raw of String(text).split(SURFACE_SPLIT)) {
      if (!raw) continue;
      let key = keyOf.get(raw);
      if (key === undefined) {
        key = normalizeSearchText(raw);
        keyOf.set(raw, key);
      }
      if (key.length < minLength || key.includes(' ') || /^\d+$/.test(key)) continue;
      const e = entries.get(key);
      if (e) {
        e.count++;
        if (e.display !== raw) {
          const clean = raw.replace(DIACRITICS, '');
          if (surfaceRank(clean) > surfaceRank(e.display)) e.display = clean;
        }
      } else {
        entries.set(key, { key, display: raw.replace(DIACRITICS, ''), count: 1 });
      }
    }
  }
  const keys = [...entries.keys()].sort();
  const bare: Array<[string, string]> = [];
  for (const k of keys) {
    const b = stripPrefix(k);
    if (b !== k) bare.push([b, k]);
  }
  bare.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return { entries, keys, bare };
}

function lowerBound<T>(arr: readonly T[], value: string, get: (x: T) => string): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (get(arr[mid]) < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Vocabulary words starting with `prefix` (directly or after و/ب/ال…). */
function wordsWithPrefix(vocab: Vocabulary, prefix: string, max = 400): string[] {
  const out = new Set<string>();
  for (let i = lowerBound(vocab.keys, prefix, (k) => k); i < vocab.keys.length && out.size < max; i++) {
    if (!vocab.keys[i].startsWith(prefix)) break;
    out.add(vocab.keys[i]);
  }
  for (let i = lowerBound(vocab.bare, prefix, (b) => b[0]); i < vocab.bare.length && out.size < max; i++) {
    if (!vocab.bare[i][0].startsWith(prefix)) break;
    out.add(vocab.bare[i][1]);
  }
  return [...out];
}

// --- Autocomplete -------------------------------------------------------------------------------

export interface Completion {
  /** The whole query with the last word completed. */
  query: string;
  /** The completed word as the newsroom writes it. */
  word: string;
}

/**
 * Completions for the word being typed (the last one), most frequent first. Nothing is offered
 * after a space, inside quotes, for excluded words or for fewer than two letters.
 */
export function completeQuery(query: string, vocab: Vocabulary, limit = 5): Completion[] {
  const raw = String(query ?? '');
  if (!raw.trim() || /\s$/.test(raw)) return [];
  if (((raw.match(/["«»“”]/g) || []).length) % 2 === 1) return [];
  const m = /(\S+)$/.exec(raw);
  if (!m || /^[-−"«“]/.test(m[1])) return [];
  const last = normalizeSearchText(m[1]);
  if (last.length < 2 || last.includes(' ')) return [];
  const head = raw.slice(0, m.index);
  const used = new Set(tokenize(head));
  return wordsWithPrefix(vocab, last)
    .filter((k) => k !== last && !used.has(k))
    .map((k) => vocab.entries.get(k)!)
    .sort((a, b) => b.count - a.count || a.key.length - b.key.length || (a.key < b.key ? -1 : 1))
    .slice(0, limit)
    .map((e) => ({ query: `${head}${e.display}`, word: e.display }));
}

// --- «هل تقصد» ----------------------------------------------------------------------------------

/** Optimal-string-alignment Damerau–Levenshtein distance; returns max + 1 once it is exceeded. */
export function editDistance(a: string, b: string, max = Infinity): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const n = a.length;
  const m = b.length;
  if (!n) return m;
  if (!m) return n;
  let prev2 = new Array<number>(m + 1).fill(0);
  let prev = Array.from({ length: m + 1 }, (_, j) => j);
  let cur = new Array<number>(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    [prev2, prev, cur] = [prev, cur, prev2];
  }
  return prev[m];
}

/** Edits allowed for a word of this length. */
export function maxEditsFor(length: number): number {
  return length <= 3 ? 0 : length <= 5 ? 1 : length <= 8 ? 2 : 3;
}

/** True when the newsroom's texts contain the word (or a form of it). */
function isKnown(vocab: Vocabulary, w: string): boolean {
  const e = vocab.entries;
  if (e.has(w) || e.has(`ال${w}`) || e.has(stripArticle(w))) return true;
  if (stemCandidates(w).some((c) => e.has(c) || e.has(`ال${c}`))) return true;
  return wordsWithPrefix(vocab, w, 1).length > 0;
}

/** Closest newsroom word to a misspelt one, or null. Prefers fewer edits, then frequent words. */
export function closestWord(vocab: Vocabulary, w: string): VocabEntry | null {
  const max = maxEditsFor(w.length);
  if (!max) return null;
  const wBare = stripArticle(w);
  const wHasAl = wBare !== w;
  let best: VocabEntry | null = null;
  let bestScore = Infinity;
  for (const entry of vocab.entries.values()) {
    const k = entry.key;
    if (k.length < 3 || Math.abs(k.length - w.length) > max + 2) continue;
    let d = editDistance(w, k, max);
    const kBare = stripArticle(k);
    if (d > max && (wHasAl || kBare !== k)) d = editDistance(wBare, kBare, max);
    if (d > max || d === 0) continue;
    const alMismatch = wHasAl !== (kBare !== k) ? 0.5 : 0;
    const score = d * 10 + alMismatch - Math.log2(entry.count + 1) * 0.9;
    if (score < bestScore) {
      bestScore = score;
      best = entry;
    }
  }
  return best;
}

/**
 * «هل تقصد»: the query with each unknown word replaced by the closest newsroom word, or null when
 * every word is known or nothing close exists. Quoted phrases and -excluded words are kept as typed.
 * Hamza, ة/ه and ى/ي variants are already absorbed by normalisation, so they are never "corrected".
 */
export function didYouMean(query: string, vocab: Vocabulary): string | null {
  const raw = String(query ?? '').trim();
  if (!raw || !vocab.entries.size) return null;
  let changed = false;
  const pieces = raw.match(/["«“][^"»”]*["»”]?|\S+/g) || [];
  const out = pieces.map((piece) => {
    if (/^["«“]/.test(piece) || /^[-−]/.test(piece)) return piece;
    const words = tokenize(piece);
    if (words.length !== 1) return piece;
    const w = words[0];
    if (w.length < 3 || /\d/.test(w) || isKnown(vocab, w)) return piece;
    const best = closestWord(vocab, w);
    if (!best) return piece;
    changed = true;
    // Keep punctuation typed around the word.
    const m = /^([^\p{L}\p{N}]*)[\s\S]*?([^\p{L}\p{N}]*)$/u.exec(piece);
    return `${m?.[1] || ''}${best.display}${m?.[2] || ''}`;
  });
  return changed ? out.join(' ') : null;
}

// --- Recent searches (pure helpers; storage lives in the browser service) -----------------------

export const RECENT_SEARCH_LIMIT = 8;

/** Puts a query first, drops older copies of it (compared normalised) and caps the list. */
export function pushRecentSearch(list: readonly string[], query: string, limit = RECENT_SEARCH_LIMIT): string[] {
  const q = String(query ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!normalizeSearchText(q)) return [...list].slice(0, limit);
  const key = normalizeSearchText(q);
  return [q, ...list.filter((x) => normalizeSearchText(x) !== key)].slice(0, limit);
}

/** Accepts only a list of non-empty strings (a corrupted stored value never breaks the screen). */
export function sanitizeRecentSearches(value: unknown, limit = RECENT_SEARCH_LIMIT): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const v of value) {
    if (typeof v !== 'string' || !v.trim()) continue;
    if (out.some((x) => normalizeSearchText(x) === normalizeSearchText(v))) continue;
    out.push(v.slice(0, 200));
    if (out.length >= limit) break;
  }
  return out;
}

/** Recent searches that continue what is typed (all of them for an empty box). */
export function matchingRecentSearches(list: readonly string[], query: string, limit = 5): string[] {
  const q = normalizeSearchText(query);
  if (!q) return list.slice(0, limit);
  return list.filter((x) => { const n = normalizeSearchText(x); return n !== q && n.startsWith(q); }).slice(0, limit);
}

// --- Highlighting -------------------------------------------------------------------------------

export interface HighlightSegment {
  text: string;
  match: boolean;
}

/** Folds one character the way {@link normalizeSearchText} does ('' for marks, ' ' for breaks). */
function foldChar(ch: string): string {
  if (IS_DIACRITIC.test(ch)) return '';
  const f = foldArabic(ch);
  if (!f) return ' ';
  return WORD_CHAR.test(f[0]) ? f : ' ';
}

/**
 * Ranges [start, end) of the original text to emphasise for a query: whole words matched by a
 * query word (prefix, stem or inside the word) and exact phrases. Excluded words are not marked.
 */
export function highlightRanges(text: string, query: string): Array<[number, number]> {
  const src = String(text ?? '');
  const q = parseQuery(query);
  if (!src || (!q.terms.length && !q.phrases.length)) return [];
  // Normalised text with, for each normalised character, the index of its source character.
  let norm = '';
  const map: number[] = [];
  for (let i = 0; i < src.length; i++) {
    let ch = src[i];
    const code = src.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < src.length) ch += src[i + 1];
    const f = foldChar(ch);
    for (const raw of f) {
      const c = WORD_CHAR.test(raw) ? raw : ' ';
      if (c === ' ' && (norm.endsWith(' ') || !norm)) continue;
      norm += c;
      map.push(i);
    }
    i += ch.length - 1;
  }
  const ranges: Array<[number, number]> = [];
  const endOf = (normEnd: number) => {
    // Extend over the marks (harakat, tatweel) that follow the last matched letter.
    let e = map[normEnd - 1] + 1;
    while (e < src.length && IS_DIACRITIC.test(src[e])) e++;
    if (e < src.length && /[\udc00-\udfff]/.test(src[e])) e++;
    return e;
  };
  const re = /[^ ]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(norm))) {
    const w = m[0];
    const bare = stripPrefix(w);
    const hit = q.terms.some((t, i) => {
      if (w.startsWith(t) || bare.startsWith(t)) return true;
      if (q.candidates[i].some((c) => w.startsWith(c) || bare.startsWith(c))) return true;
      return t.length >= 2 && w.includes(t);
    });
    if (hit) ranges.push([map[m.index], endOf(m.index + w.length)]);
  }
  for (const ph of q.phrases) {
    let from = 0;
    for (;;) {
      const at = norm.indexOf(ph, from);
      if (at < 0) break;
      const before = at === 0 || norm[at - 1] === ' ';
      const after = at + ph.length === norm.length || norm[at + ph.length] === ' ';
      if (before && after) ranges.push([map[at], endOf(at + ph.length)]);
      from = at + 1;
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

/** The text split into matched and unmatched pieces, ready to render. */
export function highlightSegments(text: string, query: string): HighlightSegment[] {
  const src = String(text ?? '');
  const ranges = highlightRanges(src, query);
  if (!ranges.length) return src ? [{ text: src, match: false }] : [];
  const out: HighlightSegment[] = [];
  let at = 0;
  for (const [s, e] of ranges) {
    if (s > at) out.push({ text: src.slice(at, s), match: false });
    out.push({ text: src.slice(s, e), match: true });
    at = e;
  }
  if (at < src.length) out.push({ text: src.slice(at), match: false });
  return out;
}

// --- When to offer «هل تقصد» --------------------------------------------------------------------

/** Results this few (or none) make a correction worth offering. */
export const FEW_RESULTS = 2;
