/**
 * Reading «دليل الاستخدام» (src/content/userGuide.ts): lookups, Arabic-aware search with
 * «هل تقصد», and the Markdown export written to docs/USER_GUIDE.md. Pure functions, shared by the
 * guide screen, the export script and the tests.
 */
import { GUIDE_CHAPTERS, GUIDE_PARTS, GUIDE_TITLE, type GuideBlock, type GuideChapter, type GuideEntry } from '../content/userGuide';
import { TOURS } from '../content/tours';
import { DEFAULT_ROLE_DEFINITIONS } from './rbac';
import { buildVocabulary, createSearchIndex, didYouMean, FEW_RESULTS, highlightRanges, type Vocabulary } from './arabicSearch';
import { APP_TITLE, screenTitle } from '../services/router';

export interface GuideLocation {
  chapter: GuideChapter;
  entry?: GuideEntry;
}

/** Every entry with the chapter it belongs to, in reading order. */
export const GUIDE_ENTRIES: { chapter: GuideChapter; entry: GuideEntry }[] = GUIDE_CHAPTERS.flatMap((chapter) => chapter.entries.map((entry) => ({ chapter, entry })));

const ENTRY_BY_ID = new Map(GUIDE_ENTRIES.map((x) => [x.entry.id, x]));

/** A chapter or an entry by id (the guide's address /guide/<id> takes either). */
export function findGuideTarget(id: string | null | undefined): GuideLocation | null {
  if (!id) return null;
  const chapter = GUIDE_CHAPTERS.find((c) => c.id === id);
  if (chapter) return { chapter };
  const hit = ENTRY_BY_ID.get(id);
  return hit ? { chapter: hit.chapter, entry: hit.entry } : null;
}

export function guideEntry(id: string): GuideEntry | undefined {
  return ENTRY_BY_ID.get(id)?.entry;
}

/** The screen's name as the rail and the window title show it. */
const SCREEN_NAME_OVERRIDES: Record<string, string> = {
  database: 'النسخ الاحتياطي وقاعدة البيانات',
  alerts: 'تنبيهاتي',
  'news-editor': 'محرر الخبر',
};
export function guideScreenName(nav: string): string {
  return SCREEN_NAME_OVERRIDES[nav] || screenTitle(nav).replace(` · ${APP_TITLE}`, '').replace(APP_TITLE, '') || nav;
}

export function guideScreenPath(block: { screen: string; path?: string }): string {
  return block.path || `/${block.screen}`;
}

export function tourTitle(id: string): string {
  return TOURS.find((t) => t.id === id)?.title || id;
}

export function roleName(code: string): string {
  return DEFAULT_ROLE_DEFINITIONS.find((r) => r.roleCode === code)?.nameAr || code;
}

/** Text of one block, for search and snippets. */
export function blockText(block: GuideBlock): string[] {
  switch (block.kind) {
    case 'p':
    case 'sub':
    case 'tip':
    case 'warning':
      return [block.text];
    case 'steps':
    case 'list':
      return block.items;
    case 'screens':
      return block.items.map((i) => `${guideScreenName(i.screen)}: ${i.text}`);
    case 'screen':
      return [block.label || guideScreenName(block.screen)];
    case 'tour':
      return [tourTitle(block.tour)];
    default:
      return [];
  }
}

export function entryText(entry: GuideEntry): string[] {
  return entry.body.flatMap(blockText);
}

// --- Search -------------------------------------------------------------------------------------

type Row = { chapter: GuideChapter; entry: GuideEntry };

const index = createSearchIndex<Row>({
  id: (r) => r.entry.id,
  version: () => 1,
  // Keywords count as body text so an exact title still earns its bonus.
  title: (r) => [r.entry.title],
  body: (r) => [r.entry.keywords || '', r.chapter.title, ...entryText(r.entry)],
});

export interface GuideHit extends Row {
  score: number;
  /** A line of the entry that holds the match (empty when only the title matched). */
  snippet: string;
}

/** Entries matching the query, best first (titles above bodies; reading order breaks ties). */
export function searchGuide(query: string): GuideHit[] {
  if (!query.trim()) return [];
  return index.search(GUIDE_ENTRIES, query).map(({ item, score }) => ({ ...item, score, snippet: snippetFor(item.entry, query) }));
}

