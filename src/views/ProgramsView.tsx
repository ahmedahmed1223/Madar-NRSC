import React, { useState } from 'react';
import {
  Plus,
  Tv,
  Calendar,
  Clock,
  User as UserIcon,
  Video,
  Edit2,
  Trash2,
  Search,
  Users,
  CheckCircle2,
  Star,
  Eye,
} from 'lucide-react';
import { Program, ProgramType, User } from '../types';
import { Badge } from '../components/common/Badge';
import { Modal } from '../components/common/Modal';
import { apiService } from '../services/api';

interface ProgramsViewProps {
  programs: Program[];
  programTypes: ProgramType[];
  currentUser: User;
  onSaveProgram: (program: Partial<Program>) => void;
  onSelectProgramEpisodes: (programId: string) => void;
  onSelectProgram?: (programId: string) => void;
  onDeleteProgram?: (programId: string) => void;
}

export const ProgramsView: React.FC<ProgramsViewProps> = ({
  programs = [],
  programTypes = [],
  currentUser,
  onSaveProgram,
  onSelectProgramEpisodes,
  onSelectProgram,
  onDeleteProgram,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState('ALL');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProgram, setEditingProgram] = useState<Program | null>(null);

  // Form states
  const [name, setName] = useState('');
  const [shortName, setShortName] = useState('');
  const [description, setDescription] = useState('');
  const [typeId, setTypeId] = useState(programTypes[0]?.id || '');
  const [presenterName, setPresenterName] = useState(currentUser.fullName);
  const [producerName, setProducerName] = useState(currentUser.fullName);
  const [broadcastDays, setBroadcastDays] = useState<string[]>(['الأحد']);
  const [broadcastTime, setBroadcastTime] = useState('20:00');
  const [durationMinutes, setDurationMinutes] = useState(50);
  const [channelName, setChannelName] = useState('القناة الإخبارية الأولى');
  const [studioName, setStudioName] = useState('استوديو الأخبار الرئيسي (A1)');
  const [coverImageUrl, setCoverImageUrl] = useState('');

  const daysOfWeek = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];

  const handleOpenAddModal = () => {
    setEditingProgram(null);
    setName('');
    setShortName('');
    setDescription('');
    setTypeId(programTypes[0]?.id || '');
    setPresenterName(currentUser.fullName);
    setProducerName(currentUser.fullName);
    setBroadcastDays(['الأحد']);
    setBroadcastTime('20:00');
    setDurationMinutes(50);
    setChannelName('القناة الإخبارية الأولى');
    setStudioName('استوديو الأخبار الرئيسي (A1)');
    setCoverImageUrl('https://images.unsplash.com/photo-1585829365295-ab7cd400c167?auto=format&fit=crop&w=800&q=80');
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (prog: Program) => {
    setEditingProgram(prog);
    setName(prog.name);
    setShortName(prog.shortName);
    setDescription(prog.description);
    setTypeId(prog.typeId);
    setPresenterName(prog.presenterName);
    setProducerName(prog.producerName);
    setBroadcastDays(prog.broadcastDays);
    setBroadcastTime(prog.broadcastTime);
    setDurationMinutes(prog.durationMinutes);
    setChannelName(prog.channelName);
    setStudioName(prog.studioName);
    setCoverImageUrl(prog.coverImageUrl || '');
    setIsModalOpen(true);
  };

  const handleToggleDay = (day: string) => {
    if (broadcastDays.includes(day)) {
      if (broadcastDays.length > 1) {
        setBroadcastDays(broadcastDays.filter((d) => d !== day));
      }
    } else {
      setBroadcastDays([...broadcastDays, day]);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const typeObj = programTypes.find((t) => t.id === typeId);

    onSaveProgram({
      id: editingProgram?.id,
      name,
      shortName: shortName || name,
      description,
      typeId,
      typeName: typeObj?.name || 'نشرة إخبارية',
      presenterName,
      producerName,
      broadcastDays,
      broadcastTime,
      durationMinutes: Number(durationMinutes) || 50,
      channelName,
      studioName,
      coverImageUrl: coverImageUrl || 'https://images.unsplash.com/photo-1585829365295-ab7cd400c167?auto=format&fit=crop&w=800&q=80',
    });

    setIsModalOpen(false);
  };

  const filteredPrograms = (programs || []).filter((p) => {
    if (selectedType !== 'ALL' && p.typeId !== selectedType) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        p.presenterName.toLowerCase().includes(q) ||
        p.producerName.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-800 tracking-tight">
            البرامج التلفزيونية والإذاعية
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            دليل وإدارة خريطة البرامج، طواقم العمل، ومواعيد البث والاستوديوهات
          </p>
        </div>

        <button
          type="button"
          onClick={handleOpenAddModal}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          إضافة برنامج جديد
        </button>
      </div>

      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="بحث بالاسم، مقدم البرنامج، أو المنتج..."
            className="w-full pr-9 pl-4 py-2 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <span className="text-xs text-slate-500 shrink-0">نوع البرنامج:</span>
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-xl text-xs bg-white focus:ring-2 focus:ring-blue-500 w-full sm:w-auto"
          >
            <option value="ALL">جميع الأنواع</option>
            {programTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Programs Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredPrograms.map((prog) => {
          const rating = apiService.getProgramRatingSummary(prog.id);
          return (
            <div
              key={prog.id}
              className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden flex flex-col hover:shadow-md transition-all group"
            >
              {/* Cover image & badges */}
              <div
                className="relative h-44 overflow-hidden bg-slate-900 cursor-pointer"
                onClick={() => onSelectProgram && onSelectProgram(prog.id)}
                title="اضغط لفتح شاشة البرنامج والتقييم"
              >
                <img
                  src={prog.coverImageUrl}
                  alt={prog.name}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/40 to-transparent" />
                <div className="absolute top-3 right-3 flex items-center gap-2">
                  <Badge variant="primary" size="sm">
                    {prog.typeName}
                  </Badge>
                  <span className="flex items-center gap-1 bg-slate-900/80 backdrop-blur-md px-2 py-0.5 rounded-lg text-amber-400 text-[11px] font-mono font-bold border border-amber-400/30">
                    <Star className="w-3 h-3 fill-amber-400" />
                    {rating.average}
                  </span>
                </div>
                <div className="absolute bottom-3 right-3 left-3 text-white">
                  <h3 className="text-lg font-bold leading-tight hover:text-blue-300 transition-colors">
                    {prog.name}
                  </h3>
                  <span className="text-xs text-slate-300 font-mono">
                    {prog.broadcastTime} | {prog.durationMinutes} دقيقة
                  </span>
                </div>
              </div>

              {/* Content Details */}
              <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
                <p className="text-xs text-slate-600 leading-relaxed line-clamp-2">
                  {prog.description}
                </p>

                <div className="space-y-2 pt-3 border-t border-slate-100 text-xs text-slate-600">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">المقدم:</span>
                    <strong className="text-slate-800">{prog.presenterName}</strong>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">المنتج المنفذ:</span>
                    <strong className="text-slate-800">{prog.producerName}</strong>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">الاستوديو:</span>
                    <span className="text-slate-700">{prog.studioName}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">أيام البث:</span>
                    <span className="font-semibold text-blue-700">{prog.broadcastDays.join('، ')}</span>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="pt-3 border-t border-slate-100 space-y-2">
                  <button
                    type="button"
                    onClick={() => onSelectProgram ? onSelectProgram(prog.id) : onSelectProgramEpisodes(prog.id)}
                    className="w-full py-2.5 px-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs transition-colors flex items-center justify-center gap-2 shadow-xs"
                  >
                    <Eye className="w-4 h-4" />
                    <span>شاشة البرنامج والتقييم</span>
                    <span className="bg-blue-800/80 text-amber-300 font-mono px-2 py-0.5 rounded-lg text-[10px] flex items-center gap-1">
                      <Star className="w-2.5 h-2.5 fill-amber-300" />
                      {rating.average} / 5
                    </span>
                  </button>

                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => onSelectProgramEpisodes(prog.id)}
                      className="flex-1 py-2 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition-colors flex items-center justify-center gap-1.5"
                    >
                      <Video className="w-3.5 h-3.5 text-slate-500" />
                      <span>الحلقات ({prog.episodesCount || 0})</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleOpenEditModal(prog)}
                      className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors"
                      title="تعديل بيانات البرنامج"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>

                    {onDeleteProgram && (
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm(`هل أنت متأكد من حذف البرنامج: "${prog.name}"؟`)) {
                            onDeleteProgram(prog.id);
                          }
                        }}
                        className="p-2 text-red-400 hover:text-red-700 hover:bg-red-50 rounded-xl transition-colors"
                        title="حذف البرنامج"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Program Add / Edit Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingProgram ? 'تعديل بيانات البرنامج' : 'إضافة برنامج تلفزيوني جديد'}
        subtitle="تحديد معلومات البرنامج والمسؤولين ومواعيد البث"
        maxWidth="2xl"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">اسم البرنامج *</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="مثال: المشهد السياسي، نبض الاقتصاد"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">نوع البرنامج</label>
              <select
                value={typeId}
                onChange={(e) => setTypeId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white focus:ring-2 focus:ring-blue-500"
              >
                {programTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">وصف ورؤية البرنامج</label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="وصف موجز لطبيعة البرنامج وأهدافه التحريرية..."
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">مقدم البرنامج الرئيسي</label>
              <input
                type="text"
                value={presenterName}
                onChange={(e) => setPresenterName(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">المنتج المنفذ</label>
              <input
                type="text"
                value={producerName}
                onChange={(e) => setProducerName(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Broadcast Days */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">أيام البث الأسبوعي</label>
            <div className="flex flex-wrap gap-2">
              {daysOfWeek.map((day) => {
                const isSelected = broadcastDays.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => handleToggleDay(day)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                      isSelected
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">وقت البث (توقيت مكة)</label>
              <input
                type="time"
                value={broadcastTime}
                onChange={(e) => setBroadcastTime(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono text-center focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">المدة (بالدقائق)</label>
              <input
                type="number"
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(Number(e.target.value))}
                min="10"
                max="180"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs text-center font-mono focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">الاستوديو</label>
              <input
                type="text"
                value={studioName}
                onChange={(e) => setStudioName(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">رابط صورة الغلاف أو الشارة (URL)</label>
            <input
              type="url"
              value={coverImageUrl}
              onChange={(e) => setCoverImageUrl(e.target.value)}
              placeholder="https://...jpg"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs text-left focus:ring-2 focus:ring-blue-500"
              dir="ltr"
            />
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setIsModalOpen(false)}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
            >
              إلغاء
            </button>
            <button
              type="submit"
              className="px-5 py-2 text-xs font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-xs"
            >
              {editingProgram ? 'حفظ التعديلات' : 'إنشاء البرنامج'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
