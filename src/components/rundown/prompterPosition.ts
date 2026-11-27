interface ScriptNode {
  node: Text;
  start: number;
}

const breaks = new Set(['br', 'p', 'div', 'li', 'h1', 'h2', 'h3', 'blockquote']);

/** Preserve line boundaries for sentence detection while retaining the DOM offsets of actual letters. */
export function prompterTextMap(root: HTMLElement): { text: string; nodes: ScriptNode[] } {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  const nodes: ScriptNode[] = [];
  let text = '';
  for (let item = walker.nextNode(); item; item = walker.nextNode()) {
    if (item.nodeType === Node.ELEMENT_NODE) {
      if (breaks.has((item as Element).localName) && text && !text.endsWith('\n')) text += '\n';
    } else {
      const node = item as Text;
      if (!node.length) continue;
      nodes.push({ node, start: text.length });
      text += node.data;
    }
  }
  return { text, nodes };
}

const glyphBounds = (range: Range, node: Text, index: number): DOMRect => {
  range.setStart(node, index);
  range.setEnd(node, index + 1);
  return range.getBoundingClientRect();
};

/** Locate the first glyph of the rendered line currently crossing the eyeline. */
export function prompterAnchorAtLine(nodes: ScriptNode[], lineY: number): { offset: number; top: number } | null {
  for (const { node, start } of nodes) {
    const range = node.ownerDocument.createRange();
    range.selectNodeContents(node);
    const bounds = range.getBoundingClientRect();
    if (!bounds.height || bounds.bottom <= lineY) continue;
    let first = 0;
    let last = node.length - 1;
    while (first < last) {
      const middle = Math.floor((first + last) / 2);
      if (glyphBounds(range, node, middle).bottom <= lineY) first = middle + 1;
      else last = middle;
    }
    return { offset: start + first, top: glyphBounds(range, node, first).top };
  }
  const tail = nodes.at(-1);
  return tail ? {
    offset: tail.start + tail.node.length,
    top: glyphBounds(tail.node.ownerDocument.createRange(), tail.node, tail.node.length - 1).top,
  } : null;
}

export function prompterGlyphTop(nodes: ScriptNode[], offset: number): number | undefined {
  const target = nodes.find(({ node, start }) => start + node.length > offset) ?? nodes.at(-1);
  if (!target) return undefined;
  const index = Math.max(0, Math.min(offset - target.start, target.node.length - 1));
  return glyphBounds(target.node.ownerDocument.createRange(), target.node, index).top;
}
