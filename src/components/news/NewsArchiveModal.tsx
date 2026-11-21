import { appLocale, zoneOptions } from '../../shared/dateFormat';
import React, { useEffect, useState } from 'react';
import { Search, Loader2, ArrowRight, RotateCcw } from 'lucide-react';
import { Modal } from '../common/Modal';
import { apiService, NewsArchivePage } from '../../services/api';
import { sanitizeHtml } from '../../utils/sanitizeHtml';
import type { NewsItem } from '../../types';
import { Highlight } from '../common/Highlight';
import { DidYouMean } from '../common/SearchHints';
import { AR, countLabel } from '../../shared/arabicPlural';
import { stationsOf } from '../../shared/stations';
import type { NewsArchiveFilters } from '../../shared/newsArchive';

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
  const [filters, setFilters] = useState<NewsArchiveFilters>({});
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
      .searchNewsArchive(submitted, page, filters)
      .then((r) => !cancelled && setResult(r))
      .catch((err) => !cancelled && setError(err?.message || 'تعذر البحث في الأرشيف'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [isOpen, submitted, page, filters]);

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

  const pickSuggestion = (q: string) => {
    setQuery(q);
    setPage(1);
    setSubmitted(q);
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
              <Search className="w-4 h-4 text-slate-500 absolute right-3 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="ابحث في العناوين والملخصات والنصوص..."
                aria-label="بحث في أرشيف الأخبار"
                className="w-full min-h-11 pr-9 pl-3 py-2 border border-slate-300 rounded-xl text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <button type="submit" className="min-h-11 px-5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold">
              بحث
            </button>
          </form>
          <div role="group" aria-label="تصفية أرشيف الأخبار" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <label className="col-span-2 text-xs sm:col-span-1">محطة الكاتب
              <select value={filters.station || ''} onChange={(e) => { setPage(1); setFilters({ ...filters, station: e.target.value }); }} className="mt-1 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-2">
                <option value="">كل المحطات</option>
                {stationsOf(apiService.getSettings()).map((station) => <option key={station.id} value={station.id}>{station.name}</option>)}
              </select>
            </label>
            {(['from', 'to'] as const).map((side) => (
              <label key={side} className="min-w-0 text-xs">{side === 'from' ? 'من تاريخ' : 'إلى تاريخ'}
                <input type="date" value={filters[side] || ''} max={side === 'from' ? filters.to || undefined : undefined} min={side === 'to' ? filters.from || undefined : undefined}
                  onChange={(e) => { setPage(1); setFilters({ ...filters, [side]: e.target.value }); }}
                  className="mt-1 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-2" />
              </label>
            ))}
          </div>

          {error && <p className="p-2 rounded-lg bg-rose-50 text-rose-700 text-xs font-bold">{error}</p>}

          {loading ? (
            <div className="py-10 flex justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-slate-500" />
            </div>
          ) : result && result.items.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-500" role="status">
              {submitted ? `لا نتائج لـ«${submitted}» في الأرشيف.` : 'لا توجد أخبار مؤرشفة بعد؛ كل الأخبار ما زالت ضمن غرفة الأخبار.'}
              <DidYouMean suggestion={result.suggestion} onPick={pickSuggestion} className="mt-2" />
            </div>
          ) : (
            result && (
              <>
                <p className="text-2xs text-slate-500">{countLabel(result.total, AR.news)}</p>
                <DidYouMean suggestion={result.suggestion} onPick={pickSuggestion} />
                <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl">
                  {result.items.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => openPreview(item.id)}
                        className="w-full text-right p-3 hover:bg-slate-50 space-y-1 block"
                      >
                        <span className="text-sm font-bold text-slate-800 block"><Highlight text={item.title} query={submitted} /></span>
                        {item.summary && <span className="text-xs text-slate-500 line-clamp-2"><Highlight text={item.summary} query={submitted} /></span>}
                        <span className="text-2xs text-slate-500 block">
                          {STATUS_LABELS[item.status] || item.status} · {item.categoryName || '—'} · نُشر {fmt(item.publishDate)} · آخر تعديل {fmt(item.updatedAt)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                {totalPages > 1 && (
                  <div className="flex items-center justify-between text-xs">
                    <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="min-h-11 sm:min-h-9 px-3 rounded-lg border border-slate-300 hover:bg-slate-50 font-semibold disabled:opacity-40">
                      السابق
                    </button>
                    <span>
                      صفحة {page} من {totalPages}
                    </span>
                    <button
                      type="button"
                      disabled={page >= totalPages}
                      onClick={() => setPage((p) => p + 1)}
                      className="min-h-11 sm:min-h-9 px-3 rounded-lg border border-slate-300 hover:bg-slate-50 font-semibold disabled:opacity-40"
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
