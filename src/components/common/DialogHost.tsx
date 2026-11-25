import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Copy, HelpCircle, Info } from 'lucide-react';
import { DialogRequest, onDialogs, settleDialog } from '../../services/dialogs';
import { useModalFocus } from '../../hooks/useModalFocus';
import { copyTextToClipboard } from '../../services/clipboard';

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
  const cancelRef = useRef<HTMLButtonElement>(null);
  const prompt = req.kind === 'prompt' ? req.options : null;
  const [value, setValue] = useState(prompt?.defaultValue ?? '');
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
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

  useModalFocus(true, boxRef, {
    close: cancel,
    global: true,
    initialFocus: () => prompt ? inputRef.current : danger ? cancelRef.current : confirmRef.current,
  });

  const Icon = req.kind === 'alert' ? Info : danger ? AlertTriangle : HelpCircle;
  const title = opts.title || (req.kind === 'confirm' ? (danger ? 'تأكيد إجراء لا يمكن التراجع عنه' : 'تأكيد') : req.kind === 'alert' ? 'تنبيه' : 'إدخال');
  const titleId = `dlg-title-${req.id}`;
  const descId = `dlg-desc-${req.id}`;
  const inputId = `dlg-input-${req.id}`;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" dir="rtl">
      <div className="absolute inset-0 bg-slate-950/50" onClick={cancel} aria-hidden />
      <div
        ref={boxRef}
        role={req.kind === 'prompt' ? 'dialog' : 'alertdialog'}
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby={titleId}
        aria-describedby={opts.message ? descId : undefined}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.nativeEvent.isComposing || !(event.target instanceof HTMLInputElement)) return;
          event.preventDefault();
          accept();
        }}
        className="relative max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto overscroll-contain bg-white rounded-2xl shadow-2xl border border-slate-200 p-4 sm:p-5 space-y-4 text-start"
      >
        <div className="flex items-start gap-3">
          <span className={`p-2 rounded-xl shrink-0 ${danger ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'}`}>
            <Icon className="w-5 h-5" aria-hidden="true" />
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
          <div>
            <label htmlFor={inputId} className="block text-xs font-bold text-slate-700">{prompt.label || 'الإجابة'}</label>
            {prompt.multiline ? (
              <textarea
                ref={inputRef}
                id={inputId}
                rows={3}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={prompt.placeholder}
                aria-invalid={invalid || undefined}
                aria-required={prompt.required || undefined}
                className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-300 text-sm"
              />
            ) : (
              <div className="mt-1 flex gap-2">
                <input
                  ref={inputRef}
                  id={inputId}
                  value={value}
                  readOnly={prompt.copyOnly}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={prompt.placeholder}
                  aria-invalid={invalid || undefined}
                  aria-required={prompt.required || undefined}
                  onFocus={prompt.copyOnly ? (event) => event.currentTarget.select() : undefined}
                  dir={prompt.copyOnly ? 'ltr' : undefined}
                  className={`min-w-0 flex-1 px-3 py-2 rounded-xl border border-slate-300 text-sm ${prompt.copyOnly ? 'font-mono' : ''}`}
                />
                {prompt.copyOnly && (
                  <button
                    type="button"
                    onClick={() => {
                      void copyTextToClipboard(value).then((ok) => {
                        setCopied(ok);
                        setCopyFailed(!ok);
                        if (!ok) inputRef.current?.select();
                      });
                    }}
                    className="inline-flex min-h-11 items-center gap-1 px-3 rounded-xl border border-slate-300 text-xs font-bold hover:bg-slate-50"
                  >
                    {copied ? <Check className="w-4 h-4 text-emerald-700" /> : <Copy className="w-4 h-4" />}
                    {copied ? 'نُسخت' : copyFailed ? 'حدّد وانسخ' : 'نسخ'}
                  </button>
                )}
              </div>
            )}
            {copyFailed && <p role="status" className="mt-1 text-xs text-amber-800">تعذّر النسخ تلقائياً؛ حدّد النص وانسخه يدوياً.</p>}
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          {(req.kind === 'confirm' || (req.kind === 'prompt' && !prompt?.copyOnly)) && (
            <button type="button" ref={cancelRef} onClick={cancel} className="min-h-11 px-4 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-50">
              {opts.cancelLabel || 'إلغاء'}
            </button>
          )}
          <button
            ref={confirmRef}
            type="button"
            onClick={accept}
            disabled={invalid}
            className={`min-h-11 px-4 py-2 rounded-xl text-xs font-bold text-white disabled:opacity-40 ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}
          >
            {opts.confirmLabel || (req.kind === 'confirm' ? 'تأكيد' : req.kind === 'alert' || prompt?.copyOnly ? 'حسناً' : 'موافق')}
          </button>
        </div>
      </div>
    </div>
  );
};
