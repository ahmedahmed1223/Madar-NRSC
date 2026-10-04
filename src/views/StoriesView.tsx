import { appLocale, zoneOptions } from '../shared/dateFormat';
import { GlossaryDatalist } from '../components/editor/WritingAids';
import { FilterTabs } from '../components/common/FilterTabs';
import { matchesQuery } from '../shared/search';
import { FormPage } from '../components/common/FormPage';
import { RbacService } from '../services/rbacService';
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
import { CoverageHub } from '../components/stories/CoverageHub';
import { apiService } from '../services/api';

interface StoriesViewProps {
  stories: Story[];
  newsList: NewsItem[];
  categories?: Category[];
  currentUser?: User;
  onSelectStory?: (id: string) => void;
  onCreateStory?: () => void;
  /** Resolves true once the server has stored the story (the form stays open otherwise). */
  onSaveStory?: (story: Partial<Story>) => boolean | Promise<boolean> | void;
  onDeleteStory?: (id: string) => void;
  onSelectNews?: (id: string) => void;
  onCreateNewsForStory?: (storyId: string) => void;
  onSelectEpisode?: (id: string) => void;
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
  onSelectEpisode,
}) => {
  const canCreateNews = RbacService.hasPermission(currentUser, 'news.create');
  const canManageStories = canCreateNews || RbacService.hasPermission(currentUser, 'news.edit_any');
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
    setLocationName('');
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

  const [saving, setSaving] = useState(false);
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || saving) return;

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

    setSaving(true);
    const saved = onSaveStory ? await onSaveStory(storyData) : true;
    setSaving(false);
    if (saved !== false) setIsModalOpen(false);
  };

  const filteredStories = stories.filter((story) => {
    if (story.status !== activeTab) return false;
    if (selectedCategory !== 'ALL' && story.categoryId !== selectedCategory) return false;
    if (searchQuery.trim()) {
      if (!matchesQuery(searchQuery, story.title, story.description, story.locationName, story.categoryName)) return false;
    }
    return true;
  });

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-800 tracking-tight">التغطيات</h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">الأحداث الكبرى وتطوراتها، مع الأخبار والمواد المرتبطة بكل تغطية.</p>
        </div>
        {canManageStories && (
        <button
          type="button"
          onClick={handleOpenAddModal}
          className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          إنشاء تغطية / قصة جديدة
        </button>
        )}
      </div>

      {/* Tabs & Search Filter */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
        <FilterTabs<"ARCHIVED" | "ACTIVE" | "RESOLVED">
          label="تصفية التغطيات"
          className="shrink-0"
          active={activeTab}
          onChange={setActiveTab}
          tabs={[
            { id: 'ACTIVE', label: 'التغطيات النشطة', count: stories.filter((s) => s.status === 'ACTIVE').length, tone: 'blue' },
            { id: 'RESOLVED', label: 'منتهية/مغلقة', count: stories.filter((s) => s.status === 'RESOLVED').length, tone: 'emerald' },
            { id: 'ARCHIVED', label: 'الأرشيف', count: stories.filter((s) => s.status === 'ARCHIVED').length, tone: 'slate', secondary: true },
          ]}
        />

        <div className="flex items-center gap-3">
          {categories.length > 0 && (
            <select
              aria-label="تصنيف التغطية"
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
            <Search className="w-4 h-4 text-slate-500 absolute right-3 top-1/2 -translate-y-1/2" />
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
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-600 p-0.5"
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
                      <MapPin className="w-3 h-3 text-slate-500" />
                      {story.locationName}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1">
                  {canManageStories && (
                  <button
                    type="button"
                    onClick={() => handleOpenEditModal(story)}
                    className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                    title="تعديل بيانات القصة"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setDetailStory(story);
                      if (onSelectStory) onSelectStory(story.id);
                    }}
                    className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
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
                  <CalendarIcon className="w-3.5 h-3.5 text-slate-500" />
                  بدأت: {new Date(story.startedAt).toLocaleDateString(appLocale(), zoneOptions())}
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
          <div className="col-span-full py-12 flex flex-col items-center justify-center text-slate-500 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
            <FolderGit2 className="w-12 h-12 mb-3 text-slate-300" />
            <p className="font-semibold text-sm">لا توجد قصص إخبارية مطابقة لمعايير البحث</p>
            <p className="text-xs text-slate-500 mt-1">اضغط على زر "إنشاء تغطية / قصة جديدة" لإضافة ملف تحريري</p>
          </div>
        )}
      </div>

      {/* Create / Edit Story Modal */}
      <FormPage
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingStory ? 'تعديل التغطية والقصة الإخبارية' : 'إنشاء تغطية أو قصة مركزية جديدة'}
        subtitle="تجميع الأخبار والتقارير ومتابعة التطورات تحت ملف إخباري موحد"
        maxWidth="2xl"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="stories-view-field-1" className="block text-xs font-bold text-slate-700">عنوان القصة / الملف التحريري *</label>
              {title && (
                <button
                  type="button"
                  onClick={() => setTitle('')}
                  className="text-[10px] text-slate-500 hover:text-rose-500"
                >
                  مسح
                </button>
              )}
            </div>
            <input id="stories-view-field-1"
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
              <label htmlFor="stories-view-field-2" className="block text-xs font-bold text-slate-700 mb-1">التصنيف الإخباري</label>
              <select id="stories-view-field-2"
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
              <label htmlFor="stories-view-field-3" className="block text-xs font-bold text-slate-700 mb-1">الأولوية التحريرية</label>
              <select id="stories-view-field-3"
                value={priority}
                onChange={(e) => setPriority(e.target.value as NewsPriority)}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs bg-white font-semibold focus:ring-2 focus:ring-indigo-500"
              >
                <option value="CRITICAL">أولوية قصوى</option>
                <option value="HIGH">عاجل وهام</option>
                <option value="NORMAL">متابعة اعتيادية</option>
                <option value="LOW">أرشفة وخلفيات</option>
              </select>
            </div>

            <div>
              <label htmlFor="stories-view-field-4" className="block text-xs font-bold text-slate-700 mb-1">حالة التغطية</label>
              <select id="stories-view-field-4"
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
                <label htmlFor="stories-view-field-5" className="block text-xs font-bold text-slate-700">الموقع / المدينة الرئيسية</label>
                {locationName && (
                  <button
                    type="button"
                    onClick={() => setLocationName('')}
                    className="text-[10px] text-slate-500 hover:text-rose-500"
                  >
                    مسح
                  </button>
                )}
              </div>
              <input id="stories-view-field-5"
                type="text"
                list="newsroom-glossary"
                    value={locationName}
                onChange={(e) => setLocationName(e.target.value)}
                placeholder="مثال: الرياض، واشنطن..."
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500"
              />
                  <GlossaryDatalist id="newsroom-glossary" />
              <div className="mt-1 flex flex-wrap gap-1">
                {LOCATION_PRESETS.map((loc) => (
                  <button
                    key={loc}
                    type="button"
                    onClick={() => setLocationName(loc)}
                    className="text-[10px] bg-slate-100 hover:bg-indigo-50 text-slate-600 px-1.5 py-0.5 rounded"
                  >
                    {loc}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="stories-view-field-6" className="block text-xs font-bold text-slate-700">الكلمات الدلالية (مفصولة بفواصل)</label>
                {keywordsInput && (
                  <button
                    type="button"
                    onClick={() => setKeywordsInput('')}
                    className="text-[10px] text-slate-500 hover:text-rose-500"
                  >
                    مسح
                  </button>
                )}
              </div>
              <input id="stories-view-field-6"
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
              <label htmlFor="stories-view-field-7" className="block text-xs font-bold text-slate-700">شرح وتفاصيل التغطية</label>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-500">{description.length} حرف</span>
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
            </div>
            <textarea id="stories-view-field-7"
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
              disabled={saving}
              className="px-5 py-2 text-xs font-bold bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 shadow-xs disabled:opacity-60"
            >
              {saving ? 'جارٍ الحفظ…' : editingStory ? 'حفظ التعديلات' : 'إنشاء التغطية'}
            </button>
          </div>
        </form>
      </FormPage>

      {detailStory && (
        <FormPage
          isOpen
          onClose={() => setDetailStory(null)}
          title={`ملف التغطية: ${detailStory.title}`}
          subtitle="الأخبار والوسائط وطلبات الأقسام والحلقات ونقاش الفريق حول هذه التغطية"
          maxWidth="6xl"
        >
          <CoverageHub
            story={detailStory}
            newsList={newsList}
            currentUser={(currentUser || apiService.getCurrentUser()) as User}
            canCreateNews={canCreateNews}
            onOpenNews={onSelectNews ? (id) => { setDetailStory(null); onSelectNews(id); } : undefined}
            onCreateNews={onCreateNewsForStory ? () => { const id = detailStory.id; setDetailStory(null); onCreateNewsForStory(id); } : undefined}
            onOpenEpisode={onSelectEpisode ? (id) => { setDetailStory(null); onSelectEpisode(id); } : undefined}
            onEdit={() => { handleOpenEditModal(detailStory); setDetailStory(null); }}
          />
        </FormPage>
      )}
    </div>
  );
};
