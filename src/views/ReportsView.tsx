import React, { useState, useMemo } from 'react';
import {
  BarChart3,
  TrendingUp,
  Clock,
  CheckCircle2,
  Tv,
  FileText,
  Users,
  AlertTriangle,
  Award,
  Calendar,
  Printer,
  Download,
  Filter,
  Layers,
  ChevronDown,
} from 'lucide-react';
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
      return inPeriod(item.updatedAt || item.createdAt);
    });
  }, [newsList, selectedCategory, periodStart]);

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

  const handlePrint = () => {
    window.print();
  };

  const handleExportCsv = () => {
    const csvRows = [
      ['المؤشر الإحصائي', 'القيمة'],
      ['الفترة', periodLabel],
      ['إجمالي الأخبار المرشحة', String(filteredNews.length)],
      ['الأخبار المنشورة', String(publishedCount)],
      ['الأخبار المعتمدة', String(approvedCount)],
      ['أخبار قيد المراجعة', String(reviewCount)],
      ['المسودات الأولية', String(draftCount)],
      ['إجمالي الحلقات التلفزيونية', String(totalEpisodes)],
      ['حلقات جاهزة للبث المباشر', String(readyEpisodes)],
      ['حلقات تم بثها', String(completedEpisodes)],
      ['إجمالي الضيوف المعتمدين (كل الفترات)', String(guests.length)],
      ['دقة توقيت الرانداون', `${rundownAccuracy.onTime}/${rundownAccuracy.total}`],
    ];

    const csvContent = '\uFEFF' + csvRows.map((e) => e.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `nrcs_performance_report_${selectedPeriod}_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* Header with Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-800 tracking-tight">
            التقارير التحليلية ومؤشرات الأداء (KPIs)
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
            <Download className="w-4 h-4 text-emerald-600" />
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

      {/* Filter & Period Toolbar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs flex flex-wrap items-center justify-between gap-3 text-xs">
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
              هذا الشهر
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

        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-slate-400" />
          <label htmlFor="reports-category-filter" className="text-slate-600 font-medium">القسم الصحفي:</label>
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
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-bold text-slate-600">معدل نشر الأخبار</span>
            <FileText className="w-5 h-5 text-blue-600" />
          </div>
          <div className="text-2xl font-black text-slate-800 font-mono">
            {filteredNews.length > 0 ? Math.round((publishedCount / filteredNews.length) * 100) : 0}%
          </div>
          <p className="text-[11px] text-emerald-600 font-semibold flex items-center gap-1">
            <TrendingUp className="w-3.5 h-3.5" />
            <span>{publishedCount} من أصل {filteredNews.length} مادة معتمدة ومنشورة</span>
          </p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-2">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-bold text-slate-600">جاهزية الحلقات للبث</span>
            <Tv className="w-5 h-5 text-purple-600" />
          </div>
          <div className="text-2xl font-black text-slate-800 font-mono">
            {readyEpisodes + completedEpisodes} / {totalEpisodes}
          </div>
          <p className="text-[11px] text-purple-600 font-semibold">
            {readyEpisodes} حلقة جاهزة للبث المباشر اليوم
          </p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-2">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-bold text-slate-600">دقة توقيت الرانداون</span>
            <Clock className="w-5 h-5 text-emerald-600" />
          </div>
          <div className="text-2xl font-black text-slate-800 font-mono">
            {rundownAccuracy.total > 0 ? `${Math.round((rundownAccuracy.onTime / rundownAccuracy.total) * 100)}%` : '—'}
          </div>
          <p className="text-[11px] text-slate-500">
            {rundownAccuracy.total > 0
              ? `${rundownAccuracy.onTime} من ${rundownAccuracy.total} حلقة مجموع فقراتها ضمن ±60 ثانية من المدة المخططة`
              : 'لا توجد حلقات بفقرات رانداون بعد'}
          </p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-2">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-bold text-slate-600">قاعدة الخبراء والضيوف <span className="font-normal text-slate-400">(الإجمالي، لا يتأثر بالفترة)</span></span>
            <Users className="w-5 h-5 text-amber-600" />
          </div>
          <div className="text-2xl font-black text-slate-800 font-mono">{guests.length}</div>
          <p className="text-[11px] text-amber-700 font-semibold">
            موزعين على مختلف التخصصات السياسية والاقتصادية
          </p>
        </div>
      </div>

      {/* Production by Category & Workflow Velocity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Category Breakdown */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-2xs space-y-4">
          <h3 className="text-sm font-bold text-slate-800">
            حجم الإنتاج الإخباري حسب الأقسام الصحفية <span className="text-[11px] font-normal text-slate-500">(ضمن الفترة المختارة)</span>
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
                      {count} أخبار ({pct}%)
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
              <span className="text-xs text-slate-500 block">المسودات الأولية (Draft)</span>
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
              : <>متوسط الوقت من إنشاء الخبر حتى اعتماده في الفترة المحددة هو <strong>{avgApprovalMinutes >= 120 ? `${Math.round(avgApprovalMinutes / 60)} ساعة` : `${avgApprovalMinutes} دقيقة`}</strong>.</>}
          </div>
        </div>
      </div>
    </div>
  );
};
