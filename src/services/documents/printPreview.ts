export interface PrintablePreview {
  html: string;
  title: string;
  landscape?: boolean;
  pdf?: boolean;
}

const previewEvents = new EventTarget();

export function showPrintPreview(preview: PrintablePreview) {
  previewEvents.dispatchEvent(new CustomEvent('preview', { detail: preview }));
}

export function onPrintPreview(open: (preview: PrintablePreview) => void) {
  const listener = (event: Event) => open((event as CustomEvent<PrintablePreview>).detail);
  previewEvents.addEventListener('preview', listener);
  return () => previewEvents.removeEventListener('preview', listener);
}

/** Capture the report or guide after its active filters and print-only sections have rendered. */
export function previewWorkspacePage(title: string) {
  const main = document.getElementById('app-main');
  if (!main) return;
  const doc = document.implementation.createHTMLDocument(title);
  doc.documentElement.lang = 'ar';
  doc.documentElement.dir = 'rtl';
  const page = main.cloneNode(true) as HTMLElement;
  page.querySelectorAll('.no-print, script, iframe, object, embed, [role="dialog"], [role="alertdialog"]').forEach(node => node.remove());
  page.querySelectorAll('a[href]').forEach(link => link.removeAttribute('href'));
  page.querySelectorAll('button, input, select, textarea, [tabindex]').forEach(control => control.setAttribute('tabindex', '-1'));
  doc.body.append(page);
  const printStyles: string[] = [];
  for (const sheet of document.styleSheets) {
    if (sheet.disabled || !(sheet.ownerNode instanceof HTMLElement)) continue;
    if (sheet.href && new URL(sheet.href).origin !== location.origin) continue;
    doc.head.append(sheet.ownerNode.cloneNode(true));
    for (const rule of sheet.cssRules) {
      if (rule instanceof CSSMediaRule && rule.conditionText === 'print') {
        printStyles.push(Array.from(rule.cssRules, inner => inner.cssText).join('\n'));
      }
    }
  }
  const style = doc.createElement('style');
  style.textContent = `@media screen { ${printStyles.join('\n')} body { padding: 14mm 12mm; } } @page { size: A4 portrait; }`;
  doc.head.append(style);
  showPrintPreview({ title, html: '<!doctype html>' + doc.documentElement.outerHTML });
}
