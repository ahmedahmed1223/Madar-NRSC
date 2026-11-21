import React, { useId, useRef } from 'react';
import { X } from 'lucide-react';
import { useModalFocus } from '../../hooks/useModalFocus';
import { tabStops } from '../../shared/focus';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '4xl' | '6xl';
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '4xl' | '6xl' | string;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  initialFocusRef,
  children,
  maxWidth = '2xl',
  size,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const subtitleId = useId();
  useModalFocus(isOpen, dialogRef, {
    close: onClose,
    initialFocus: () => {
      const fields = contentRef.current ? tabStops(contentRef.current) : [];
      return initialFocusRef?.current || fields.find(element => element.matches('input, select, textarea, [data-autofocus]'));
    },
  });

  if (!isOpen) return null;

  const maxWidthClasses = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
    '4xl': 'max-w-4xl',
    '6xl': 'max-w-6xl',
  };

  const effectiveWidthKey = (size || maxWidth) as keyof typeof maxWidthClasses;
  const widthClass = maxWidthClasses[effectiveWidthKey] || maxWidthClasses['2xl'];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
    <div
      ref={dialogRef}
      role="dialog"
      tabIndex={-1}
      aria-labelledby={titleId}
      aria-describedby={subtitle ? subtitleId : undefined}
      aria-modal="true"
      className={`relative w-full ${widthClass} p-0 bg-white rounded-lg shadow-2xl border border-slate-200 overflow-hidden max-h-[calc(100dvh-2rem)]`}
    >
      <div className="flex flex-col max-h-[calc(100dvh-2rem)]">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-slate-100 bg-slate-50/80">
          <div className="min-w-0 break-words">
            <h3 id={titleId} className="text-lg font-bold text-slate-800">{title}</h3>
            {subtitle && <p id={subtitleId} className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="shrink-0 min-w-11 min-h-11 flex items-center justify-center text-slate-500 hover:text-slate-700 hover:bg-slate-200/60 rounded-lg transition-colors"
            title="إغلاق"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Content */}
        <div ref={contentRef} className="p-4 sm:p-6 overflow-y-auto overscroll-contain min-h-0 flex-1">{children}</div>
      </div>
    </div>
    </div>
  );
};
