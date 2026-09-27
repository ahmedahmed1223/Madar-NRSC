import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  Packer,
  PageBreak,
  PageNumber,
  PageOrientation,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import type { DocBlock, DocSpec } from './model';
import { scriptParts } from './model';

const FONT = { ascii: 'Arial', hAnsi: 'Arial', cs: 'Arial', eastAsia: 'Arial' };
const BORDER = { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' };
const BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };

/** Half-points (docx sizes). */
const pt = (n: number) => n * 2;

const run = (text: string, o: { bold?: boolean; size?: number; color?: string; mono?: boolean } = {}) =>
  new TextRun({
    text,
    rightToLeft: !o.mono,
    bold: o.bold,
    boldComplexScript: o.bold,
    size: pt(o.size ?? 11),
    sizeComplexScript: pt(o.size ?? 11),
    color: o.color,
    font: o.mono ? { ascii: 'Consolas', hAnsi: 'Consolas', cs: 'Consolas', eastAsia: 'Consolas' } : FONT,
  });

/** A right-to-left paragraph; line breaks in the text become Word line breaks. */
const para = (text: string, o: { bold?: boolean; size?: number; color?: string; mono?: boolean; spacingAfter?: number; center?: boolean } = {}) =>
  new Paragraph({
    bidirectional: !o.mono,
    alignment: o.center || o.mono ? AlignmentType.CENTER : undefined,
    spacing: { after: o.spacingAfter ?? 60 },
    children: String(text ?? '')
      .split('\n')
      .flatMap((line, i) => (i === 0 ? [run(line, o)] : [new TextRun({ text: line, break: 1, rightToLeft: !o.mono, font: FONT, size: pt(o.size ?? 11), sizeComplexScript: pt(o.size ?? 11), bold: o.bold, boldComplexScript: o.bold, color: o.color })])),
  });

const cell = (text: string, o: { head?: boolean; fill?: string; width?: number; widthDxa?: number; span?: number; mono?: boolean; bold?: boolean; muted?: boolean } = {}) =>
  new TableCell({
    borders: BORDERS,
    columnSpan: o.span,
    width: o.widthDxa ? { size: o.widthDxa, type: WidthType.DXA } : o.width ? { size: o.width, type: WidthType.PERCENTAGE } : undefined,
    shading: o.fill ? { fill: o.fill, type: ShadingType.CLEAR, color: 'auto' } : undefined,
    margins: { top: 40, bottom: 40, left: 80, right: 80 },
    children: [para(text, { bold: o.head || o.bold, size: 9.5, color: o.head ? 'FFFFFF' : o.muted ? '94A3B8' : undefined, mono: o.mono, spacingAfter: 0 })],
  });

