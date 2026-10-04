import { arabicDate } from '../shared/dates';
import { RbacService } from '../services/rbacService';
import { localDateString } from '../shared/dates';
import { formatSecondsToTime } from '../shared/rundown';
import React, { useState, useEffect } from 'react';
import {
  ArrowRight,
  Tv,
  Calendar,
  Clock,
  User as UserIcon,
  Video,
  Plus,
  Edit2,
  CheckCircle2,
  Sparkles,
  Award,
  Layers,
  FileText,
  Users,
  MessageSquare,
  TrendingUp,
  AlertCircle,
  ExternalLink,
  Sliders,
  Check,
  Building,
  Radio,
  Share2,
  ChevronLeft,
} from 'lucide-react';
import { Program, Episode, User } from '../types';
import { Badge } from '../components/common/Badge';
import { Breadcrumbs } from '../components/layout/Breadcrumbs';
import { apiService } from '../services/api';

interface ProgramDetailViewProps {
  program: Program;
  allPrograms?: Program[];
  allEpisodes?: Episode[];
  currentUser: User;
  onBack: () => void;
  onSelectEpisode: (episodeId: string) => void;
  onEditProgram: (program: Program) => void;
  onCreateEpisodeForProgram: (programId: string) => void;
  onOpenWorkspace: (episode: Episode) => void;
  onSwitchProgram?: (programId: string) => void;
}

