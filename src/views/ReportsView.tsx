import React from 'react';
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
  const publishedCount = (newsList || []).filter((n) => n.status === 'PUBLISHED').length;
  const draftCount = (newsList || []).filter((n) => n.status === 'DRAFT').length;
  const reviewCount = (newsList || []).filter((n) => n.status === 'UNDER_REVIEW').length;
  const approvedCount = (newsList || []).filter((n) => n.status === 'APPROVED').length;

  const totalEpisodes = (episodes || []).length;
  const readyEpisodes = (episodes || []).filter((e) => e.status === 'READY_FOR_BROADCAST').length;
  const completedEpisodes = (episodes || []).filter((e) => e.status === 'BROADCASTED').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-black text-slate-800 tracking-tight">
          التقارير التحليلية ومؤشرات الأداء (KPIs)
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 mt-1">
          إحصائيات الإنتاج الإخباري، كفاءة التدقيق التحريري، ودقة الالتزام بجداول البث التلفزيوني
        </p>
      </div>

      {/* Top Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-2">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-bold text-slate-600">معدل نشر الأخبار</span>
            <FileText className="w-5 h-5 text-blue-600" />
          </div>
          <div className="text-2xl font-black text-slate-800 font-mono">
            {newsList.length > 0 ? Math.round((publishedCount / newsList.length) * 100) : 0}%
          </div>
          <p className="text-[11px] text-emerald-600 font-semibold flex items-center gap-1">
            <TrendingUp className="w-3.5 h-3.5" />
            <span>{publishedCount} من أصل {newsList.length} مادة معتمدة ومنشورة</span>
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
          <div className="text-2xl font-black text-slate-800 font-mono">99.4%</div>
          <p className="text-[11px] text-slate-500">
            مطابقة التوقيت الزمني لفقرات البث والاستوديوهات
          </p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-2">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-bold text-slate-600">قاعدة الخبراء والضيوف</span>
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
            حجم الإنتاج الإخباري حسب الأقسام الصحفية
          </h3>
          <div className="space-y-3">
            {categories.map((cat) => {
              const count = (newsList || []).filter((n) => n.categoryId === cat.id).length;
              const pct = (newsList || []).length > 0 ? Math.round((count / newsList.length) * 100) : 0;

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
            <strong>مؤشر الكفاءة:</strong> معدل الوقت المستغرق لنقل الخبر من مرحلة الصياغة حتى الاعتماد النهائي هو <strong>18 دقيقة</strong>، وهو يقع ضمن النطاق الأمثل لمعايير غرف الأخبار السريعة.
          </div>
        </div>
      </div>
    </div>
  );
};
