import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer } from 'lucide-react';
import { onPrintPreview, type PrintablePreview } from '../../services/documents/printPreview';
import { Modal } from './Modal';

export function PrintPreviewHost() {
  const [preview, setPreview] = useState<PrintablePreview | null>(null);
  useEffect(() => onPrintPreview(setPreview), []);
  return preview && createPortal(<Preview preview={preview} close={() => setPreview(null)} />, document.body);
}

function Preview({ preview, close }: { preview: PrintablePreview; close: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const action = useRef<HTMLButtonElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [enlarged, setEnlarged] = useState(false);
  const [available, setAvailable] = useState(0);
  const paperWidth = (preview.landscape ? 297 : 210) * 96 / 25.4;
  const scale = !enlarged && available ? Math.min(1, available / paperWidth) : 1;

  const print = useCallback(() => {
    try {
      const target = frame.current?.contentWindow;
      if (!target || !ready) return;
      setError('');
      target.print();
    } catch {
      setError('تعذّر فتح نافذة الطباعة في هذا المتصفح. أعد المحاولة.');
    }
  }, [ready]);

  useEffect(() => {
    const box = viewport.current;
    if (!box) return;
    const resize = () => setAvailable(box.clientWidth);
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const doc = frame.current?.contentDocument;
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyP') {
        event.preventDefault();
        print();
      }
    };
    const keys = (event: KeyboardEvent) => {
      shortcut(event);
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key === 'Tab') { event.preventDefault(); action.current?.focus(); }
    };
    window.addEventListener('keydown', shortcut);
    doc?.addEventListener('keydown', keys);
    return () => {
      window.removeEventListener('keydown', shortcut);
      doc?.removeEventListener('keydown', keys);
    };
  }, [ready, close, print]);

  return (
    <Modal isOpen onClose={close} title="معاينة الطباعة" subtitle={preview.title} maxWidth="6xl">
      <div className="flex flex-wrap items-center gap-2 pb-3">
        <button ref={action} type="button" disabled={!ready} onClick={print} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50">
          <Printer className="size-4" aria-hidden /> {preview.pdf ? 'متابعة إلى حفظ PDF' : 'متابعة إلى الطباعة'}
        </button>
        {available > 0 && available < paperWidth && <button type="button" aria-pressed={enlarged} onClick={() => setEnlarged(!enlarged)} className="min-h-11 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          {enlarged ? 'ملاءمة العرض' : 'تكبير للقراءة'}
        </button>}
        <span className="ms-auto text-xs text-slate-600">A4 · {preview.landscape ? 'أفقي' : 'عمودي'}</span>
      </div>
      {error && <p role="alert" className="mb-2 text-sm text-rose-700">{error}</p>}
      <p className="mb-2 text-xs text-slate-600">{preview.pdf ? 'اختر «حفظ بتنسيق PDF» في نافذة الطباعة لمراجعة الصفحات وحفظ الملف.' : 'يمكنك مراجعة فواصل الصفحات وتحديد الطابعة في الخطوة التالية.'}</p>
      <div ref={viewport} className="h-[min(55dvh,42rem)] overflow-auto rounded-lg border border-slate-300 bg-slate-100" aria-label="ورقة المعاينة">
        <div className="relative mx-auto h-full overflow-hidden bg-white" style={{ width: paperWidth * scale }}>
          <iframe ref={frame} tabIndex={0} title={`معاينة المستند — ${preview.title}`} sandbox="allow-same-origin allow-modals" srcDoc={preview.html}
            onLoad={async event => {
              const doc = event.currentTarget.contentDocument;
              if (!doc) return;
              await doc.fonts.ready;
              if (doc === frame.current?.contentDocument) setReady(true);
            }}
            className="absolute start-0 top-0 origin-top-right border-0"
            style={{ width: paperWidth, height: `${100 / scale}%`, transform: `scale(${scale})` }} />
        </div>
      </div>
    </Modal>
  );
}
