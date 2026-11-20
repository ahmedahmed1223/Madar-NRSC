import React, { useEffect, useState } from 'react';
import { FormPage } from '../common/FormPage';
import { apiService } from '../../services/api';
import { departmentName } from '../../shared/departments';
import { DeptRequest, REQUEST_TYPES, RequestLink, RequestType, requestTypeOf } from '../../shared/production';
import { toLocalInputValue, fromLocalInputValue } from '../../shared/dates';
import { confirmSaved } from '../../services/confirmSave';

export interface RequestDraft {
  type?: RequestType;
  title?: string;
  details?: string;
  link?: RequestLink;
  lines?: string[];
}

interface RequestFormPageProps {
  isOpen: boolean;
  onClose: () => void;
  draft?: RequestDraft;
  onCreated?: (message: string) => void;
  /** An open request its sender is editing (title, details, due date, priority); the type stays fixed. */
  editing?: DeptRequest | null;
}

/** Sends a request to another department (montage, graphics, studio, ...). */
export const RequestFormPage: React.FC<RequestFormPageProps> = ({ isOpen, onClose, draft, onCreated, editing }) => {
  const [type, setType] = useState<RequestType>('MONTAGE');
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [dueAt, setDueAt] = useState('');
  const [lines, setLines] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    if (editing) {
      setType(editing.type);
      setTitle(editing.title || '');
      setDetails(editing.details || '');
      setLines((editing.lines || []).join('\n'));
      setUrgent(editing.priority === 'URGENT');
      setDueAt(editing.dueAt ? toLocalInputValue(editing.dueAt) : '');
      setError(null);
      return;
    }
    setType(draft?.type || 'MONTAGE');
    setTitle(draft?.title || '');
    setDetails(draft?.details || '');
    setLines((draft?.lines || []).join('\n'));
    setUrgent(false);
    setDueAt('');
    setError(null);
  }, [isOpen, draft, editing]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setError(null);
    if (editing) {
      setSaving(true);
      try {
        // updateRequest applies the same rules as the server (only the sender, only while open).
        apiService.updateRequest(editing.id, {
          title: title.trim(),
          details: details.trim(),
          priority: urgent ? 'URGENT' : 'NORMAL',
          dueAt: dueAt ? fromLocalInputValue(dueAt) : undefined,
          ...(type === 'GRAPHICS' ? { lines: lines.split('\n').filter((l) => l.trim()) } : {}),
        });
        if (await confirmSaved('requests', editing.id, 'حُفظت تعديلات الطلب')) {
          onCreated?.('حُفظت تعديلات الطلب');
          onClose();
        } else {
          setError('لم يؤكد الخادم حفظ التعديلات بعد؛ ما كتبته باقٍ هنا.');
        }
      } catch (err: any) {
        setError(err?.message || 'تعذر حفظ تعديلات الطلب');
      } finally {
        setSaving(false);
      }
      return;
    }
    try {
      const req = apiService.createRequest({
        type,
        title,
        details,
        priority: urgent ? 'URGENT' : 'NORMAL',
        link: draft?.link,
        lines: type === 'GRAPHICS' ? lines.split('\n') : undefined,
        dueAt: dueAt ? fromLocalInputValue(dueAt) : undefined,
      });
      onCreated?.(`أُرسل الطلب إلى ${departmentName(req.departmentId)}`);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'تعذر إرسال الطلب');
    }
  };

  const target = requestTypeOf(type);

  return (
    <FormPage isOpen={isOpen} onClose={onClose} title={editing ? 'تعديل الطلب' : 'طلب من قسم'} subtitle={(editing?.link || draft?.link) ? `مرتبط بـ: ${(editing?.link || draft?.link)!.title}` : undefined} maxWidth="xl">
      <form onSubmit={submit} className="space-y-4 text-xs">
        <div>
          <span className="block font-bold text-slate-700 mb-1.5">نوع الطلب</span>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2" role="radiogroup" aria-label="نوع الطلب">
            {REQUEST_TYPES.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={type === t.id}
                aria-disabled={!!editing && type !== t.id}
                disabled={!!editing && type !== t.id}
                onClick={() => setType(t.id)}
                className={`px-2 py-2 rounded-xl border font-bold disabled:opacity-40 disabled:cursor-not-allowed ${type === t.id ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}
              >
                {t.name}
              </button>
            ))}
          </div>
          {target && <p className="mt-1.5 text-2xs text-slate-500">{editing ? 'لا يتغير نوع الطلب بعد إرساله. ' : ''}يصل الطلب إلى مناوبي قسم «{departmentName(target.departmentId)}».</p>}
        </div>

        <div>
          <label htmlFor="request-title" className="block font-bold text-slate-700 mb-1">العنوان *</label>
          <input id="request-title" data-autofocus value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="مثال: مونتاج تقرير القمة بمدة دقيقتين" className="w-full px-3 py-2 border border-slate-300 rounded-xl" />
        </div>

        <div>
          <label htmlFor="request-details" className="block font-bold text-slate-700 mb-1">التفاصيل</label>
          <textarea id="request-details" rows={4} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="ما المطلوب تحديداً؟ المدة، المواد الخام، الملاحظات..." className="w-full px-3 py-2 border border-slate-300 rounded-xl" />
        </div>

        {type === 'GRAPHICS' && (
          <div>
            <label htmlFor="request-lines" className="block font-bold text-slate-700 mb-1">نصوص الشارات (سطر لكل شارة)</label>
            <textarea id="request-lines" rows={4} value={lines} onChange={(e) => setLines(e.target.value)} placeholder={'د. خالد الشمري — خبير اقتصادي\nعاجل: ...'} className="w-full px-3 py-2 border border-slate-300 rounded-xl" />
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="request-due" className="block font-bold text-slate-700 mb-1">مطلوب قبل</label>
            <input id="request-due" type="datetime-local" value={dueAt} min={editing ? undefined : toLocalInputValue()} onChange={(e) => setDueAt(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-xl" />
          </div>
          <label className="flex items-center gap-2 mt-6 font-bold text-slate-700">
            <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} />
            طلب عاجل
          </label>
        </div>

        {error && <p role="alert" className="p-2 rounded-lg bg-rose-50 text-rose-700 font-bold">{error}</p>}
        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <button type="button" onClick={onClose} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl">
            إلغاء
          </button>
          <button type="submit" disabled={saving} className="px-5 py-2 font-bold bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-xl">
            {saving ? 'جارٍ الحفظ...' : editing ? 'حفظ التعديلات' : 'إرسال الطلب'}
          </button>
        </div>
      </form>
    </FormPage>
  );
};
