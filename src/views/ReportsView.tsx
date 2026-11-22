import { countLabel } from '../shared/labels';
import { AR, countLabel as countOf } from '../shared/arabicPlural';
import { downloadCsv } from '../services/csvExport';
import { apiService } from '../services/api';
import { RbacService } from '../services/rbacService';
import { stationName, stationsOf } from '../shared/stations';
import { managerScope, stationFilterMatcher, stationGroupsOf } from '../shared/managerToday';
import { productionSummary } from '../shared/workload';
import { stepTypesOf } from '../shared/productionCards';
import { addDaysIso, fromLocalInputValue, localDateString } from '../shared/dates';
import { basisZone } from '../shared/dateFormat';
import { when } from '../components/cards/cardUi';
import React, { useEffect, useState, useMemo } from 'react';
import { apiFetch } from '../services/http';
import { useLiveData } from '../hooks/useLiveData';
import type { NewsReport } from '../shared/newsReport';
import { BarChart3, Clock, Tv, FileText, Users, Calendar, Printer, Download } from 'lucide-react';
import { Episode, Guest, Category } from '../types';
import { AiringOutcomes } from '../components/reports/AiringOutcomes';

const PERIODS = [
  { id: 'today', name: 'اليوم' },
  { id: 'week', name: 'آخر 7 أيام' },
  { id: 'month', name: 'آخر 30 يوماً' },
  { id: 'all', name: 'كل الفترات' },
] as const;
const STATION_COLUMNS = [
  { key: 'total', label: 'أخبار' },
  { key: 'published', label: 'منشورة' },
  { key: 'approved', label: 'معتمدة' },
  { key: 'review', label: 'قيد المراجعة' },
  { key: 'drafts', label: 'مسودات' },
  { key: 'cards', label: 'تكليفات شاركت فيها' },
  { key: 'cardSteps', label: 'خطوات تكليفات أنجزتها' },
] as const;
const REPORT_FILTER = 'w-full min-w-0 min-h-11 sm:min-h-9 px-3 bg-white border border-slate-300 rounded-lg text-sm sm:text-xs text-slate-800 focus-visible:ring-2 focus-visible:ring-blue-500';

/** A headline figure: what it measures (and over which period), the figure, and how it was counted. */
const Metric: React.FC<{ label: string; scope: string; icon: React.ElementType; value: React.ReactNode; note: React.ReactNode }> = ({ label, scope, icon: Icon, value, note }) => (
  <div className="min-w-0 bg-white p-3 sm:p-5 rounded-xl border border-slate-200 space-y-2">
    <div className="flex items-start justify-between gap-2">
      <h2 className="text-xs font-bold text-slate-700">
        {label} <span className="font-normal text-slate-500">({scope})</span>
      </h2>
      <Icon className="hidden sm:block w-5 h-5 shrink-0 text-slate-400" aria-hidden="true" />
    </div>
    <p className="text-2xl font-bold text-slate-900 tabular-nums">{value}</p>
    <p className="text-2xs text-slate-600">{note}</p>
  </div>
);

interface ReportsViewProps {
  episodes: Episode[];
  guests: Guest[];
  categories: Category[];
  onOpenNews: (id: string) => void;
}

