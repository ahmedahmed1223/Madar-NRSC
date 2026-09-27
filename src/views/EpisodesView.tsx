import { ExportMenu, docContext } from '../components/common/ExportMenu';
import { episodesScheduleDoc } from '../services/documents/builders';
import { FormPage } from '../components/common/FormPage';
import { studioConflictsFor } from '../shared/schedule';
import { localDateString } from '../shared/dates';
import { RbacService } from '../services/rbacService';
import React, { useState } from 'react';
import {
  Plus,
  Video,
  Calendar,
  Clock,
  User as UserIcon,
  Search,
  SlidersHorizontal,
  ChevronRight,
  ListOrdered,
  Users,
  CheckCircle2,
  Tv,
  Trash2,
  X,
  Sparkles,
} from 'lucide-react';
import { Episode, Program, EpisodeStatus, User } from '../types';
import { newId } from '../shared/ids';
import { structureFromTemplate, templateFromEpisode } from '../shared/episodePlan';
import { Badge } from '../components/common/Badge';
import { Modal } from '../components/common/Modal';

interface EpisodesViewProps {
  episodes: Episode[];
  programs: Program[];
  currentUser: User;
  onSelectEpisode: (episodeId: string) => void;
  onSaveEpisode: (episode: Partial<Episode>) => void;
  filterProgramId?: string | null;
  onDeleteEpisode?: (episodeId: string) => void;
}

