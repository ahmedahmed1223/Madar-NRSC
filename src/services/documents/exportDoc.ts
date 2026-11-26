import type { DocSpec } from './model';
import { renderHtml } from './renderHtml';
import { showPrintPreview } from './printPreview';

export type ExportFormat = 'print' | 'pdf' | 'word';

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
  showPrintPreview({ title: doc.title, html: renderHtml(doc), landscape: doc.orientation === 'landscape', pdf: format === 'pdf' });
}
