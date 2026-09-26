import React, { useEffect, useMemo, useState } from 'react';
import { Rss, RefreshCw, Search, ExternalLink, FilePlus2, CheckCircle2, AlertTriangle, Settings as SettingsIcon } from 'lucide-react';
import type { NewsItem, NewsSource, User, WireItem } from '../types';
import { apiService, WireStatusInfo } from '../services/api';
import { RbacService } from '../services/rbacService';

interface WiresViewProps {
  wires: WireItem[];
  sources: NewsSource[];
  newsList: NewsItem[];
  currentUser: User;
  onConvert: (wire: WireItem) => void;
  onOpenNews: (newsId: string) => void;
  onOpenSettings: () => void;
}

const PAGE = 50;

function timeAgo(iso: string, now: number): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'الآن';
  if (min < 60) return `منذ ${min} دقيقة`;
  const h = Math.floor(min / 60);
  if (h < 24) return `منذ ${h} ساعة`;
  return new Date(iso).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });
}

/** Wire desk: agency items pulled by the server from RSS/Atom feeds, turned into drafts by journalists. */
export const WiresView: React.FC<WiresViewProps> = ({ wires, sources, newsList, currentUser, onConvert, onOpenNews, onOpenSettings }) => {
  const can = (p: string) => RbacService.hasPermission(currentUser, p);
  const [query, setQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState('ALL');
  const [limit, setLimit] = useState(PAGE);
  const [status, setStatus] = useState<WireStatusInfo | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    apiService.getWireStatus().then(setStatus).catch(() => undefined);
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const feedSources = sources.filter((s) => s.feedUrl && s.feedEnabled);

  const usedBy = useMemo(() => {
    const map = new Map<string, NewsItem>();
    newsList.forEach((n) => n.wireId && !n.deletedAt && map.set(n.wireId, n));
    return map;
  }, [newsList]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...wires]
      .filter((w) => sourceFilter === 'ALL' || w.sourceId === sourceFilter)
      .filter((w) => !q || w.title.toLowerCase().includes(q) || w.summary.toLowerCase().includes(q))
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  }, [wires, query, sourceFilter]);

  const handleRefresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const feeds = await apiService.refreshWires();
      setStatus((prev) => (prev ? { ...prev, feeds } : prev));
    } catch (err: any) {
      setError(err?.message || 'تعذر تحديث البرقيات');
    } finally {
      setRefreshing(false);
    }
  };

  const sourceNames = Array.from(new Map(wires.map((w) => [w.sourceId, w.sourceName])).entries());

  return (
    <div className="space-y-5">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Rss className="w-5 h-5 text-orange-500" />
            مكتب برقيات الوكالات
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            برقيات تُجلب آلياً من خلاصات الوكالات المعتمدة
            {status && status.pollMinutes > 0 ? ` كل ${status.pollMinutes} دقائق` : ''}
            {status ? `، وتُحفظ ${status.retentionDays} أيام` : ''}. حوّل أي برقية إلى مسودة خبر لتحريرها ومراجعتها.
          </p>
        </div>
        {can('news.create') && feedSources.length > 0 && (
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold disabled:opacity-60"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'جارِ الجلب...' : 'جلب الآن'}
          </button>
        )}
      </div>

      {error && <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 font-bold">{error}</div>}

      {feedSources.length === 0 ? (
        <div className="bg-white border border-dashed border-slate-300 rounded-2xl p-8 text-center space-y-3">
          <Rss className="w-8 h-8 text-slate-300 mx-auto" />
          <p className="text-sm font-bold text-slate-700">لم تُربط أي خلاصة وكالة بعد</p>
          <p className="text-xs text-slate-500">
            أضف رابط خلاصة RSS أو Atom لأحد المصادر من «الإعدادات ← وكالات ومصادر الأخبار» ليبدأ الخادم بجلب البرقيات.
          </p>
          {can('system.settings') && (
            <button
              type="button"
              onClick={onOpenSettings}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold"
            >
              <SettingsIcon className="w-3.5 h-3.5" />
              فتح الإعدادات
            </button>
          )}
        </div>
      ) : (
        status &&
        status.feeds.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {status.feeds.map((f) => (
              <span
                key={f.sourceId}
                title={`${f.feedUrl}\n${f.message}`}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold border ${
                  f.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-700'
                }`}
              >
                {f.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                {f.sourceName}: {f.ok ? `آخر فحص ${timeAgo(f.checkedAt, now)}` : f.message}
              </span>
            ))}
          </div>
        )
      )}

      {wires.length > 0 && (
        <div className="bg-white p-3 rounded-2xl border border-slate-200 flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setLimit(PAGE);
              }}
              placeholder="ابحث في عناوين ونصوص البرقيات..."
              aria-label="بحث في البرقيات"
              className="w-full pr-9 pl-3 py-2 border border-slate-300 rounded-xl text-xs focus:outline-hidden focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <select
            value={sourceFilter}
            onChange={(e) => {
              setSourceFilter(e.target.value);
              setLimit(PAGE);
            }}
            aria-label="تصفية حسب الوكالة"
            className="px-3 py-2 border border-slate-300 rounded-xl text-xs bg-white"
          >
            <option value="ALL">كل الوكالات ({wires.length})</option>
            {sourceNames.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="space-y-2">
        {feedSources.length > 0 && filtered.length === 0 && (
          <p className="text-xs text-slate-500 text-center py-8">
            {wires.length === 0 ? 'لم تصل برقيات بعد. ستظهر هنا فور جلبها من الخلاصات.' : 'لا توجد برقيات مطابقة للبحث.'}
          </p>
        )}
        {filtered.slice(0, limit).map((w) => {
          const used = usedBy.get(w.id);
          const isOpen = expanded === w.id;
          return (
            <article key={w.id} className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                <span className="px-2 py-0.5 rounded-md bg-orange-50 text-orange-700 font-bold">{w.sourceName}</span>
                <time dateTime={w.publishedAt}>{timeAgo(w.publishedAt, now)}</time>
                {w.categories.slice(0, 3).map((c) => (
                  <span key={c} className="px-1.5 py-0.5 rounded bg-slate-100">
                    {c}
                  </span>
                ))}
                {used && (
                  <button
                    type="button"
                    onClick={() => onOpenNews(used.id)}
                    className="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 font-bold hover:underline"
                  >
                    حُوّلت إلى خبر
                  </button>
                )}
              </div>
              <h2 className="text-sm font-bold text-slate-900 leading-relaxed">{w.title}</h2>
              {w.summary && (
                <p
                  className={`text-xs text-slate-600 leading-relaxed whitespace-pre-line cursor-pointer ${isOpen ? '' : 'line-clamp-3'}`}
                  onClick={() => setExpanded(isOpen ? null : w.id)}
                >
                  {w.summary}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {can('news.create') && (
                  <button
                    type="button"
                    onClick={() => onConvert(w)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold"
                  >
                    <FilePlus2 className="w-3.5 h-3.5" />
                    تحرير خبر من البرقية
                  </button>
                )}
                {w.link && (
                  <a
                    href={w.link}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs text-slate-600 hover:text-blue-700 hover:bg-slate-50 rounded-lg"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    المصدر الأصلي
                  </a>
                )}
              </div>
            </article>
          );
        })}
        {filtered.length > limit && (
          <button
            type="button"
            onClick={() => setLimit((l) => l + PAGE)}
            className="w-full py-2 text-xs font-bold text-blue-700 hover:bg-blue-50 rounded-xl"
          >
            عرض المزيد ({filtered.length - limit})
          </button>
        )}
      </div>
    </div>
  );
};
