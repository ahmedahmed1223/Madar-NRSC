/**
 * Word-level comparison of two versions of a text, for the version history of stories.
 * Works on whole words so Arabic letters are never split, and returns runs the screen can show
 * in reading order (right to left) as unchanged, removed or added text.
 */
export type DiffKind = 'same' | 'add' | 'del';
export interface DiffRun {
  kind: DiffKind;
  text: string;
}

/** Above this many changed words the middle is shown as one replacement (keeps the browser fast). */
const MAX_CELLS = 4_000_000;

export function tokenize(text: string): string[] {
  return String(text || '').split(/\s+/).filter(Boolean);
}

function push(runs: DiffRun[], kind: DiffKind, word: string) {
  const last = runs[runs.length - 1];
  if (last && last.kind === kind) last.text += ` ${word}`;
  else runs.push({ kind, text: word });
}

/** Differences from `before` to `after`, word by word. */
export function wordDiff(before: string, after: string): DiffRun[] {
  const a = tokenize(before);
  const b = tokenize(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const runs: DiffRun[] = [];
  a.slice(0, start).forEach((w) => push(runs, 'same', w));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  if (midA.length * midB.length > MAX_CELLS) {
    midA.forEach((w) => push(runs, 'del', w));
    midB.forEach((w) => push(runs, 'add', w));
  } else {
    // Longest common subsequence over the changed middle.
    const n = midA.length;
    const m = midB.length;
    const table: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        table[i][j] = midA[i] === midB[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        push(runs, 'same', midA[i]);
        i++;
        j++;
      } else if (table[i + 1][j] >= table[i][j + 1]) {
        push(runs, 'del', midA[i++]);
      } else {
        push(runs, 'add', midB[j++]);
      }
    }
    while (i < n) push(runs, 'del', midA[i++]);
    while (j < m) push(runs, 'add', midB[j++]);
  }
  a.slice(endA).forEach((w) => push(runs, 'same', w));
  return runs;
}

/** How many words were added and removed. */
export function diffStats(runs: DiffRun[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const r of runs) {
    const n = tokenize(r.text).length;
    if (r.kind === 'add') added += n;
    if (r.kind === 'del') removed += n;
  }
  return { added, removed };
}
