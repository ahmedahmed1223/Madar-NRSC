export function prompterScrollDelta(pixelsPerSecond: number, milliseconds: number): number {
  return Math.max(0, pixelsPerSecond) * Math.min(100, Math.max(0, milliseconds)) / 1000;
}
export function prompterShortcut(input: { key: string; tagName?: string; editable?: boolean; composing?: boolean; modified?: boolean }) {
  if (input.composing || input.modified) return null;
  if (input.key === 'Escape') return 'CLOSE';
  if (input.editable || ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A'].includes(input.tagName || '')) return null;
  const shortcuts: Record<string, string> = {
    ' ': 'PLAY', ArrowLeft: 'NEXT', ArrowRight: 'PREVIOUS', ArrowUp: 'FASTER', ArrowDown: 'SLOWER',
    '+': 'LARGER', '=': 'LARGER', '-': 'SMALLER', Home: 'RESET', PageDown: 'PAGE_DOWN', PageUp: 'PAGE_UP',
    f: 'FULLSCREEN', F: 'FULLSCREEN', m: 'MIRROR', M: 'MIRROR',
  };
  return shortcuts[input.key] || null;
}
