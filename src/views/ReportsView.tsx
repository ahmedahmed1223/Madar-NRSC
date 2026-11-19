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
import React, { useState, useMemo } from 'react';
import { TrendingUp, Clock, Tv, FileText, Users, Calendar, Printer, Download, Filter } from 'lucide-react';
import { NewsItem, Episode, Guest, Category } from '../types';

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
  const preparedAt = new Date().toLocaleString('ar', { dateStyle: 'medium', timeStyle: 'short' });

  const handlePrint = () => {
    window.print();
  };

  const handleExportCsv = () => {
    // Same filters as the screen: the period and the selected category.
    const categoryLabel = selectedCategory === 'ALL' ? 'كل الأقسام' : categories.find((c) => c.id === selectedCategory)?.nameAr || selectedCategory;
    const approvalLabel = avgApprovalMinutes === null ? 'لا توجد أخبار معتمدة' : countOf(avgApprovalMinutes, { ...AR.minute, zero: 'أقل من دقيقة' });
    const csvRows: unknown[][] = [
      ['المؤشر الإحصائي', 'القيمة'],
      ['المؤسسة', settings?.organizationName || ''],
      ['أُعدّ في', preparedAt],
      ['الفترة', periodLabel],
      ['القسم', categoryLabel],
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
      {/* Header with Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-800 tracking-tight">
            التقارير
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            إحصائيات الإنتاج الإخباري، كفاءة التدقيق التحريري، ودقة الالتزام بجداول البث التلفزيوني
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            onClick={handleExportCsv}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-bold transition-all shadow-2xs"
          >
            <Download className="w-4 h-4 text-emerald-700" />
            <span>تصدير تقرير CSV</span>
          </button>
          <button
            type="button"
            onClick={handlePrint}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-2xs"
          >
            <Printer className="w-4 h-4 text-white" />
            <span>طباعة التقرير</span>
          </button>
        </div>
      </div>

      {/* On paper: who, what period and which filters, and when it was prepared. */}
      <div className="hidden print-only print-keep text-xs">
        <p className="font-bold">{settings?.organizationName}</p>
        <p>الفترة: {periodLabel} · القسم: {selectedCategory === 'ALL' ? 'كل الأقسام' : categories.find((c) => c.id === selectedCategory)?.nameAr} · المحطة: {stationLabel} · أُعدّ في {preparedAt}</p>
      </div>

      {/* Filter & Period Toolbar */}
      <div className="no-print bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-slate-500" />
          <span className="font-bold text-slate-700">النطاق الزمني:</span>
          <div className="inline-flex rounded-xl bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setSelectedPeriod('today')}
              className={`px-3 py-1 rounded-lg font-bold text-xs transition-all ${
                selectedPeriod === 'today'
                  ? 'bg-white text-blue-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              اليوم
            </button>
            <button
              type="button"
              onClick={() => setSelectedPeriod('week')}
              className={`px-3 py-1 rounded-lg font-bold text-xs transition-all ${
                selectedPeriod === 'week'
                  ? 'bg-white text-blue-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              آخر 7 أيام
            </button>
            <button
              type="button"
              onClick={() => setSelectedPeriod('month')}
              className={`px-3 py-1 rounded-lg font-bold text-xs transition-all ${
                selectedPeriod === 'month'
                  ? 'bg-white text-blue-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              آخر 30 يوماً
            </button>
            <button
              type="button"
              onClick={() => setSelectedPeriod('all')}
              className={`px-3 py-1 rounded-lg font-bold text-xs transition-all ${
                selectedPeriod === 'all'
                  ? 'bg-white text-blue-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              جميع الفترات
            </button>
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
          <Filter className="w-4 h-4 text-slate-500" />
          <label htmlFor="reports-category-filter" className="text-slate-600 font-medium">تصنيف الخبر:</label>
          <select
            id="reports-category-filter"
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-3.5 py-2 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all font-medium"
          >
            <option value="ALL">كافة الأقسام ({newsList.length})</option>
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
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-2">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold text-slate-600">معدل نشر الأخبار <span className="font-normal text-slate-500">({periodLabel})</span></span>
            <FileText className="w-5 h-5 text-blue-600" />
          </div>
          <div className="text-2xl font-bold text-slate-800 font-mono">
            {filteredNews.length > 0 ? Math.round((publishedCount / filteredNews.length) * 100) : 0}%
          </div>
          <p className="text-2xs text-emerald-700 font-semibold flex items-center gap-1">
            <TrendingUp className="w-3.5 h-3.5" />
            <span>{publishedCount} من أصل {filteredNews.length} مادة معتمدة ومنشورة</span>
          </p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-2">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold text-slate-600">جاهزية الحلقات للبث <span className="font-normal text-slate-500">({periodLabel}، كل المحطات)</span></span>
            <Tv className="w-5 h-5 text-purple-600" />
          </div>
          <div className="text-2xl font-bold text-slate-800 font-mono">
            {readyEpisodes} من {notAired}
          </div>
          <p className="text-2xs text-purple-600 font-semibold">
            جاهزة من الحلقات التي لم تُبث بعد {inPeriodWords} · {countOf(completedEpisodes, { ...AR.episode, zero: 'لا حلقات' })} بُثّت
          </p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-2">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold text-slate-600">دقة توقيت الرانداون <span className="font-normal text-slate-500">({periodLabel})</span></span>
            <Clock className="w-5 h-5 text-emerald-700" />
          </div>
          <div className="text-2xl font-bold text-slate-800 font-mono">
            {rundownAccuracy.total > 0 ? `${Math.round((rundownAccuracy.onTime / rundownAccuracy.total) * 100)}%` : '—'}
          </div>
          <p className="text-2xs text-slate-500">
            {rundownAccuracy.total > 0
              ? `${rundownAccuracy.onTime} من ${rundownAccuracy.total} حلقة مجموع فقراتها ضمن ±60 ثانية من المدة المخططة`
              : 'لا توجد حلقات بفقرات رانداون بعد'}
          </p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-2">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold text-slate-600">قاعدة الخبراء والضيوف <span className="font-normal text-slate-500">(الإجمالي، لا يتأثر بالفترة)</span></span>
            <Users className="w-5 h-5 text-amber-700" />
          </div>
          <div className="text-2xl font-bold text-slate-800 font-mono">{guests.length}</div>
          <p className="text-2xs text-amber-700 font-semibold">
            موزعين على مختلف التخصصات السياسية والاقتصادية
          </p>
        </div>
      </div>

      {/* Production by Category & Workflow Velocity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Category Breakdown */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-2xs space-y-4">
          <h3 className="text-sm font-bold text-slate-800">
            حجم الإنتاج الإخباري حسب تصنيفات الأخبار <span className="text-2xs font-normal text-slate-500">(ضمن الفترة المختارة)</span>
          </h3>
          <div className="space-y-3">
            {categories.map((cat) => {
              // Same period as the other indicators (the category filter is ignored here by design).
              const newsInPeriod = (newsList || []).filter((n) => inPeriod(n.updatedAt || n.createdAt));
              const count = newsInPeriod.filter((n) => n.categoryId === cat.id).length;
              const pct = newsInPeriod.length > 0 ? Math.round((count / newsInPeriod.length) * 100) : 0;

              return (
                <div key={cat.id} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-700">{cat.nameAr}</span>
                    <span className="font-mono text-slate-500">
                      {countLabel(count, { zero: 'لا أخبار', one: 'خبر واحد', two: 'خبران', few: 'أخبار', many: 'خبراً' })} ({pct}%)
                    </span>
                  </div>
                  <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-600 rounded-full transition-all duration-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Workflow Breakdown */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-2xs space-y-4">
          <h3 className="text-sm font-bold text-slate-800">
            توزيع المواد الإخبارية في خط الإنتاج والتحرير
          </h3>

          <div className="grid grid-cols-2 gap-3 pt-2">
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
              <span className="text-xs text-slate-500 block">المسودات الأولية</span>
              <strong className="text-xl font-bold font-mono text-slate-700 block mt-1">
                {draftCount}
              </strong>
            </div>

            <div className="p-4 bg-amber-50 rounded-xl border border-amber-200">
              <span className="text-xs text-amber-700 block">قيد التدقيق والمراجعة</span>
              <strong className="text-xl font-bold font-mono text-amber-800 block mt-1">
                {reviewCount}
              </strong>
            </div>

            <div className="p-4 bg-purple-50 rounded-xl border border-purple-200">
              <span className="text-xs text-purple-700 block">معتمدة من مدراء التحرير</span>
              <strong className="text-xl font-bold font-mono text-purple-800 block mt-1">
                {approvedCount}
              </strong>
            </div>

            <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-200">
              <span className="text-xs text-emerald-700 block">منشورة على الهواء والرقمي</span>
              <strong className="text-xl font-bold font-mono text-emerald-800 block mt-1">
                {publishedCount}
              </strong>
            </div>
          </div>

          <div className="p-4 bg-blue-50/70 border border-blue-200 rounded-xl text-xs text-blue-900 leading-relaxed">
            <strong>مؤشر الكفاءة:</strong>{' '}
            {avgApprovalMinutes === null
              ? 'لا توجد أخبار معتمدة في الفترة المحددة لحساب متوسط زمن الاعتماد.'
              : <>متوسط الوقت من إنشاء الخبر حتى اعتماده ({periodLabel}) هو <strong>{avgApprovalMinutes >= 120 ? countOf(Math.round(avgApprovalMinutes / 60), AR.hour) : countOf(avgApprovalMinutes, { ...AR.minute, zero: 'أقل من دقيقة' })}</strong>.</>}
          </div>
        </div>
      </div>

      {/* Per station: a story counts for its writer's station; cards for each station that finished a step on them. */}
      {stationBreakdown.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-bold text-slate-800">حسب المحطة <span className="text-2xs font-normal text-slate-500">({periodLabel})</span></h3>
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
