import { describe, expect, it } from 'vitest';
import {
  buildVocabulary,
  completeQuery,
  createSearchIndex,
  didYouMean,
  editDistance,
  foldArabic,
  highlightRanges,
  highlightSegments,
  matchesSearch,
  matchingRecentSearches,
  normalizeSearchText,
  parseQuery,
  pushRecentSearch,
  sanitizeRecentSearches,
  scoreFields,
  stem,
  stemCandidates,
  stripPrefix,
  stripSuffix,
  tokenize,
} from '../../src/shared/arabicSearch';

describe('normalisation', () => {
  it('folds hamza, taa marbuta, alef maqsura, diacritics, tatweel and digits', () => {
    expect(foldArabic('أحمد إبراهيم آمنة ٱلقدس')).toBe('احمد ابراهيم امنه القدس');
    expect(foldArabic('مُصْطَفَى')).toBe('مصطفي');
    expect(foldArabic('الـــقمة ٢٠٢٦')).toBe('القمه 2026');
    expect(foldArabic('مسؤول هيئة')).toBe('مسوول هييه');
    expect(foldArabic('۱۴۰۵ CNN')).toBe('1405 cnn');
  });

  it('turns Latin and Arabic punctuation into word breaks', () => {
    expect(normalizeSearchText('غزة، رفح؛ هل انتهى؟ «الهدنة»…')).toBe('غزه رفح هل انتهي الهدنه');
    expect(tokenize('  news.view —  COVID-19 ')).toEqual(['news', 'view', 'covid', '19']);
  });
});

describe('light stemming', () => {
  it('strips attached prefixes only when a real word remains', () => {
    expect(stripPrefix('بالموتمر')).toBe('موتمر');
    expect(stripPrefix('والحكومه')).toBe('حكومه');
    expect(stripPrefix('للصحفيين')).toBe('صحفيين');
    expect(stripPrefix('بغزه')).toBe('غزه');
    expect(stripPrefix('بيت')).toBe('بيت'); // ب + two letters is not a prefix
    expect(stripPrefix('ال')).toBe('ال');
  });

  it('strips plural, dual, pronoun and nisba endings conservatively', () => {
    expect(stripSuffix('صحفيين')).toBe('صحفي');
    expect(stripSuffix('صحفيه')).toBe('صحفي'); // صحفية
    expect(stripSuffix('مراسلون')).toBe('مراسل');
    expect(stripSuffix('سيارات')).toBe('سيار');
    expect(stripSuffix('لبنان')).toBe('لبنان'); // names ending in -ان stay whole
    expect(stripSuffix('ايران')).toBe('ايران');
    expect(stripSuffix('غزه')).toBe('غزه');
    expect(stem('الصحفيين')).toBe('صحفي');
    expect(stemCandidates('الصحفيين')).toEqual(expect.arrayContaining(['صحفيين', 'صحفي']));
    expect(stemCandidates('غزه')).toEqual([]);
  });
});

