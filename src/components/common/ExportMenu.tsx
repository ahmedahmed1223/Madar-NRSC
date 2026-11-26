import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileDown, FileText, Loader2, Printer } from 'lucide-react';
import type { DocSpec } from '../../services/documents/model';
import { exportDocument, type ExportFormat } from '../../services/documents/exportDoc';
import { Modal } from './Modal';

export interface ExportItem {
  id: string;
  label: string;
  hint?: string;
  build: () => DocSpec;
}

const formats = [
  { id: 'print', label: 'طباعة', icon: Printer },
  { id: 'pdf', label: 'PDF', icon: FileDown },
  { id: 'word', label: 'Word', icon: FileText },
] as const;

interface Props {
  items: ExportItem[];
  label?: string;
  className?: string;
}

export function ExportMenu({ items, label = 'تصدير وطباعة', className = '' }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ error?: boolean; text: string } | null>(null);
  const running = useRef(false);
  const firstFormat = useRef<HTMLButtonElement>(null);

  const run = async (item: ExportItem, format: ExportFormat) => {
    if (running.current) return;
    running.current = true;
    setBusy(`${item.id}:${format}`);
    setFeedback(null);
    try {
      await exportDocument(item.build(), format);
      if (format === 'word') setFeedback({ text: `بدأ تنزيل «${item.label}» بصيغة Word.` });
    } catch (error) {
      setFeedback({ error: true, text: error instanceof Error ? error.message : 'تعذّر إنشاء المستند. أعد المحاولة.' });
    } finally {
      running.current = false;
      setBusy(null);
    }
  };

  return (
    <>
      <button type="button" aria-haspopup="dialog" aria-expanded={open}
        onClick={() => { setFeedback(null); setOpen(true); }}
        className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 ${className}`}>
        <Printer className="size-4" aria-hidden="true" /> {label}
      </button>
      {open && createPortal(
        <Modal isOpen onClose={() => setOpen(false)} title={label} maxWidth="md" initialFocusRef={firstFormat}>
          <div className="divide-y divide-slate-200">
            {items.map((item, index) => (
              <fieldset key={item.id} className="min-w-0 pb-4 last:pb-0 not-first:pt-4">
                <legend className="float-start w-full text-sm font-bold text-slate-900">{item.label}</legend>
                <div className="clear-both">
                  {item.hint && <p className="text-xs leading-relaxed text-slate-600">{item.hint}</p>}
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {formats.map(({ id, label: formatLabel, icon: Icon }) => {
                      const working = busy === `${item.id}:${id}`;
                      return (
                        <button key={id} type="button" ref={index === 0 && id === 'print' ? firstFormat : undefined}
                          aria-label={`${item.label} — ${formatLabel}`} aria-disabled={!!busy}
                          onClick={() => void run(item, id)}
                          className="inline-flex min-h-11 items-center justify-center gap-1 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-blue-50 hover:text-blue-800 aria-disabled:opacity-60">
                          {working ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Icon className="size-4" aria-hidden />}
                          {formatLabel}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </fieldset>
            ))}
          </div>
          {feedback && <p role={feedback.error ? 'alert' : 'status'} className={`mt-3 text-sm ${feedback.error ? 'text-rose-700' : 'text-slate-700'}`}>{feedback.text}</p>}
          <p className="mt-4 border-t border-slate-200 pt-3 text-xs leading-relaxed text-slate-600">لحفظ PDF، اختر «حفظ بتنسيق PDF» في نافذة الطباعة.</p>
        </Modal>, document.body)}
    </>
  );
}

export { docContext } from '../../services/documents/context';
