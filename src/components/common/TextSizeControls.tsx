import React, { useEffect, useState } from 'react';
import { AArrowDown, AArrowUp, Maximize2, Minimize2 } from 'lucide-react';

/** Reading sizes for long text (scripts, story bodies), in pixels. */
export const TEXT_SIZES = [13, 15, 17, 20, 24, 28] as const;
const DEFAULT_INDEX = 2;
const key = (id: string) => `nrcs-text-size:${id}`;

/** Font size remembered per kind of field on this device (e.g. every anchor script shares one size). */
export function useTextSize(id: string) {
  const [index, setIndex] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem(key(id)));
      return Number.isInteger(saved) && saved >= 0 && saved < TEXT_SIZES.length ? saved : DEFAULT_INDEX;
    } catch {
      return DEFAULT_INDEX;
    }
  });
  const change = (delta: number) =>
    setIndex((i) => {
      const next = Math.min(TEXT_SIZES.length - 1, Math.max(0, i + delta));
      try {
        localStorage.setItem(key(id), String(next));
      } catch {
        // Private mode: lasts for this visit.
      }
      return next;
    });
  return { size: TEXT_SIZES[index], index, smaller: () => change(-1), larger: () => change(1), canSmaller: index > 0, canLarger: index < TEXT_SIZES.length - 1 };
}

/** Full-screen writing mode for one field; Escape leaves it. */
export function useFullscreenField() {
  const [full, setFull] = useState(false);
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setFull(false);
      }
    };
    document.addEventListener('keydown', onKey, true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prev;
    };
  }, [full]);
  return { full, setFull, toggle: () => setFull((v) => !v) };
}

/** Classes for the field's container: normal, or covering the screen for focused writing. */
export const fullscreenClass = (full: boolean) =>
  full ? 'fixed inset-0 z-[70] bg-white p-3 sm:p-6 flex flex-col gap-2' : '';

/** A−  size  A+  and a full-screen toggle; small enough to sit beside a field's label. */
export const TextSizeControls: React.FC<{
  label: string;
  text: ReturnType<typeof useTextSize>;
  fullscreen?: ReturnType<typeof useFullscreenField>;
  className?: string;
}> = ({ label, text, fullscreen, className = '' }) => (
  <div role="group" aria-label={`عرض ${label}`} className={`inline-flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white p-0.5 ${className}`}>
    <button type="button" onClick={text.smaller} disabled={!text.canSmaller} aria-label={`تصغير خط ${label}`} title="تصغير الخط" className="p-1 rounded-md text-slate-600 hover:bg-slate-100 disabled:opacity-30">
      <AArrowDown className="w-4 h-4" />
    </button>
    <span className="min-w-[2.25rem] text-center text-[10px] font-mono text-slate-500" aria-live="polite">
      {text.size}px
    </span>
    <button type="button" onClick={text.larger} disabled={!text.canLarger} aria-label={`تكبير خط ${label}`} title="تكبير الخط" className="p-1 rounded-md text-slate-600 hover:bg-slate-100 disabled:opacity-30">
      <AArrowUp className="w-4 h-4" />
    </button>
    {fullscreen && (
      <button
        type="button"
        onClick={fullscreen.toggle}
        aria-pressed={fullscreen.full}
        aria-label={fullscreen.full ? `إنهاء ملء الشاشة (${label})` : `ملء الشاشة للكتابة (${label})`}
        title={fullscreen.full ? 'إنهاء ملء الشاشة (Esc)' : 'ملء الشاشة للكتابة'}
        className="p-1 rounded-md text-slate-600 hover:bg-slate-100 border-s border-slate-200 ms-0.5"
      >
        {fullscreen.full ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
      </button>
    )}
  </div>
);

/**
 * A long-text field (anchor script, intro, notes) with adjustable font size, a full-screen mode,
 * vertical resizing and its own scrolling, so it works on phones, laptops and studio screens.
 */
export const LongTextField: React.FC<
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
    id: string;
    label: React.ReactNode;
    /** Short name used in button labels, e.g. «نص المذيع». */
    name: string;
    /** Fields sharing this key share one font size. */
    sizeKey: string;
    /** Extra content beside the label (word counts, actions). */
    aside?: React.ReactNode;
    footer?: React.ReactNode;
  }
> = ({ id, label, name, sizeKey, aside, footer, className = '', style, rows = 8, ...rest }) => {
  const text = useTextSize(sizeKey);
  const fs = useFullscreenField();
  return (
    <div className={fullscreenClass(fs.full)} role={fs.full ? 'dialog' : undefined} aria-modal={fs.full || undefined} aria-label={fs.full ? name : undefined}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <label htmlFor={id} className="text-xs font-bold text-slate-700">
          {label}
        </label>
        <div className="flex flex-wrap items-center gap-2">
          {aside}
          <TextSizeControls label={name} text={text} fullscreen={fs} />
        </div>
      </div>
      <textarea
        id={id}
        rows={rows}
        {...rest}
        style={{ ...style, fontSize: text.size, lineHeight: 1.9 }}
        className={`w-full resize-y overflow-y-auto ${fs.full ? 'flex-1 max-h-none' : 'max-h-[70vh]'} ${className}`}
      />
      {footer}
    </div>
  );
};
