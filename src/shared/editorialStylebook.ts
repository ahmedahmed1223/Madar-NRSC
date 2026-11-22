import { normalizeArabic } from './search';

export interface StylebookRules {
  terms: { term: string; replacement: string }[];
  numbers: 'keep' | 'latn' | 'arab';
  dates: 'keep' | 'dmy' | 'iso';
  currencies: 'keep' | 'code-before' | 'code-after';
}

export interface EditorialPublishingSettings {
  preferredTags: string[];
  stylebook: StylebookRules;
}

export const emptyEditorialPublishing = (): EditorialPublishingSettings => ({
  preferredTags: [], stylebook: { terms: [], numbers: 'keep', dates: 'keep', currencies: 'keep' },
});

export const MAX_STYLEBOOK_TERMS = 100;
export const MAX_PREFERRED_TAGS = 20;
export const MAX_STYLEBOOK_FINDINGS = 100;

export function editorialPublishingError(value: unknown): string | null {
  if (value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'إعدادات النشر ودليل الأسلوب غير صالحة';
  const { stylebook, preferredTags } = value as Partial<EditorialPublishingSettings>;
  if (!Array.isArray(preferredTags) || preferredTags.length > MAX_PREFERRED_TAGS ||
    preferredTags.some(tag => typeof tag !== 'string' || !/^#[\p{L}\p{N}_]{1,60}$/u.test(tag))) return 'اكتب الوسوم دون مسافات أو علامات خاصة';
  if (!stylebook || !['keep', 'latn', 'arab'].includes(stylebook.numbers) ||
    !['keep', 'dmy', 'iso'].includes(stylebook.dates) || !['keep', 'code-before', 'code-after'].includes(stylebook.currencies) ||
    !Array.isArray(stylebook.terms) || stylebook.terms.length > MAX_STYLEBOOK_TERMS) return 'خيارات دليل الأسلوب غير صالحة';
  const seen = new Set<string>();
  for (const rule of stylebook.terms) {
    if (typeof rule?.term !== 'string' || !rule.term.trim() || rule.term.length > 80 || /[\u0000-\u001f]/.test(rule.term) ||
      typeof rule.replacement !== 'string' || rule.replacement.length > 120 || /[\u0000-\u001f]/.test(rule.replacement)) return 'اكتب العبارة المراد مراجعتها والبديل المقترح';
    const key = normalizeArabic(rule.term).trim().replace(/\s+/g, ' ');
    if (!/[\p{L}\p{N}]/u.test(key) || seen.has(key)) return 'عبارة المراجعة غير صالحة أو مكررة';
    seen.add(key);
  }
  return null;
}

export interface StylebookFinding {
  start: number;
  end: number;
  original: string;
  replacement: string;
  label: string;
}

const digits = /[0-9٠-٩۰-۹]+/g;
const numberToAscii = (value: string) => value.replace(/[٠-٩۰-۹]/g, digit => String(digit.charCodeAt(0) - (digit <= '٩' ? 0x660 : 0x6f0)));
const formatDigits = (value: string, mode: StylebookRules['numbers']) =>
  mode === 'keep' ? value : mode === 'latn' ? numberToAscii(value) : numberToAscii(value).replace(/\d/g, digit => String.fromCharCode(0x660 + Number(digit)));
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function normalizedOffsets(text: string) {
  let folded = '';
  const starts: number[] = [];
  const ends: number[] = [];
  let offset = 0;
  for (const char of text) {
    const next = /\s/u.test(char) ? ' ' : normalizeArabic(char);
    if (!next && ends.length) ends[ends.length - 1] = offset + char.length;
    for (let unit = 0; unit < next.length; unit++) {
      starts.push(offset);
      ends.push(offset + char.length);
    }
    folded += next;
    offset += char.length;
  }
  return { folded, starts, ends };
}

export function lintStylebook(text: string, rules: StylebookRules): StylebookFinding[] {
  const findings: StylebookFinding[] = [];
  const push = (start: number, end: number, replacement: string, label: string) => {
    if (findings.length >= MAX_STYLEBOOK_FINDINGS) return;
    const original = text.slice(start, end);
    if (original !== replacement && !findings.some(item => item.start < end && item.end > start)) findings.push({ start, end, original, replacement, label });
  };
  if (rules.terms.length) {
    const { folded, starts, ends } = normalizedOffsets(text);
    for (const rule of rules.terms) {
      const parts = normalizeArabic(rule.term).trim().split(/\s+/).filter(Boolean).map(escapeRegex);
      if (!parts.length) continue;
      const phrase = new RegExp(`(?<![\\p{L}\\p{N}])${parts.join(' +')}(?![\\p{L}\\p{N}])`, 'gu');
      for (const hit of folded.matchAll(phrase)) push(starts[hit.index!], ends[hit.index! + hit[0].length - 1], rule.replacement, 'عبارة في دليل الأسلوب');
    }
  }
  const numericalText = numberToAscii(text);
  if (rules.dates !== 'keep') {
    for (const hit of numericalText.matchAll(/(?<![\d/\-])(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{4})(?![\d/\-])/g)) {
      const parts = hit[0].split(/[-/]/);
      const [day, month, year] = parts[0].length === 4 ? parts.reverse() : parts;
      const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
      if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() + 1 !== Number(month) || date.getUTCDate() !== Number(day)) continue;
      const dmy = [day.padStart(2, '0'), month.padStart(2, '0'), year];
      const formatted = rules.dates === 'dmy' ? dmy.join('/') : dmy.reverse().join('-');
      const original = text.slice(hit.index!, hit.index! + hit[0].length);
      const mode = rules.numbers === 'keep' && /[٠-٩۰-۹]/.test(original) ? 'arab' : rules.numbers;
      push(hit.index!, hit.index! + hit[0].length, formatDigits(formatted, mode), 'صيغة التاريخ');
    }
  }
  if (rules.currencies !== 'keep') {
    const currency = '(?:USD|EUR|GBP|ILS|JOD|SAR|AED|QAR|EGP|KWD|BHD|OMR|TRY|CAD|AUD)';
    const amount = '-?\\d+(?:[.,٫٬]\\d+)*';
    const matches = new RegExp(`(?<![\\p{L}\\p{N}])(?:(${currency})[ \\t]+(${amount})|(${amount})[ \\t]+(${currency}))(?![\\p{L}\\p{N}])`, 'giu');
    for (const hit of numericalText.matchAll(matches)) {
      const code = (hit[1] || hit[4]).toUpperCase();
      const amountStart = hit.index! + (hit[1] ? hit[0].indexOf(hit[2]) : 0);
      const rawAmount = text.slice(amountStart, amountStart + (hit[2] || hit[3]).length);
      const formatted = formatDigits(rawAmount, rules.numbers);
      const replacement = rules.currencies === 'code-before' ? `${code} ${formatted}` : `${formatted} ${code}`;
      push(hit.index!, hit.index! + hit[0].length, replacement, 'صيغة العملة');
    }
  }
  if (rules.numbers !== 'keep') {
    for (const hit of text.matchAll(digits)) push(hit.index!, hit.index! + hit[0].length, formatDigits(hit[0], rules.numbers), 'طريقة كتابة الأرقام');
  }
  return findings.sort((a, b) => a.start - b.start);
}

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function lintStylebookHtml(html: string, rules: StylebookRules) {
  const parts = html.split(/(<(?:[^"'<>]|"[^"]*"|'[^']*')*>)/g);
  let text = '';
  let hidden = false;
  const segments: { partIndex: number; start: number; end: number }[] = [];
  parts.forEach((part, partIndex) => {
    if (partIndex % 2) {
      if (/^<(?:script|style)\b/i.test(part)) hidden = true;
      if (/^<\/(?:script|style)\b/i.test(part)) hidden = false;
      if (/^<\/?(?:p|div|br|li|ul|ol|h[1-6]|blockquote|td|th|tr|pre|script|style)\b/i.test(part)) text += '\u0000';
      return;
    }
    if (hidden || !part) return;
    segments.push({ partIndex, start: text.length, end: text.length + part.length });
    text += part.replace(/&(?:#\w+|\w+);/g, match => '\u0000'.repeat(match.length));
  });
  return lintStylebook(text, rules).map(finding => ({
    ...finding,
    apply: () => {
      const updated = [...parts];
      const hitSegments = segments.filter(segment => segment.start < finding.end && segment.end > finding.start);
      hitSegments.forEach((segment, index) => {
        const from = Math.max(0, finding.start - segment.start);
        const to = Math.min(segment.end, finding.end) - segment.start;
        const part = parts[segment.partIndex];
        updated[segment.partIndex] = part.slice(0, from) + (index === 0 ? escapeHtml(finding.replacement) : '') + part.slice(to);
      });
      return updated.join('');
    },
  }));
}

export const replaceStylebookFinding = (text: string, finding: StylebookFinding) =>
  text.slice(0, finding.start) + finding.replacement + text.slice(finding.end);