describe('matching', () => {
  it('finds newsroom words through prefixes, endings and spelling variants', () => {
    expect(matchesSearch('الصحفيين', 'نقابة صحفي غزة')).toBe(true);
    expect(matchesSearch('صحفي', 'اعتقال الصحفيين في الضفة')).toBe(true);
    expect(matchesSearch('بالمؤتمر', 'انطلاق مؤتمر المناخ')).toBe(true);
    expect(matchesSearch('مؤتمر', 'الوزير يتحدث بالمؤتمر الصحفي')).toBe(true);
    expect(matchesSearch('غزة', 'قصف على غزه')).toBe(true);
    expect(matchesSearch('غزه', 'قصف على بغزة')).toBe(true);
    expect(matchesSearch('مصطفى', 'مُصطفي')).toBe(true);
    expect(matchesSearch('الحكومة', 'الحكومات العربية')).toBe(true);
  });

  it('requires every word, in any field and order, and survives missing fields', () => {
    expect(matchesSearch('احمد التحرير', 'أحمد المنصوري', undefined, 'غرفة التحرير')).toBe(true);
    expect(matchesSearch('احمد الرياضة', 'أحمد المنصوري', 'غرفة التحرير')).toBe(false);
    expect(matchesSearch('القمة', ['وسم', 'القمه الاقتصادية'])).toBe(true);
    expect(matchesSearch('  ', null)).toBe(true);
  });

  it('supports "exact phrases" and -excluded words', () => {
    const a = 'وزير الخارجية يزور القاهرة';
    const b = 'الخارجية تنفي زيارة الوزير';
    expect(matchesSearch('"وزير الخارجية"', a)).toBe(true);
    expect(matchesSearch('"وزير الخارجية"', b)).toBe(false);
    expect(matchesSearch('«وزير الخارجيه»', a)).toBe(true);
    expect(matchesSearch('الخارجية -القاهرة', a)).toBe(false);
    expect(matchesSearch('الخارجية -القاهرة', b)).toBe(true);
    expect(matchesSearch('-غزة', 'هدنة بغزة')).toBe(false); // excluded through the attached ب
    const q = parseQuery('"قمة المناخ" مصر -السودان');
    expect(q.phrases).toEqual(['قمه المناخ']);
    expect(q.terms).toEqual(['مصر']);
    expect(q.excluded).toEqual(['السودان']);
  });

  it('matches symbol-only queries literally', () => {
    expect(matchesSearch('%', 'نسبة 50%')).toBe(true);
    expect(matchesSearch('%', 'نسبة خمسين')).toBe(false);
    expect(matchesSearch('-', 'أي شيء')).toBe(true); // a lone minus is still being typed
  });

  it('ranks whole phrases and title matches above body matches', () => {
    const exact = scoreFields('قمة المناخ', 'قمة المناخ في شرم الشيخ')!;
    const scattered = scoreFields('قمة المناخ', 'المناخ يتصدر جدول القمة')!;
    expect(exact).toBeGreaterThan(scattered);
    const index = createSearchIndex<{ id: string; t: string; b: string; u: string }>({
      id: (r) => r.id,
      version: (r) => r.u,
      title: (r) => [r.t],
      body: (r) => [r.b],
    });
    const rows = [
      { id: 'body', t: 'أخبار الصباح', b: 'تحدث الرئيس عن المؤتمر الاقتصادي', u: '1' },
      { id: 'title', t: 'المؤتمر الاقتصادي يختتم أعماله', b: 'تفاصيل', u: '1' },
      { id: 'none', t: 'طقس', b: 'أمطار', u: '1' },
    ];
    expect(index.search(rows, 'المؤتمر الاقتصادي').map((h) => h.item.id)).toEqual(['title', 'body']);
    expect(index.count(rows, 'مؤتمرات')).toBe(2);
    // Memoised by id + version: an edited record is prepared again.
    rows[2] = { ...rows[2], t: 'المؤتمر', u: '2' };
    expect(index.count(rows, 'المؤتمر')).toBe(3);
  });

  it('handles a large list quickly', () => {
    const titles = Array.from({ length: 5000 }, (_, i) => `خبر رقم ${i} عن ${i % 2 ? 'الحكومة' : 'المعارضة'} في ${i % 3 ? 'غزة' : 'رفح'}`);
    const started = performance.now();
    const vocab = buildVocabulary(titles);
    const hits = titles.filter((t) => matchesSearch('الحكومه بغزة', t)).length;
    expect(hits).toBeGreaterThan(1000);
    expect(vocab.entries.get('الحكومه')?.count).toBe(2500);
    expect(performance.now() - started).toBeLessThan(1500);
  });
});

const NEWSROOM = [
  'انطلاق المؤتمر الصحفي لوزير الخارجية',
  'الصحفيين في غزة يطالبون بالحماية',
  'المؤتمر الاقتصادي في القاهرة',
  'مؤتمر المناخ يختتم أعماله',
  'الحكومة تعلن الموازنة العامة',
  'أمطار غزيرة على الساحل',
  'المنتخب الوطني يتأهل',
  'وزير الصحة يزور المستشفيات',
];

