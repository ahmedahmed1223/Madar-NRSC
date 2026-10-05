import React from 'react';
import type { FormDraftStatus } from '../../hooks/useFormDraft';
import { RotateCcw } from 'lucide-react';
import { confirmDialog } from '../../services/dialogs';

export const DraftStatus: React.FC<{ draft: FormDraftStatus }> = ({ draft }) => {
  if (!draft.dirty && !draft.recovered && !draft.error) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p role={draft.error ? 'alert' : 'status'} className={`text-xs leading-relaxed py-2 flex-1 min-w-0 ${draft.error ? 'text-rose-700' : 'text-amber-800'}`}>
        {draft.error
          ? 'تعذر حفظ نسخة الاستعادة على هذا الجهاز. احفظ لدى الخادم قبل المغادرة.'
          : draft.recovered
          ? 'استُعيدت مسودة محلية. راجع التغييرات ثم احفظها لدى الخادم.'
          : 'تغييرات غير محفوظة لدى الخادم؛ نسخة الاستعادة محفوظة على هذا الجهاز.'}
      </p>
      {draft.dirty && (
        <button type="button" title="تجاهل المسودة المحلية" aria-label="تجاهل المسودة المحلية"
          onClick={async () => {
            if (await confirmDialog({ title: 'تجاهل المسودة المحلية', message: 'ستُحذف التغييرات المحلية وتعود الحقول إلى قيمها عند فتح النموذج.', confirmLabel: 'تجاهل التغييرات', cancelLabel: 'البقاء', danger: true })) draft.discardDraft();
          }} className="w-11 h-11 shrink-0 inline-flex items-center justify-center text-amber-800 hover:bg-amber-50 rounded-md">
          <RotateCcw className="w-4 h-4" />
        </button>
      )}
    </div>
  );
};
