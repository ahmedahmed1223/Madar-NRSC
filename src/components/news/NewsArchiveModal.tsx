import { appLocale, zoneOptions } from '../../shared/dateFormat';
import React, { useEffect, useState } from 'react';
import { Search, Loader2, ArrowRight, RotateCcw } from 'lucide-react';
import { Modal } from '../common/Modal';
import { apiService, NewsArchivePage } from '../../services/api';
import { sanitizeHtml } from '../../utils/sanitizeHtml';
import type { NewsItem } from '../../types';

interface NewsArchiveModalProps {
  isOpen: boolean;
  onClose: () => void;
  canReactivate: boolean;
  /** Called after a story was returned to the newsroom. */
  onReactivated: (newsId: string) => void;
}

const STATUS_LABELS: Record<string, string> = {
  PUBLISHED: 'منشور',
  ARCHIVED: 'مؤرشف',
  UNPUBLISHED: 'مسحوب',
  REJECTED: 'مرفوض',
};

const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString(appLocale(), { ...zoneOptions(), dateStyle: 'medium' }) : '—');

/** Search of finished news that is no longer synced to browsers (older than NEWS_ACTIVE_DAYS). */
export const NewsArchiveModal: React.FC<NewsArchiveModalProps> = ({ isOpen, onClose, canReactivate, onReactivated }) => {
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<NewsArchivePage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<NewsItem | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiService
      .searchNewsArchive(submitted, page)
      .then((r) => !cancelled && setResult(r))
      .catch((err) => !cancelled && setError(err?.message || 'تعذر البحث في الأرشيف'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [isOpen, submitted, page]);

  const openPreview = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      setPreview(await apiService.getArchivedNews(id));
    } catch (err: any) {
      setError(err?.message || 'تعذر فتح الخبر');
    } finally {
      setBusy(false);
    }
  };

  const reactivate = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await apiService.reactivateArchivedNews(id);
      setPreview(null);
      onReactivated(id);
    } catch (err: any) {
      setError(err?.message || 'تعذرت إعادة الخبر');
    } finally {
      setBusy(false);
    }
  };

  const totalPages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="أرشيف الأخبار القديمة"
      subtitle={
        result && result.activeDays > 0
          ? `الأخبار المنتهية التي لم تُعدّل منذ أكثر من ${result.activeDays} يوماً تُحفظ على الخادم وتُستعرض من هنا`
          : 'البحث في الأخبار المنتهية المحفوظة على الخادم'
      }
      maxWidth="4xl"
    >
      {preview ? (
        <div className="space-y-3 text-right">
          <button type="button" onClick={() => setPreview(null)} className="inline-flex items-center gap-1 text-xs font-bold text-blue-700">
            <ArrowRight className="w-4 h-4" />
            العودة للنتائج
          </button>
          <h2 className="text-lg font-bold text-slate-900">{preview.title}</h2>
          <p className="text-xs text-slate-500">
            {STATUS_LABELS[preview.status] || preview.status} · {preview.categoryName || '—'} · {preview.authorName || '—'} · نُشر {fmt(preview.publishDate)}
          </p>
          {preview.summary && <p className="text-sm text-slate-700 font-semibold">{preview.summary}</p>}
          <div className="rich-content text-sm text-slate-800" dangerouslySetInnerHTML={{ __html: sanitizeHtml(preview.content || '') }} />
          {canReactivate && (
            <button
              type="button"
              disabled={busy}
              onClick={() => reactivate(preview.id)}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold disabled:opacity-50"
            >
              <RotateCcw className="w-4 h-4" />
              إعادة إلى غرفة الأخبار للتعديل
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3 text-right">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setPage(1);
              setSubmitted(query.trim());
            }}
            className="flex gap-2"
          >
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="ابحث في العناوين والملخصات والنصوص..."
                aria-label="بحث في أرشيف الأخبار"
                className="w-full pr-9 pl-3 py-2 border border-slate-300 rounded-xl text-xs focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <button type="submit" className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold">
              بحث
            </button>
          </form>

          {error && <p className="p-2 rounded-lg bg-rose-50 text-rose-700 text-xs font-bold">{error}</p>}

          {loading ? (
            <div className="py-10 flex justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
            </div>
          ) : result && result.items.length === 0 ? (
            <p className="py-10 text-center text-xs text-slate-500">
              {submitted ? 'لا توجد نتائج مطابقة في الأرشيف.' : 'لا توجد أخبار مؤرشفة بعد؛ كل الأخبار ما زالت ضمن غرفة الأخبار.'}
            </p>
          ) : (
            result && (
              <>
                <p className="text-[11px] text-slate-500">{result.total} خبراً</p>
                <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl">
                  {result.items.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => openPreview(item.id)}
                        className="w-full text-right p-3 hover:bg-slate-50 space-y-1 block"
                      >
                        <span className="text-sm font-bold text-slate-800 block">{item.title}</span>
                        {item.summary && <span className="text-xs text-slate-500 line-clamp-2 block">{item.summary}</span>}
                        <span className="text-[11px] text-slate-400 block">
                          {STATUS_LABELS[item.status] || item.status} · {item.categoryName || '—'} · نُشر {fmt(item.publishDate)} · آخر تعديل {fmt(item.updatedAt)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                {totalPages > 1 && (
                  <div className="flex items-center justify-between text-xs">
                    <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="px-3 py-1.5 rounded-lg border disabled:opacity-40">
                      السابق
                    </button>
                    <span>
                      صفحة {page} من {totalPages}
                    </span>
                    <button
                      type="button"
                      disabled={page >= totalPages}
                      onClick={() => setPage((p) => p + 1)}
                      className="px-3 py-1.5 rounded-lg border disabled:opacity-40"
                    >
                      التالي
                    </button>
                  </div>
                )}
              </>
            )
          )}
        </div>
      )}
    </Modal>
  );
};
