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
} from 'lucide-react';
import { Episode, Program, EpisodeStatus, User } from '../types';
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
  const [selectedProgId, setSelectedProgId] = useState(filterProgramId || 'ALL');
  const [selectedStatus, setSelectedStatus] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // Form states for new episode
  const [programId, setProgramId] = useState(programs[0]?.id || '');
  const [title, setTitle] = useState('');
  const [episodeNumber, setEpisodeNumber] = useState(1);
  const [seasonNumber, setSeasonNumber] = useState(1);
  const [broadcastDate, setBroadcastDate] = useState(new Date().toISOString().slice(0, 10));
  const [startTime, setStartTime] = useState('21:00');
  const [endTime, setEndTime] = useState('21:50');
  const [durationMinutes, setDurationMinutes] = useState(50);
  const [presenterName, setPresenterName] = useState(currentUser.fullName);
  const [producerName, setProducerName] = useState(currentUser.fullName);
  const [studioName, setStudioName] = useState('استوديو A1');
  const [description, setDescription] = useState('');

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
    setEpisodeNumber(episodes.length + 1);
    setSeasonNumber(1);
    setBroadcastDate(new Date().toISOString().slice(0, 10));
    setStartTime('21:00');
    setEndTime('21:50');
    setDurationMinutes(50);
    setDescription('');
    setIsAddModalOpen(true);
  };

  const handleCreateEpisode = (e: React.FormEvent) => {
    e.preventDefault();
    const selProg = programs.find((p) => p.id === programId);

    onSaveEpisode({
      programId,
      programName: selProg?.name || 'البرنامج العام',
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
      rundown: [
        {
          id: `seg-${Date.now()}-1`,
          episodeId: 'temp',
          orderIndex: 1,
          title: 'شارة البداية والمقدمة الترحيبية',
          segmentType: 'INTRO',
          startTimeOffset: '00:00:00',
          durationSeconds: 120,
          endTimeOffset: '00:02:00',
          presenterName: presenterName || selProg?.presenterName,
          scriptText: 'أهلاً بكم مشاهدينا الكرام في حلقة جديدة نتناول فيها أبرز المستجدات...',
          notes: 'كاميرا 1 مع الشارة الموسيقية',
          isCompleted: false,
        },
      ],
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

        <button
          type="button"
          onClick={handleOpenAdd}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          إعداد حلقة جديدة
        </button>
      </div>

      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="بحث بعنوان الحلقة أو البرنامج..."
            className="w-full pr-9 pl-4 py-2 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto">
          <div className="flex items-center gap-1 text-xs text-slate-600">
            <span>البرنامج:</span>
            <select
              value={selectedProgId}
              onChange={(e) => setSelectedProgId(e.target.value)}
              className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white focus:ring-2 focus:ring-blue-500"
            >
              <option value="ALL">جميع البرامج</option>
              {programs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1 text-xs text-slate-600">
            <span>الحالة:</span>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white focus:ring-2 focus:ring-blue-500"
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

                          {onDeleteEpisode && (
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
      <Modal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        title="إعداد وتجهيز حلقة جديدة"
        subtitle="إنشاء حلقة جديدة وتجهيز جدول الرانداون والضيوف"
        maxWidth="2xl"
      >
        <form onSubmit={handleCreateEpisode} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">البرنامج التابع له *</label>
              <select
                value={programId}
                onChange={(e) => setProgramId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white focus:ring-2 focus:ring-blue-500"
              >
                {programs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">عنوان موضوع الحلقة *</label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="مثال: مستقبل الطاقة المتجددة في الشرق الأوسط"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">رقم الحلقة</label>
              <input
                type="number"
                value={episodeNumber}
                onChange={(e) => setEpisodeNumber(Number(e.target.value))}
                min="1"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono text-center focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">الموسم</label>
              <input
                type="number"
                value={seasonNumber}
                onChange={(e) => setSeasonNumber(Number(e.target.value))}
                min="1"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono text-center focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">وقت البدء</label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono text-center focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">المدة (دقيقة)</label>
              <input
                type="number"
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(Number(e.target.value))}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono text-center focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">تاريخ البث المقرر</label>
              <input
                type="date"
                value={broadcastDate}
                onChange={(e) => setBroadcastDate(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">الاستوديو المخصص</label>
              <input
                type="text"
                value={studioName}
                onChange={(e) => setStudioName(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">مقدمة ووصف الحلقة</label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="وصف مختصر لمحاور الحلقة الرئيسية..."
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setIsAddModalOpen(false)}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
            >
              إلغاء
            </button>
            <button
              type="submit"
              className="px-5 py-2 text-xs font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-xs"
            >
              بدء إعداد الحلقة
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
