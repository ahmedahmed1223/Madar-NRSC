import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, FileDown, FileText, Loader2, Printer } from 'lucide-react';
import type { DocSpec } from '../../services/documents/model';
import { exportDocument, ExportFormat } from '../../services/documents/exportDoc';

export interface ExportItem {
  id: string;
  label: string;
  hint?: string;
  build: () => DocSpec;
}

interface Props {
  items: ExportItem[];
  label?: string;
  /** Opens the menu towards the start (right in RTL) or end. */
  align?: 'start' | 'end';
  className?: string;
}

const FORMATS: { id: ExportFormat; label: string; icon: any; title: string }[] = [
  { id: 'print', label: 'طباعة', icon: Printer, title: 'طباعة على ورق A4' },
  { id: 'pdf', label: 'PDF', icon: FileDown, title: 'حفظ PDF (عبر نافذة الطباعة: اختر «حفظ بتنسيق PDF»)' },
  { id: 'word', label: 'Word', icon: FileText, title: 'تنزيل ملف Word ‏(.docx) قابل للتعديل' },
];

/** "Export & print": each standard document can be printed, saved as PDF or downloaded as Word. */
export const ExportMenu: React.FC<Props> = ({ items, label = 'تصدير وطباعة', align = 'end', className = '' }) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  // Which edge of the button the menu hangs from, so it always stays on screen.
  const [side, setSide] = useState<'left' | 'right'>(align === 'end' ? 'left' : 'right');

  const toggle = () => {
    if (!open && ref.current) {
      const rect = ref.current.getBoundingClientRect();
      const width = Math.min(352, window.innerWidth - 32);
      setSide(rect.left + width <= window.innerWidth - 8 ? 'left' : 'right');
    }
    setOpen((v) => !v);
  };

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const run = async (item: ExportItem, format: ExportFormat) => {
    setBusy(`${item.id}:${format}`);
    setError(null);
    try {
      await exportDocument(item.build(), format);
      if (format !== 'word') setOpen(false);
    } catch (err: any) {
      setError(err?.message || 'تعذر إنشاء المستند');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div ref={ref} className={`relative inline-block ${className}`}>
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50"
      >
        <Printer className="w-4 h-4" /> {label}
        <ChevronDown className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={label}
          className={`absolute z-30 mt-1 w-[min(22rem,calc(100vw-2rem))] bg-white border border-slate-200 rounded-xl shadow-xl p-2 space-y-1 ${side === 'left' ? 'left-0' : 'right-0'}`}
        >
          {items.map((item) => (
            <div key={item.id} className="p-2 rounded-lg hover:bg-slate-50">
              <div className="text-xs font-bold text-slate-800">{item.label}</div>
              {item.hint && <div className="text-[10px] text-slate-500">{item.hint}</div>}
              <div className="flex gap-1.5 mt-1.5">
                {FORMATS.map((f) => {
                  const key = `${item.id}:${f.id}`;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      role="menuitem"
                      title={f.title}
                      aria-label={`${item.label} — ${f.label}`}
                      disabled={!!busy}
                      onClick={() => void run(item, f.id)}
                      className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg border border-slate-200 text-[11px] font-bold text-slate-700 hover:border-blue-400 hover:text-blue-700 disabled:opacity-50"
                    >
                      {busy === key ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <f.icon className="w-3.5 h-3.5" />}
                      {f.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {error && (
            <p role="alert" className="text-[11px] font-bold text-rose-700 p-1">
              {error}
            </p>
          )}
          <p className="text-[10px] text-slate-400 px-1 pt-1 border-t border-slate-100">PDF: في نافذة الطباعة اختر الوجهة «حفظ بتنسيق PDF».</p>
        </div>
      )}
    </div>
  );
};

/** Organisation name and "printed by" details for documents. */
export { docContext } from '../../services/documents/context';
