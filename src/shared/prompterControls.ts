import { tokenize, wordDiff } from './textDiff';

/** Align the reading word with its new position and distinguish completed sentences from the current one. */
export function remapPrompterReadingPosition(before: string, after: string, offset: number) {
  const position = Math.max(0, Math.min(offset, before.length));
  if (before === after || position === 0) return { offset: position, amendedPastSentence: false };
  const oldWords = [...before.matchAll(/\S+/g)];
  const newWords = [...after.matchAll(/\S+/g)];
  const wordAtPosition = oldWords.findIndex(word => word.index + word[0].length > position);
  let sentenceStart = 0;
  for (const boundary of before.slice(0, position).matchAll(/(?:[.!؟?؛](?=\s|$)|\n)\s*/g)) {
    sentenceStart = boundary.index + boundary[0].length;
  }

  let oldIndex = 0;
  let newIndex = 0;
  let mapped = after.length;
  let amendedPastSentence = false;
  for (const run of wordDiff(before, after)) {
    const count = tokenize(run.text).length;
    if (run.kind !== 'same' && (oldWords[oldIndex]?.index ?? before.length) < sentenceStart) amendedPastSentence = true;
    if (run.kind !== 'add' && wordAtPosition >= oldIndex && wordAtPosition < oldIndex + count) {
      if (run.kind === 'same') {
        const next = newWords[newIndex + wordAtPosition - oldIndex];
        mapped = next.index + Math.max(0, position - oldWords[wordAtPosition].index);
      } else {
        mapped = newWords[newIndex]?.index ?? after.length;
      }
    }
    if (run.kind !== 'add') oldIndex += count;
    if (run.kind !== 'del') newIndex += count;
  }
  return { offset: mapped, amendedPastSentence };
}

/** An opaque copy identifier so the server can reject reports for an outdated live script. */
export function prompterScriptRevision(script: string): string {
  let hash = 2166136261;
  for (let index = 0; index < script.length; index += 1) hash = Math.imul(hash ^ script.charCodeAt(index), 16777619);
  return `${script.length}-${(hash >>> 0).toString(36)}`;
}

export function prompterScrollDelta(pixelsPerSecond: number, milliseconds: number): number {
  return Math.max(0, pixelsPerSecond) * Math.min(100, Math.max(0, milliseconds)) / 1000;
}
export function prompterShortcut(input: { key: string; tagName?: string; editable?: boolean; composing?: boolean; modified?: boolean }) {
  if (input.composing || input.modified) return null;
  if (input.key === 'Escape') return 'CLOSE';
  if (input.editable || ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A', 'SUMMARY'].includes(input.tagName || '')) return null;
  const shortcuts: Record<string, string> = {
    ' ': 'PLAY', ArrowLeft: 'NEXT', ArrowRight: 'PREVIOUS', ArrowUp: 'FASTER', ArrowDown: 'SLOWER',
    '+': 'LARGER', '=': 'LARGER', '-': 'SMALLER', Home: 'RESET', PageDown: 'PAGE_DOWN', PageUp: 'PAGE_UP',
    f: 'FULLSCREEN', F: 'FULLSCREEN', m: 'MIRROR', M: 'MIRROR',
  };
  return shortcuts[input.key] || null;
}