/** Word honours fixed column widths (in twips), not percentages, so widths are derived from the page. */
function blockToDocx(b: DocBlock, usable: number): (Paragraph | Table)[] {
  const dxa = (pct: number) => Math.round((pct / 100) * usable);
  switch (b.t) {
    case 'heading':
      return [
        new Paragraph({
          bidirectional: true,
          keepNext: true,
          spacing: { before: 240, after: 80 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: '0F172A', space: 2 } },
          children: [run(b.text, { bold: true, size: 13 })],
        }),
      ];
    case 'paragraph':
      return [para(b.text, { bold: b.bold, color: b.muted ? '64748B' : undefined })];
    case 'meta': {
      const rows: TableRow[] = [];
      for (let i = 0; i < b.rows.length; i += 2) {
        const pair = b.rows.slice(i, i + 2);
        const cells = pair.flatMap(([k, v]) => [cell(k, { fill: 'F1F5F9', bold: true, widthDxa: dxa(16) }), cell(v, { widthDxa: dxa(34) })]);
        if (pair.length === 1) cells.push(cell('', { fill: 'F1F5F9', widthDxa: dxa(16) }), cell('', { widthDxa: dxa(34) }));
        rows.push(new TableRow({ cantSplit: true, children: cells }));
      }
      return [new Table({ rows, width: { size: usable, type: WidthType.DXA }, columnWidths: [16, 34, 16, 34].map(dxa), layout: TableLayoutType.FIXED, visuallyRightToLeft: true }), para('', { spacingAfter: 60 })];
    }
    case 'table': {
      const cols = b.head.length;
      const widths = (b.widths && b.widths.length === cols ? b.widths : Array(cols).fill(100 / cols)).map(dxa);
      const head = new TableRow({
        tableHeader: true,
        cantSplit: true,
        children: b.head.map((h, i) => cell(h, { head: true, fill: '1E293B', widthDxa: widths[i] })),
      });
      const body = b.rows.length
        ? b.rows.map(
            (r) =>
              new TableRow({
                cantSplit: true,
                children:
                  r.kind === 'group'
                    ? [cell(r.cells[0], { span: cols, fill: 'E0E7FF', bold: true })]
                    : r.cells.map((c, i) => cell(c, { widthDxa: widths[i], mono: b.mono?.includes(i), bold: r.kind === 'strong', muted: r.kind === 'muted' })),
              })
          )
        : [new TableRow({ children: [cell('—', { span: cols, muted: true })] })];
      return [new Table({ rows: [head, ...body], width: { size: usable, type: WidthType.DXA }, columnWidths: widths, layout: TableLayoutType.FIXED, visuallyRightToLeft: true }), para('', { spacingAfter: 60 })];
    }
    case 'list':
      return b.items.map((item, i) => para(`${b.ordered ? `${i + 1}. ` : '• '}${item}`));
    case 'script':
      return [
        new Paragraph({
          bidirectional: true,
          spacing: { line: 480, after: 200 },
          children: scriptParts(b.text).flatMap((p) =>
            p.text.split('\n').map((line, i) =>
              new TextRun({
                text: line,
                break: i > 0 ? 1 : undefined,
                rightToLeft: true,
                font: FONT,
                bold: p.cue,
                boldComplexScript: p.cue,
                color: p.cue ? '1D4ED8' : undefined,
                size: pt(p.cue ? 12 : 20),
                sizeComplexScript: pt(p.cue ? 12 : 20),
              })
            )
          ),
        }),
      ];
    case 'pagebreak':
      return [new Paragraph({ children: [new PageBreak()] })];
  }
}

/** A right-to-left Word document with running header and "page x of y" footer. */
export async function renderDocx(doc: DocSpec): Promise<Blob> {
  // A4 in twips, less the side margins below.
  const usable = (doc.orientation === 'landscape' ? 16838 : 11906) - 1400;
  const header = new Header({
    children: [
      new Paragraph({
        bidirectional: true,
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1', space: 2 } },
        children: [run(`${doc.organization ? `${doc.organization} — ` : ''}${doc.title}`, { size: 9, color: '475569' })],
      }),
    ],
  });
  const footer = new Footer({
    children: [
      new Paragraph({
        bidirectional: true,
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ children: ['صفحة ', PageNumber.CURRENT, ' من ', PageNumber.TOTAL_PAGES], rightToLeft: true, font: FONT, size: pt(9), sizeComplexScript: pt(9), color: '475569' }),
        ],
      }),
      ...(doc.footerNote ? [para(doc.footerNote, { size: 8, color: '94A3B8', spacingAfter: 0 })] : []),
    ],
  });
  const document = new Document({
    creator: doc.organization || 'Madar NRCS',
    title: doc.title,
    styles: { default: { document: { run: { font: FONT, rightToLeft: true } } } },
    sections: [
      {
        properties: {
          page: {
            size: { orientation: doc.orientation === 'landscape' ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT },
            margin: { top: 1000, bottom: 900, left: 700, right: 700 },
          },
        },
        headers: { default: header },
        footers: { default: footer },
        children: [
          para(doc.title, { bold: true, size: 18, spacingAfter: 20 }),
          ...(doc.subtitle ? [para(doc.subtitle, { size: 10, color: '475569', spacingAfter: 160 })] : []),
          ...doc.blocks.flatMap((b) => blockToDocx(b, usable)),
        ],
      },
    ],
  });
  return Packer.toBlob(document);
}
