/**
 * One description of a printable newsroom document, rendered two ways: an A4 print page
 * (also saved as PDF through the browser's print engine, which shapes Arabic correctly)
 * and a real right-to-left Word (.docx) file.
 */

export interface TableRow {
  cells: string[];
  /** group = full-width heading row (e.g. a topic); muted = floated/greyed; strong = emphasised. */
  kind?: 'group' | 'muted' | 'strong';
}

export type DocBlock =
  | { t: 'heading'; text: string }
  | { t: 'paragraph'; text: string; bold?: boolean; muted?: boolean }
  /** Label/value pairs shown as a compact grid. */
  | { t: 'meta'; rows: [string, string][] }
  | { t: 'table'; head: string[]; rows: TableRow[]; widths?: number[]; mono?: number[] }
  | { t: 'list'; items: string[]; ordered?: boolean }
  /** Anchor copy: large type; [bracketed] directions are shown as cues. */
  | { t: 'script'; text: string }
  | { t: 'pagebreak' };

export interface DocSpec {
  title: string;
  subtitle?: string;
  /** File name without extension. */
  fileName: string;
  orientation?: 'portrait' | 'landscape';
  /** Organisation name for the running header. */
  organization?: string;
  /** "Printed by … on …" line. */
  footerNote?: string;
  blocks: DocBlock[];
}

/** Safe file name that keeps Arabic letters. */
export const fileNameOf = (...parts: (string | undefined)[]) =>
  parts
    .filter(Boolean)
    .join(' - ')
    .replace(/[\\/:*?"<>|\n\r\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'document';

/** Splits anchor copy into spoken text and bracketed directions. */
export function scriptParts(text: string): { cue: boolean; text: string }[] {
  const out: { cue: boolean; text: string }[] = [];
  const re = /\[[^\]]*\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ cue: false, text: text.slice(last, m.index) });
    out.push({ cue: true, text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ cue: false, text: text.slice(last) });
  return out;
}