/** The first line of the entry that the query highlights, trimmed around the match. */
export function snippetFor(entry: GuideEntry, query: string, max = 180): string {
  for (const line of entryText(entry)) {
    const ranges = highlightRanges(line, query);
    if (!ranges.length) continue;
    if (line.length <= max) return line;
    const start = Math.max(0, ranges[0][0] - 50);
    const cut = line.slice(start, start + max);
    return `${start > 0 ? '… ' : ''}${cut}${start + max < line.length ? ' …' : ''}`;
  }
  return '';
}

let vocabulary: Vocabulary | null = null;
/** The guide's own words, for «هل تقصد». Built on first use. */
export function guideVocabulary(): Vocabulary {
  if (!vocabulary) vocabulary = buildVocabulary(GUIDE_ENTRIES.flatMap(({ chapter, entry }) => [chapter.title, entry.title, entry.keywords || '', ...entryText(entry)]));
  return vocabulary;
}

/** «هل تقصد»: offered when the query finds few entries and the correction finds more. */
export function guideSuggestion(query: string, found: number): string | null {
  if (!query.trim() || found > FEW_RESULTS) return null;
  const better = didYouMean(query, guideVocabulary());
  if (!better || better === query.trim()) return null;
  return searchGuide(better).length > found ? better : null;
}

// --- Markdown export ----------------------------------------------------------------------------

const md = (text: string) => text.replace(/\r?\n/g, ' ');

function blockMarkdown(block: GuideBlock): string {
  switch (block.kind) {
    case 'p':
      return md(block.text);
    case 'sub':
      return `#### ${md(block.text)}`;
    case 'steps':
      return block.items.map((item, i) => `${i + 1}. ${md(item)}`).join('\n');
    case 'list':
      return block.items.map((item) => `- ${md(item)}`).join('\n');
    case 'tip':
      return `> **نصيحة:** ${md(block.text)}`;
    case 'warning':
      return `> **تنبيه:** ${md(block.text)}`;
    case 'screen':
      return `الشاشة: «${block.label?.replace(/^افتح\s*/, '').replace(/[«»]/g, '') || guideScreenName(block.screen)}» (\`${guideScreenPath(block)}\`)`;
    case 'screens':
      return block.items.map((i) => `- **«${guideScreenName(i.screen)}»** (\`/${i.screen}\`): ${md(i.text)}`).join('\n');
    case 'tour':
      return `> **جولة تفاعلية:** «${tourTitle(block.tour)}»، من «المساعدة» ← «جولات تفاعلية».`;
    case 'see':
      return `اقرأ أيضاً: ${block.entries.map((id) => `[${guideEntry(id)?.title || id}](#${id})`).join('، ')}.`;
    case 'setup':
      return 'يُفتح «الإعداد السريع» من «الرئيسية» أو من «المساعدة» ← «الإعداد السريع للنظام».';
  }
}

/** The whole guide as Markdown (docs/USER_GUIDE.md). */
export function guideToMarkdown(): string {
  const out: string[] = [];
  out.push(`# ${GUIDE_TITLE} — «${APP_TITLE}»`);
  out.push('<!-- مولَّد من src/content/userGuide.ts عبر `node scripts/export-user-guide.mjs`. لا تعدّله يدوياً. -->');
  out.push('الدليل نفسه داخل «مدار»: قسم «المساعدة» ← «دليل الاستخدام» (`/guide`)، مع البحث والجولات التفاعلية والطباعة.');
  out.push('## المحتويات');
  for (const part of GUIDE_PARTS) {
    const chapters = GUIDE_CHAPTERS.filter((c) => c.part === part.id);
    out.push(`- **${part.title}**\n${chapters.map((c) => `  - [${c.title}](#${c.id})`).join('\n')}`);
  }
  for (const part of GUIDE_PARTS) {
    out.push(`---\n\n# ${part.title}`);
    for (const chapter of GUIDE_CHAPTERS.filter((c) => c.part === part.id)) {
      out.push(`<a id="${chapter.id}"></a>\n\n## ${chapter.title}`);
      out.push(md(chapter.intro));
      if (chapter.roles?.length) out.push(`الأدوار: ${chapter.roles.map(roleName).join('، ')}.`);
      if (chapter.part === 'glossary') {
        out.push(chapter.entries.map((e) => `<a id="${e.id}"></a>**${e.title}**: ${entryText(e).map(md).join(' ')}`).join('\n\n'));
        continue;
      }
      for (const entry of chapter.entries) {
        out.push(`<a id="${entry.id}"></a>\n\n### ${entry.title}`);
        for (const block of entry.body) out.push(blockMarkdown(block));
      }
    }
  }
  return `${out.join('\n\n')}\n`;
}
