import { AR, countLabel } from '../shared/arabicPlural';
import { isHandledBy, MONITOR_MEDIA } from '../shared/wires';
import { addManualObservation, addWireToCard, deleteManualObservation, sendWireToColleague, toggleWireHandled } from '../services/newsReview';
import { toLocalInputValue, fromLocalInputValue } from '../shared/dates';
import { appLocale, zoneOptions } from '../shared/dateFormat';
import { matchesQuery } from '../shared/search';
import React, { useEffect, useMemo, useState } from 'react';
import { Rss, RefreshCw, Search, ExternalLink, FilePlus2, CheckCircle2, AlertTriangle, Settings as SettingsIcon, Zap, Eye, BellRing, Edit2, Check, Send, ClipboardList, Tv, Plus, Trash2 } from 'lucide-react';
import { isFlashWire, watchWordHits } from '../shared/notifications';
import type { NewsItem, NewsSource, User, WireItem } from '../types';
import { apiService, WireStatusInfo } from '../services/api';
import { RbacService } from '../services/rbacService';
import { dataStore } from '../services/dataStore';
import { confirmDialog, promptDialog } from '../services/dialogs';
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
  if (min < 60) return `منذ ${countLabel(min, AR.minute)}`;
  const h = Math.floor(min / 60);
  if (h < 24) return `منذ ${countLabel(h, AR.hour)}`;
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
  const [only, setOnly] = useState<'ALL' | 'FLASH' | 'WATCH' | 'TODO' | 'DONE'>('ALL');
  // One open panel at a time under an item: send to a colleague, or add to a card.
  const [panel, setPanel] = useState<{ wireId: string; kind: 'send' | 'card' } | null>(null);
  const [panelTarget, setPanelTarget] = useState('');
  const [panelNote, setPanelNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const emptyManual = () => ({ sourceName: '', medium: 'TV' as const as NonNullable<WireItem['medium']>, at: toLocalInputValue(), title: '', summary: '', link: '' });
  const [manual, setManual] = useState(emptyManual);
  const canWrite = can('news.create');
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
      .filter((w) => !w.deletedAt)
      .filter((w) =>
        only === 'ALL'
          ? true
          : only === 'FLASH'
          ? w.flash || isFlashWire(w)
          : only === 'WATCH'
          ? watchWordHits(`${w.title}\n${w.summary}`, watchWords).length > 0
          : only === 'DONE'
          ? isHandledBy(w, currentUser.id)
          : !isHandledBy(w, currentUser.id)
      )
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  }, [wires, query, sourceFilter, only, watchWords, currentUser.id]);
  const todoCount = useMemo(() => wires.filter((w) => !w.deletedAt && !isHandledBy(w, currentUser.id)).length, [wires, currentUser.id]);
  const colleagues = useMemo(() => apiService.getUsers().filter((u) => u.id !== currentUser.id && u.isActive !== false).sort((a, b) => a.fullName.localeCompare(b.fullName, 'ar')), [currentUser.id]);
  const canWorkWithCards = RbacService.canUseModule(currentUser, 'assignments') && (can('cards.work') || can('cards.manage'));
  const openCards = useMemo(() => canWorkWithCards ? apiService.getCards().filter((c) => c.status === 'OPEN') : [], [panel?.kind, canWorkWithCards]);
  const manualSourceNames = useMemo(() => [...new Set(wires.filter((w) => w.manual).map((w) => w.sourceName))].slice(0, 30), [wires]);

  /** Writes, then reports what the server said (offline: kept on this device). */
  const confirm = async (collection: 'wires' | 'messages' | 'productionCards', id: string, ok: string) => {
    const outcome = await dataStore.awaitWrite(collection, id);
    if (outcome.ok) notify({ type: 'success', message: ok });
    else if (outcome.pending) notify({ type: 'warning', title: outcome.queued ? 'غير متصل: سيُرسل عند عودة الاتصال' : 'لم يؤكد الخادم بعد', message: outcome.message || '' });
    return outcome.ok || !!outcome.pending;
  };
  const act = async (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      notify({ type: 'error', title: 'لم يتم الإجراء', message: err instanceof Error ? err.message : 'تعذر الحفظ' });
    } finally {
      setBusy(false);
    }
  };
  const openPanel = (wireId: string, kind: 'send' | 'card') => {
    setPanel(panel?.wireId === wireId && panel.kind === kind ? null : { wireId, kind });
    setPanelTarget('');
    setPanelNote('');
  };
  const submitPanel = (w: WireItem) =>
    act(async () => {
      if (!panel || !panelTarget) return;
      if (panel.kind === 'send') {
        sendWireToColleague(w, panelTarget, panelNote);
        const name = colleagues.find((c) => c.id === panelTarget)?.fullName || 'الزميل';
        notify({ type: 'success', message: `أُرسلت المادة إلى ${name}` });
      } else {
        const card = addWireToCard(w, panelTarget, panelNote);
        await confirm('productionCards', card.id, `أُضيفت المادة إلى التكليف «${card.title}»`);
      }
      setPanel(null);
    });
  const submitManual = (e: React.FormEvent) => {
    e.preventDefault();
    void act(async () => {
      const wire = addManualObservation({
        sourceName: manual.sourceName,
        medium: manual.medium,
        publishedAt: fromLocalInputValue(manual.at) || new Date().toISOString(),
        title: manual.title,
        summary: manual.summary,
        link: manual.link,
      });
      if (await confirm('wires', wire.id, 'أُضيف الرصد إلى المصادر')) {
        setManual(emptyManual());
        setManualOpen(false);
      }
    });
  };
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
            <Rss className="w-5 h-5" />
            المصادر
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            مواد تُجلب آلياً من خلاصات الوكالات والمصادر المعتمدة
            {status && status.pollMinutes > 0 ? ` كل ${status.pollMinutes} دقائق` : ''}
            {status ? `، وتُحفظ ${countLabel(status.retentionDays, { zero: '', one: 'يوماً واحداً', two: 'يومين', few: 'أيام', many: 'يوماً' })}` : ''}، ومعها ما يرصده الديسك يدوياً من القنوات والمنصات. حوّل أي مادة إلى مسودة خبر، أو أرسلها لزميل، أو أضفها إلى تكليف.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canWrite && (
            <button
              type="button"
              aria-expanded={manualOpen}
              onClick={() => setManualOpen((v) => !v)}
              className="inline-flex items-center gap-2 min-h-11 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-xs whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              رصد يدوي
            </button>
          )}
          {canManageSources && (
            <button
              type="button"
              onClick={() => onOpenSettings('sources')}
              className="inline-flex items-center gap-2 min-h-11 px-4 border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-bold"
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
              className="inline-flex items-center gap-2 min-h-11 px-4 border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-bold disabled:opacity-60"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? 'جارِ الجلب...' : 'جلب الآن'}
            </button>
          )}
        </div>
      </div>

      {error && <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 font-bold">{error}</div>}

      {manualOpen && canWrite && (
        <form onSubmit={submitManual} aria-label="رصد يدوي" className="bg-white border border-slate-200 rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <p className="sm:col-span-2 text-xs text-slate-700 font-semibold flex items-center gap-1.5">
            <Tv className="w-4 h-4 text-blue-600" />
            ما رأيته على قناة أو منصة: يظهر للديسك مع مواد الوكالات.
          </p>
          <label className="text-xs font-bold text-slate-700">
            القناة أو المنصة
            <input required maxLength={120} list="manual-source-names" value={manual.sourceName} onChange={(e) => setManual({ ...manual, sourceName: e.target.value })} placeholder="مثال: قناة الجزيرة، حساب وزارة الصحة" className="mt-1 w-full min-h-11 px-3 border border-slate-300 rounded-lg text-sm bg-white" />
            <datalist id="manual-source-names">
              {manualSourceNames.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs font-bold text-slate-700">
              الوسيلة
              <select value={manual.medium} onChange={(e) => setManual({ ...manual, medium: e.target.value as NonNullable<WireItem['medium']> })} className="mt-1 w-full min-h-11 px-2 border border-slate-300 rounded-lg text-sm bg-white">
                {MONITOR_MEDIA.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-bold text-slate-700">
              الوقت
              <input type="datetime-local" required value={manual.at} max={toLocalInputValue()} onChange={(e) => setManual({ ...manual, at: e.target.value })} className="mt-1 w-full min-h-11 px-2 border border-slate-300 rounded-lg text-sm bg-white" dir="ltr" />
            </label>
          </div>
          <label className="sm:col-span-2 text-xs font-bold text-slate-700">
            ما رُصد (سطر واحد)
            <input required minLength={3} maxLength={300} value={manual.title} onChange={(e) => setManual({ ...manual, title: e.target.value })} className="mt-1 w-full min-h-11 px-3 border border-slate-300 rounded-lg text-sm bg-white" />
          </label>
          <label className="sm:col-span-2 text-xs font-bold text-slate-700">
            التفاصيل والنص (اختياري)
            <textarea rows={3} maxLength={4000} value={manual.summary} onChange={(e) => setManual({ ...manual, summary: e.target.value })} className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white" />
          </label>
          <label className="text-xs font-bold text-slate-700">
            الرابط (اختياري)
            <input type="url" inputMode="url" maxLength={1000} value={manual.link} onChange={(e) => setManual({ ...manual, link: e.target.value })} placeholder="https://" dir="ltr" className="mt-1 w-full min-h-11 px-3 border border-slate-300 rounded-lg text-sm bg-white text-left" />
          </label>
          <div className="flex items-end gap-2">
            <button type="submit" disabled={busy} className="min-h-11 px-4 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold disabled:opacity-50">
              <Plus className="w-4 h-4" /> إضافة الرصد
            </button>
            <button type="button" onClick={() => setManualOpen(false)} className="min-h-11 px-3 rounded-lg text-xs text-slate-600 hover:bg-slate-100">
              إلغاء
            </button>
          </div>
        </form>
      )}

      {feedSources.length === 0 ? (
        <div className="bg-white border border-dashed border-slate-300 rounded-2xl p-8 text-center space-y-3">
          <Rss className="w-8 h-8 text-slate-300 mx-auto" />
          <p className="text-sm font-bold text-slate-700">{canManageSources ? 'لم تُربط أي خلاصة وكالة بعد' : 'لم تُضف مصادر بعد؛ اطلب من مدير النظام إضافتها'}</p>
          <p className="text-xs text-slate-500">
            {canManageSources
              ? 'أضف رابط خلاصة RSS أو Atom لأحد المصادر من «الإعدادات ← الوكالات والمصادر» ليبدأ الخادم بجلب المصادر.'
              : 'تصل مواد الوكالات هنا تلقائياً حين يربط مدير النظام خلاصاتها.'}
            {canWrite ? ' وإلى ذلك الحين أضف ما ترصده من القنوات والمنصات بزر «رصد يدوي».' : ''}
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
              className="w-full min-h-11 sm:min-h-0 pr-9 pl-3 py-2 border border-slate-300 rounded-xl text-xs focus:outline-hidden focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <select
            value={sourceFilter}
            onChange={(e) => {
              setSourceFilter(e.target.value);
              setLimit(PAGE);
            }}
            aria-label="تصفية حسب الوكالة"
            className="min-h-11 sm:min-h-0 px-3 py-2 border border-slate-300 rounded-xl text-xs bg-white"
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
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="نوع المواد">
            {([
              ['ALL', 'الكل', null],
              ['FLASH', `العاجل (${flashCount})`, Zap],
              ['WATCH', 'كلماتي', Eye],
              ['TODO', `لم أتابعها (${todoCount})`, null],
              ['DONE', 'تابعتها', Check],
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
                className={`inline-flex items-center gap-1 min-h-11 sm:min-h-0 px-3 py-2 rounded-xl text-xs font-bold border disabled:opacity-40 ${
                  only === id ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                }`}
              >
                {Icon && <Icon className="w-3.5 h-3.5" />}
                {label}
              </button>
            ))}
            {onOpenAlerts && (
              <button type="button" onClick={onOpenAlerts} title="تنبيهات العاجل وكلمات المتابعة" aria-label="إعداد تنبيهات المصادر" className="min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 inline-flex items-center justify-center px-2.5 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-600">
                <BellRing className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      <div className="space-y-2">
        {(feedSources.length > 0 || wires.length > 0) && filtered.length === 0 && (
          <p className="text-xs text-slate-500 text-center py-8">
            {wires.length === 0 ? 'لم تصل مواد بعد. ستظهر هنا فور جلبها من الخلاصات.' : only === 'TODO' ? 'تابعت كل المواد المعروضة.' : 'لا توجد مواد مطابقة للبحث.'}
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
                {w.manual && (
                  <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md bg-slate-800 text-white font-bold">
                    <Tv className="w-3 h-3" /> رصد يدوي{w.medium ? ` · ${MONITOR_MEDIA.find((m) => m.id === w.medium)?.label || ''}` : ''}
                  </span>
                )}
                <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-800 font-bold">{sourceById.get(w.sourceId)?.name || w.sourceName}</span>
                {w.manual && w.createdByName && <span>رصدها {w.createdByName}</span>}
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
                {!!w.handled?.length && (
                  <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 font-bold" title={w.handled.map((h) => h.userName).join('، ')}>
                    <Check className="w-3 h-3" />
                    {isHandledBy(w, currentUser.id) ? (w.handled.length > 1 ? `تابعتها أنت و${countLabel(w.handled.length - 1, { one: 'زميل', two: 'زميلان', few: 'زملاء', many: 'زميلاً' })}` : 'تابعتها') : `تابعها ${w.handled.map((h) => h.userName).slice(0, 2).join('، ')}`}
                  </span>
                )}
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
                <button
                  type="button"
                  aria-pressed={isHandledBy(w, currentUser.id)}
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      const done = !isHandledBy(w, currentUser.id);
                      toggleWireHandled(w.id);
                      await confirm('wires', w.id, done ? 'سُجّلت متابعتك للمادة' : 'أُلغيت علامة المتابعة');
                    })
                  }
                  className={`inline-flex items-center gap-1 min-h-9 px-3 rounded-lg text-xs font-bold border disabled:opacity-50 ${
                    isHandledBy(w, currentUser.id) ? 'bg-emerald-700 border-emerald-700 text-white' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <Check className="w-3.5 h-3.5" />
                  تمت المتابعة
                </button>
                <button type="button" aria-expanded={panel?.wireId === w.id && panel.kind === 'send'} onClick={() => openPanel(w.id, 'send')} className="inline-flex items-center gap-1 min-h-9 px-3 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50">
                  <Send className="w-3.5 h-3.5" />
                  إرسال لزميل
                </button>
                {canWorkWithCards && (
                  <button type="button" aria-expanded={panel?.wireId === w.id && panel.kind === 'card'} onClick={() => openPanel(w.id, 'card')} className="inline-flex items-center gap-1 min-h-9 px-3 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50">
                    <ClipboardList className="w-3.5 h-3.5" />
                    إضافة إلى تكليف
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
                {w.manual && (w.createdById === currentUser.id || canManageSources) && (
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={`حذف الرصد ${w.title.slice(0, 40)}`}
                    onClick={() =>
                      void act(async () => {
                        if (!(await confirmDialog('حذف مادة الرصد اليدوي؟'))) return;
                        deleteManualObservation(w.id);
                        await confirm('wires', w.id, 'حُذفت مادة الرصد');
                      })
                    }
                    className="inline-flex items-center gap-1 min-h-9 px-2 rounded-lg text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              {panel?.wireId === w.id && (panel.kind !== 'card' || canWorkWithCards) && (
                <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-slate-100">
                  <select
                    aria-label={panel.kind === 'send' ? 'الزميل' : 'التكليف'}
                    value={panelTarget}
                    onChange={(e) => setPanelTarget(e.target.value)}
                    className="min-h-11 px-2 border border-slate-300 rounded-lg text-xs bg-white sm:w-56"
                  >
                    <option value="">{panel.kind === 'send' ? 'اختر الزميل…' : openCards.length ? 'اختر التكليف…' : 'لا تكليفات جارية'}</option>
                    {panel.kind === 'send'
                      ? colleagues.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.fullName}
                          </option>
                        ))
                      : openCards.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.title}
                          </option>
                        ))}
                  </select>
                  <input
                    aria-label="ملاحظة"
                    value={panelNote}
                    maxLength={500}
                    onChange={(e) => setPanelNote(e.target.value)}
                    placeholder={panel.kind === 'send' ? 'سطر للزميل (اختياري)' : 'لماذا تهم هذا التكليف (اختياري)'}
                    className="min-h-11 flex-1 px-3 border border-slate-300 rounded-lg text-xs"
                  />
                  <button type="button" disabled={!panelTarget || busy} onClick={() => void submitPanel(w)} className="min-h-11 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold disabled:opacity-50">
                    {panel.kind === 'send' ? 'إرسال' : 'إضافة'}
                  </button>
                </div>
              )}
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
