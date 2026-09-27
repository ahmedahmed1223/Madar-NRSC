import React, { useEffect, useState } from 'react';
import { History, Loader2, RotateCcw, AlertCircle } from 'lucide-react';
import { Modal } from '../common/Modal';
import { apiService, NewsRevision } from '../../services/api';
import { sanitizeHtml } from '../../utils/sanitizeHtml';
import type { NewsItem } from '../../types';

interface NewsHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  newsId: string;
  /** Loads the chosen version into the editor; it is only saved when the user saves. */
  onRestore: (data: NewsItem) => void;
  canRestore: boolean;
}

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'مسودة',
  IN_PROGRESS: 'قيد الكتابة',
  UNDER_REVIEW: 'قيد المراجعة',
  NEEDS_REVISION: 'يحتاج تعديل',
  APPROVED: 'معتمد',
  PUBLISHED: 'منشور',
  ARCHIVED: 'مؤرشف',
  REJECTED: 'مرفوض',
};

/** Server-kept previous versions of a story, newest first. */
export const NewsHistoryModal: React.FC<NewsHistoryModalProps> = ({ isOpen, onClose, newsId, onRestore, canRestore }) => {
  const [revisions, setRevisions] = useState<NewsRevision[]>([]);
  const [selected, setSelected] = useState<NewsRevision | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setError(null);
    setSelected(null);
    apiService
      .getNewsHistory(newsId)
      .then((list) => {
        setRevisions(list);
        setSelected(list[0] || null);
      })
      .catch((err) => setError(err?.message || 'تعذر تحميل سجل النسخ'))
      .finally(() => setLoading(false));
  }, [isOpen, newsId]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="سجل نسخ الخبر" maxWidth="4xl">
      <div className="text-right" dir="rtl">
        {loading && (
          <div className="py-16 flex justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
          </div>
        )}
        {error && (
          <div role="alert" className="flex items-center gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 font-semibold">
            <AlertCircle className="w-4 h-4" />
            {error}
          </div>
        )}
        {!loading && !error && revisions.length === 0 && (
          <p className="py-12 text-center text-sm text-slate-500">لا توجد نسخ سابقة لهذا الخبر بعد. تُحفظ نسخة عند كل تعديل.</p>
        )}
        {!loading && revisions.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 min-h-[400px]">
            <ul className="md:col-span-1 space-y-1.5 max-h-[60vh] overflow-y-auto">
              {revisions.map((rev) => (
                <li key={rev.version}>
                  <button
                    type="button"
                    onClick={() => setSelected(rev)}
                    className={`w-full text-right p-2.5 rounded-xl border text-xs transition-colors ${
                      selected?.version === rev.version ? 'bg-blue-50 border-blue-300' : 'bg-white border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 font-bold text-slate-800">
                      <History className="w-3.5 h-3.5 text-slate-400" />
                      النسخة {rev.version}
                      <span className="text-[10px] font-semibold text-slate-500">({STATUS_LABELS[rev.data.status] || rev.data.status})</span>
                    </div>
                    <div className="text-[11px] text-slate-500 mt-1">
                      {new Date(rev.changedAt).toLocaleString('ar-EG-u-nu-latn')} — عدّلها بعد ذلك: {rev.changedByName || 'النظام'}
                    </div>
                    <div className="text-[11px] text-slate-700 mt-1 truncate">{rev.data.title}</div>
                  </button>
                </li>
              ))}
            </ul>
            {selected && (
              <div className="md:col-span-2 border border-slate-200 rounded-xl p-4 space-y-3 max-h-[60vh] overflow-y-auto">
                <h3 className="text-base font-extrabold text-slate-900">{selected.data.title}</h3>
                {selected.data.summary && <p className="text-xs text-slate-600 leading-relaxed">{selected.data.summary}</p>}
                <div
                  className="rich-content text-sm text-slate-800"
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(selected.data.content) }}
                />
                {canRestore && (
                  <button
                    type="button"
                    onClick={() => {
                      onRestore(selected.data);
                      onClose();
                    }}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    تحميل هذه النسخة في المحرر (لا تُحفظ حتى تضغط حفظ)
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
};
