import type { DocBlock, DocSpec } from './model';
import { scriptParts } from './model';

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

const multiline = (s: string) => esc(s).replace(/\n/g, '<br/>');

const cssString = (s: string) => `"${s.replace(/["\\<>\r\n\f]/g, c => `\\${c.charCodeAt(0).toString(16)} `)}"`;

function block(b: DocBlock): string {
  switch (b.t) {
    case 'heading':
      return `<h2>${esc(b.text)}</h2>`;
    case 'paragraph':
      return `<p class="${b.bold ? 'b' : ''} ${b.muted ? 'muted' : ''}">${multiline(b.text)}</p>`;
    case 'meta':
      return `<table class="meta"><tbody>${b.rows
        .reduce<[string, string][][]>((acc, r, i) => {
          if (i % 2 === 0) acc.push([r]);
          else acc[acc.length - 1].push(r);
          return acc;
        }, [])
        .map((pair) => `<tr>${pair.map(([k, v]) => `<th>${esc(k)}</th><td>${multiline(v)}</td>`).join('')}${pair.length === 1 ? '<th></th><td></td>' : ''}</tr>`)
        .join('')}</tbody></table>`;
    case 'table': {
      const cols = b.head.length;
      const colgroup = b.widths ? `<colgroup>${b.widths.map((w) => `<col style="width:${w}%"/>`).join('')}</colgroup>` : '';
      const rows = b.rows
        .map((r) =>
          r.kind === 'group'
            ? `<tr class="group"><td colspan="${cols}">${esc(r.cells[0])}</td></tr>`
            : `<tr class="${r.kind || ''}">${r.cells.map((c, i) => `<td class="${b.mono?.includes(i) ? 'mono' : ''}">${multiline(c)}</td>`).join('')}</tr>`
        )
        .join('');
      return `<table class="grid">${colgroup}<thead><tr>${b.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td colspan="${cols}" class="muted">—</td></tr>`}</tbody></table>`;
    }
    case 'list':
      return `<${b.ordered ? 'ol' : 'ul'}>${b.items.map((i) => `<li>${multiline(i)}</li>`).join('')}</${b.ordered ? 'ol' : 'ul'}>`;
    case 'script':
      return `<div class="script">${scriptParts(b.text)
        .map((p) => (p.cue ? `<span class="cue">${esc(p.text)}</span>` : multiline(p.text)))
        .join('')}</div>`;
    case 'pagebreak':
      return '<div class="pb"></div>';
  }
}

/** The same A4 document is displayed in the preview and printed by the browser. */
export function renderHtml(doc: DocSpec): string {
  const landscape = doc.orientation === 'landscape';
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(doc.fileName)}</title>
<style>
  @page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 18mm 12mm 16mm;
    @top-right { content: ${cssString(doc.organization || '')}; font: 9pt Tahoma, Arial, sans-serif; color: #475569; }
    @top-left { content: ${cssString(doc.title)}; font: 9pt Tahoma, Arial, sans-serif; color: #475569; }
    @bottom-center { content: "صفحة " counter(page) " من " counter(pages); font: 9pt Tahoma, Arial, sans-serif; color: #475569; }
    @bottom-right { content: ${cssString(doc.footerNote || '')}; font: 8pt Tahoma, Arial, sans-serif; color: #94a3b8; }
  }
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Tahoma, 'Noto Sans Arabic', Arial, sans-serif; color: #0f172a; font-size: 11pt; margin: 0; line-height: 1.6; background: #e2e8f0; }
  .sheet { background: #fff; margin: 0 auto; padding: 18mm 12mm 16mm; min-height: ${landscape ? '210mm' : '297mm'}; }
  @media screen { .pb { border-top: 1px dashed #94a3b8; margin: 12mm 0; } }
  h1 { font-size: 18pt; margin: 0 0 2px; } .sub { color: #475569; font-size: 10pt; margin-bottom: 10px; }
  h2 { font-size: 13pt; margin: 16px 0 6px; padding-bottom: 3px; border-bottom: 2px solid #0f172a; break-after: avoid; }
  p { margin: 4px 0; } .b { font-weight: 700; } .muted { color: #64748b; }
  table { width: 100%; border-collapse: collapse; margin: 6px 0; }
  table.meta th { background: #f1f5f9; text-align: right; width: 16%; font-weight: 700; }
  table.meta th, table.meta td { border: 1px solid #cbd5e1; padding: 4px 6px; vertical-align: top; font-size: 10pt; }
  table.grid th { background: #1e293b; color: #fff; font-weight: 700; font-size: 9.5pt; padding: 5px; text-align: right; border: 1px solid #1e293b; }
  table.grid td { border: 1px solid #cbd5e1; padding: 4px 5px; vertical-align: top; font-size: 9.5pt; }
  table.grid thead { display: table-header-group; } table.grid tr { break-inside: avoid; }
  tr.group td { background: #e0e7ff; font-weight: 700; } tr.muted td { color: #94a3b8; } tr.strong td { font-weight: 700; }
  .mono { font-family: Consolas, 'Courier New', monospace; white-space: nowrap; direction: ltr; text-align: center; }
  .script { font-size: 20pt; line-height: 2; white-space: pre-wrap; margin: 8px 0 12px; }
  .cue { font-size: 12pt; color: #1d4ed8; font-weight: 700; }
  .pb { break-after: page; height: 0; }
  ul, ol { margin: 4px 0; padding-right: 22px; }
  @media print { body { background: #fff; } .sheet { margin: 0; padding: 0; min-height: 0; } }
</style></head><body>
<div class="sheet">
<h1>${esc(doc.title)}</h1>
${doc.subtitle ? `<div class="sub">${esc(doc.subtitle)}</div>` : ''}
${doc.blocks.map(block).join('\n')}
</div>
</body></html>`;
}
