/**
 * Arabic newsroom proofreading: common spelling slips (hamza, taa marbuta, final yaa), repeated
 * words, spacing and punctuation. Only unambiguous fixes are proposed — words whose spelling
 * depends on meaning (أن/إن، علي/على…) are left alone.
 */

export interface ProofIssue {
  /** Offsets in the checked text. */
  start: number;
  end: number;
  original: string;
  suggestion: string;
  message: string;
  kind: 'spelling' | 'repeat' | 'spacing' | 'punctuation';
}

/** Common misspellings → correct form (whole words only). */
const WORDS: Record<string, string> = {
  الى: 'إلى',
  الي: 'إلى',
  فى: 'في',
  الذى: 'الذي',
  التى: 'التي',
  حتي: 'حتى',
  متي: 'متى',
  لدي: 'لدى',
  اذا: 'إذا',
  انشاء: 'إنشاء',
  اعلان: 'إعلان',
  اعلن: 'أعلن',
  اعلنت: 'أعلنت',
  اكد: 'أكد',
  اكدت: 'أكدت',
  اكثر: 'أكثر',
  اقل: 'أقل',
  اول: 'أول',
  اولى: 'أولى',
  اضاف: 'أضاف',
  اضافت: 'أضافت',
  اشار: 'أشار',
  اشارت: 'أشارت',
  اوضح: 'أوضح',
  اوضحت: 'أوضحت',
  امس: 'أمس',
  ايضا: 'أيضاً',
  اسرائيل: 'إسرائيل',
  ايران: 'إيران',
  امريكا: 'أمريكا',
  اوروبا: 'أوروبا',
  افريقيا: 'أفريقيا',
  الاردن: 'الأردن',
  الامم: 'الأمم',
  الامن: 'الأمن',
  الاسبوع: 'الأسبوع',
  الاربعاء: 'الأربعاء',
  الاحد: 'الأحد',
  الحكومه: 'الحكومة',
  الدوله: 'الدولة',
  الشرطه: 'الشرطة',
  الصحه: 'الصحة',
  المنطقه: 'المنطقة',
  السنه: 'السنة',
  القمه: 'القمة',
  الجامعه: 'الجامعة',
  المدينه: 'المدينة',
  العاصمه: 'العاصمة',
  الوزاره: 'الوزارة',
  الطاقه: 'الطاقة',
  الرياضه: 'الرياضة',
  الثقافه: 'الثقافة',
  السياسه: 'السياسة',
  الشركه: 'الشركة',
  المملكه: 'المملكة',
  المتحده: 'المتحدة',
  العربيه: 'العربية',
  الاسلاميه: 'الإسلامية',
  الاقتصاديه: 'الاقتصادية',
  مسئول: 'مسؤول',
  مسئولية: 'مسؤولية',
  مسئولون: 'مسؤولون',
  شئون: 'شؤون',
};

const LETTER = '\\u0621-\\u064A\\u0671-\\u06D3';
const wordRe = new RegExp(`[${LETTER}\\u064B-\\u065F\\u0640]+`, 'g');

/** Skip text inside [director cues] and URLs. */
function protectedRanges(text: string): [number, number][] {
  const out: [number, number][] = [];
  for (const m of text.matchAll(/\[[^\]]*\]|https?:\/\/\S+/g)) out.push([m.index!, m.index! + m[0].length]);
  return out;
}

