import { countLabel } from '../shared/labels';
import { appLocale, zoneOptions } from '../shared/dateFormat';
import { matchesQuery } from '../shared/search';
import React, { useEffect, useMemo, useState } from 'react';
import { Rss, RefreshCw, Search, ExternalLink, FilePlus2, CheckCircle2, AlertTriangle, Settings as SettingsIcon, Zap, Eye, BellRing, Edit2 } from 'lucide-react';
import { isFlashWire, watchWordHits } from '../shared/notifications';
import type { NewsItem, NewsSource, User, WireItem } from '../types';
import { apiService, WireStatusInfo } from '../services/api';
import { RbacService } from '../services/rbacService';
import { dataStore } from '../services/dataStore';
import { promptDialog } from '../services/dialogs';
import { notify } from '../services/notify';

interface WiresViewProps {
  wires: WireItem[];
  sources: NewsSource[];
  newsList: NewsItem[];
  currentUser: User;
  onConvert: (wire: WireItem) => void;
  onOpenNews: (newsId: string) => void;
  /**
   * Opens Settings. `section` is a settings section id ('sources' from this screen);
   * `focusSourceId` asks Settings to highlight that source and open its feed editor.
   */
  onOpenSettings: (section?: string, focusSourceId?: string) => void;
  /** Opens «تنبيهاتي» (flash alerts and watch words). */
  onOpenAlerts?: () => void;
  /** Wire opened from a notification: shown, expanded and highlighted. */
  focusWireId?: string | null;
}

const PAGE = 50;

function timeAgo(iso: string, now: number): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'الآن';
  if (min < 60) return `منذ ${min} دقيقة`;
  const h = Math.floor(min / 60);
  if (h < 24) return `منذ ${h} ساعة`;
  return new Date(iso).toLocaleString(appLocale(), { ...zoneOptions(), dateStyle: 'medium', timeStyle: 'short' });
}