export const ReportsView: React.FC<ReportsViewProps> = ({
  episodes = [],
  guests = [],
  categories = [],
  onOpenNews,
}) => {
  const [selectedPeriod, setSelectedPeriod] = useState<'today' | 'week' | 'month' | 'all'>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedStation, setSelectedStation] = useState<string>('ALL');

  // Stations this reader follows (all for central management), and the station groups among them.
  const currentUser = apiService.getCurrentUser();
  const settings = apiService.getSettings();
  const allStations = stationsOf(settings);
  const scope = managerScope(currentUser, allStations, RbacService.hasPermission(currentUser, 'workload.view_all'));
  const stations = allStations.filter((s) => scope.has(s.id));
  const groups = stationGroupsOf(settings).filter((g) => g.stationIds.some((id) => scope.has(id)));
  const seesAll = stations.length === allStations.length;
  const inStation = stationFilterMatcher(selectedStation, groups);
  const stationLabel = selectedStation === 'ALL' ? (seesAll ? 'كل المحطات' : 'محطاتي') : selectedStation.startsWith('group:') ? groups.find((g) => `group:${g.id}` === selectedStation)?.name || '' : stationName(allStations, selectedStation);

  const today = localDateString();
  // Start of the selected reporting window in the configured time basis.
  const periodStart = useMemo(() => {
    if (selectedPeriod === 'all') return null;
    const lookback = selectedPeriod === 'week' ? 6 : selectedPeriod === 'month' ? 29 : 0;
    return new Date(fromLocalInputValue(`${addDaysIso(today, -lookback)}T00:00`));
  }, [selectedPeriod, today]);
  const periodLabel = { today: 'اليوم', week: 'آخر 7 أيام', month: 'آخر 30 يوماً', all: 'كل الفترات' }[selectedPeriod];

  const inPeriod = (value?: string) => {
    if (!periodStart) return true;
    if (!value) return false;
    const t = Date.parse(value.length === 10 ? fromLocalInputValue(`${value}T00:00`) : value);
    return Number.isFinite(t) && t >= periodStart.getTime();
  };

  const since = periodStart?.toISOString();
  const params = new URLSearchParams({ category: selectedCategory, station: selectedStation });
  if (since) params.set('since', since);
  const reportUrl = `/api/v1/reports/news?${params}`;
  const [records, setRecords] = useState<{ status: 'ALL' | 'PUBLISHED'; page: number } | null>(null);
  type RecordsPage = { rows: { id: string; title: string | null; summary: string | null; updatedAt: string | null }[]; hasMore: boolean };
  const recordsUrl = records ? `${reportUrl}&records=${records.status}&page=${records.page}` : null;
  const [recordsResult, setRecordsResult] = useState<{ url: string; value?: RecordsPage; error?: string }>();
  useEffect(() => {
    if (!recordsUrl) return;
    const controller = new AbortController();
    void apiFetch<{ data: RecordsPage }>(recordsUrl, { signal: controller.signal }).then(({ data }) => {
      if (!controller.signal.aborted) setRecordsResult({ url: recordsUrl, value: data });
    }).catch(error => {
      if (!controller.signal.aborted) setRecordsResult({ url: recordsUrl, error: error instanceof Error ? error.message : 'تعذّر تحميل سجلات التقرير' });
    });
    return () => controller.abort();
  }, [recordsUrl]);
  const sourcePage = recordsResult?.url === recordsUrl ? recordsResult : undefined;
  const reportRevision = useLiveData(['news', 'users', 'settings'], 60_000);
  const [attempt, setAttempt] = useState(0);
  const [reportState, setReportState] = useState<{ url: string; data?: NewsReport; updatedAt?: string; error?: string }>();
  useEffect(() => {
    const controller = new AbortController();
    void apiFetch<{ data: NewsReport }>(reportUrl, { signal: controller.signal, cache: 'no-store' })
      .then(({ data }) => {
        if (!controller.signal.aborted) setReportState({ url: reportUrl, data, updatedAt: new Date().toISOString() });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setReportState({
          url: reportUrl, error: error instanceof Error ? error.message : 'تعذّر تحميل التقرير.',
        });
      });
    return () => controller.abort();
  }, [reportUrl, reportRevision, attempt]);
  const currentReport = reportState?.url === reportUrl ? reportState : undefined;
  const report = currentReport?.data;
  const { total: newsTotal, published: publishedCount, approved: approvedCount, review: reviewCount, drafts: draftCount } =
    report?.totals ?? { total: 0, published: 0, approved: 0, review: 0, drafts: 0 };
  const avgApprovalMinutes = report?.avgApprovalMinutes ?? null;

  // Per station: the stories its writers worked on in the period, and the production cards it finished.
  const periodRange = useMemo(() => ({ from: periodStart ? periodStart.getTime() : 0, to: Date.now() + 1 }), [periodStart]);
  const production = useMemo(() => productionSummary(apiService.getCards(), stepTypesOf(settings), periodRange), [periodRange, settings]);
  const stationBreakdown = stations
    .filter((st) => inStation(st.id))
    .map((st) => {
      const own = report?.byStation[st.id];
      const cards = production.byStation.find((r) => r.stationId === st.id);
      return {
        id: st.id,
        name: st.name,
        total: own?.total ?? 0,
        published: own?.published ?? 0,
        approved: own?.approved ?? 0,
        review: own?.review ?? 0,
        drafts: own?.drafts ?? 0,
        cards: cards?.cards || 0,
        cardSteps: cards?.steps || 0,
      };
    });

  const periodEpisodes = useMemo(
    () => episodes.filter((e) => inPeriod(e.broadcastDate)),
    [episodes, periodStart]
  );

  // Share of episodes whose rundown adds up to within a minute of the planned duration.
  const rundownAccuracy = useMemo(() => {
    const withRundown = periodEpisodes.filter((e) => Array.isArray(e.rundown) && e.rundown.length > 0 && e.durationMinutes > 0);
    const onTime = withRundown.filter((e) => {
      const total = e.rundown.reduce((sum, seg) => sum + (Number(seg.durationSeconds) || 0), 0);
      return Math.abs(total - e.durationMinutes * 60) <= 60;
    }).length;
    return { onTime, total: withRundown.length };
  }, [periodEpisodes]);

  const totalEpisodes = periodEpisodes.length;
  const readyEpisodes = periodEpisodes.filter((e) => e.status === 'READY_FOR_BROADCAST').length;
  const completedEpisodes = periodEpisodes.filter((e) => e.status === 'BROADCASTED').length;
  const notAired = periodEpisodes.filter((e) => !['BROADCASTED', 'CANCELLED', 'ARCHIVED'].includes(e.status)).length;
  /** The period in words for a sentence: «اليوم», «في آخر 7 أيام»… */
  const inPeriodWords = selectedPeriod === 'today' ? 'اليوم' : selectedPeriod === 'all' ? 'في كل الفترات' : `في ${periodLabel}`;
  const preparedAt = currentReport?.updatedAt ? when(currentReport.updatedAt) : '—';

  const handlePrint = () => {
    if (report) window.print();
  };

  const handleExportCsv = () => {
    if (!report) return;
    const categoryLabel = selectedCategory === 'ALL' ? 'كل التصنيفات' : categories.find((c) => c.id === selectedCategory)?.nameAr || selectedCategory;
    const approvalLabel = avgApprovalMinutes === null ? 'لا توجد أخبار معتمدة' : countOf(avgApprovalMinutes, { ...AR.minute, zero: 'أقل من دقيقة' });
    const csvRows: unknown[][] = [
      ['المؤشر الإحصائي', 'القيمة'],
      ['المؤسسة', settings?.organizationName || ''],
      ['أُعدّ في', preparedAt],
      ['الفترة', periodLabel],
      ['تصنيف الأخبار', categoryLabel],
      ['المحطة', stationLabel],
      ['إجمالي الأخبار المرشحة', newsTotal],
      ['الأخبار المنشورة', publishedCount],
      ['الأخبار المعتمدة', approvedCount],
      ['أخبار قيد المراجعة', reviewCount],
      ['المسودات الأولية', draftCount],
      ['متوسط زمن الاعتماد (من الإنشاء حتى الاعتماد)', approvalLabel],
      ['إجمالي الحلقات التلفزيونية', totalEpisodes],
      ['حلقات جاهزة للبث (لم تُبث بعد)', readyEpisodes],
      ['حلقات لم تُبث بعد', notAired],
      ['حلقات تم بثها', completedEpisodes],
      ['إجمالي الضيوف المعتمدين (كل الفترات)', guests.length],
      ['دقة توقيت الرانداون', `${rundownAccuracy.onTime}/${rundownAccuracy.total}`],
      [],
      ['المحطة', 'أخبار في الفترة', 'منشورة', 'معتمدة', 'قيد المراجعة', 'مسودات', 'تكليفات شاركت فيها', 'خطوات تكليفات أنجزتها'],
      ...stationBreakdown.map((r) => [r.name, r.total, r.published, r.approved, r.review, r.drafts, r.cards, r.cardSteps]),
    ];
    const categorySlug = selectedCategory === 'ALL' ? 'all' : selectedCategory;
    downloadCsv(`nrcs_performance_report_${selectedPeriod}_${categorySlug}_${selectedStation === 'ALL' ? 'all' : selectedStation.replace(':', '-')}_${localDateString()}.csv`, csvRows);
  };

  return (
    <div className="space-y-6">
      {/* Header with Actions (on paper the sheet heading below replaces it) */}
      <div className="no-print flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-blue-600" />
            التقارير
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            ما أُنتج من أخبار وحلقات، وسرعة الاعتماد، ودقة توقيت الرانداون، لكل محطة وتصنيف.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:self-auto">
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={!report}
            className="flex items-center gap-2 min-h-11 px-4 py-2 disabled:opacity-50 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-bold"
          >
            <Download className="w-4 h-4" />
            <span>تصدير تقرير CSV</span>
          </button>
          <button
            type="button"
            onClick={handlePrint}
            disabled={!report}
            className="flex items-center gap-2 min-h-11 px-4 py-2 disabled:opacity-50 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold"
          >
            <Printer className="w-4 h-4" />
            <span>طباعة التقرير</span>
          </button>
        </div>
      </div>

      {report && <p className="no-print text-xs text-slate-600">آخر تحديث لنتائج الأخبار {preparedAt} · توقيت الفلاتر {basisZone() || 'توقيت الجهاز'}</p>}

      {/* On paper: who, what period and which filters, and when it was prepared. */}
      <div className="hidden print-only print-keep text-xs">
        <p>{settings?.organizationName}</p>
        <h2 className="text-lg font-bold">التقارير</h2>
        <p>الفترة: {periodLabel} · التصنيف: {selectedCategory === 'ALL' ? 'كل التصنيفات' : categories.find((c) => c.id === selectedCategory)?.nameAr} · المحطة: {stationLabel} · أُعدّ في {preparedAt}</p>
      </div>

      {/* Filter & Period Toolbar */}
      <div role="group" aria-label="تصفية التقارير" className="no-print bg-white p-3 sm:p-4 rounded-xl border border-slate-200 grid grid-cols-2 lg:grid-cols-4 items-end gap-3 text-xs">
        <div className="col-span-full lg:col-span-2 grid gap-1 min-w-0">
          <span id="reports-period-label" className="inline-flex items-center gap-1.5 font-semibold text-slate-700">
            <Calendar className="w-4 h-4 text-slate-500" aria-hidden="true" /> الفترة
          </span>
          <div role="group" aria-labelledby="reports-period-label" className="grid grid-cols-2 sm:grid-cols-4 rounded-lg bg-slate-100 p-1 gap-1">
            {PERIODS.map((p) => (
              <button
                key={p.id}
                type="button"
                aria-pressed={selectedPeriod === p.id}
                onClick={() => setSelectedPeriod(p.id)}
                className={`min-h-11 sm:min-h-9 px-2 sm:px-3 py-1 rounded-md font-bold text-xs ${
                  selectedPeriod === p.id ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>

        {(stations.length > 1 || groups.length > 0) && (
          <div className="grid gap-1 min-w-0">
            <label htmlFor="reports-station-filter" className="text-slate-700 font-semibold">المحطة</label>
            <select
              id="reports-station-filter"
              value={selectedStation}
              onChange={(e) => setSelectedStation(e.target.value)}
              className={REPORT_FILTER}
            >
              <option value="ALL">{seesAll ? 'كل المحطات' : 'كل محطاتي'}</option>
              {groups.length > 0 && (
                <optgroup label="مجموعات المحطات">
                  {groups.map((g) => <option key={g.id} value={`group:${g.id}`}>{g.name}</option>)}
                </optgroup>
              )}
              {stations.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
            </select>
          </div>
        )}

        <div className={`grid gap-1 min-w-0 ${stations.length > 1 || groups.length > 0 ? '' : 'col-span-full lg:col-span-2'}`}>
          <label htmlFor="reports-category-filter" className="text-slate-700 font-semibold">التصنيف</label>
          <select
            id="reports-category-filter"
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className={REPORT_FILTER}
          >
            <option value="ALL">كل التصنيفات</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nameAr}
              </option>
            ))}
          </select>
        </div>
      </div>

      {currentReport?.error && (
        <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          {currentReport.error}{' '}
          <button type="button" onClick={() => setAttempt((value) => value + 1)} className="min-h-11 px-2 font-bold underline">
            إعادة المحاولة
          </button>
        </div>
      )}
      {!report && !currentReport?.error && <p role="status" className="text-sm text-slate-600">جارٍ تحميل أرقام التقرير من الخادم…</p>}
      {report && <>
      {/* Top Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4">
        <Metric
          label="معدل نشر الأخبار"
          scope={periodLabel}
          icon={FileText}
          value={`${newsTotal > 0 ? Math.round((publishedCount / newsTotal) * 100) : 0}%`}
          note={newsTotal > 0 ? <>
            نُشر {publishedCount} من {newsTotal}{' '}
            <button type="button" className="no-print min-h-11 px-1 font-semibold text-blue-700 hover:underline" onClick={() => setRecords({ status: 'ALL', page: 1 })}>عرض سجلات الفترة</button>
          </> : 'لا أخبار في هذه الفترة'}
        />
        <Metric
          label="جاهزية الحلقات للبث"
          scope={`${periodLabel}، كل المحطات`}
          icon={Tv}
          value={notAired > 0 ? `${readyEpisodes} من ${notAired}` : '—'}
          note={<>{notAired > 0 ? 'جاهزة من الحلقات التي لم تُبث بعد' : `لا حلقات تنتظر البث ${inPeriodWords}`} · {countOf(completedEpisodes, { ...AR.episode, zero: 'لا حلقات' })} بُثّت</>}
        />
        <Metric
          label="دقة توقيت الرانداون"
          scope={periodLabel}
          icon={Clock}
          value={rundownAccuracy.total > 0 ? `${Math.round((rundownAccuracy.onTime / rundownAccuracy.total) * 100)}%` : '—'}
          note={
            rundownAccuracy.total > 0
              ? `${rundownAccuracy.onTime} من ${rundownAccuracy.total}: مجموع الفقرات ضمن ±60 ثانية من المدة المخططة`
              : 'لا حلقات بفقرات رانداون بعد'
          }
        />
        <Metric label="الضيوف في الدليل" scope="العدد الكلي" icon={Users} value={guests.length} note="لا يتأثر بالفترة ولا بالمحطة." />
      </div>
      <AiringOutcomes accepts={(session, item) => inPeriod(session.startedAt) &&
        (seesAll || !!item.stationId && scope.has(item.stationId)) && inStation(item.stationId) &&
        (selectedCategory === 'ALL' || item.categoryId === selectedCategory)} />
      {records && <section className="no-print space-y-3 rounded-xl border border-slate-200 bg-white p-4" aria-label="سجلات تقرير الأخبار">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-slate-900">سجلات تقرير الأخبار</h2>
          <div className="flex flex-wrap gap-1 text-xs">
            <button type="button" aria-pressed={records.status === 'ALL'} onClick={() => setRecords({ status: 'ALL', page: 1 })} className="min-h-11 px-2 font-semibold">كل أخبار الفترة</button>
            <button type="button" aria-pressed={records.status === 'PUBLISHED'} onClick={() => setRecords({ status: 'PUBLISHED', page: 1 })} className="min-h-11 px-2 font-semibold">المنشورة</button>
            <button type="button" onClick={() => setRecords(null)} className="min-h-11 px-2 text-blue-700">إغلاق</button>
          </div>
        </div>
        {sourcePage?.error ? <p role="alert" className="text-sm text-rose-800">{sourcePage.error}</p> : !sourcePage?.value ? <p role="status" className="text-sm text-slate-600">جارٍ تحميل السجلات…</p> : <>
          {sourcePage.value.rows.length ? <ul className="divide-y divide-slate-200">
            {sourcePage.value.rows.map(row => <li key={row.id} className="py-2 text-sm">
              {apiService.getNews().some(news => news.id === row.id)
                ? <button type="button" onClick={() => onOpenNews(row.id)} className="min-h-9 text-start font-semibold text-blue-700 hover:underline">{row.title || row.id}</button>
                : <p className="font-semibold text-slate-900">{row.title || row.id}</p>}
              {row.summary && <p className="mt-1 break-words text-xs text-slate-600">{row.summary}</p>}
            </li>)}
          </ul> : <p className="text-sm text-slate-600">لا سجلات تطابق الفلاتر الحالية.</p>}
          <div className="flex items-center gap-2 text-xs text-slate-700">
            <button type="button" disabled={records.page === 1} className="min-h-11 px-3 disabled:opacity-50" onClick={() => setRecords({ ...records, page: records.page - 1 })}>السابق</button>
            <span>صفحة {records.page}</span>
            <button type="button" disabled={!sourcePage.value.hasMore || records.page >= 1000} className="min-h-11 px-3 disabled:opacity-50" onClick={() => setRecords({ ...records, page: records.page + 1 })}>التالي</button>
          </div>
        </>}
      </section>}

      {/* Production by Category & Workflow Velocity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Category Breakdown */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 space-y-4">
          <h2 className="text-sm font-bold text-slate-800">
            الأخبار حسب التصنيف <span className="text-2xs font-normal text-slate-500">({periodLabel})</span>
          </h2>
          <div className="space-y-3">
            {categories.map((cat) => {
              const count = Object.hasOwn(report.byCategory, cat.id) ? report.byCategory[cat.id] : 0;
              const pct = report.categoryTotal > 0 ? Math.round((count / report.categoryTotal) * 100) : 0;

              return (
                <div key={cat.id} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-700">{cat.nameAr}</span>
                    <span className="tabular-nums text-slate-600">
                      {countLabel(count, { zero: 'لا أخبار', one: 'خبر واحد', two: 'خبران', few: 'أخبار', many: 'خبراً' })} ({pct}%)
                    </span>
                  </div>
                  <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden" aria-hidden="true">
                    <div
                      className="h-full bg-blue-600 rounded-full"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Workflow Breakdown */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 space-y-4">
          <h2 className="text-sm font-bold text-slate-800">
            أين الأخبار في مسار التحرير <span className="text-2xs font-normal text-slate-500">({periodLabel})</span>
          </h2>

          <dl className="grid grid-cols-2 gap-3 pt-2">
            {[
              { label: 'مسودات', value: draftCount, tone: 'text-slate-900' },
              { label: 'قيد المراجعة', value: reviewCount, tone: 'text-amber-800' },
              { label: 'معتمدة', value: approvedCount, tone: 'text-violet-700' },
              { label: 'منشورة', value: publishedCount, tone: 'text-emerald-700' },
            ].map((stage) => (
              <div key={stage.label} className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                <dt className="text-xs text-slate-600">{stage.label}</dt>
                <dd className={`text-xl font-bold tabular-nums mt-1 ${stage.value ? stage.tone : 'text-slate-900'}`}>{stage.value}</dd>
              </div>
            ))}
          </dl>

          <p className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 leading-relaxed">
            <strong className="text-slate-900">سرعة الاعتماد:</strong>{' '}
            {avgApprovalMinutes === null
              ? 'لا توجد أخبار معتمدة في الفترة المحددة لحساب متوسط زمن الاعتماد.'
              : <>متوسط الوقت من إنشاء الخبر حتى اعتماده <strong>{avgApprovalMinutes >= 120 ? countOf(Math.round(avgApprovalMinutes / 60), AR.hour) : countOf(avgApprovalMinutes, { ...AR.minute, zero: 'أقل من دقيقة' })}</strong>.</>}
          </p>
        </div>
      </div>

      {/* Per station: a story counts for its writer's station; cards for each station that finished a step on them. */}
      {stationBreakdown.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-bold text-slate-800">حسب المحطة <span className="text-2xs font-normal text-slate-500">({periodLabel})</span></h2>
          <div role="region" tabIndex={0} aria-label="جدول المحطات" className="bg-white border border-slate-200 rounded-xl sm:overflow-x-auto print:overflow-visible">
            <table role="table" className="max-sm:block w-full sm:min-w-[40rem] print:min-w-0 text-xs">
              <thead role="rowgroup" className="max-sm:sr-only">
                <tr role="row" className="text-slate-600 border-b border-slate-200">
                  <th role="columnheader" scope="col" className="sticky right-0 bg-white p-3 text-start font-bold">المحطة</th>
                  {STATION_COLUMNS.map(({ key, label }) => (
                    <th role="columnheader" key={key} scope="col" className="p-3 font-bold text-start whitespace-nowrap print:whitespace-normal">{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody role="rowgroup" className="max-sm:block">
                {stationBreakdown.map((r) => (
                  <tr role="row" key={r.id} className="max-sm:grid max-sm:grid-cols-2 max-sm:gap-x-3 max-sm:gap-y-2.5 max-sm:p-3 border-b border-slate-200 last:border-0">
                    <th role="rowheader" scope="row" className="max-sm:col-span-full sm:p-3 text-start font-bold text-slate-900 max-sm:text-sm sm:whitespace-nowrap sm:sticky sm:right-0 bg-white [overflow-wrap:anywhere]">{r.name}</th>
                    {STATION_COLUMNS.map(({ key, label }) => (
                      <td role="cell" key={key} className="sm:p-3 tabular-nums">
                        <span aria-hidden="true" className="block sm:hidden text-slate-600">{label}</span>
                        <span className="max-sm:font-semibold">{r[key]}</span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-2xs text-slate-500">يُنسب الخبر إلى محطة كاتبه. الحلقات لا تُنسب إلى محطة، فأرقامها تخص كل المحطات.</p>
        </section>
      )}
      </>}
    </div>
  );
};
