import React, { useState, useEffect } from 'react';
import {
  ArrowRight,
  Tv,
  Star,
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
import { Program, Episode, User, ProgramEvaluation } from '../types';
import { Badge } from '../components/common/Badge';
import { Modal } from '../components/common/Modal';
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
  const [activeTab, setActiveTab] = useState<'overview' | 'evaluations' | 'episodes' | 'template' | 'team'>('overview');
  const [evaluations, setEvaluations] = useState<ProgramEvaluation[]>(() => apiService.getProgramEvaluations(program.id));
  const [isAddEvalModalOpen, setIsAddEvalModalOpen] = useState(false);

  // Sync evaluations if program changes
  useEffect(() => {
    setEvaluations(apiService.getProgramEvaluations(program.id));
  }, [program.id]);

  // New evaluation form state
  const [evalRating, setEvalRating] = useState(5);
  const [editorialQuality, setEditorialQuality] = useState(5);
  const [timeCommitment, setTimeCommitment] = useState(5);
  const [guestRelevance, setGuestRelevance] = useState(5);
  const [visualDirection, setVisualDirection] = useState(5);
  const [viewerEngagement, setViewerEngagement] = useState(5);
  const [evalStrengths, setEvalStrengths] = useState('');
  const [evalImprovements, setEvalImprovements] = useState('');
  const [evalNotes, setEvalNotes] = useState('');

  // Filter episodes belonging to this program
  const programEpisodes = (allEpisodes || []).filter(
    (e) => e.programId === program.id || e.programName === program.name
  );

  // Ratings calculation
  const ratingSummary = apiService.getProgramRatingSummary(program.id);

  const handleAddEvaluationSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const strengthsArr = evalStrengths
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    const improvementsArr = evalImprovements
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    const newEval = apiService.addProgramEvaluation(
      {
        programId: program.id,
        overallRating: evalRating,
        criteria: {
          editorialQuality,
          timeCommitment,
          guestRelevance,
          visualDirection,
          viewerEngagement,
        },
        strengths: strengthsArr.length > 0 ? strengthsArr : ['أداء تحريري متقن ومحتوى متميز.'],
        improvements: improvementsArr,
        notes: evalNotes,
      },
      currentUser
    );

    setEvaluations([newEval, ...evaluations]);
    setIsAddEvalModalOpen(false);

    // Reset form
    setEvalStrengths('');
    setEvalImprovements('');
    setEvalNotes('');
  };

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
      {/* Top Breadcrumbs / Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-2 text-xs font-bold text-slate-600 hover:text-blue-600 bg-white px-3.5 py-2 rounded-xl border border-slate-200 transition-colors shadow-2xs"
          >
            <ArrowRight className="w-4 h-4" />
            <span>العودة لدليل البرامج</span>
          </button>

          {allPrograms.length > 0 && onSwitchProgram && (
            <div className="flex items-center gap-1.5 bg-white px-3 py-1.5 rounded-xl border border-slate-200 shadow-2xs">
              <Tv className="w-3.5 h-3.5 text-blue-600" />
              <label htmlFor="program-switcher-select" className="text-[11px] font-medium text-slate-500">
                البرنامج الحالي:
              </label>
              <select
                id="program-switcher-select"
                value={program.id}
                onChange={(e) => onSwitchProgram(e.target.value)}
                className="text-xs font-bold text-slate-800 bg-transparent border-none focus:outline-none focus:ring-0 cursor-pointer"
              >
                {allPrograms.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.typeName})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onEditProgram(program)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 rounded-xl border border-slate-200 transition-colors"
          >
            <Edit2 className="w-3.5 h-3.5 text-slate-500" />
            <span>تعديل بيانات البرنامج</span>
          </button>

          <button
            type="button"
            onClick={() => onCreateEpisodeForProgram(program.id)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-all shadow-xs"
          >
            <Plus className="w-4 h-4" />
            <span>إنشاء حلقة جديدة</span>
          </button>
        </div>
      </div>

      {/* Program Hero Banner */}
      <div className="relative rounded-3xl overflow-hidden bg-slate-950 border border-slate-800 shadow-lg text-white">
        <div className="absolute inset-0 z-0">
          <img
            src={program.coverImageUrl || 'https://images.unsplash.com/photo-1585829365295-ab7cd400c167?auto=format&fit=crop&w=1400&q=80'}
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
              <span className="px-3 py-1 bg-emerald-500/20 backdrop-blur-md text-emerald-300 font-semibold text-xs rounded-lg border border-emerald-400/30 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                نشط في خريطة البث
              </span>
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

          {/* Program Rating Scorecard in Hero */}
          <div className="bg-slate-900/90 backdrop-blur-md p-5 rounded-2xl border border-slate-700/80 flex flex-col items-center justify-center text-center shrink-0 w-full md:w-56 shadow-md">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
              مؤشر تقييم البرنامج
            </span>
            <div className="flex items-center gap-2 my-1">
              <span className="text-3xl sm:text-4xl font-black text-amber-400 font-mono">
                {ratingSummary.average}
              </span>
              <span className="text-slate-400 text-sm">/ 5.0</span>
            </div>
            <div className="flex items-center gap-1 text-amber-400 mb-2">
              {[1, 2, 3, 4, 5].map((s) => (
                <Star
                  key={s}
                  className={`w-4 h-4 ${
                    s <= Math.round(ratingSummary.average)
                      ? 'fill-amber-400 text-amber-400'
                      : 'text-slate-600'
                  }`}
                />
              ))}
            </div>
            <span className="text-[11px] text-slate-400 font-medium">
              بناءً على {ratingSummary.count || evaluations.length} تقييماً تحريرياً
            </span>

            <button
              type="button"
              onClick={() => {
                setActiveTab('evaluations');
                setIsAddEvalModalOpen(true);
              }}
              className="mt-3 w-full py-2 px-3 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded-xl text-xs transition-colors flex items-center justify-center gap-1.5 shadow-xs"
            >
              <Star className="w-3.5 h-3.5 fill-slate-950" />
              <span>تقييم البرنامج الآن</span>
            </button>
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
          onClick={() => setActiveTab('evaluations')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all shrink-0 ${
            activeTab === 'evaluations'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Star className="w-4 h-4" />
          <span>تقييم البرنامج ومؤشرات الجودة ({evaluations.length})</span>
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
                    {ratingSummary.average}
                  </span>
                  <span className="text-[11px] text-slate-500">معدل التقييم</span>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl">
                  <span className="block text-xl font-black text-emerald-600 font-mono">
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
                    <span className="block text-[11px] text-slate-400 font-medium">مقدم البرنامج الرئيسي</span>
                    <strong className="text-xs text-slate-900">{program.presenterName}</strong>
                  </div>
                </div>

                <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
                  <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-sm shrink-0">
                    <UserIcon className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="block text-[11px] text-slate-400 font-medium">المنتج المنفذ</span>
                    <strong className="text-xs text-slate-900">{program.producerName}</strong>
                  </div>
                </div>
              </div>
            </div>

            {/* Quick Next Episode Widget */}
            <div className="bg-gradient-to-br from-blue-900 to-indigo-950 p-6 rounded-2xl text-white shadow-md space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-blue-200 flex items-center gap-1.5">
                  <Radio className="w-4 h-4 text-emerald-400 animate-pulse" />
                  الحلقة القادمة
                </span>
                <span className="text-[10px] bg-blue-800/80 px-2 py-0.5 rounded text-blue-100 font-mono">
                  {programEpisodes[0]?.broadcastDate || 'الأحد القادم'}
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

      {/* TAB CONTENT: 2. EVALUATIONS & QUALITY RATINGS */}
      {activeTab === 'evaluations' && (
        <div className="space-y-6">
          {/* Top Scorecard & Criteria */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-2xs">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-6 border-b border-slate-100">
              <div>
                <h2 className="text-lg font-black text-slate-800 flex items-center gap-2">
                  <Award className="w-5 h-5 text-amber-500" />
                  <span>لوحة التقييم التحريري ومؤشرات الجودة</span>
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  معايير قياس الأداء المهني، جودة المحتوى، الالتزام بالرانداون وتفاعل الجمهور
                </p>
              </div>

              <button
                type="button"
                onClick={() => setIsAddEvalModalOpen(true)}
                className="flex items-center gap-2 px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded-xl text-xs transition-colors shadow-xs"
              >
                <Plus className="w-4 h-4" />
                <span>إضافة تقييم تحريري جديد</span>
              </button>
            </div>

            {/* Criteria Progress Bars */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 pt-6">
              <div className="p-4 bg-slate-50 rounded-xl space-y-2 border border-slate-100">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-600 font-medium">جودة الإعداد والتحرير</span>
                  <strong className="text-slate-900 font-mono">{ratingSummary.criteriaAverages.editorialQuality} / 5</strong>
                </div>
                <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-600 rounded-full"
                    style={{ width: `${(ratingSummary.criteriaAverages.editorialQuality / 5) * 100}%` }}
                  />
                </div>
              </div>

              <div className="p-4 bg-slate-50 rounded-xl space-y-2 border border-slate-100">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-600 font-medium">الانضباط الزمني والرانداون</span>
                  <strong className="text-slate-900 font-mono">{ratingSummary.criteriaAverages.timeCommitment} / 5</strong>
                </div>
                <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-600 rounded-full"
                    style={{ width: `${(ratingSummary.criteriaAverages.timeCommitment / 5) * 100}%` }}
                  />
                </div>
              </div>

              <div className="p-4 bg-slate-50 rounded-xl space-y-2 border border-slate-100">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-600 font-medium">مستوى الضيوف والنقاش</span>
                  <strong className="text-slate-900 font-mono">{ratingSummary.criteriaAverages.guestRelevance} / 5</strong>
                </div>
                <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-purple-600 rounded-full"
                    style={{ width: `${(ratingSummary.criteriaAverages.guestRelevance / 5) * 100}%` }}
                  />
                </div>
              </div>

              <div className="p-4 bg-slate-50 rounded-xl space-y-2 border border-slate-100">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-600 font-medium">الإخراج البصري والغرافيك</span>
                  <strong className="text-slate-900 font-mono">{ratingSummary.criteriaAverages.visualDirection} / 5</strong>
                </div>
                <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber-500 rounded-full"
                    style={{ width: `${(ratingSummary.criteriaAverages.visualDirection / 5) * 100}%` }}
                  />
                </div>
              </div>

              <div className="p-4 bg-slate-50 rounded-xl space-y-2 border border-slate-100">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-600 font-medium">التفاعل وريتنج المشاهدة</span>
                  <strong className="text-slate-900 font-mono">{ratingSummary.criteriaAverages.viewerEngagement} / 5</strong>
                </div>
                <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-rose-500 rounded-full"
                    style={{ width: `${(ratingSummary.criteriaAverages.viewerEngagement / 5) * 100}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Evaluations History List */}
          <div className="space-y-4">
            <h3 className="text-sm font-bold text-slate-700">
              سجل التقييمات التحريرية السابقة ({evaluations.length})
            </h3>

            {evaluations.length === 0 ? (
              <div className="bg-white p-8 rounded-2xl border border-slate-200 text-center space-y-3">
                <Award className="w-12 h-12 text-slate-300 mx-auto" />
                <h4 className="text-sm font-bold text-slate-700">لا توجد تقييمات مسجلة بعد</h4>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  كن أول من يقيم أداء هذا البرنامج من خلال إضافة التقييم التحريري الأول.
                </p>
                <button
                  type="button"
                  onClick={() => setIsAddEvalModalOpen(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-amber-500 text-slate-950 rounded-xl text-xs font-bold"
                >
                  <Plus className="w-4 h-4" />
                  <span>إضافة تقييم الآن</span>
                </button>
              </div>
            ) : (
              evaluations.map((ev) => (
                <div
                  key={ev.id}
                  className="bg-white p-6 rounded-2xl border border-slate-200 shadow-2xs space-y-4"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center font-bold text-sm">
                        {ev.evaluatorName.charAt(0)}
                      </div>
                      <div>
                        <strong className="block text-sm text-slate-900">{ev.evaluatorName}</strong>
                        <span className="text-xs text-slate-500">{ev.evaluatorRole}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1 text-amber-400">
                        {[1, 2, 3, 4, 5].map((s) => (
                          <Star
                            key={s}
                            className={`w-4 h-4 ${
                              s <= Math.round(ev.overallRating)
                                ? 'fill-amber-400 text-amber-400'
                                : 'text-slate-300'
                            }`}
                          />
                        ))}
                      </div>
                      <span className="text-sm font-black text-slate-900 font-mono">
                        {ev.overallRating} / 5
                      </span>
                      <span className="text-xs text-slate-400">
                        {new Date(ev.evaluatedAt).toLocaleDateString('ar-EG')}
                      </span>
                    </div>
                  </div>

                  {/* Notes */}
                  {ev.notes && (
                    <p className="text-xs sm:text-sm text-slate-700 bg-slate-50 p-3.5 rounded-xl border border-slate-100 leading-relaxed">
                      {ev.notes}
                    </p>
                  )}

                  {/* Strengths & Improvements */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 text-xs">
                    {ev.strengths && ev.strengths.length > 0 && (
                      <div className="p-3 bg-emerald-50/60 border border-emerald-200/60 rounded-xl space-y-1.5">
                        <strong className="text-emerald-900 block font-bold flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          نقاط القوة والتميز:
                        </strong>
                        <ul className="list-disc list-inside text-emerald-800 space-y-1 text-[11px]">
                          {ev.strengths.map((str, i) => (
                            <li key={i}>{str}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {ev.improvements && ev.improvements.length > 0 && (
                      <div className="p-3 bg-amber-50/60 border border-amber-200/60 rounded-xl space-y-1.5">
                        <strong className="text-amber-900 block font-bold flex items-center gap-1.5">
                          <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
                          فرص التحسين الموصى بها:
                        </strong>
                        <ul className="list-disc list-inside text-amber-800 space-y-1 text-[11px]">
                          {ev.improvements.map((imp, i) => (
                            <li key={i}>{imp}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
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
                      <span className="text-slate-400">تاريخ ووقت البث:</span>
                      <strong className="text-slate-800 font-mono">
                        {ep.broadcastDate} | {ep.startTime}
                      </strong>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">المقدم:</span>
                      <span className="text-slate-800">{ep.presenterName || program.presenterName}</span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">فقرات الرانداون:</span>
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
                هيكل القالب التحريري المعياري للبرنامج (Standard Rundown Template)
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
            {[
              {
                index: 1,
                title: 'شارة البرنامج ومقدمة المذيع الترحيبية (Autocue & Teaser)',
                type: 'شارة ومقدمة',
                duration: '02:30',
                notes: 'استعراض أبرز العناوين وطرح السؤال المحوري مع شاشات الاستوديو.',
              },
              {
                index: 2,
                title: 'تقرير استهلالي مصور (VT Report)',
                type: 'تقرير ميداني',
                duration: '04:00',
                notes: 'تقرير تمهيدي بالصوت والصورة مع المؤثرات والأرقام الإحصائية.',
              },
              {
                index: 3,
                title: 'المحور الأول: مناقشة في الاستوديو مع الضيف الرئيسي',
                type: 'حوار استوديو',
                duration: '12:30',
                notes: 'تفكيك الموضوع المحوري ومواجهة الضيف بالوثائق والمعطيات.',
              },
              {
                index: 4,
                title: 'فاصل إعلاني وموجز أنباء سريع',
                type: 'فاصل تجاري',
                duration: '03:00',
                notes: 'شريط الأخبار العاجلة وبرومو البرامج التالية.',
              },
              {
                index: 5,
                title: 'المحور الثاني: مداخلة عبر الأقمار الصناعية ومشاركة الجمهور',
                type: 'مداخلة أقمار / زووم',
                duration: '15:00',
                notes: 'توسيع دائرة النقاش بمحلل إقليمي واستعراض تفاعلات وسائل التواصل.',
              },
              {
                index: 6,
                title: 'خلاصة الحلقة، التوصيات، والوداع الموسيقي (Outro)',
                type: 'خاتمة وتتر',
                duration: '03:00',
                notes: 'شكر الضيوف، التنويه بموضوع الحلقة القادمة، وظهور أسماء فريق العمل.',
              },
            ].map((seg) => (
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
            { role: 'مقدم ومحاور رئيسي', name: program.presenterName, dept: 'إدارة التقديم والمذيعين' },
            { role: 'المنتج المنفذ', name: program.producerName, dept: 'إدارة الإنتاج البرامجي' },
            { role: 'المخرج التلفزيوني', name: 'هاني بن رضوان', dept: 'الإخراج الفني وغرفة التحكم (PCR)' },
            { role: 'رئيس فريق الإعداد', name: 'طارق الهاشمي', dept: 'غرفة الأخبار والتحرير' },
            { role: 'مسؤول المونتاج والمكتبة', name: 'عمر الدوسري', dept: 'المكتبة الرقمية والأرشيف' },
            { role: 'مهندس الإضاءة والصوت', name: 'أحمد كمال', dept: 'العمليات الفنية والهندسية' },
          ].map((member, idx) => (
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
                <p className="text-xs text-slate-400 truncate">{member.dept}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* MODAL: ADD PROGRAM EVALUATION */}
      {isAddEvalModalOpen && (
        <Modal
          isOpen={isAddEvalModalOpen}
          onClose={() => setIsAddEvalModalOpen(false)}
          title={`إضافة تقييم تحريري: ${program.name}`}
          size="lg"
        >
          <form onSubmit={handleAddEvaluationSubmit} className="space-y-5">
            {/* Overall Rating Selection */}
            <div className="p-4 bg-amber-50/70 border border-amber-200 rounded-2xl text-center space-y-2">
              <span className="text-xs font-bold text-amber-900 block">
                التقييم التحريري الإجمالي للبرنامج
              </span>
              <div className="flex items-center justify-center gap-2">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setEvalRating(star)}
                    className="p-1.5 focus:outline-hidden transition-transform hover:scale-110"
                  >
                    <Star
                      className={`w-7 h-7 ${
                        star <= evalRating
                          ? 'fill-amber-400 text-amber-400'
                          : 'text-slate-300'
                      }`}
                    />
                  </button>
                ))}
              </div>
              <span className="text-xs font-mono font-bold text-amber-900">
                {evalRating} من 5 نجوم
              </span>
            </div>

            {/* Criteria Detailed Sliders */}
            <div className="space-y-3 pt-2">
              <span className="text-xs font-bold text-slate-700 block">
                تقييم معايير الجودة الخمسة (من 1 إلى 5):
              </span>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="p-3 bg-slate-50 rounded-xl space-y-1.5">
                  <div className="flex justify-between">
                    <label className="text-slate-700 font-medium">جودة الإعداد والبحث الصحفي:</label>
                    <strong className="font-mono">{editorialQuality}/5</strong>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="5"
                    step="1"
                    value={editorialQuality}
                    onChange={(e) => setEditorialQuality(Number(e.target.value))}
                    className="w-full accent-blue-600"
                  />
                </div>

                <div className="p-3 bg-slate-50 rounded-xl space-y-1.5">
                  <div className="flex justify-between">
                    <label className="text-slate-700 font-medium">الانضباط الزمني ومخطط الرانداون:</label>
                    <strong className="font-mono">{timeCommitment}/5</strong>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="5"
                    step="1"
                    value={timeCommitment}
                    onChange={(e) => setTimeCommitment(Number(e.target.value))}
                    className="w-full accent-emerald-600"
                  />
                </div>

                <div className="p-3 bg-slate-50 rounded-xl space-y-1.5">
                  <div className="flex justify-between">
                    <label className="text-slate-700 font-medium">مستوى وخبرة الضيوف:</label>
                    <strong className="font-mono">{guestRelevance}/5</strong>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="5"
                    step="1"
                    value={guestRelevance}
                    onChange={(e) => setGuestRelevance(Number(e.target.value))}
                    className="w-full accent-purple-600"
                  />
                </div>

                <div className="p-3 bg-slate-50 rounded-xl space-y-1.5">
                  <div className="flex justify-between">
                    <label className="text-slate-700 font-medium">الإخراج البصري والغرافيك:</label>
                    <strong className="font-mono">{visualDirection}/5</strong>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="5"
                    step="1"
                    value={visualDirection}
                    onChange={(e) => setVisualDirection(Number(e.target.value))}
                    className="w-full accent-amber-500"
                  />
                </div>

                <div className="p-3 bg-slate-50 rounded-xl space-y-1.5 sm:col-span-2">
                  <div className="flex justify-between">
                    <label className="text-slate-700 font-medium">تفاعل الجمهور وريتنج المشاهدة:</label>
                    <strong className="font-mono">{viewerEngagement}/5</strong>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="5"
                    step="1"
                    value={viewerEngagement}
                    onChange={(e) => setViewerEngagement(Number(e.target.value))}
                    className="w-full accent-rose-500"
                  />
                </div>
              </div>
            </div>

            {/* Strengths & Improvements */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  أبرز نقاط القوة والتميز (سطر لكل نقطة):
                </label>
                <textarea
                  rows={3}
                  value={evalStrengths}
                  onChange={(e) => setEvalStrengths(e.target.value)}
                  placeholder="مثال: حوار متوازن، مقدمة قوية، ربط ممتاز بين الفقرات..."
                  className="w-full p-2.5 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  فرص وتوصيات التحسين (سطر لكل نقطة):
                </label>
                <textarea
                  rows={3}
                  value={evalImprovements}
                  onChange={(e) => setEvalImprovements(e.target.value)}
                  placeholder="مثال: ضرورة توفير مقتطفات فيديو للمنصات، الالتزام بوقت الفاصل..."
                  className="w-full p-2.5 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* General Notes */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                التقرير والتقييم التحريري العام:
              </label>
              <textarea
                rows={3}
                value={evalNotes}
                onChange={(e) => setEvalNotes(e.target.value)}
                placeholder="اكتب خلاصة تقييمك لأداء البرنامج أو الحلقة وتوجيهاتك لفريق العمل..."
                className="w-full p-2.5 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsAddEvalModalOpen(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
              >
                إلغاء
              </button>
              <button
                type="submit"
                className="px-5 py-2 text-xs font-bold text-slate-950 bg-amber-500 hover:bg-amber-600 rounded-xl transition-all shadow-xs flex items-center gap-1.5"
              >
                <Check className="w-4 h-4" />
                <span>حفظ التقييم واعتماده</span>
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};
