import { countLabel } from '../shared/labels';
import { AR, countLabel as countOf } from '../shared/arabicPlural';
import { downloadCsv } from '../services/csvExport';
import { apiService } from '../services/api';
import { RbacService } from '../services/rbacService';
import { stationName, stationsOf } from '../shared/stations';
import { managerScope, stationFilterMatcher, stationGroupsOf } from '../shared/managerToday';
import { productionSummary } from '../shared/workload';
import { stepTypesOf } from '../shared/productionCards';
import { localDateString } from '../shared/dates';
import { when } from '../components/cards/cardUi';
import React, { useState, useMemo } from 'react';
import { BarChart3, Clock, Tv, FileText, Users, Calendar, Printer, Download, Filter } from 'lucide-react';
import { NewsItem, Episode, Guest, Category } from '../types';

const PERIODS = [
  { id: 'today', name: 'اليوم' },
  { id: 'week', name: 'آخر 7 أيام' },
  { id: 'month', name: 'آخر 30 يوماً' },
  { id: 'all', name: 'كل الفترات' },
] as const;

/** A headline figure: what it measures (and over which period), the figure, and how it was counted. */
const Metric: React.FC<{ label: string; scope: string; icon: React.ElementType; value: React.ReactNode; note: React.ReactNode }> = ({ label, scope, icon: Icon, value, note }) => (
  <div className="bg-white p-5 rounded-2xl border border-slate-200 space-y-2">
    <div className="flex items-start justify-between gap-2">
      <h2 className="text-xs font-bold text-slate-700">
        {label} <span className="font-normal text-slate-500">({scope})</span>
      </h2>
      <Icon className="w-5 h-5 shrink-0 text-slate-400" aria-hidden="true" />
    </div>
    <p className="text-2xl font-bold text-slate-900 tabular-nums">{value}</p>
    <p className="text-2xs text-slate-600">{note}</p>
  </div>
);

interface ReportsViewProps {
  newsList: NewsItem[];
  episodes: Episode[];
  guests: Guest[];
  categories: Category[];
}