describe('«هل تقصد»', () => {
  const vocab = buildVocabulary(NEWSROOM);

  it('measures edits with adjacent swaps as one edit', () => {
    expect(editDistance('موتمر', 'موتمر')).toBe(0);
    expect(editDistance('مومتر', 'موتمر')).toBe(1); // swapped letters
    expect(editDistance('الحكومه', 'الحكومت')).toBe(1);
    expect(editDistance('abcdef', 'uvwxyz', 2)).toBe(3); // stops past the limit
  });

  it('corrects misspelt words to the closest newsroom word, keeping the newsroom spelling', () => {
    expect(didYouMean('المؤتمرر', vocab)).toBe('المؤتمر');
    expect(didYouMean('الحكومه المزانة', vocab)).toBe('الحكومه الموازنة');
    expect(didYouMean('الخارجيه وزبر', vocab)).toBe('الخارجيه وزير');
    expect(didYouMean('المستشفبات', vocab)).toBe('المستشفيات');
  });

  it('handles a missing or extra «ال»', () => {
    expect(didYouMean('منتخب', vocab)).toBeNull(); // known through المنتخب
    expect(didYouMean('الأمطارر', vocab)).toBe('أمطار');
  });

  it('leaves known words, spelling variants, phrases, exclusions and short words alone', () => {
    expect(didYouMean('غزه', vocab)).toBeNull();
    expect(didYouMean('الصحفيون', vocab)).toBeNull();
    expect(didYouMean('بالمؤتمر', vocab)).toBeNull();
    expect(didYouMean('"المؤتمرر" -الحكومة', vocab)).toBeNull();
    expect(didYouMean('قم', vocab)).toBeNull();
    expect(didYouMean('كلمةغريبةجدا', vocab)).toBeNull();
    expect(didYouMean('', vocab)).toBeNull();
  });
});

describe('suggestions', () => {
  const vocab = buildVocabulary([...NEWSROOM, 'المؤتمر', 'المؤتمر']);

  it('completes the last word from the newsroom vocabulary, most frequent first', () => {
    const c = completeQuery('وزير الم', vocab);
    expect(c[0]).toEqual({ query: 'وزير المؤتمر', word: 'المؤتمر' });
    expect(c.map((x) => x.word)).toContain('المناخ');
    expect(completeQuery('مؤت', vocab).map((x) => x.word)).toEqual(expect.arrayContaining(['مؤتمر', 'المؤتمر']));
  });

  it('offers nothing after a space, for one letter, or inside quotes and exclusions', () => {
    expect(completeQuery('المؤتمر ', vocab)).toEqual([]);
    expect(completeQuery('م', vocab)).toEqual([]);
    expect(completeQuery('"الم', vocab)).toEqual([]);
    expect(completeQuery('-الم', vocab)).toEqual([]);
  });

  it('keeps recent searches unique, capped and safe to load', () => {
    let list: string[] = [];
    list = pushRecentSearch(list, 'غزة');
    list = pushRecentSearch(list, 'المؤتمر الصحفي');
    list = pushRecentSearch(list, 'غزه '); // same search, newer spelling first
    expect(list).toEqual(['غزه', 'المؤتمر الصحفي']);
    expect(pushRecentSearch(list, '   ')).toEqual(list);
    expect(pushRecentSearch(Array.from({ length: 20 }, (_, i) => `بحث ${i}`), 'جديد')).toHaveLength(8);
    expect(sanitizeRecentSearches(['أ', 2, '', null, 'أ', 'ب'])).toEqual(['أ', 'ب']);
    expect(sanitizeRecentSearches('x')).toEqual([]);
    expect(matchingRecentSearches(['المؤتمر الصحفي', 'غزة'], 'المؤ')).toEqual(['المؤتمر الصحفي']);
    expect(matchingRecentSearches(['أ', 'ب'], '')).toEqual(['أ', 'ب']);
  });
});

describe('highlighting', () => {
  it('marks whole matched words in the original text, diacritics included', () => {
    const text = 'انطلاقُ المؤتمرِ الصحفيّ في غزة';
    const marked = highlightSegments(text, 'مؤتمر غزه').filter((s) => s.match).map((s) => s.text);
    expect(marked).toEqual(['المؤتمرِ', 'غزة']);
    expect(highlightSegments(text, 'مؤتمر').map((s) => s.text).join('')).toBe(text);
  });

  it('marks exact phrases and ignores excluded words', () => {
    const text = 'وزير الخارجية يزور القاهرة';
    expect(highlightSegments(text, '"وزير الخارجيه"').filter((s) => s.match).map((s) => s.text)).toEqual(['وزير الخارجية']);
    expect(highlightRanges(text, '-القاهرة')).toEqual([]);
    expect(highlightSegments('', 'x')).toEqual([]);
    expect(highlightSegments('بدون تطابق', 'غزة')).toEqual([{ text: 'بدون تطابق', match: false }]);
  });

  it('marks words found through attached prefixes and plural endings', () => {
    const marked = highlightSegments('لقاء مع الصحفيين وبالمؤتمر', 'صحفي مؤتمر').filter((s) => s.match).map((s) => s.text);
    expect(marked).toEqual(['الصحفيين', 'وبالمؤتمر']);
  });
});