export const ProgramDetailView: React.FC<ProgramDetailViewProps> = ({
  program,
  allPrograms = [],
  allEpisodes = [],
  currentUser,
  onBack,
  onSelectEpisode,
  onEditProgram,
  onCreateEpisodeForProgram,
  onOpenWorkspace,
  onSwitchProgram,
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'episodes' | 'template' | 'team'>('overview');
  const canManageProgram = RbacService.hasPermission(currentUser, 'programs.manage');

  // Filter episodes belonging to this program
  const programEpisodes = (allEpisodes || []).filter((e) => e.programId === program.id);
  const today = localDateString();
  const nextEpisode = [...programEpisodes]
    .filter((e) => (e.broadcastDate || '') >= today)
    .sort((a, b) => `${a.broadcastDate} ${a.startTime}`.localeCompare(`${b.broadcastDate} ${b.startTime}`))[0];
  // The structure of the latest episode that has a rundown serves as the program's template.
  const templateSource = [...programEpisodes]
    .filter((e) => (e.rundown || []).length > 0)
    .sort((a, b) => (b.broadcastDate || '').localeCompare(a.broadcastDate || ''))[0];
  const templateSegments = (templateSource?.rundown || []).map((seg, i) => ({
    index: i + 1,
    title: seg.title,
    type: seg.segmentType,
    duration: formatSecondsToTime(seg.durationSeconds || 0).slice(3),
    notes: seg.notes || '',
  }));

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'READY_FOR_BROADCAST':
        return <Badge variant="success" size="sm">جاهزة للبث</Badge>;
      case 'ON_AIR':
        return <Badge variant="danger" size="sm">على الهواء الآن</Badge>;
      case 'BROADCASTED':
        return <Badge variant="default" size="sm">أُذيعت</Badge>;
      case 'PREPARING':
      case 'IN_PREPARATION':
        return <Badge variant="warning" size="sm">قيد الإعداد</Badge>;
      default:
        return <Badge variant="info" size="sm">مجدولة</Badge>;
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Top Contextual Breadcrumbs */}
      <Breadcrumbs
        items={[
          { label: 'دليل البرامج التلفزيونية', onClick: onBack },
          { label: program.name },
        ]}
        statusBadge={{
          label: program.status === 'ACTIVE' ? 'برنامج نشط' : 'متوقف مؤقتاً',
          variant: program.status === 'ACTIVE' ? 'success' : 'default',
        }}
        onBack={onBack}
        backLabel="العودة لدليل البرامج"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {allPrograms.length > 0 && onSwitchProgram && (
              <div className="flex items-center gap-1.5 bg-slate-50 px-2.5 py-1.5 rounded-xl border border-slate-200">
                <Tv className="w-3.5 h-3.5 text-blue-600" />
                <label htmlFor="program-switcher-select" className="text-[11px] font-medium text-slate-500">
                  تبديل:
                </label>
                <select
                  id="program-switcher-select"
                  value={program.id}
                  onChange={(e) => onSwitchProgram(e.target.value)}
                  className="text-xs font-bold text-slate-800 bg-transparent border-none focus:outline-hidden cursor-pointer"
                >
                  {allPrograms.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.typeName})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {canManageProgram && (
            <button
              type="button"
              onClick={() => onEditProgram(program)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 rounded-xl border border-slate-200 transition-colors"
            >
              <Edit2 className="w-3.5 h-3.5 text-slate-500" />
              <span>تعديل</span>
            </button>
            )}

            <button
              type="button"
              onClick={() => onCreateEpisodeForProgram(program.id)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-all shadow-xs"
            >
              <Plus className="w-4 h-4" />
              <span>حلقة جديدة</span>
            </button>
          </div>
        }
      />

      {/* Program Hero Banner */}
      <div className="theme-fixed relative rounded-3xl overflow-hidden bg-slate-950 border border-slate-800 shadow-lg text-white">
        <div className="absolute inset-0 z-0">
          <img
            src={program.coverImageUrl || '/cover.svg'}
            alt={program.name}
            className="w-full h-full object-cover opacity-35 filter blur-xs scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/80 to-transparent" />
        </div>

        <div className="relative z-10 p-6 sm:p-8 lg:p-10 flex flex-col md:flex-row justify-between gap-6 items-start md:items-end">
          <div className="space-y-4 max-w-3xl">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="px-3 py-1 bg-blue-600/80 backdrop-blur-md text-white font-bold text-xs rounded-lg border border-blue-400/30">
                {program.typeName || 'برنامج تلفزيوني'}
              </span>
              {program.status === 'ACTIVE' && (
                <span className="px-3 py-1 bg-emerald-500/20 backdrop-blur-md text-emerald-300 font-semibold text-xs rounded-lg border border-emerald-400/30 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  نشط في خريطة البث
                </span>
              )}
              <span className="px-3 py-1 bg-slate-800/80 backdrop-blur-md text-slate-300 text-xs rounded-lg font-mono">
                {program.channelName}
              </span>
            </div>

            <div>
              <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black text-white tracking-tight">
                {program.name}
              </h1>
              {program.shortName && program.shortName !== program.name && (
                <p className="text-sm font-medium text-slate-300 mt-1">
                  الاسم المختصر: {program.shortName}
                </p>
              )}
            </div>

            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed max-w-2xl line-clamp-3">
              {program.description}
            </p>

            {/* Quick Metadata Badges */}
            <div className="flex flex-wrap items-center gap-4 text-xs text-slate-300 pt-2 border-t border-slate-800/80">
              <div className="flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-blue-400" />
                <span>موعد العرض: <strong>{program.broadcastTime}</strong> ({program.durationMinutes} دقيقة)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Calendar className="w-4 h-4 text-amber-400" />
                <span>أيام البث: <strong>{program.broadcastDays.join('، ')}</strong></span>
              </div>
              <div className="flex items-center gap-1.5">
                <Building className="w-4 h-4 text-emerald-400" />
                <span>{program.studioName}</span>
              </div>
            </div>
          </div>

          {/* Next episode at a glance */}
          <div className="bg-slate-900/90 backdrop-blur-md p-5 rounded-2xl border border-slate-700/80 flex flex-col gap-2 text-right shrink-0 w-full md:w-64 shadow-md">
            <span className="text-[11px] font-bold text-slate-500">الحلقة القادمة</span>
            {nextEpisode ? (
              <>
                <strong className="text-sm text-white leading-snug line-clamp-2">{nextEpisode.title}</strong>
                <span className="text-xs text-slate-300 font-mono">
                  {arabicDate(nextEpisode.broadcastDate)} · {nextEpisode.startTime}
                </span>
                <button
                  type="button"
                  onClick={() => onOpenWorkspace(nextEpisode)}
                  className="mt-1 w-full py-2 px-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-xs transition-colors"
                >
                  فتح مساحة العمل
                </button>
              </>
            ) : (
              <span className="text-xs text-slate-500">لا توجد حلقة مجدولة بعد</span>
            )}
          </div>
        </div>
      </div>

      {/* Tabs Navigation Bar */}
      <div className="bg-white p-1.5 rounded-2xl border border-slate-200 shadow-2xs flex items-center gap-1 overflow-x-auto">
        <button
          type="button"
          onClick={() => setActiveTab('overview')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all shrink-0 ${
            activeTab === 'overview'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>الملف التعريفي والهوية</span>
        </button>


        <button
          type="button"
          onClick={() => setActiveTab('episodes')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all shrink-0 ${
            activeTab === 'episodes'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Video className="w-4 h-4" />
          <span>حلقات البرنامج والرانداون ({programEpisodes.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('template')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all shrink-0 ${
            activeTab === 'template'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>قالب الرانداون المعياري</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('team')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all shrink-0 ${
            activeTab === 'team'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>طاقم العمل والإنتاج</span>
        </button>
      </div>

      {/* TAB CONTENT: 1. OVERVIEW */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Column */}
          <div className="lg:col-span-2 space-y-6">
            {/* Identity Card */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-2xs space-y-4">
              <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
                <Tv className="w-5 h-5 text-blue-600" />
                <span>الرؤية التحريرية وأهداف البرنامج</span>
              </h2>

              <p className="text-sm text-slate-700 leading-relaxed">
                {program.description}
              </p>

              {program.notes && (
                <div className="p-4 bg-blue-50/70 border border-blue-200 rounded-xl text-xs text-blue-900 leading-relaxed">
                  <strong className="block mb-1 font-bold">توجيهات إنتاجية وتقنية:</strong>
                  {program.notes}
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 border-t border-slate-100 text-center">
                <div className="p-3 bg-slate-50 rounded-xl">
                  <span className="block text-xl font-black text-slate-900 font-mono">
                    {program.durationMinutes}
                  </span>
                  <span className="text-[11px] text-slate-500">دقيقة / حلقة</span>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl">
                  <span className="block text-xl font-black text-blue-600 font-mono">
                    {programEpisodes.length || program.episodesCount || 0}
                  </span>
                  <span className="text-[11px] text-slate-500">حلقات مسجلة</span>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl">
                  <span className="block text-xl font-black text-amber-500 font-mono">
                    {programEpisodes.filter((e) => (e.broadcastDate || '') >= today).length}
                  </span>
                  <span className="text-[11px] text-slate-500">حلقات قادمة</span>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl">
                  <span className="block text-xl font-black text-emerald-700 font-mono">
                    {program.broadcastDays.length}
                  </span>
                  <span className="text-[11px] text-slate-500">أيام أسبوعياً</span>
                </div>
              </div>
            </div>

            {/* Production Specifications */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-2xs space-y-4">
              <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
                <Sliders className="w-5 h-5 text-indigo-600" />
                <span>المواصفات الفنية ومحددات البث</span>
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                  <span className="text-slate-500">الاستوديو وموقع التسجيل:</span>
                  <strong className="text-slate-800">{program.studioName}</strong>
                </div>

                <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                  <span className="text-slate-500">القناة العارضة:</span>
                  <strong className="text-slate-800">{program.channelName}</strong>
                </div>

                <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                  <span className="text-slate-500">توقيت البث المعتمد:</span>
                  <strong className="text-slate-800 font-mono">{program.broadcastTime} KSA</strong>
                </div>

                <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                  <span className="text-slate-500">أيام العرض المجدولة:</span>
                  <strong className="text-blue-700">{program.broadcastDays.join('، ')}</strong>
                </div>
              </div>
            </div>
          </div>

          {/* Side Column: Crew & Latest Episodes */}
          <div className="space-y-6">
            {/* Key Personnel Card */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-2xs space-y-4">
              <h3 className="text-sm font-bold text-slate-800 flex items-center justify-between">
                <span>قيادة البرنامج</span>
                <Badge variant="primary" size="sm">فريق القيادة</Badge>
              </h3>

              <div className="space-y-3">
                <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
                  <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-sm shrink-0">
                    <UserIcon className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="block text-[11px] text-slate-500 font-medium">مقدم البرنامج الرئيسي</span>
                    <strong className="text-xs text-slate-900">{program.presenterName}</strong>
                  </div>
                </div>

                <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
                  <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-sm shrink-0">
                    <UserIcon className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="block text-[11px] text-slate-500 font-medium">المنتج المنفذ</span>
                    <strong className="text-xs text-slate-900">{program.producerName}</strong>
                  </div>
                </div>
              </div>
            </div>

            {/* Quick Next Episode Widget */}
            <div className="theme-fixed bg-slate-900 p-6 rounded-2xl text-white shadow-md space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-blue-200 flex items-center gap-1.5">
                  <Radio className="w-4 h-4 text-emerald-400 animate-pulse" />
                  الحلقة القادمة
                </span>
                <span className="text-[10px] bg-blue-800/80 px-2 py-0.5 rounded text-blue-100 font-mono">
                  {nextEpisode ? `${arabicDate(nextEpisode.broadcastDate)} ${nextEpisode.startTime || ''}` : 'لا توجد حلقة مجدولة'}
                </span>
              </div>

              {programEpisodes.length > 0 ? (
                <div className="space-y-2">
                  <h4 className="text-sm font-bold leading-snug text-white">
                    {programEpisodes[0].title}
                  </h4>
                  <p className="text-xs text-blue-200 line-clamp-2">
                    {programEpisodes[0].description}
                  </p>

                  <button
                    type="button"
                    onClick={() => onOpenWorkspace(programEpisodes[0])}
                    className="w-full mt-3 py-2.5 bg-blue-500 hover:bg-blue-400 text-white rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-1.5"
                  >
                    <Video className="w-4 h-4" />
                    <span>فتح مساحة عمل الحلقة والرانداون</span>
                  </button>
                </div>
              ) : (
                <div className="text-center py-4 space-y-2">
                  <p className="text-xs text-blue-200">لا توجد حلقات مسجلة بعد لهذا البرنامج</p>
                  <button
                    type="button"
                    onClick={() => onCreateEpisodeForProgram(program.id)}
                    className="py-2 px-3 bg-white text-blue-900 rounded-xl text-xs font-bold"
                  >
                    إنشاء الحلقة الأولى
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB CONTENT: 3. EPISODES & RUNDOWN */}
      {activeTab === 'episodes' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-bold text-slate-800">
                حلقات البرنامج وجداول الرانداون
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                تصفح الحلقات المنتجة وجداول البث، مع إمكانية الدخول المباشر لشاشة الرانداون التفاعلية
              </p>
            </div>

            <button
              type="button"
              onClick={() => onCreateEpisodeForProgram(program.id)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs self-start sm:self-auto"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة حلقة جديدة</span>
            </button>
          </div>

          {programEpisodes.length === 0 ? (
            <div className="bg-white p-10 rounded-2xl border border-slate-200 text-center space-y-3">
              <Video className="w-12 h-12 text-slate-300 mx-auto" />
              <h4 className="text-sm font-bold text-slate-700">لا توجد حلقات مسجلة لهذا البرنامج</h4>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                ابدأ بإنشاء أول حلقة لإعداد الرانداون والمقدمة ودعوة الضيوف.
              </p>
              <button
                type="button"
                onClick={() => onCreateEpisodeForProgram(program.id)}
                className="px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold"
              >
                إنشاء الحلقة الأولى الآن
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {programEpisodes.map((ep) => (
                <div
                  key={ep.id}
                  className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs hover:shadow-md transition-all flex flex-col justify-between space-y-4 group"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-mono text-slate-500 font-semibold">
                        الموسم {ep.seasonNumber || 1} • الحلقة {ep.episodeNumber || 1}
                      </span>
                      {getStatusBadge(ep.status)}
                    </div>

                    <h4 className="text-sm font-bold text-slate-900 group-hover:text-blue-600 transition-colors leading-snug">
                      {ep.title}
                    </h4>

                    <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">
                      {ep.description}
                    </p>
                  </div>

                  <div className="space-y-3 pt-3 border-t border-slate-100 text-xs text-slate-600">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">تاريخ ووقت البث:</span>
                      <strong className="text-slate-800 font-mono">
                        {arabicDate(ep.broadcastDate)} | {ep.startTime}
                      </strong>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">المقدم:</span>
                      <span className="text-slate-800">{ep.presenterName || program.presenterName}</span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">فقرات الرانداون:</span>
                      <span className="font-bold text-blue-600 font-mono">
                        {ep.rundownSegments?.length || 0} فقرة
                      </span>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-100 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onOpenWorkspace(ep)}
                      className="flex-1 py-2.5 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center justify-center gap-1.5"
                    >
                      <Video className="w-4 h-4" />
                      <span>مساحة العمل والرانداون</span>
                    </button>

                    <a
                      href={apiService.getMosExportUrl(ep.id)}
                      download={`mos_${ep.id}.xml`}
                      className="p-2.5 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-xl text-xs font-semibold transition-colors border border-indigo-200"
                      title="تصدير بروتوكول MOS XML للبث"
                    >
                      MOS
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB CONTENT: 4. RUNDOWN TEMPLATE SPEC */}
      {activeTab === 'template' && (
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-2xs space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-800">
                هيكل القالب التحريري المعياري للبرنامج
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                التسلسل الزمني النموذجي وتوزيع الفقرات في كل حلقة من حلقات {program.name}
              </p>
            </div>
            <Badge variant="primary" size="sm">
              إجمالي المدة: {program.durationMinutes} دقيقة
            </Badge>
          </div>

          <div className="space-y-3">
            {templateSegments.length === 0 && (
              <p className="text-xs text-slate-500 py-6 text-center">لا يوجد رانداون محفوظ لحلقات هذا البرنامج بعد؛ سيظهر هيكل آخر حلقة هنا.</p>
            )}
            {templateSegments.map((seg) => (
              <div
                key={seg.index}
                className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100 gap-3"
              >
                <div className="flex items-center gap-3">
                  <span className="w-7 h-7 rounded-lg bg-blue-100 text-blue-800 font-bold text-xs flex items-center justify-center font-mono shrink-0">
                    {seg.index}
                  </span>
                  <div>
                    <strong className="text-xs sm:text-sm text-slate-800 block">
                      {seg.title}
                    </strong>
                    <span className="text-[11px] text-slate-500">{seg.notes}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2.5 shrink-0 self-end sm:self-auto">
                  <Badge variant="info" size="sm">{seg.type}</Badge>
                  <span className="font-mono text-xs font-bold text-slate-700 bg-white px-2.5 py-1 rounded-md border border-slate-200">
                    {seg.duration}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB CONTENT: 5. TEAM & CREW */}
      {activeTab === 'team' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            { role: 'مقدم ومحاور رئيسي', name: program.presenterName, dept: 'التقديم' },
            { role: 'المنتج المنفذ', name: program.producerName, dept: 'الإنتاج البرامجي' },
            ...(program.teamMembers || [])
              .filter((m) => m && m !== program.presenterName && m !== program.producerName)
              .map((m) => ({ role: 'عضو فريق البرنامج', name: m, dept: '' })),
          ].filter((m) => !!m.name).map((member, idx) => (
            <div
              key={idx}
              className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs flex items-center gap-4"
            >
              <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center font-bold text-base shrink-0">
                <UserIcon className="w-6 h-6" />
              </div>
              <div className="min-w-0">
                <span className="text-[11px] font-bold text-blue-600 block uppercase">
                  {member.role}
                </span>
                <h4 className="text-sm font-black text-slate-800 truncate">{member.name}</h4>
                <p className="text-xs text-slate-500 truncate">{member.dept}</p>
              </div>
            </div>
          ))}
        </div>
      )}

    </div>
  );
};