/** Wire desk: agency items pulled by the server from RSS/Atom feeds, turned into drafts by journalists. */
export const WiresView: React.FC<WiresViewProps> = ({ wires, sources, newsList, currentUser, onConvert, onOpenNews, onOpenSettings, onOpenAlerts, focusWireId }) => {
  const can = (p: string) => RbacService.hasPermission(currentUser, p);
  const [query, setQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState('ALL');
  const [limit, setLimit] = useState(PAGE);
  const [status, setStatus] = useState<WireStatusInfo | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(focusWireId || null);
  const [now, setNow] = useState(Date.now());
  const [only, setOnly] = useState<'ALL' | 'FLASH' | 'WATCH'>('ALL');
  const watchWords = useMemo(() => apiService.getMyNotificationPrefs().watchWords, []);
  const [renaming, setRenaming] = useState<string | null>(null);
  const canManageSources = can('system.settings');
  const sourceById = useMemo(() => new Map(sources.map((s) => [s.id, s])), [sources]);

  useEffect(() => {
    if (!focusWireId) return;
    setExpanded(focusWireId);
    setQuery('');
    setSourceFilter('ALL');
    setOnly('ALL');
    const t = setTimeout(() => document.getElementById(`wire-${focusWireId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 80);
    return () => clearTimeout(t);
  }, [focusWireId]);

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
      .filter((w) => !q || matchesQuery(q, w.title, w.summary, w.sourceName))
      .filter((w) => only === 'ALL' || (only === 'FLASH' ? w.flash || isFlashWire(w) : watchWordHits(`${w.title}\n${w.summary}`, watchWords).length > 0))
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  }, [wires, query, sourceFilter, only, watchWords]);
  const flashCount = useMemo(() => wires.filter((w) => w.flash || isFlashWire(w)).length, [wires]);

  const handleRefresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const feeds = await apiService.refreshWires();
      setStatus((prev) => (prev ? { ...prev, feeds } : prev));
    } catch (err: any) {
      setError(err?.message || 'تعذر تحديث المصادر');
    } finally {
      setRefreshing(false);
    }
  };

  // Current source names win over the name stored on older wires.
  const sourceNames = Array.from(new Map(wires.map((w) => [w.sourceId, sourceById.get(w.sourceId)?.name || w.sourceName])).entries());

  /** Renames a source from this screen; the server carries the new name to its wires and news. */
  const renameSource = async (sourceId: string) => {
    if (renaming) return;
    const src = sourceById.get(sourceId);
    if (!src) {
      notify({ type: 'warning', message: 'هذا المصدر لم يعد موجوداً في الإعدادات.' });
      return;
    }
    const answer = await promptDialog({
      title: 'تعديل اسم المصدر',
      message: 'يتحدث الاسم في مواد الوكالة والأخبار المرتبطة بهذا المصدر.',
      label: 'اسم المصدر',
      defaultValue: src.name,
      required: true,
      confirmLabel: 'حفظ الاسم',
    });
    const name = answer?.trim().replace(/\s+/g, ' ');
    if (!name || name === src.name) return;
    if (name.length > 120) {
      notify({ type: 'warning', message: 'اسم المصدر حتى 120 حرفاً.' });
      return;
    }
    if (sources.some((s) => s.id !== src.id && s.name.trim().toLowerCase() === name.toLowerCase())) {
      notify({ type: 'warning', message: `يوجد مصدر آخر باسم (${name}).` });
      return;
    }
    setRenaming(src.id);
    try {
      apiService.saveNewsSource({ id: src.id, name });
      const outcome = await dataStore.awaitWrite('sources', src.id);
      if (outcome.ok) notify({ type: 'success', message: `أصبح اسم المصدر (${name})` });
      // A refusal is already announced with the server's reason (App's sync-error toast).
      else if (outcome.pending) notify({ type: 'warning', title: 'لم يؤكد الخادم اسم المصدر بعد', message: outcome.message || '' });
    } catch (err) {
      notify({ type: 'error', title: 'لم يُحفظ اسم المصدر', message: err instanceof Error ? err.message : 'تعذر حفظ اسم المصدر' });
    } finally {
      setRenaming(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Rss className="w-5 h-5 text-orange-500" />
            المصادر
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            مواد تُجلب آلياً من خلاصات الوكالات والمصادر المعتمدة
            {status && status.pollMinutes > 0 ? ` كل ${status.pollMinutes} دقائق` : ''}
            {status ? `، وتُحفظ ${countLabel(status.retentionDays, { zero: '', one: 'يوماً واحداً', two: 'يومين', few: 'أيام', many: 'يوماً' })}` : ''}. حوّل أي مادة إلى مسودة خبر لتحريرها ومراجعتها.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canManageSources && (
            <button
              type="button"
              onClick={() => onOpenSettings('sources')}
              className="inline-flex items-center gap-2 min-h-11 px-4 border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-bold"
            >
              <SettingsIcon className="w-4 h-4" />
              إدارة المصادر والخلاصات
            </button>
          )}
          {can('news.create') && feedSources.length > 0 && (
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              className="inline-flex items-center gap-2 min-h-11 px-4 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold disabled:opacity-60"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? 'جارِ الجلب...' : 'جلب الآن'}
            </button>
          )}
        </div>
      </div>

      {error && <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 font-bold">{error}</div>}

      {feedSources.length === 0 ? (
        <div className="bg-white border border-dashed border-slate-300 rounded-2xl p-8 text-center space-y-3">
          <Rss className="w-8 h-8 text-slate-300 mx-auto" />
          <p className="text-sm font-bold text-slate-700">لم تُربط أي خلاصة وكالة بعد</p>
          <p className="text-xs text-slate-500">
            أضف رابط خلاصة RSS أو Atom لأحد المصادر من «الإعدادات ← الوكالات والمصادر» ليبدأ الخادم بجلب المصادر.
          </p>
          {canManageSources && (
            <button
              type="button"
              onClick={() => onOpenSettings('sources')}
              className="inline-flex items-center gap-1.5 min-h-11 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold"
            >
              <SettingsIcon className="w-3.5 h-3.5" />
              ربط خلاصة لمصدر
            </button>
          )}
        </div>
      ) : (
        status &&
        status.feeds.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label="حالة خلاصات المصادر">
            {status.feeds.map((f) => {
              const name = sourceById.get(f.sourceId)?.name || f.sourceName;
              const text = `${name}: ${f.ok ? `آخر فحص ${timeAgo(f.checkedAt, now)}` : f.message}`;
              const chipClass = `inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-2xs font-bold border ${
                f.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-700'
              }`;
              const icon = f.ok ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : <AlertTriangle className="w-3.5 h-3.5 shrink-0" />;
              return (
                <li key={f.sourceId} className="inline-flex items-stretch gap-1">
                  {canManageSources ? (
                    <button
                      type="button"
                      onClick={() => onOpenSettings('sources', f.sourceId)}
                      title={`${f.feedUrl}\n${f.message}`}
                      aria-label={`${text}. ${f.ok ? 'فتح إعدادات الخلاصة' : 'إصلاح الخلاصة في الإعدادات'}`}
                      className={`${chipClass} min-h-11 sm:min-h-0 text-right hover:underline`}
                    >
                      {icon}
                      {text}
                    </button>
                  ) : (
                    <span title={`${f.feedUrl}\n${f.message}`} className={chipClass}>
                      {icon}
                      {text}
                    </span>
                  )}
                  {canManageSources && sourceById.has(f.sourceId) && (
                    <button
                      type="button"
                      disabled={!!renaming}
                      onClick={() => void renameSource(f.sourceId)}
                      aria-label={`تعديل اسم المصدر ${name}`}
                      title="تعديل اسم المصدر"
                      className="inline-flex items-center gap-1 min-h-11 sm:min-h-0 px-2 rounded-lg border border-slate-200 bg-white text-2xs font-bold text-slate-600 hover:text-blue-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      <Edit2 className="w-3 h-3" />
                      {renaming === f.sourceId ? 'جارٍ الحفظ...' : 'تعديل'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )
      )}

      {wires.length > 0 && (
        <div className="bg-white p-3 rounded-2xl border border-slate-200 flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-500 absolute right-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setLimit(PAGE);
              }}
              placeholder="ابحث في عناوين ونصوص المواد..."
              aria-label="بحث في المصادر"
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
          {canManageSources && sourceFilter !== 'ALL' && sourceById.has(sourceFilter) && (
            <button
              type="button"
              disabled={!!renaming}
              onClick={() => void renameSource(sourceFilter)}
              aria-label={`تعديل اسم المصدر ${sourceById.get(sourceFilter)?.name || ''}`}
              title="تعديل اسم المصدر المختار"
              className="inline-flex items-center justify-center gap-1 min-h-11 sm:min-h-0 px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <Edit2 className="w-3.5 h-3.5" />
              {renaming === sourceFilter ? 'جارٍ الحفظ...' : 'تعديل'}
            </button>
          )}
          <div className="flex gap-1.5" role="group" aria-label="نوع المواد">
            {([
              ['ALL', 'الكل', null],
              ['FLASH', `العاجل (${flashCount})`, Zap],
              ['WATCH', 'كلماتي', Eye],
            ] as const).map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                aria-pressed={only === id}
                disabled={id === 'WATCH' && !watchWords.length}
                title={id === 'WATCH' && !watchWords.length ? 'أضف كلمات متابعة من «تنبيهاتي»' : undefined}
                onClick={() => {
                  setOnly(id);
                  setLimit(PAGE);
                }}
                className={`inline-flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold border disabled:opacity-40 ${
                  only === id ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                }`}
              >
                {Icon && <Icon className="w-3.5 h-3.5" />}
                {label}
              </button>
            ))}
            {onOpenAlerts && (
              <button type="button" onClick={onOpenAlerts} title="تنبيهات العاجل وكلمات المتابعة" aria-label="إعداد تنبيهات المصادر" className="px-2.5 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-600">
                <BellRing className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      <div className="space-y-2">
        {feedSources.length > 0 && filtered.length === 0 && (
          <p className="text-xs text-slate-500 text-center py-8">
            {wires.length === 0 ? 'لم تصل مواد بعد. ستظهر هنا فور جلبها من الخلاصات.' : 'لا توجد مواد مطابقة للبحث.'}
          </p>
        )}
        {filtered.slice(0, limit).map((w) => {
          const used = usedBy.get(w.id);
          const isOpen = expanded === w.id;
          const flash = w.flash || isFlashWire(w);
          const hits = watchWords.length ? watchWordHits(`${w.title}\n${w.summary}`, watchWords) : [];
          return (
            <article
              key={w.id}
              id={`wire-${w.id}`}
              className={`bg-white border rounded-2xl p-4 space-y-2 ${flash ? 'border-red-300 bg-red-50/40' : 'border-slate-200'} ${
                focusWireId === w.id ? 'ring-2 ring-blue-500' : ''
              }`}
            >
              <div className="flex flex-wrap items-center gap-2 text-2xs text-slate-500">
                {flash && (
                  <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md bg-red-600 text-white font-bold">
                    <Zap className="w-3 h-3" /> عاجل
                  </span>
                )}
                <span className="px-2 py-0.5 rounded-md bg-orange-50 text-orange-700 font-bold">{sourceById.get(w.sourceId)?.name || w.sourceName}</span>
                {hits.map((h) => (
                  <span key={h} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-bold">
                    <Eye className="w-3 h-3" /> {h}
                  </span>
                ))}
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
                    تحرير خبر من المادة
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
