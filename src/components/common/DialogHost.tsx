import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Copy, HelpCircle, Info } from 'lucide-react';
import { DialogRequest, onDialogs, settleDialog } from '../../services/dialogs';

/**
 * Shows in-app confirm / alert / prompt dialogs one at a time. Focus moves into the dialog and
 * stays there; Esc cancels, Enter confirms, and focus returns to where it was.
 */
export const DialogHost: React.FC = () => {
  const [queue, setQueue] = useState<DialogRequest[]>([]);
  useEffect(() => onDialogs(setQueue), []);
  const current = queue[0];
  return current ? <DialogView key={current.id} req={current} /> : null;
};

const DialogView: React.FC<{ req: DialogRequest }> = ({ req }) => {
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(typeof document !== 'undefined' ? (document.activeElement as HTMLElement) : null);
  const prompt = req.kind === 'prompt' ? req.options : null;
  const [value, setValue] = useState(prompt?.defaultValue ?? '');
  const [copied, setCopied] = useState(false);
  const opts = req.options as any;
  const danger = req.kind === 'confirm' && !!opts.danger;
  const invalid = !!prompt?.required && !prompt.copyOnly && !value.trim();

  const cancel = () => settleDialog(req.id, req.kind === 'confirm' ? false : req.kind === 'prompt' ? (prompt?.copyOnly ? value : null) : undefined);
  const accept = () => {
    if (req.kind === 'prompt' && invalid) {
      inputRef.current?.focus();
      return;
    }
    settleDialog(req.id, req.kind === 'confirm' ? true : req.kind === 'prompt' ? value : undefined);
  };

  useEffect(() => {
    const t = setTimeout(() => {
      if (prompt) {
        inputRef.current?.focus();
        if (prompt.copyOnly) inputRef.current?.select();
      } else confirmRef.current?.focus();
    }, 20);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const back = opener.current;
    return () => {
      clearTimeout(t);
      document.body.style.overflow = prev;
      back?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    } else if (e.key === 'Enter' && !(prompt?.multiline && e.target instanceof HTMLTextAreaElement)) {
      e.preventDefault();
      accept();
    } else if (e.key === 'Tab') {
      const items = boxRef.current?.querySelectorAll<HTMLElement>('button, input, textarea');
      if (!items?.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  const Icon = req.kind === 'alert' ? Info : danger ? AlertTriangle : HelpCircle;
  const title = opts.title || (req.kind === 'confirm' ? (danger ? 'تأكيد إجراء لا يمكن التراجع عنه' : 'تأكيد') : req.kind === 'alert' ? 'تنبيه' : 'إدخال');
  const titleId = `dlg-title-${req.id}`;
  const descId = `dlg-desc-${req.id}`;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" dir="rtl">
      <div className="absolute inset-0 bg-slate-950/50" onClick={cancel} aria-hidden />
      <div
        ref={boxRef}
        role={req.kind === 'prompt' ? 'dialog' : 'alertdialog'}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={opts.message ? descId : undefined}
        onKeyDown={onKeyDown}
        className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 p-5 space-y-4 text-right"
      >
        <div className="flex items-start gap-3">
          <span className={`p-2 rounded-xl shrink-0 ${danger ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'}`}>
            <Icon className="w-5 h-5" />
          </span>
          <div className="min-w-0 space-y-1">
            <h2 id={titleId} className="text-sm font-bold text-slate-900">
              {title}
            </h2>
            {opts.message && (
              <p id={descId} className="text-xs text-slate-600 leading-relaxed whitespace-pre-line">
                {opts.message}
              </p>
            )}
          </div>
        </div>

        {prompt && (
          <label className="block text-xs font-bold text-slate-700">
            {prompt.label}
            {prompt.multiline ? (
              <textarea
                ref={inputRef}
                rows={3}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={prompt.placeholder}
                aria-invalid={invalid || undefined}
                className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-300 text-sm"
              />
            ) : (
              <div className="mt-1 flex gap-2">
                <input
                  ref={inputRef}
                  value={value}
                  readOnly={prompt.copyOnly}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={prompt.placeholder}
                  aria-invalid={invalid || undefined}
                  dir={prompt.copyOnly ? 'ltr' : undefined}
                  className={`flex-1 px-3 py-2 rounded-xl border border-slate-300 text-sm ${prompt.copyOnly ? 'font-mono' : ''}`}
                />
                {prompt.copyOnly && (
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard?.writeText(value).then(() => setCopied(true)).catch(() => inputRef.current?.select());
                    }}
                    className="inline-flex items-center gap-1 px-3 rounded-xl border border-slate-300 text-xs font-bold hover:bg-slate-50"
                  >
                    {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                    {copied ? 'نُسخت' : 'نسخ'}
                  </button>
                )}
              </div>
            )}
          </label>
        )}

        <div className="flex justify-end gap-2">
          {(req.kind === 'confirm' || (req.kind === 'prompt' && !prompt?.copyOnly)) && (
            <button type="button" onClick={cancel} className="px-4 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-50">
              {opts.cancelLabel || 'إلغاء'}
            </button>
          )}
          <button
            ref={confirmRef}
            type="button"
            onClick={accept}
            disabled={invalid}
            className={`px-4 py-2 rounded-xl text-xs font-bold text-white disabled:opacity-40 ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}
          >
            {opts.confirmLabel || (req.kind === 'confirm' ? 'تأكيد' : req.kind === 'alert' || prompt?.copyOnly ? 'حسناً' : 'موافق')}
          </button>
        </div>
      </div>
    </div>
  );
};