export const EpisodesView: React.FC<EpisodesViewProps> = ({
  episodes = [],
  programs = [],
  currentUser,
  onSelectEpisode,
  onSaveEpisode,
  filterProgramId,
  onDeleteEpisode,
}) => {
  const canCreate = RbacService.hasPermission(currentUser, 'episodes.create');
  const canDelete = RbacService.hasPermission(currentUser, 'episodes.edit') || RbacService.hasPermission(currentUser, 'programs.manage');
  const [selectedProgId, setSelectedProgId] = useState(filterProgramId || 'ALL');
  const [selectedStatus, setSelectedStatus] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // Form states for new episode
  const [programId, setProgramId] = useState(programs[0]?.id || '');
  const [title, setTitle] = useState('');
  const [episodeNumber, setEpisodeNumber] = useState(1);
  const [seasonNumber, setSeasonNumber] = useState(1);
  const [broadcastDate, setBroadcastDate] = useState(localDateString());
  const [startTime, setStartTime] = useState('21:00');
  const [endTime, setEndTime] = useState('21:50');
  const [durationMinutes, setDurationMinutes] = useState(50);
  const [presenterName, setPresenterName] = useState(currentUser.fullName);
  const [producerName, setProducerName] = useState(currentUser.fullName);
  const [studioName, setStudioName] = useState('');

  // Episode numbers run per program (next = highest number in that program + 1).
  const nextEpisodeNumber = (progId: string) =>
    episodes.filter((e) => e.programId === progId).reduce((max, e) => Math.max(max, Number(e.episodeNumber) || 0), 0) + 1;

  const selectProgramForNew = (progId: string) => {
    const prog = programs.find((p) => p.id === progId);
    setProgramId(progId);
    setEpisodeNumber(nextEpisodeNumber(progId));
    const prev = episodes.filter((e) => e.programId === progId && (e.rundown || []).length > 0).sort((a, b) => (b.broadcastDate || '').localeCompare(a.broadcastDate || ''));
    setCopyFromId(prev[0]?.id || '');
    setStartMode(prog?.template?.segments.length ? 'TEMPLATE' : 'BLANK');
    if (prog) {
      setStudioName(prog.studioName || '');
      setPresenterName(prog.presenterName || currentUser.fullName);
      setProducerName(prog.producerName || currentUser.fullName);
      setDurationMinutes(prog.durationMinutes || 50);
    }
  };
  const [description, setDescription] = useState('');
  // How the new episode's structure starts: the program template, a copy of an earlier episode, or blank.
  const [startMode, setStartMode] = useState<'TEMPLATE' | 'COPY' | 'BLANK'>('BLANK');
  const [copyFromId, setCopyFromId] = useState('');
  const programTemplate = programs.find((p) => p.id === programId)?.template;
  const previousEpisodes = episodes
    .filter((e) => e.programId === programId && (e.rundown || []).length > 0)
    .sort((a, b) => (b.broadcastDate || '').localeCompare(a.broadcastDate || ''));


  const DURATION_PRESETS = [30, 45, 50, 60, 90];

  const calculateEndTime = (start: string, durationMin: number) => {
    try {
      const [h, m] = start.split(':').map(Number);
      if (isNaN(h) || isNaN(m)) return start;
      const totalMin = h * 60 + m + durationMin;
      const endH = Math.floor(totalMin / 60) % 24;
      const endM = totalMin % 60;
      return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
    } catch {
      return start;
    }
  };

  const handleDurationChange = (minutes: number) => {
    setDurationMinutes(minutes);
    setEndTime(calculateEndTime(startTime, minutes));
  };

  const handleStartTimeChange = (newStart: string) => {
    setStartTime(newStart);
    setEndTime(calculateEndTime(newStart, durationMinutes));
  };

  const statusBadgeInfo: Record<EpisodeStatus, { label: string; variant: 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'purple' | 'default' }> = {
    PLANNING: { label: 'مرحلة التخطيط', variant: 'default' },
    IN_PREPARATION: { label: 'قيد الإعداد والتحرير', variant: 'warning' },
    PREPARING: { label: 'تجهيز المحتوى', variant: 'warning' },
    READY: { label: 'جاهز للتسجيل', variant: 'info' },
    RECORDING: { label: 'جاري التسجيل', variant: 'danger' },
    RECORDED: { label: 'تم التسجيل', variant: 'purple' },
    EDITING: { label: 'المونتاج والمكساج', variant: 'info' },
    READY_FOR_BROADCAST: { label: 'جاهز للبث المباشر', variant: 'success' },
    ON_AIR: { label: 'على الهواء مباشرة', variant: 'danger' },
    BROADCASTED: { label: 'تم البث بنجاح', variant: 'primary' },
    ARCHIVED: { label: 'مؤرشفة', variant: 'default' },
    CANCELLED: { label: 'ملغاة', variant: 'danger' },
  };

  const handleOpenAdd = () => {
    setTitle('');
    const defaultProgram =
      (filterProgramId && filterProgramId !== 'ALL' && filterProgramId) ||
      (selectedProgId !== 'ALL' && selectedProgId) ||
      programs[0]?.id ||
      '';
    selectProgramForNew(defaultProgram);
    setSeasonNumber(1);
    setBroadcastDate(localDateString());
    setStartTime('21:00');
    setEndTime('21:50');
    setDescription('');
    setIsAddModalOpen(true);
  };

  const handleCreateEpisode = (e: React.FormEvent) => {
    e.preventDefault();
    const selProg = programs.find((p) => p.id === programId);
    const clashes = studioConflictsFor(
      { id: '__new__', studioName: studioName || selProg?.studioName, broadcastDate, startTime, endTime, durationMinutes: Number(durationMinutes) || 50 },
      episodes
    );
    if (
      clashes.length > 0 &&
      !window.confirm(
        `تنبيه تعارض استوديو: الموعد يتداخل مع ${clashes
          .map((c) => `«${c.programName} – ${c.title}» (${c.startTime}–${c.endTime})`)
          .join('، ')}. هل تريد الحفظ رغم ذلك؟`
      )
    ) {
      return;
    }

    const id = newId('ep');
    const source =
      startMode === 'TEMPLATE' && programTemplate
        ? programTemplate
        : startMode === 'COPY' && previousEpisodes.find((e) => e.id === copyFromId)
        ? templateFromEpisode(previousEpisodes.find((e) => e.id === copyFromId))
        : null;
    const structure = source ? structureFromTemplate(source, id, newId, presenterName || selProg?.presenterName) : { topics: [], rundown: [] };

    onSaveEpisode({
      id,
      programId,
      programName: selProg?.name || '',
      title: title || `الحلقة ${episodeNumber}`,
      episodeNumber: Number(episodeNumber) || 1,
      seasonNumber: Number(seasonNumber) || 1,
      broadcastDate,
      startTime,
      endTime,
      durationMinutes: Number(durationMinutes) || 50,
      presenterName: presenterName || selProg?.presenterName,
      producerName: producerName || selProg?.producerName,
      studioName: studioName || selProg?.studioName,
      description,
      status: 'PLANNING',
      topics: structure.topics,
      rundown: structure.rundown,
    });

    setIsAddModalOpen(false);
  };

  const filteredEpisodes = (episodes || []).filter((ep) => {
    if (selectedProgId !== 'ALL' && ep.programId !== selectedProgId) return false;
    if (selectedStatus !== 'ALL' && ep.status !== selectedStatus) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return ep.title.toLowerCase().includes(q) || ep.programName.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-800 tracking-tight">
            حلقات البرامج التلفزيونية
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            إعداد الحلقات، تنظيم محاور الحوار، جداول الرانداون، وتنسيق الضيوف
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
        <ExportMenu
          items={[
            {
              id: 'schedule',
              label: 'جدول بث الحلقات المعروضة',
              hint: `${filteredEpisodes.length} حلقة حسب البرنامج والحالة والبحث`,
              build: () => episodesScheduleDoc(filteredEpisodes, selectedProgId === 'ALL' ? 'كل البرامج' : programs.find((p) => p.id === selectedProgId)?.name || '', docContext()),
            },
          ]}
        />
        {canCreate && (
        <button
          type="button"
          onClick={handleOpenAdd}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          إعداد حلقة جديدة
        </button>
        )}
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            id="episodes-search-input"
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="بحث بعنوان الحلقة أو البرنامج..."
            autoComplete="off"
            spellCheck="false"
            className="w-full pr-10 pl-8 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
              aria-label="مسح البحث"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto">
          <div className="flex items-center gap-1.5 text-xs text-slate-600">
            <label htmlFor="episodes-program-filter" className="font-medium">البرنامج:</label>
            <select
              id="episodes-program-filter"
              value={selectedProgId}
              onChange={(e) => setSelectedProgId(e.target.value)}
              className="px-3.5 py-2.5 border border-slate-300 rounded-xl text-xs bg-white text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-semibold transition-all"
            >
              <option value="ALL">جميع البرامج ({programs.length})</option>
              {programs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5 text-xs text-slate-600">
            <label htmlFor="episodes-status-filter" className="font-medium">الحالة:</label>
            <select
              id="episodes-status-filter"
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="px-3.5 py-2.5 border border-slate-300 rounded-xl text-xs bg-white text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-semibold transition-all"
            >
              <option value="ALL">جميع الحالات</option>
              <option value="PLANNING">تخطيط</option>
              <option value="IN_PREPARATION">قيد الإعداد</option>
              <option value="READY_FOR_BROADCAST">جاهز للبث</option>
              <option value="BROADCASTED">تم البث</option>
            </select>
          </div>
        </div>
      </div>

      {/* Episodes Table */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-600 font-bold">
                <th className="py-3.5 px-4">عنوان الحلقة والبرنامج</th>
                <th className="py-3.5 px-3">رقم الحلقة / الموسم</th>
                <th className="py-3.5 px-3">تاريخ وموعد البث</th>
                <th className="py-3.5 px-3">المقدم / المنتج</th>
                <th className="py-3.5 px-3 text-center">فقرات الرانداون</th>
                <th className="py-3.5 px-3 text-center">الضيوف</th>
                <th className="py-3.5 px-3">حالة الحلقة</th>
                <th className="py-3.5 px-4 text-center w-36">إدارة الحلقة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {filteredEpisodes.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    لا توجد حلقات مطابقة لمعايير البحث. انقر على "إعداد حلقة جديدة" لبدء العمل.
                  </td>
                </tr>
              ) : (
                filteredEpisodes.map((ep) => {
                  const sInfo = statusBadgeInfo[ep.status] || { label: ep.status, variant: 'default' };
                  const rundownCount = ep.rundown?.length || 0;
                  const guestsCount = ep.guests?.length || 0;

                  return (
                    <tr key={ep.id} className="hover:bg-slate-50/80 transition-colors">
                      {/* Title & Program */}
                      <td className="py-3.5 px-4">
                        <div
                          onClick={() => onSelectEpisode(ep.id)}
                          className="font-bold text-slate-800 hover:text-blue-600 cursor-pointer block leading-snug"
                        >
                          {ep.title}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-500">
                          <span className="font-semibold text-blue-700">{ep.programName}</span>
                          <span>•</span>
                          <span>{ep.studioName}</span>
                        </div>
                      </td>

                      {/* Numbers */}
                      <td className="py-3.5 px-3 font-mono text-slate-600 font-semibold">
                        ح #{ep.episodeNumber} (م {ep.seasonNumber})
                      </td>

                      {/* Air date & time */}
                      <td className="py-3.5 px-3">
                        <div className="font-mono text-slate-700">
                          <div>{ep.broadcastDate}</div>
                          <div className="text-[11px] text-slate-400">
                            {ep.startTime} - {ep.endTime}
                          </div>
                        </div>
                      </td>

                      {/* Team */}
                      <td className="py-3.5 px-3 text-[11px]">
                        <div>تقديم: <strong className="text-slate-800">{ep.presenterName}</strong></div>
                        <div className="text-slate-500">إنتاج: {ep.producerName}</div>
                      </td>

                      {/* Rundown count */}
                      <td className="py-3.5 px-3 text-center">
                        <span className="inline-flex items-center gap-1 font-mono font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md">
                          <ListOrdered className="w-3.5 h-3.5" />
                          {rundownCount} فقرة
                        </span>
                      </td>

                      {/* Guests count */}
                      <td className="py-3.5 px-3 text-center">
                        <span className="inline-flex items-center gap-1 font-mono font-semibold text-purple-700 bg-purple-50 px-2 py-0.5 rounded-md">
                          <Users className="w-3.5 h-3.5" />
                          {guestsCount} ضيوف
                        </span>
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-3">
                        <Badge variant={sInfo.variant} size="sm">
                          {sInfo.label}
                        </Badge>
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-center">
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => onSelectEpisode(ep.id)}
                            className="flex-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-xs transition-colors shadow-2xs flex items-center justify-center gap-1"
                          >
                            <span>فتح مساحة العمل</span>
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>

                          {onDeleteEpisode && canDelete && (
                            <button
                              type="button"
                              onClick={() => {
                                if (window.confirm(`هل أنت متأكد من حذف الحلقة: "${ep.title}"؟`)) {
                                  onDeleteEpisode(ep.id);
                                }
                              }}
                              className="p-1.5 text-red-400 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                              title="حذف الحلقة"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Episode Modal */}
      <FormPage
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        title="إعداد وتجهيز حلقة جديدة"
        subtitle="إنشاء حلقة جديدة وتجهيز جدول الرانداون والضيوف"
        maxWidth="2xl"
      >
        <form onSubmit={handleCreateEpisode} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="episode-program-select" className="block text-xs font-bold text-slate-700 mb-1">البرنامج التابع له *</label>
              <select
                id="episode-program-select"
                value={programId}
                onChange={(e) => selectProgramForNew(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
              >
                {programs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="episode-title-input" className="block text-xs font-bold text-slate-700">عنوان موضوع الحلقة *</label>
                {title && (
                  <button
                    type="button"
                    onClick={() => setTitle('')}
                    className="text-[10px] text-slate-400 hover:text-rose-500"
                  >
                    مسح
                  </button>
                )}
              </div>
              <input
                id="episode-title-input"
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="مثال: مستقبل الطاقة المتجددة في الشرق الأوسط"
                className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label htmlFor="episode-number-input" className="block text-xs font-bold text-slate-700 mb-1">رقم الحلقة</label>
              <input
                id="episode-number-input"
                type="number"
                value={episodeNumber}
                onChange={(e) => setEpisodeNumber(Number(e.target.value))}
                min="1"
                inputMode="numeric"
                className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs font-mono text-center text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
              />
            </div>
            <div>
              <label htmlFor="episode-season-input" className="block text-xs font-bold text-slate-700 mb-1">الموسم</label>
              <input
                id="episode-season-input"
                type="number"
                value={seasonNumber}
                onChange={(e) => setSeasonNumber(Number(e.target.value))}
                min="1"
                inputMode="numeric"
                className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs font-mono text-center text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
              />
            </div>
            <div>
              <label htmlFor="episode-start-time-input" className="block text-xs font-bold text-slate-700 mb-1">وقت البدء</label>
              <input
                id="episode-start-time-input"
                type="time"
                value={startTime}
                onChange={(e) => handleStartTimeChange(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs font-mono text-center text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
              />
            </div>
            <div>
              <label htmlFor="episode-duration-input" className="block text-xs font-bold text-slate-700 mb-1">المدة (دقيقة)</label>
              <input
                id="episode-duration-input"
                type="number"
                min="1"
                max="480"
                inputMode="numeric"
                value={durationMinutes}
                onChange={(e) => handleDurationChange(Number(e.target.value))}
                className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs font-mono text-center text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
              />
            </div>
          </div>

          {/* Duration Presets & End Time Calculation */}
          <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-blue-50/70 border border-blue-100 rounded-xl">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-blue-700 font-bold">المدة الموصى بها:</span>
              {DURATION_PRESETS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => handleDurationChange(m)}
                  className={`text-[10px] px-2 py-0.5 rounded-md font-mono transition-all ${
                    durationMinutes === m
                      ? 'bg-blue-600 text-white font-bold shadow-2xs'
                      : 'bg-white text-blue-800 hover:bg-blue-100 border border-blue-200'
                  }`}
                >
                  {m}د
                </button>
              ))}
            </div>
            <div className="text-[11px] text-blue-900 font-medium">
              نهاية البث التقديرية: <strong className="font-mono text-blue-700">{endTime}</strong>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="episode-broadcast-date-input" className="block text-xs font-bold text-slate-700 mb-1">تاريخ البث المقرر</label>
              <input
                id="episode-broadcast-date-input"
                type="date"
                value={broadcastDate}
                onChange={(e) => setBroadcastDate(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs font-mono text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
              />
            </div>
            <div>
              <label htmlFor="episode-studio-input" className="block text-xs font-bold text-slate-700 mb-1">الاستوديو المخصص</label>
              <input
                id="episode-studio-input"
                type="text"
                value={studioName}
                onChange={(e) => setStudioName(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
              />
            </div>
          </div>

          <div>
            <label htmlFor="episode-desc-input" className="block text-xs font-bold text-slate-700 mb-1">مقدمة ووصف الحلقة</label>
            <textarea
              id="episode-desc-input"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="وصف مختصر لمحاور الحلقة الرئيسية ومسار الحوار..."
              className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
            />
          </div>

          <fieldset className="p-3 rounded-xl border border-slate-200 space-y-2">
            <legend className="px-1 text-xs font-bold text-slate-700">بنية الحلقة</legend>
            <div role="radiogroup" aria-label="بنية الحلقة" className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {[
                { id: 'TEMPLATE' as const, name: 'من قالب البرنامج', hint: programTemplate ? `${programTemplate.topics.length} محور · ${programTemplate.segments.length} فقرة` : 'لا يوجد قالب محفوظ لهذا البرنامج', disabled: !programTemplate?.segments.length },
                { id: 'COPY' as const, name: 'نسخ بنية حلقة سابقة', hint: previousEpisodes.length ? 'المحاور والفقرات والمدد بدون الضيوف والأسئلة' : 'لا حلقات سابقة لها رانداون', disabled: previousEpisodes.length === 0 },
                { id: 'BLANK' as const, name: 'حلقة فارغة', hint: 'تبني المحاور والفقرات بنفسك', disabled: false },
              ].map((o) => (
                <button
                  key={o.id}
                  type="button"
                  role="radio"
                  aria-checked={startMode === o.id}
                  disabled={o.disabled}
                  onClick={() => setStartMode(o.id)}
                  className={`p-2.5 rounded-xl border text-right disabled:opacity-50 ${startMode === o.id ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'}`}
                >
                  <span className="block text-xs font-bold">{o.name}</span>
                  <span className={`block text-[10px] ${startMode === o.id ? 'text-blue-100' : 'text-slate-500'}`}>{o.hint}</span>
                </button>
              ))}
            </div>
            {startMode === 'COPY' && (
              <select aria-label="الحلقة المصدر" value={copyFromId} onChange={(e) => setCopyFromId(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs bg-white">
                {previousEpisodes.map((e) => (
                  <option key={e.id} value={e.id}>
                    #{e.episodeNumber} — {e.title} ({e.broadcastDate})
                  </option>
                ))}
              </select>
            )}
          </fieldset>

          <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setIsAddModalOpen(false)}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
            >
              إلغاء
            </button>
            <button
              type="submit"
              className="px-5 py-2 text-xs font-bold bg-blue-600 text-white rounded-xl hover:bg-blue-700 shadow-xs"
            >
              بدء إعداد الحلقة
            </button>
          </div>
        </form>
      </FormPage>
    </div>
  );
};
