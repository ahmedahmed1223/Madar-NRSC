import React, { useEffect } from 'react';
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
    <div className="fixed bottom-5 left-5 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
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
  useEffect(() => {
    const timer = setTimeout(() => {
      onDismiss(toast.id);
    }, toast.duration ?? (toast.action ? 8000 : 4500));
    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, toast.action, onDismiss]);

  const styles = {
    success: {
      bg: 'bg-emerald-950/90 border-emerald-500/40 text-emerald-100',
      icon: <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />,
      bar: 'bg-emerald-500',
    },
    error: {
      bg: 'bg-rose-950/90 border-rose-500/40 text-rose-100',
      icon: <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />,
      bar: 'bg-rose-500',
    },
    warning: {
      bg: 'bg-amber-950/90 border-amber-500/40 text-amber-100',
      icon: <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />,
      bar: 'bg-amber-500',
    },
    info: {
      bg: 'bg-slate-900/90 border-blue-500/40 text-slate-100',
      icon: <Info className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />,
      bar: 'bg-blue-500',
    },
  }[toast.type];

  return (
    <div
      role={toast.type === 'error' ? 'alert' : 'status'}
      className={`pointer-events-auto relative overflow-hidden backdrop-blur-md border rounded-xl p-3.5 shadow-2xl transition-all duration-300 animate-in fade-in slide-in-from-bottom-3 ${styles.bg}`}
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
            className="shrink-0 px-2.5 py-1 rounded-md bg-white/15 hover:bg-white/25 text-white text-xs font-bold"
          >
            {toast.action.label}
          </button>
        )}
        <button
          type="button"
          onClick={() => onDismiss(toast.id)}
          className="text-slate-400 hover:text-white p-1 rounded-md transition-colors"
          aria-label="إغلاق"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white/10 overflow-hidden">
        <div className={`h-full ${styles.bar} animate-toast-progress`} />
      </div>
    </div>
  );
};
