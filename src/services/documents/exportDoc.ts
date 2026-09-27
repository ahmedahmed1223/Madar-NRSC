import type { DocSpec } from './model';
import { renderHtml } from './renderHtml';

export type ExportFormat = 'print' | 'pdf' | 'word';

/** Opens the A4 document; for PDF the print dialog is pre-set by the file name and a hint. */
function openPrintable(doc: DocSpec, pdf: boolean) {
  const w = window.open('', '_blank');
  if (!w) {
    window.alert('اسمح للمتصفح بفتح النوافذ المنبثقة لهذا الموقع لإتمام الطباعة أو حفظ PDF');
    return;
  }
  w.document.open();
  w.document.write(renderHtml(doc, { autoPrint: true, pdfHint: pdf }));
  w.document.close();
}

async function downloadWord(doc: DocSpec) {
  // The Word writer is loaded only when someone exports.
  const { renderDocx } = await import('./renderDocx');
  const blob = await renderDocx(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${doc.fileName}.docx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function exportDocument(doc: DocSpec, format: ExportFormat): Promise<void> {
  if (format === 'word') return downloadWord(doc);
  openPrintable(doc, format === 'pdf');
}