export const ReportsView: React.FC<ReportsViewProps> = ({
  newsList = [],
  episodes = [],
  guests = [],
  categories = [],
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
  const stationOfUser = useMemo(() => new Map(apiService.getUsers().map((u) => [u.id, u.stationId])), [newsList]);
  const inStation = stationFilterMatcher(selectedStation, groups);
  /** A story belongs to its writer's station. */
  const newsStation = (n: NewsItem) => stationOfUser.get(n.authorId);
  const inScope = (n: NewsItem) => seesAll || scope.has(newsStation(n) || '');
  const stationLabel = selectedStation === 'ALL' ? (seesAll ? 'كل المحطات' : 'محطاتي') : selectedStation.startsWith('group:') ? groups.find((g) => `group:${g.id}` === selectedStation)?.name || '' : stationName(allStations, selectedStation);

  // Filter news based on selected category

  // Start of the selected reporting window (local time); null means no limit.
  const periodStart = useMemo(() => {
    if (selectedPeriod === 'all') return null;
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    if (selectedPeriod === 'week') d.setDate(d.getDate() - 6);
    if (selectedPeriod === 'month') d.setDate(d.getDate() - 29);
    return d;
  }, [selectedPeriod]);
  const periodLabel = { today: 'اليوم', week: 'آخر 7 أيام', month: 'آخر 30 يوماً', all: 'كل الفترات' }[selectedPeriod];

  const inPeriod = (value?: string) => {
    if (!periodStart) return true;
    if (!value) return false;
    const t = new Date(value.length === 10 ? `${value}T00:00:00` : value).getTime();
    return Number.isFinite(t) && t >= periodStart.getTime();
  };

  const filteredNews = useMemo(() => {
    return newsList.filter((item) => {
      if (selectedCategory !== 'ALL' && item.categoryId !== selectedCategory) {
        return false;
      }
      if (!inScope(item) || !inStation(newsStation(item))) return false;
      return inPeriod(item.updatedAt || item.createdAt);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newsList, selectedCategory, periodStart, selectedStation, stationOfUser]);

  // Per station: the stories its writers worked on in the period, and the production cards it finished.
  const periodRange = useMemo(() => ({ from: periodStart ? periodStart.getTime() : 0, to: Date.now() + 1 }), [periodStart]);
  const production = useMemo(() => productionSummary(apiService.getCards(), stepTypesOf(settings), periodRange), [periodRange, settings]);
  const stationBreakdown = stations
    .filter((st) => inStation(st.id))
    .map((st) => {
      const own = newsList.filter((n) => newsStation(n) === st.id && (selectedCategory === 'ALL' || n.categoryId === selectedCategory) && inPeriod(n.updatedAt || n.createdAt));
      const cards = production.byStation.find((r) => r.stationId === st.id);
      return {
        id: st.id,
        name: st.name,
        total: own.length,
        published: own.filter((n) => n.status === 'PUBLISHED').length,
        approved: own.filter((n) => n.status === 'APPROVED').length,
        review: own.filter((n) => n.status === 'UNDER_REVIEW').length,
        drafts: own.filter((n) => n.status === 'DRAFT').length,
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

  // Average minutes from creation to approval for approved/published items in the window.
  const avgApprovalMinutes = useMemo(() => {
    const durations = filteredNews
      .filter((n) => n.approvedAt && n.createdAt)
      .map((n) => (new Date(n.approvedAt!).getTime() - new Date(n.createdAt).getTime()) / 60000)
      .filter((m) => Number.isFinite(m) && m >= 0);
    if (durations.length === 0) return null;
    return Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
  }, [filteredNews]);

  // Same period as the other indicators (the category filter is ignored in the per-category list by design).
  const newsInPeriod = newsList.filter((n) => inPeriod(n.updatedAt || n.createdAt));
  const publishedCount = (filteredNews || []).filter((n) => n.status === 'PUBLISHED').length;
  const draftCount = (filteredNews || []).filter((n) => n.status === 'DRAFT').length;
  const reviewCount = (filteredNews || []).filter((n) => n.status === 'UNDER_REVIEW').length;
  const approvedCount = (filteredNews || []).filter((n) => n.status === 'APPROVED').length;

  const totalEpisodes = periodEpisodes.length;
  const readyEpisodes = periodEpisodes.filter((e) => e.status === 'READY_FOR_BROADCAST').length;
  const completedEpisodes = periodEpisodes.filter((e) => e.status === 'BROADCASTED').length;
  const notAired = periodEpisodes.filter((e) => !['BROADCASTED', 'CANCELLED', 'ARCHIVED'].includes(e.status)).length;
  /** The period in words for a sentence: «اليوم», «في آخر 7 أيام»… */
  const inPeriodWords = selectedPeriod === 'today' ? 'اليوم' : selectedPeriod === 'all' ? 'في كل الفترات' : `في ${periodLabel}`;
  const preparedAt = when(new Date().toISOString());

  const handlePrint = () => {
    window.print();
  };

  const handleExportCsv = () => {
    // Same filters as the screen: the period and the selected category.
    const categoryLabel = selectedCategory === 'ALL' ? 'كل التصنيفات' : categories.find((c) => c.id === selectedCategory)?.nameAr || selectedCategory;
    const approvalLabel = avgApprovalMinutes === null ? 'لا توجد أخبار معتمدة' : countOf(avgApprovalMinutes, { ...AR.minute, zero: 'أقل من دقيقة' });
    const csvRows: unknown[][] = [
      ['المؤشر الإحصائي', 'القيمة'],
      ['المؤسسة', settings?.organizationName || ''],
      ['أُعدّ في', preparedAt],
      ['الفترة', periodLabel],
      ['تصنيف الأخبار', categoryLabel],
      ['المحطة', stationLabel],
      ['إجمالي الأخبار المرشحة', filteredNews.length],
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

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            onClick={handleExportCsv}
            className="flex items-center gap-2 min-h-11 px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-bold"
          >
            <Download className="w-4 h-4" />
            <span>تصدير تقرير CSV</span>
          </button>
          <button
            type="button"
            onClick={handlePrint}
            className="flex items-center gap-2 min-h-11 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold"
          >
            <Printer className="w-4 h-4" />
            <span>طباعة التقرير</span>
          </button>
        </div>
      </div>

      {/* On paper: who, what period and which filters, and when it was prepared. */}
      <div className="hidden print-only print-keep text-xs">
        <p>{settings?.organizationName}</p>
        <h2 className="text-lg font-bold">التقارير</h2>
        <p>الفترة: {periodLabel} · التصنيف: {selectedCategory === 'ALL' ? 'كل التصنيفات' : categories.find((c) => c.id === selectedCategory)?.nameAr} · المحطة: {stationLabel} · أُعدّ في {preparedAt}</p>
      </div>

      {/* Filter & Period Toolbar */}
      <div className="no-print bg-white p-4 rounded-2xl border border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <Calendar className="w-4 h-4 text-slate-500" aria-hidden="true" />
          <span id="reports-period-label" className="font-bold text-slate-700">الفترة:</span>
          <div role="group" aria-labelledby="reports-period-label" className="inline-flex flex-wrap rounded-xl bg-slate-100 p-1">
            {PERIODS.map((p) => (
              <button
                key={p.id}
                type="button"
                aria-pressed={selectedPeriod === p.id}
                onClick={() => setSelectedPeriod(p.id)}
                className={`min-h-9 px-3 py-1 rounded-lg font-bold text-xs whitespace-nowrap ${
                  selectedPeriod === p.id ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>

        {(stations.length > 1 || groups.length > 0) && (
          <div className="flex items-center gap-2">
            <label htmlFor="reports-station-filter" className="text-slate-600 font-medium">المحطة:</label>
            <select
              id="reports-station-filter"
              value={selectedStation}
              onChange={(e) => setSelectedStation(e.target.value)}
              className="px-3.5 py-2 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 font-medium"
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

        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-slate-500" aria-hidden="true" />
          <label htmlFor="reports-category-filter" className="text-slate-600 font-medium">التصنيف:</label>
          <select
            id="reports-category-filter"
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-3.5 py-2 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all font-medium"
          >
            <option value="ALL">كل التصنيفات ({newsList.length})</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nameAr}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Top Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Metric
          label="معدل نشر الأخبار"
          scope={periodLabel}
          icon={FileText}
          value={`${filteredNews.length > 0 ? Math.round((publishedCount / filteredNews.length) * 100) : 0}%`}
          note={filteredNews.length > 0 ? `نُشر ${publishedCount} من ${filteredNews.length}` : 'لا أخبار في هذه الفترة'}
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

      {/* Production by Category & Workflow Velocity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Category Breakdown */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 space-y-4">
          <h2 className="text-sm font-bold text-slate-800">
            الأخبار حسب التصنيف <span className="text-2xs font-normal text-slate-500">({periodLabel})</span>
          </h2>
          <div className="space-y-3">
            {categories.map((cat) => {
              const count = newsInPeriod.filter((n) => n.categoryId === cat.id).length;
              const pct = newsInPeriod.length > 0 ? Math.round((count / newsInPeriod.length) * 100) : 0;

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
          <div role="region" tabIndex={0} aria-label="جدول المحطات (يمكن تمريره أفقياً)" className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
            <table className="w-full min-w-[40rem] text-xs">
              <thead>
                <tr className="text-slate-600 border-b border-slate-200">
                  {['المحطة', 'أخبار', 'منشورة', 'معتمدة', 'قيد المراجعة', 'مسودات', 'تكليفات شاركت فيها', 'خطوات تكليفات أنجزتها'].map((h, i) => (
                    <th key={h} scope="col" className={`p-3 font-bold text-right whitespace-nowrap ${i === 0 ? 'sticky right-0 bg-white' : ''}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stationBreakdown.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 last:border-0">
                    <th scope="row" className="p-3 text-right font-bold text-slate-900 whitespace-nowrap sticky right-0 bg-white">{r.name}</th>
                    {[r.total, r.published, r.approved, r.review, r.drafts, r.cards, r.cardSteps].map((v, i) => (
                      <td key={i} className="p-3 tabular-nums">{v}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-2xs text-slate-500">يُنسب الخبر إلى محطة كاتبه. الحلقات لا تُنسب إلى محطة، فأرقامها تخص كل المحطات.</p>
        </section>
      )}
    </div>
  );
};
