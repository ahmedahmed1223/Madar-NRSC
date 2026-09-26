import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight } from 'lucide-react';

interface FormPageProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  /** Accepted for drop-in compatibility with Modal; pages size themselves. */
  maxWidth?: string;
  size?: string;
}

export const FORM_PAGE_ROOT_ID = 'form-page-root';
const OPEN_CLASS = 'form-page-open';
let openCount = 0;
// The app restores scroll itself when a page closes; the browser's restoration would fight it.
if (typeof history !== 'undefined' && 'scrollRestoration' in history) history.scrollRestoration = 'manual';
let seq = 0;

const WIDTHS: Record<string, string> = {
  sm: 'max-w-2xl',
  md: 'max-w-2xl',
  lg: 'max-w-3xl',
  xl: 'max-w-3xl',
  '2xl': 'max-w-4xl',
  '4xl': 'max-w-5xl',
  '6xl': 'max-w-6xl',
};

/**
 * Create/edit form shown as its own page inside the app shell (the current screen is hidden
 * while it is open). Browser Back closes it, and the screen underneath keeps its scroll position.
 */
export const FormPage: React.FC<FormPageProps> = ({ isOpen, onClose, title, subtitle, children, maxWidth, size }) => {
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const bodyRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    setRoot(document.getElementById(FORM_PAGE_ROOT_ID));
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const id = `form-page-${++seq}`;
    // Whichever actually scrolls: the content column or the window.
    const column = document.getElementById(FORM_PAGE_ROOT_ID)?.parentElement;
    const scroller = column && column.scrollHeight > column.clientHeight ? column : null;
    const savedScroll = scroller ? scroller.scrollTop : window.scrollY;
    let closedByHistory = false;

    openCount++;
    document.body.classList.add(OPEN_CLASS);
    if (scroller) scroller.scrollTop = 0;
    else window.scrollTo(0, 0);

    try {
      history.pushState({ ...(history.state || {}), nrcsFormPage: id }, '');
    } catch {
      // history unavailable (sandboxed frame): the back button still works
    }
    const onPop = () => {
      closedByHistory = true;
      onCloseRef.current();
    };
    window.addEventListener('popstate', onPop);

    // Put the cursor in the first field.
    const t = window.setTimeout(() => {
      const body = bodyRef.current;
      const first =
        body?.querySelector<HTMLElement>('[data-autofocus]') ||
        body?.querySelector<HTMLElement>('input[required]:not([disabled]), select[required], textarea[required]') ||
        body?.querySelector<HTMLElement>('input:not([type=hidden]):not([type=url]):not([type=file]):not([disabled]), select, textarea');
      first?.focus({ preventScroll: true });
    }, 50);

    return () => {
      window.clearTimeout(t);
      window.removeEventListener('popstate', onPop);
      openCount = Math.max(0, openCount - 1);
      if (!openCount) document.body.classList.remove(OPEN_CLASS);
      if (!closedByHistory && history.state?.nrcsFormPage === id) {
        try {
          history.back();
        } catch {
          // ignore
        }
      }
      const restore = () => {
        if (scroller) scroller.scrollTop = savedScroll;
        else window.scrollTo(0, savedScroll);
      };
      window.requestAnimationFrame(restore);
      window.setTimeout(restore, 60); // after the history navigation settles
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const width = WIDTHS[(size || maxWidth || '2xl') as string] || 'max-w-4xl';
  const page = (
    <section className={`form-page w-full ${width} mx-auto space-y-4`} aria-label={title}>
      <div className="flex items-center gap-3 bg-white border border-slate-200 rounded-2xl px-4 py-3 shadow-2xs">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors shrink-0"
        >
          <ArrowRight className="w-4 h-4" />
          رجوع
        </button>
        <div className="min-w-0">
          <h1 className="text-base sm:text-lg font-bold text-slate-900 truncate">{title}</h1>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      <div ref={bodyRef} className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 shadow-2xs">
        {children}
      </div>
    </section>
  );

  if (root) return createPortal(page, root);
  // Outside the app shell: fall back to a full-screen page.
  return createPortal(
    <div className="fixed inset-0 z-50 bg-slate-50 overflow-y-auto p-4 sm:p-6">{page}</div>,
    document.body
  );
};