export function proofread(text: string): ProofIssue[] {
  const issues: ProofIssue[] = [];
  const guarded = protectedRanges(text);
  const inGuard = (i: number) => guarded.some(([a, b]) => i >= a && i < b);
  const push = (i: ProofIssue) => {
    if (!inGuard(i.start)) issues.push(i);
  };

  // Words: known misspellings and repeated words.
  let prev: { word: string; end: number } | null = null;
  for (const m of text.matchAll(wordRe)) {
    const word = m[0];
    const start = m.index!;
    const end = start + word.length;
    const bare = word.replace(/[ً-ٟـ]/g, '');
    const fix = WORDS[bare];
    if (fix && fix !== bare) push({ start, end, original: word, suggestion: fix, message: `«${word}» تُكتب «${fix}»`, kind: 'spelling' });
    // Prefixed forms: و/ف/ب/ل + word (e.g. والى → وإلى).
    else if (/^[وفبل]/.test(bare) && WORDS[bare.slice(1)] && bare.length > 3) {
      const corrected = bare[0] + WORDS[bare.slice(1)];
      if (corrected !== bare) push({ start, end, original: word, suggestion: corrected, message: `«${word}» تُكتب «${corrected}»`, kind: 'spelling' });
    }
    if (prev && prev.word === bare && /^\s+$/.test(text.slice(prev.end, start)) && !['جدا', 'رويدا', 'شيئا'].includes(bare)) {
      push({ start: prev.end, end, original: text.slice(prev.end, end), suggestion: '', message: `كلمة مكررة: «${word}»`, kind: 'repeat' });
    }
    prev = { word: bare, end };
  }

  // Spacing.
  for (const m of text.matchAll(/ {2,}/g)) push({ start: m.index!, end: m.index! + m[0].length, original: m[0], suggestion: ' ', message: 'مسافات زائدة', kind: 'spacing' });
  const ARABIC_PUNCT: Record<string, string> = { ',': '،', ';': '؛', '?': '؟' };
  for (const m of text.matchAll(/ +([،؛؟!.:,;?])/g)) {
    const before = text.slice(0, m.index!).trimEnd().slice(-1);
    const arabicContext = new RegExp(`[${LETTER}]`).test(before) && ARABIC_PUNCT[m[1]];
    push({
      start: m.index!,
      end: m.index! + m[0].length,
      original: m[0],
      suggestion: arabicContext ? ARABIC_PUNCT[m[1]] : m[1],
      message: arabicContext ? `لا مسافة قبل علامة الترقيم، واستخدم «${ARABIC_PUNCT[m[1]]}» العربية` : 'لا مسافة قبل علامة الترقيم',
      kind: arabicContext ? 'punctuation' : 'spacing',
    });
  }
  for (const m of text.matchAll(new RegExp(`([،؛؟!])(?=[${LETTER}])`, 'g')))
    push({ start: m.index!, end: m.index! + 1, original: m[1], suggestion: `${m[1]} `, message: 'مسافة بعد علامة الترقيم', kind: 'spacing' });

  // Latin punctuation between Arabic words.
  for (const m of text.matchAll(new RegExp(`(?<=[${LETTER}]\\s?)([,;?])(?=\\s?[${LETTER}])`, 'g'))) {
    const map: Record<string, string> = { ',': '،', ';': '؛', '?': '؟' };
    push({ start: m.index!, end: m.index! + 1, original: m[1], suggestion: map[m[1]], message: `استخدم «${map[m[1]]}» العربية`, kind: 'punctuation' });
  }
  // Doubled punctuation (keep an ellipsis).
  for (const m of text.matchAll(/([،؛؟!,])\1+/g)) push({ start: m.index!, end: m.index! + m[0].length, original: m[0], suggestion: m[1], message: 'علامة ترقيم مكررة', kind: 'punctuation' });

  // One fix per span, in reading order.
  issues.sort((a, b) => a.start - b.start || b.end - a.end);
  return issues.filter((it, i) => i === 0 || it.start >= issues[i - 1].end);
}

/** Applies fixes (all, or the given ones) from the end so offsets stay valid. */
export function applyFixes(text: string, fixes: ProofIssue[]): string {
  let out = text;
  for (const f of [...fixes].sort((a, b) => b.start - a.start)) {
    if (out.slice(f.start, f.end) !== f.original) continue;
    out = out.slice(0, f.start) + f.suggestion + out.slice(f.end);
  }
  return out;
}

/** Proofreads the text parts of HTML (tags untouched); returns fixed HTML and the issues found. */
export function proofreadHtml(html: string): { issues: ProofIssue[]; fixAll: () => string; fixOne: (issue: ProofIssue) => string } {
  // Offsets refer to the concatenated text segments; map them back when fixing.
  const parts = html.split(/(<[^>]+>)/);
  const segments: { index: number; offset: number; text: string }[] = [];
  let offset = 0;
  parts.forEach((p, index) => {
    if (p.startsWith('<')) return;
    segments.push({ index, offset, text: p });
    offset += p.length + 1; // +1 keeps words in separate segments apart
  });
  const joined = segments.map((s) => s.text).join('\u0001');
  const issues = proofread(joined).filter((i) => !joined.slice(i.start, i.end).includes('\u0001') && !/&[a-z#0-9]*$/i.test(joined.slice(Math.max(0, i.start - 8), i.start)));
  const rebuild = (fixes: ProofIssue[]) => {
    const next = [...parts];
    for (const seg of segments) {
      const local = fixes
        .filter((f) => f.start >= seg.offset && f.end <= seg.offset + seg.text.length)
        .map((f) => ({ ...f, start: f.start - seg.offset, end: f.end - seg.offset }));
      if (local.length) next[seg.index] = applyFixes(seg.text, local);
    }
    return next.join('');
  };
  return { issues, fixAll: () => rebuild(issues), fixOne: (issue) => rebuild([issue]) };
}
