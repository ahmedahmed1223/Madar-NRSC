import { confirmDialog } from '../services/dialogs';
import { matchesQuery } from '../shared/search';
import { FormPage } from '../components/common/FormPage';
import { useFormDraft } from '../hooks/useFormDraft';
import { RbacService } from '../services/rbacService';
import React, { useState , useEffect} from 'react';
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
  X,
  Sparkles,
  Image as ImageIcon,
} from 'lucide-react';
import { Program, ProgramType, User } from '../types';
import { Badge } from '../components/common/Badge';
import { Modal } from '../components/common/Modal';
import { apiService } from '../services/api';

interface ProgramsViewProps {
  programs: Program[];
  programTypes: ProgramType[];
  currentUser: User;
  onSaveProgram: (program: Partial<Program>) => boolean | Promise<boolean>;
  onSelectProgramEpisodes: (programId: string) => void;
  onSelectProgram?: (programId: string) => void;
  onDeleteProgram?: (programId: string) => void;
  /** Opens the edit form for this program on arrival (e.g. from the program page). */
  initialEditProgramId?: string | null;
  onInitialEditHandled?: () => void;
}



const DURATION_PRESETS = [30, 45, 50, 60, 90];

export const ProgramsView: React.FC<ProgramsViewProps> = ({
  programs = [],
  programTypes = [],
  currentUser,
  onSaveProgram,
  onSelectProgramEpisodes,
  onSelectProgram,
  onDeleteProgram,
  initialEditProgramId,
  onInitialEditHandled,
}) => {
  const canManage = RbacService.hasPermission(currentUser, 'programs.manage');
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
  const [channelName, setChannelName] = useState('');
  const [studioName, setStudioName] = useState('');
  const [coverImageUrl, setCoverImageUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const draft = useFormDraft(`program:${currentUser.id}:${editingProgram?.id || 'new'}`, isModalOpen,
    { name, shortName, description, typeId, presenterName, producerName, broadcastDays,
      broadcastTime, durationMinutes, channelName, studioName, coverImageUrl }, value => {
      setName(value.name); setShortName(value.shortName); setDescription(value.description);
      setTypeId(value.typeId); setPresenterName(value.presenterName); setProducerName(value.producerName);
      setBroadcastDays(value.broadcastDays); setBroadcastTime(value.broadcastTime);
      setDurationMinutes(value.durationMinutes); setChannelName(value.channelName);
      setStudioName(value.studioName); setCoverImageUrl(value.coverImageUrl);
    });

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
    setCoverImageUrl('');
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

  useEffect(() => {
    if (!initialEditProgramId) return;
    const prog = programs.find((p) => p.id === initialEditProgramId);
    if (prog && canManage) handleOpenEditModal(prog);
    onInitialEditHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialEditProgramId]);

  const handleToggleDay = (day: string) => {
    if (broadcastDays.includes(day)) {
      if (broadcastDays.length > 1) {
        setBroadcastDays(broadcastDays.filter((d) => d !== day));
      }
    } else {
      setBroadcastDays([...broadcastDays, day]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
    const typeObj = programTypes.find((t) => t.id === typeId);

    const saved = await onSaveProgram({
      id: editingProgram?.id,
      name,
      shortName: shortName || name,
      description,
      typeId,
      typeName: typeObj?.nameAr || typeObj?.name || 'نشرة إخبارية',
      presenterName,
      producerName,
      broadcastDays,
      broadcastTime,
      durationMinutes: Number(durationMinutes) || 50,
      channelName,
      studioName,
      coverImageUrl: coverImageUrl || '',
    });

    if (saved) { draft.clearDraft(); setIsModalOpen(false); }
    } finally { setSaving(false); }
  };

  const filteredPrograms = (programs || []).filter((p) => {
    if (selectedType !== 'ALL' && p.typeId !== selectedType) return false;
    if (searchQuery.trim()) {
      return matchesQuery(searchQuery, p.name, p.shortName, p.presenterName, p.producerName, p.channelName, p.studioName);
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-800 tracking-tight">
            البرامج
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            البرامج وطواقمها ومواعيد بثها واستوديوهاتها.
          </p>
        </div>

        {canManage && (
        <button
          type="button"
          onClick={handleOpenAddModal}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          إضافة برنامج جديد
        </button>
        )}
      </div>

      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-500 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            id="programs-search-input"
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="بحث بالاسم، مقدم البرنامج، أو المنتج..."
            autoComplete="off"
            spellCheck="false"
            className="w-full pr-10 pl-8 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-600 p-0.5"
              aria-label="مسح البحث"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <label htmlFor="programs-type-filter" className="text-xs text-slate-600 shrink-0 font-medium">نوع البرنامج:</label>
          <select
            id="programs-type-filter"
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="px-3.5 py-2.5 border border-slate-300 rounded-xl text-xs bg-white text-slate-800 font-semibold focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-full sm:w-auto transition-all"
          >
            <option value="ALL">جميع الأنواع ({programTypes.length})</option>
            {programTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nameAr || t.name || 'نوع بلا اسم'}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Programs Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredPrograms.map((prog) => {
          return (
            <div
              key={prog.id}
              className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden flex flex-col hover:shadow-md transition-all group"
            >
              {/* Cover image & badges */}
              <div
                className="relative h-44 overflow-hidden bg-slate-900 cursor-pointer"
                onClick={() => onSelectProgram && onSelectProgram(prog.id)}
                title="فتح ملف البرنامج"
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
                    <span className="text-slate-500">المقدم:</span>
                    <strong className="text-slate-800">{prog.presenterName}</strong>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">المنتج المنفذ:</span>
                    <strong className="text-slate-800">{prog.producerName}</strong>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">الاستوديو:</span>
                    <span className="text-slate-700">{prog.studioName}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">أيام البث:</span>
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
                    <span>ملف البرنامج</span>
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

                    {canManage && (
                    <button
                      type="button"
                      onClick={() => handleOpenEditModal(prog)}
                      className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors"
                      title="تعديل بيانات البرنامج"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    )}

                    {onDeleteProgram && canManage && (
                      <button
                        type="button"
                        onClick={async () => {
                          if ((await confirmDialog(`هل أنت متأكد من حذف البرنامج: "${prog.name}"؟`))) {
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
      <FormPage
        isOpen={isModalOpen}
        draft={draft}
        onClose={() => setIsModalOpen(false)}
        title={editingProgram ? 'تعديل بيانات البرنامج' : 'إضافة برنامج تلفزيوني جديد'}
        subtitle="تحديد معلومات البرنامج والمسؤولين ومواعيد البث"
        maxWidth="2xl"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="program-name-input" className="block text-xs font-bold text-slate-700">اسم البرنامج *</label>
                {name && (
                  <button
                    type="button"
                    onClick={() => setName('')}
                    className="text-[10px] text-slate-500 hover:text-rose-500"
                  >
                    مسح
                  </button>
                )}
              </div>
              <input
                id="program-name-input"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="مثال: المشهد السياسي، نبض الاقتصاد"
                className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
              />
            </div>
            <div>
              <label htmlFor="program-type-select" className="block text-xs font-bold text-slate-700 mb-1">نوع وتصنيف البرنامج</label>
              <select
                id="program-type-select"
                value={typeId}
                onChange={(e) => setTypeId(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs bg-white font-semibold text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
              >
                {programTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nameAr || t.name || 'نوع بلا اسم'}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="program-desc-textarea" className="block text-xs font-bold text-slate-700">وصف ورؤية البرنامج</label>
              {description && (
                <button
                  type="button"
                  onClick={() => setDescription('')}
                  className="text-[10px] text-slate-500 hover:text-rose-500"
                >
                  مسح
                </button>
              )}
            </div>
            <textarea
              id="program-desc-textarea"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="وصف موجز لطبيعة البرنامج وأهدافه التحريرية والجمهور المستهدف..."
              className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="program-presenter-input" className="block text-xs font-bold text-slate-700 mb-1">مقدم البرنامج الرئيسي</label>
              <input
                id="program-presenter-input"
                type="text"
                value={presenterName}
                onChange={(e) => setPresenterName(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
              />
            </div>
            <div>
              <label htmlFor="program-producer-input" className="block text-xs font-bold text-slate-700 mb-1">المنتج المنفذ</label>
              <input
                id="program-producer-input"
                type="text"
                value={producerName}
                onChange={(e) => setProducerName(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
              />
            </div>
          </div>

          {/* Broadcast Days & Schedule Presets */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-bold text-slate-700">أيام البث الأسبوعي</label>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setBroadcastDays([...daysOfWeek])}
                  className="text-[10px] px-2 py-0.5 rounded bg-slate-100 hover:bg-blue-50 text-slate-600 hover:text-blue-700 transition-colors"
                >
                  يومياً
                </button>
                <button
                  type="button"
                  onClick={() => setBroadcastDays(['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس'])}
                  className="text-[10px] px-2 py-0.5 rounded bg-slate-100 hover:bg-blue-50 text-slate-600 hover:text-blue-700 transition-colors"
                >
                  أيام العمل
                </button>
                <button
                  type="button"
                  onClick={() => setBroadcastDays(['الجمعة', 'السبت'])}
                  className="text-[10px] px-2 py-0.5 rounded bg-slate-100 hover:bg-blue-50 text-slate-600 hover:text-blue-700 transition-colors"
                >
                  عطلة الأسبوع
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {daysOfWeek.map((day) => {
                const isSelected = broadcastDays.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => handleToggleDay(day)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                      isSelected
                        ? 'bg-blue-600 text-white shadow-xs'
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
              <label htmlFor="program-time-input" className="block text-xs font-bold text-slate-700 mb-1">وقت البث</label>
              <input
                id="program-time-input"
                type="time"
                value={broadcastTime}
                onChange={(e) => setBroadcastTime(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs font-mono text-center text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
              />
            </div>
            <div>
              <label htmlFor="program-duration-input" className="block text-xs font-bold text-slate-700 mb-1">المدة (بالدقائق)</label>
              <input
                id="program-duration-input"
                type="number"
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(Number(e.target.value))}
                min="10"
                max="360"
                inputMode="numeric"
                className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-center font-mono text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
              />
              <div className="mt-1 flex items-center justify-center gap-1">
                {DURATION_PRESETS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDurationMinutes(d)}
                    className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                      durationMinutes === d
                        ? 'bg-blue-600 text-white font-bold'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {d}د
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label htmlFor="program-studio-input" className="block text-xs font-bold text-slate-700 mb-1">الاستوديو</label>
              <input
                id="program-studio-input"
                type="text"
                value={studioName}
                onChange={(e) => setStudioName(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="program-cover-input" className="block text-xs font-bold text-slate-700">رابط صورة الغلاف أو الشارة (URL)</label>
              {coverImageUrl && (
                <button
                  type="button"
                  onClick={() => setCoverImageUrl('')}
                  className="text-[10px] text-slate-500 hover:text-rose-500"
                >
                  مسح
                </button>
              )}
            </div>
            <input
              id="program-cover-input"
              type="url"
              inputMode="url"
              autoCapitalize="none"
              spellCheck="false"
              value={coverImageUrl}
              onChange={(e) => setCoverImageUrl(e.target.value)}
              placeholder="https://...jpg"
              className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-left text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono transition-all"
              dir="ltr"
            />
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={() => void draft.close(() => setIsModalOpen(false))}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 text-xs font-bold bg-blue-600 text-white rounded-xl hover:bg-blue-700 shadow-xs"
            >
              {editingProgram ? 'حفظ التعديلات' : 'إنشاء البرنامج'}
            </button>
          </div>
        </form>
      </FormPage>
    </div>
  );
};
