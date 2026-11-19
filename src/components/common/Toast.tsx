import React, { useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, AlertCircle, Info, X } from 'lucide-react';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title?: string;
  message: string;
  action?: { label: string; run: () => void };
  duration?: number;
}

interface ToastContainerProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => {
  return (
    <div className="fixed bottom-[max(1.25rem,var(--editor-actions-height,0px))] sm:bottom-5 left-3 sm:left-5 z-50 flex flex-col gap-2 max-w-sm w-[calc(100%-1.5rem)] sm:w-full pointer-events-none">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
};

const ToastItem: React.FC<{ toast: ToastMessage; onDismiss: (id: string) => void }> = ({
  toast,
  onDismiss,
}) => {
  // Keyboard focus inside a toast keeps it until focus leaves. The pointer does not: a toast may
  // appear over the control someone is about to press, and must clear on its own.
  const [held, setHeld] = useState(false);
  const duration = toast.duration ?? (toast.action ? 8000 : 4500);
  useEffect(() => {
    if (held) return;
    const timer = setTimeout(() => {
      onDismiss(toast.id);
    }, duration);
    return () => clearTimeout(timer);
  }, [toast.id, duration, onDismiss, held]);

  const styles = {
    success: {
      bg: 'border-emerald-500/40',
      icon: <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />,
      bar: 'bg-emerald-500',
    },
    error: {
      bg: 'border-rose-500/50',
      icon: <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />,
      bar: 'bg-rose-500',
    },
    warning: {
      bg: 'border-amber-500/40',
      icon: <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />,
      bar: 'bg-amber-500',
    },
    info: {
      bg: 'border-blue-500/40',
      icon: <Info className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />,
      bar: 'bg-blue-500',
    },
  }[toast.type];

  return (
    <div
      role={toast.type === 'error' ? 'alert' : 'status'}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
      className={`pointer-events-auto relative overflow-hidden bg-slate-900 text-slate-100 border rounded-xl p-3.5 shadow-2xl ${styles.bg}`}
    >
      <div className="flex items-start gap-3">
        {styles.icon}
        <div className="flex-1 text-xs">
          {toast.title && <div className="font-bold mb-0.5">{toast.title}</div>}
          <div className="leading-relaxed text-slate-200">{toast.message}</div>
        </div>
        {toast.action && (
          <button
            type="button"
            onClick={() => {
              toast.action!.run();
              onDismiss(toast.id);
            }}
            className="shrink-0 min-h-8 px-3 rounded-md bg-white/15 hover:bg-white/25 text-white text-xs font-bold"
          >
            {toast.action.label}
          </button>
        )}
        <button
          type="button"
          onClick={() => onDismiss(toast.id)}
          className="shrink-0 min-w-8 min-h-8 inline-flex items-center justify-center -m-1 text-slate-300 hover:text-white rounded-md transition-colors"
          aria-label="إغلاق"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white/10 overflow-hidden">
        <div className={`h-full ${styles.bar} ${held ? '' : 'animate-toast-progress'}`} style={{ animationDuration: `${duration}ms` }} />
      </div>
    </div>
  );
};
