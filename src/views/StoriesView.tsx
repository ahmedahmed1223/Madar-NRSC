import React, { useState } from 'react';
import {
  Search,
  Plus,
  FolderGit2,
  Calendar as CalendarIcon,
  Link as LinkIcon,
  ArrowUpRight,
  X,
  Sparkles,
  MapPin,
  Tag,
  Edit2,
  Archive,
  ExternalLink,
  FileText,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { Story, NewsItem, NewsPriority, Category, User } from '../types';
import { Badge } from '../components/common/Badge';
import { Modal } from '../components/common/Modal';

interface StoriesViewProps {
  stories: Story[];
  newsList: NewsItem[];
  categories?: Category[];
  currentUser?: User;
  onSelectStory?: (id: string) => void;
  onCreateStory?: () => void;
  onSaveStory?: (story: Partial<Story>) => void;
  onDeleteStory?: (id: string) => void;
  onSelectNews?: (id: string) => void;
  onCreateNewsForStory?: (storyId: string) => void;
}


const LOCATION_PRESETS = [
  'غرفة الأخبار المركزية',
  'الرياض',
  'واشنطن',
  'بروكسل',
  'جنيف',
  'القاهرة',
  'لندن',
];

export const StoriesView: React.FC<StoriesViewProps> = ({
  stories = [],
  newsList = [],
  categories = [],
  currentUser,
  onSelectStory,
  onSaveStory,
  onDeleteStory,
  onSelectNews,
  onCreateNewsForStory,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'ACTIVE' | 'RESOLVED' | 'ARCHIVED'>('ACTIVE');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');

  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingStory, setEditingStory] = useState<Story | null>(null);
  const [detailStory, setDetailStory] = useState<Story | null>(null);

  // Form states
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [priority, setPriority] = useState<NewsPriority>('HIGH');
  const [status, setStatus] = useState<'ACTIVE' | 'RESOLVED' | 'ARCHIVED'>('ACTIVE');
  const [locationName, setLocationName] = useState('غرفة الأخبار المركزية');
  const [keywordsInput, setKeywordsInput] = useState('');

  const handleOpenAddModal = () => {
    setEditingStory(null);
    setTitle('');
    setDescription('');
    setCategoryId(categories[0]?.id || '');
    setPriority('HIGH');
    setStatus('ACTIVE');
    setLocationName('غرفة الأخبار المركزية');
    setKeywordsInput('');
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (story: Story) => {
    setEditingStory(story);
    setTitle(story.title);
    setDescription(story.description);
    setCategoryId(story.categoryId);
    setPriority(story.priority);
    setStatus(story.status);
    setLocationName(story.locationName || '');
    setKeywordsInput(story.keywords?.join('، ') || '');
    setIsModalOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    const matchedCat = categories.find((c) => c.id === categoryId);
    const keywords = keywordsInput
      .split(/[,،]+/)
      .map((k) => k.trim())
      .filter(Boolean);

    const storyData: Partial<Story> = {
      ...(editingStory ? { id: editingStory.id } : {}),
      title: title.trim(),
      description: description.trim(),
      categoryId,
      categoryName: matchedCat?.nameAr || 'أخبار عامة',
      priority,
      status,
      locationName: locationName.trim(),
      keywords,
      startedAt: editingStory?.startedAt || new Date().toISOString(),
    };

    if (onSaveStory) {
      onSaveStory(storyData);
    }
    setIsModalOpen(false);
  };

  const filteredStories = stories.filter((story) => {
    if (story.status !== activeTab) return false;
    if (selectedCategory !== 'ALL' && story.categoryId !== selectedCategory) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchTitle = story.title.toLowerCase().includes(q);
      const matchDesc = story.description?.toLowerCase().includes(q);
      const matchLoc = story.locationName?.toLowerCase().includes(q);
      if (!matchTitle && !matchDesc && !matchLoc) return false;
    }
    return true;
  });

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
            <FolderGit2 className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-800 tracking-tight">القصص الإخبارية والأحداث المركزية</h1>
            <p className="text-xs text-slate-500 mt-1">
              إدارة التغطيات الكبرى، متابعة تطورات الأحداث، وربط التقارير الإخبارية بالملف الرئيسي
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleOpenAddModal}
          className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          إنشاء تغطية / قصة جديدة
        </button>
      </div>

      {/* Tabs & Search Filter */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
        <div className="flex items-center gap-2 overflow-x-auto pb-2 md:pb-0">
          {(['ACTIVE', 'RESOLVED', 'ARCHIVED'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-xl transition-all shrink-0 text-xs font-bold ${
                activeTab === tab
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {tab === 'ACTIVE' ? 'التغطيات النشطة' : tab === 'RESOLVED' ? 'منتهية/مغلقة' : 'الأرشيف'}
              <span
                className={`mr-2 px-1.5 py-0.5 rounded-md text-[10px] ${
                  activeTab === tab ? 'bg-white/30 text-white' : 'bg-slate-200 text-slate-700'
                }`}
              >
                {stories.filter((s) => s.status === tab).length}
              </span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          {categories.length > 0 && (
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="px-3 py-2 border border-slate-300 rounded-xl text-xs bg-white font-semibold focus:ring-2 focus:ring-indigo-500"
            >
              <option value="ALL">جميع التصنيفات</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nameAr}
                </option>
              ))}
            </select>
          )}

          <div className="relative flex-1 sm:w-80">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="بحث في عنوان التغطية، الوصف، أو المدينة..."
              className="w-full pr-9 pl-8 py-2 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Stories Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {filteredStories.map((story) => {
          const linkedArticles = newsList.filter((n) => n.storyId === story.id);

          return (
            <div
              key={story.id}
              className="bg-white border border-slate-200 rounded-2xl p-5 shadow-2xs hover:shadow-md transition-shadow group flex flex-col"
            >
              <div className="flex justify-between items-start mb-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant={
                      story.priority === 'CRITICAL'
                        ? 'danger'
                        : story.priority === 'HIGH' || story.priority === 'URGENT'
                        ? 'warning'
                        : 'primary'
                    }
                    size="sm"
                  >
                    {story.priority === 'CRITICAL'
                      ? 'أولوية قصوى'
                      : story.priority === 'HIGH' || story.priority === 'URGENT'
                      ? 'عاجل وهام'
                      : 'متابعة مستمرة'}
                  </Badge>

                  {story.categoryName && (
                    <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-100">
                      {story.categoryName}
                    </span>
                  )}

                  {story.locationName && (
                    <span className="text-[10px] text-slate-500 flex items-center gap-0.5">
                      <MapPin className="w-3 h-3 text-slate-400" />
                      {story.locationName}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleOpenEditModal(story)}
                    className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                    title="تعديل بيانات القصة"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setDetailStory(story);
                      if (onSelectStory) onSelectStory(story.id);
                    }}
                    className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                    title="استعراض التقارير المرتبطة"
                  >
                    <ArrowUpRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <h3
                onClick={() => setDetailStory(story)}
                className="text-base font-bold text-slate-800 mb-2 hover:text-indigo-700 transition-colors cursor-pointer"
              >
                {story.title}
              </h3>

              <p className="text-xs text-slate-600 line-clamp-2 mb-4 leading-relaxed">{story.description}</p>

              {story.keywords && story.keywords.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-4">
                  {story.keywords.map((kw, i) => (
                    <span key={i} className="text-[10px] text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                      #{kw}
                    </span>
                  ))}
                </div>
              )}

              <div className="mt-auto pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 text-[11px] text-slate-500">
                <span className="flex items-center gap-1">
                  <CalendarIcon className="w-3.5 h-3.5 text-slate-400" />
                  بدأت: {new Date(story.startedAt).toLocaleDateString('ar-SA')}
                </span>

                <button
                  type="button"
                  onClick={() => setDetailStory(story)}
                  className="flex items-center gap-1 text-indigo-600 font-bold bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1 rounded-lg transition-colors"
                >
                  <LinkIcon className="w-3 h-3" />
                  {linkedArticles.length} مادة خبرية مرتبطة
                </button>
              </div>
            </div>
          );
        })}

        {filteredStories.length === 0 && (
          <div className="col-span-full py-12 flex flex-col items-center justify-center text-slate-400 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
            <FolderGit2 className="w-12 h-12 mb-3 text-slate-300" />
            <p className="font-semibold text-sm">لا توجد قصص إخبارية مطابقة لمعايير البحث</p>
            <p className="text-xs text-slate-400 mt-1">اضغط على زر "إنشاء تغطية / قصة جديدة" لإضافة ملف تحريري</p>
          </div>
        )}
      </div>

      {/* Create / Edit Story Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingStory ? 'تعديل التغطية والقصة الإخبارية' : 'إنشاء تغطية أو قصة مركزية جديدة'}
        subtitle="تجميع الأخبار والتقارير ومتابعة التطورات تحت ملف إخباري موحد"
        maxWidth="2xl"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-bold text-slate-700">عنوان القصة / الملف التحريري *</label>
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
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="مثال: تغطية القمة الاقتصادية، مستجدات الانتخابات..."
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-bold focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">التصنيف الإخباري</label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs bg-white font-semibold focus:ring-2 focus:ring-indigo-500"
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nameAr}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">الأولوية التحريرية</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as NewsPriority)}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs bg-white font-semibold focus:ring-2 focus:ring-indigo-500"
              >
                <option value="CRITICAL">أولوية قصوى (Critical)</option>
                <option value="HIGH">عاجل وهام (High)</option>
                <option value="NORMAL">متابعة اعتيادية (Normal)</option>
                <option value="LOW">أرشفة وخلفيات (Low)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">حالة التغطية</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as 'ACTIVE' | 'RESOLVED' | 'ARCHIVED')}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs bg-white font-semibold focus:ring-2 focus:ring-indigo-500"
              >
                <option value="ACTIVE">تغطية نشطة ومستمرة</option>
                <option value="RESOLVED">ملف مكتمل / منتهي</option>
                <option value="ARCHIVED">مؤرشف</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-bold text-slate-700">الموقع / المدينة الرئيسية</label>
                {locationName && (
                  <button
                    type="button"
                    onClick={() => setLocationName('')}
                    className="text-[10px] text-slate-400 hover:text-rose-500"
                  >
                    مسح
                  </button>
                )}
              </div>
              <input
                type="text"
                value={locationName}
                onChange={(e) => setLocationName(e.target.value)}
                placeholder="مثال: الرياض، واشنطن..."
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500"
              />
              <div className="mt-1 flex flex-wrap gap-1">
                {LOCATION_PRESETS.map((loc) => (
                  <button
                    key={loc}
                    type="button"
                    onClick={() => setLocationName(loc)}
                    className="text-[9px] bg-slate-100 hover:bg-indigo-50 text-slate-600 px-1.5 py-0.5 rounded"
                  >
                    {loc}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-bold text-slate-700">الكلمات الدلالية (مفصولة بفواصل)</label>
                {keywordsInput && (
                  <button
                    type="button"
                    onClick={() => setKeywordsInput('')}
                    className="text-[10px] text-slate-400 hover:text-rose-500"
                  >
                    مسح
                  </button>
                )}
              </div>
              <input
                type="text"
                value={keywordsInput}
                onChange={(e) => setKeywordsInput(e.target.value)}
                placeholder="اقتصاد، قمة، طاقة، تضخم..."
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-bold text-slate-700">شرح وتفاصيل التغطية</label>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-400">{description.length} حرف</span>
                {description && (
                  <button
                    type="button"
                    onClick={() => setDescription('')}
                    className="text-[10px] text-slate-400 hover:text-rose-500"
                  >
                    مسح
                  </button>
                )}
              </div>
            </div>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="اكتب أهداف التغطية، الزوايا التحريرية، والجهات والمسؤولين المعنيين بالملف..."
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setIsModalOpen(false)}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
            >
              إلغاء
            </button>
            <button
              type="submit"
              className="px-5 py-2 text-xs font-bold bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 shadow-xs"
            >
              {editingStory ? 'حفظ التعديلات' : 'إنشاء التغطية'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Story Detail & Linked News Modal */}
      {detailStory && (
        <Modal
          isOpen={true}
          onClose={() => setDetailStory(null)}
          title={`تفاصيل التغطية: ${detailStory.title}`}
          subtitle="استعراض التقارير والأخبار المرتبطة بهذا الملف الإخباري"
          maxWidth="2xl"
        >
          <div className="space-y-4">
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-2">
              <p className="text-slate-700 leading-relaxed">{detailStory.description}</p>
              <div className="flex flex-wrap items-center gap-4 text-slate-500 pt-2 border-t border-slate-200">
                <span>التصنيف: <strong>{detailStory.categoryName || 'عام'}</strong></span>
                <span>الموقع: <strong>{detailStory.locationName || 'غير محدد'}</strong></span>
                <span>الحالة: <strong>{detailStory.status === 'ACTIVE' ? 'نشطة' : 'مغلقة'}</strong></span>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-indigo-600" />
                المواد الإخبارية المرتبطة بهذه القصة ({newsList.filter((n) => n.storyId === detailStory.id).length})
              </h4>
              {onCreateNewsForStory && (
                <button
                  type="button"
                  onClick={() => {
                    onCreateNewsForStory(detailStory.id);
                    setDetailStory(null);
                  }}
                  className="text-xs font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  إضافة خبر جديد لهذا الملف
                </button>
              )}
            </div>

            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {newsList
                .filter((n) => n.storyId === detailStory.id)
                .map((item) => (
                  <div
                    key={item.id}
                    className="p-3 bg-white border border-slate-200 rounded-xl hover:border-indigo-300 transition-colors flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] font-bold text-slate-500">
                          {item.sourceName || 'المصدر الداخلي'}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {new Date(item.createdAt).toLocaleDateString('ar-SA')}
                        </span>
                      </div>
                      <p className="text-xs font-bold text-slate-800 truncate">{item.title}</p>
                    </div>

                    {onSelectNews && (
                      <button
                        type="button"
                        onClick={() => {
                          onSelectNews(item.id);
                          setDetailStory(null);
                        }}
                        className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg shrink-0"
                        title="فتح الخبر في المحرر"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}

              {newsList.filter((n) => n.storyId === detailStory.id).length === 0 && (
                <div className="py-8 text-center text-slate-400 text-xs bg-slate-50 rounded-xl border border-dashed border-slate-200">
                  لا توجد مواد إخبارية مرتبطة بهذه القصة حالياً.
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  handleOpenEditModal(detailStory);
                  setDetailStory(null);
                }}
                className="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-xl"
              >
                تعديل القصة
              </button>
              <button
                type="button"
                onClick={() => setDetailStory(null)}
                className="px-4 py-2 text-xs font-bold bg-slate-800 text-white hover:bg-slate-900 rounded-xl"
              >
                إغلاق
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
