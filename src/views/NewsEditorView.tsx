import React, { useState, useEffect } from 'react';
import {
  Save,
  Send,
  CheckCircle,
  Radio,
  ArrowRight,
  Flame,
  Image as ImageIcon,
  Video,
  Tag,
  MapPin,
  Calendar,
  AlertTriangle,
  History,
  Info,
} from 'lucide-react';
import { NewsItem, NewsStatus, NewsPriority, User, Category, NewsSource } from '../types';
import { RichTextEditor } from '../components/editor/RichTextEditor';
import { Badge } from '../components/common/Badge';
import { hasPermission } from '../services/api';

interface NewsEditorViewProps {
  newsItem?: NewsItem | null;
  currentUser: User;
  categories: Category[];
  sources: NewsSource[];
  onSave: (newsData: Partial<NewsItem>) => void;
  onUpdateStatus: (newsId: string, toStatus: NewsStatus, comment?: string) => void;
  onCancel: () => void;
}

export const NewsEditorView: React.FC<NewsEditorViewProps> = ({
  newsItem,
  currentUser,
  categories,
  sources,
  onSave,
  onUpdateStatus,
  onCancel,
}) => {
  const [title, setTitle] = useState('');
  const [shortTitle, setShortTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [content, setContent] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [priority, setPriority] = useState<NewsPriority>('NORMAL');
  const [locationName, setLocationName] = useState('المقر الرئيسي');
  const [eventDate, setEventDate] = useState(new Date().toISOString().slice(0, 16));
  const [mainImageUrl, setMainImageUrl] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [keywords, setKeywords] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [isBreaking, setIsBreaking] = useState(false);
  const [internalNotes, setInternalNotes] = useState('');

  const [statusComment, setStatusComment] = useState('');
  const [showCommentModal, setShowCommentModal] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<NewsStatus | null>(null);
  const [isAutoSaving, setIsAutoSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  // Auto-save effect
  useEffect(() => {
    if (!title && !content) return;
    
    setIsAutoSaving(true);
    const timer = setTimeout(() => {
      // Simulate save to DB
      setIsAutoSaving(false);
      setLastSaved(new Date());
    }, 1500);

    return () => clearTimeout(timer);
  }, [title, content, summary, categoryId]);

  useEffect(() => {
    if (newsItem) {
      setTitle(newsItem.title);
      setShortTitle(newsItem.shortTitle);
      setSummary(newsItem.summary);
      setContent(newsItem.content);
      setCategoryId(newsItem.categoryId);
      setSourceId(newsItem.sourceId);
      setPriority(newsItem.priority);
      setLocationName(newsItem.locationName);
      setEventDate(newsItem.eventDate ? newsItem.eventDate.slice(0, 16) : new Date().toISOString().slice(0, 16));
      setMainImageUrl(newsItem.mainImageUrl || '');
      setVideoUrl(newsItem.videoUrl || '');
      setKeywords(newsItem.keywords || []);
      setIsBreaking(!!newsItem.isBreaking);
      setInternalNotes(newsItem.internalNotes || '');
    } else {
      setTitle('');
      setShortTitle('');
      setSummary('');
      setContent('');
      setCategoryId(categories[0]?.id || '');
      setSourceId(sources[0]?.id || '');
      setPriority('NORMAL');
      setLocationName('المقر الرئيسي');
      setEventDate(new Date().toISOString().slice(0, 16));
      setMainImageUrl('https://images.unsplash.com/photo-1585829365295-ab7cd400c167?auto=format&fit=crop&w=1200&q=80');
      setVideoUrl('');
      setKeywords(['أخبار', 'تغطية']);
      setIsBreaking(false);
      setInternalNotes('');
    }
  }, [newsItem, categories, sources]);

  const canApprove = hasPermission(currentUser.role, 'APPROVE_NEWS');
  const canPublish = hasPermission(currentUser.role, 'PUBLISH_NEWS');

  const handleAddTag = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && tagInput.trim()) {
      e.preventDefault();
      if (!keywords.includes(tagInput.trim())) {
        setKeywords([...keywords, tagInput.trim()]);
      }
      setTagInput('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setKeywords(keywords.filter((t) => t !== tagToRemove));
  };

  const handleSaveDraft = () => {
    const selectedCat = categories.find((c) => c.id === categoryId);
    const selectedSrc = sources.find((s) => s.id === sourceId);

    onSave({
      id: newsItem?.id,
      title: title || 'خبر جديد بدون عنوان',
      shortTitle: shortTitle || title,
      summary,
      content,
      categoryId,
      categoryName: selectedCat?.nameAr || 'عام',
      sourceId,
      sourceName: selectedSrc?.name || 'مصدر محلي',
      priority,
      locationName,
      eventDate,
      mainImageUrl,
      videoUrl: videoUrl || undefined,
      keywords,
      isBreaking,
      internalNotes,
      status: newsItem?.status || 'DRAFT',
    });
  };

  const handleTriggerStatusChange = (status: NewsStatus) => {
    if (!newsItem?.id) {
      const selectedCat = categories.find((c) => c.id === categoryId);
      const selectedSrc = sources.find((s) => s.id === sourceId);
      onSave({
        title: title || 'خبر جديد بدون عنوان',
        shortTitle: shortTitle || title,
        summary,
        content,
        categoryId,
        categoryName: selectedCat?.nameAr || 'عام',
        sourceId,
        sourceName: selectedSrc?.name || 'مصدر محلي',
        priority,
        locationName,
        eventDate,
        mainImageUrl,
        videoUrl: videoUrl || undefined,
        keywords,
        isBreaking,
        internalNotes,
        status: status,
      });
      return;
    }
    setPendingStatus(status);
    setShowCommentModal(true);
  };

  const handleConfirmStatus = () => {
    if (newsItem?.id && pendingStatus) {
      onUpdateStatus(newsItem.id, pendingStatus, statusComment);
      setShowCommentModal(false);
      setStatusComment('');
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Actions Bar */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-2xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors"
            title="العودة لقائمة الأخبار"
          >
            <ArrowRight className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-base sm:text-lg font-bold text-slate-800">
              {newsItem ? `تحرير الخبر: ${newsItem.title}` : 'إنشاء مادة إخبارية جديدة'}
            </h1>
            <div className="flex items-center gap-2 mt-0.5">
              <Badge variant="default" size="sm">
                الحالة: {newsItem?.status || 'مسودة جديدة'}
              </Badge>
              {isBreaking && (
                <Badge variant="danger" size="sm" dot>
                  خبر عاجل
                </Badge>
              )}
              <div className="flex items-center gap-1.5 ml-2 text-[10px] text-slate-400 font-medium">
                {isAutoSaving ? (
                  <>
                    <span className="w-3 h-3 border-2 border-slate-300 border-t-blue-500 rounded-full animate-spin" />
                    جارِ الحفظ...
                  </>
                ) : lastSaved ? (
                  <>
                    <CheckCircle className="w-3 h-3 text-emerald-500" />
                    تم الحفظ {lastSaved.toLocaleTimeString('ar-SA')}
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleSaveDraft}
            className="flex items-center gap-1.5 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-colors"
          >
            <Save className="w-4 h-4" />
            حفظ التغييرات
          </button>

          {/* Workflow Transitions */}
          {(!newsItem || newsItem.status === 'DRAFT') && (
            <button
              type="button"
              onClick={() => handleTriggerStatusChange('UNDER_REVIEW')}
              className="flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs"
            >
              <Send className="w-4 h-4" />
              إرسال للمراجعة والتدقيق
            </button>
          )}

          {newsItem?.status === 'UNDER_REVIEW' && canApprove && (
            <button
              type="button"
              onClick={() => handleTriggerStatusChange('APPROVED')}
              className="flex items-center gap-1.5 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs"
            >
              <CheckCircle className="w-4 h-4" />
              اعتماد الخبر للنشر
            </button>
          )}

          {newsItem?.status === 'APPROVED' && canPublish && (
            <button
              type="button"
              onClick={() => handleTriggerStatusChange('PUBLISHED')}
              className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs"
            >
              <Radio className="w-4 h-4" />
              نشر فوري على المنصات
            </button>
          )}

          {newsItem?.status === 'PUBLISHED' && canPublish && (
            <button
              type="button"
              onClick={() => handleTriggerStatusChange('ARCHIVED')}
              className="flex items-center gap-1.5 px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-bold transition-all shadow-xs"
            >
              أرشفة الخبر
            </button>
          )}
        </div>
      </div>

      {/* Main Grid: Content Area & Metadata Sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Main Editor */}
        <div className="lg:col-span-2 space-y-5">
          {/* Main Title */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                العنوان الرئيسي للمادة الصحفية *
              </label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="اكتب عنواناً جذاباً ودقيقاً يصف جوهر الحدث..."
                className="w-full px-4 py-3 border border-slate-300 rounded-xl text-base font-bold focus:ring-2 focus:ring-blue-500 placeholder:font-normal"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                العنوان المختصر (يستخدم في شريط البث السفلي والأوتوكيو)
              </label>
              <input
                type="text"
                value={shortTitle}
                onChange={(e) => setShortTitle(e.target.value)}
                placeholder="عنوان مختصر لا يتجاوز 10 كلمات..."
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Summary */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                المقدمة والملخص الإخباري (Lead Paragraph)
              </label>
              <textarea
                rows={3}
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="يجيب عن الأسئلة الصحفية الستة (من، ماذا، أين، متى، لماذا، كيف)..."
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs leading-relaxed focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Full Rich Text Editor */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-2">
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-bold text-slate-700">
                محتوى التقرير الصحفي الكامل *
              </label>
              <span className="text-[11px] text-slate-400">محرر متقدم يدعم الوسائط والتنسيق المطبوع</span>
            </div>
            <RichTextEditor
              value={content}
              onChange={(val) => setContent(val)}
              minHeight="400px"
              placeholder="اكتب تفاصيل القصة الإخبارية كاملة، التصريحات، الخلفيات، والتحليلات الميدانية..."
            />
          </div>

          {/* Internal Notes */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-2">
            <label className="block text-xs font-bold text-slate-700 flex items-center gap-1.5">
              <Info className="w-4 h-4 text-blue-500" />
              ملاحظات داخلية لغرفة الأخبار وهيئة التحرير
            </label>
            <textarea
              rows={2}
              value={internalNotes}
              onChange={(e) => setInternalNotes(e.target.value)}
              placeholder="تعليمات للمذيعين، التحقق من الترجمة، توجيهات المخرج..."
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Right 1 Col: Editorial Metadata & Publishing Controls */}
        <div className="space-y-5">
          {/* Publishing & Category Box */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-4">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider border-b border-slate-100 pb-2">
              البيانات الوصفية والتصنيف
            </h3>

            {/* Breaking News Toggle */}
            <div className="p-3 bg-red-50/70 border border-red-200 rounded-xl flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Flame className="w-5 h-5 text-red-600 animate-pulse" />
                <div>
                  <span className="text-xs font-bold text-red-900 block">خبر عاجل للبث</span>
                  <span className="text-[10px] text-red-700 block">يظهر فوراً على الشريط الإخباري</span>
                </div>
              </div>
              <input
                type="checkbox"
                checked={isBreaking}
                onChange={(e) => setIsBreaking(e.target.checked)}
                className="w-5 h-5 text-red-600 rounded-md focus:ring-red-500 cursor-pointer"
              />
            </div>

            {/* Category */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">القسم الصحفي *</label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs bg-white focus:ring-2 focus:ring-blue-500"
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nameAr}
                  </option>
                ))}
              </select>
            </div>

            {/* Source */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">مصدر الخبر *</label>
              <select
                value={sourceId}
                onChange={(e) => setSourceId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs bg-white focus:ring-2 focus:ring-blue-500"
              >
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.type})
                  </option>
                ))}
              </select>
            </div>

            {/* Priority */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">الأولوية والخطورة</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as NewsPriority)}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs bg-white focus:ring-2 focus:ring-blue-500"
              >
                <option value="URGENT">عاجل جداً (Urgent)</option>
                <option value="HIGH">أولوية عالية (High)</option>
                <option value="NORMAL">أولوية عادية (Normal)</option>
                <option value="LOW">أولوية منخفضة (Low)</option>
              </select>
            </div>

            {/* Location & Event Date */}
            <div className="space-y-3 pt-2 border-t border-slate-100">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5 text-slate-400" />
                  مكان الحدث
                </label>
                <input
                  type="text"
                  value={locationName}
                  onChange={(e) => setLocationName(e.target.value)}
                  placeholder="مثال: الرياض، القاهرة، جنيف"
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-slate-400" />
                  تاريخ وتوقيت وقوع الحدث
                </label>
                <input
                  type="datetime-local"
                  value={eventDate}
                  onChange={(e) => setEventDate(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-mono focus:ring-2 focus:ring-blue-500"
                  dir="ltr"
                />
              </div>
            </div>
          </div>

          {/* Workflow Timeline */}
          {newsItem && newsItem.workflowLogs && newsItem.workflowLogs.length > 0 && (
            <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-4">
              <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1.5 border-b border-slate-200 pb-2">
                <History className="w-4 h-4 text-slate-500" />
                سجل الاعتماد والمراجعة
              </h3>
              <div className="relative pl-2 pr-4 space-y-4 before:content-[''] before:absolute before:right-2 before:top-2 before:bottom-0 before:w-0.5 before:bg-slate-200">
                {newsItem.workflowLogs.map((log) => (
                  <div key={log.id} className="relative flex items-start gap-3 text-xs">
                    <span className="absolute -right-[19px] top-1 w-2.5 h-2.5 rounded-full bg-blue-500 border-2 border-white shadow-xs" />
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center justify-between">
                        <strong className="text-slate-800 font-semibold">{log.changedBy.name}</strong>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {new Date(log.timestamp).toLocaleString('ar-SA', { hour: '2-digit', minute:'2-digit', month: 'short', day: 'numeric' })}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600">
                        غيّر الحالة إلى: <span className="font-bold text-blue-700 bg-blue-50 px-1 rounded">{log.toStatus}</span>
                      </p>
                      {log.comment && (
                        <p className="text-[10px] text-slate-500 italic bg-white p-1.5 rounded border border-slate-100 mt-1">"{log.comment}"</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Media Links */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-3">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider border-b border-slate-100 pb-2">
              الوسائط المرفقة
            </h3>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1">
                <ImageIcon className="w-3.5 h-3.5 text-slate-400" />
                رابط الصورة البارزة (URL)
              </label>
              <input
                type="url"
                value={mainImageUrl}
                onChange={(e) => setMainImageUrl(e.target.value)}
                placeholder="https://...jpg"
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs text-left focus:ring-2 focus:ring-blue-500"
                dir="ltr"
              />
              {mainImageUrl && (
                <img
                  src={mainImageUrl}
                  alt="معاينة"
                  className="w-full h-32 object-cover rounded-xl mt-2 border border-slate-200"
                />
              )}
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1">
                <Video className="w-3.5 h-3.5 text-slate-400" />
                رابط مقطع الفيديو (Playout Video)
              </label>
              <input
                type="url"
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                placeholder="https://...mp4 أو سيرفر البث"
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs text-left focus:ring-2 focus:ring-blue-500"
                dir="ltr"
              />
            </div>
          </div>

          {/* Keywords / Tags */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-3">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider border-b border-slate-100 pb-2 flex items-center gap-1.5">
              <Tag className="w-3.5 h-3.5 text-blue-500" />
              الكلمات المفتاحية والوسوم
            </h3>

            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={handleAddTag}
              placeholder="اكتب الوسم واضغط Enter للإضافة..."
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-blue-500"
            />

            <div className="flex flex-wrap gap-1.5">
              {keywords.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200"
                >
                  <span>#{tag}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveTag(tag)}
                    className="hover:text-red-500"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Status Transition Comment Modal */}
      {showCommentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-6 max-w-md w-full space-y-4 text-right">
            <h3 className="text-base font-bold text-slate-800">
              تأكيد نقل الحالة التحريرية إلى: [{pendingStatus}]
            </h3>
            <p className="text-xs text-slate-500">
              أدخل ملاحظات التدقيق أو المراجعة لتسجيلها في سجل التدقيق الأمني والتحريري:
            </p>
            <textarea
              rows={3}
              value={statusComment}
              onChange={(e) => setStatusComment(e.target.value)}
              placeholder="مثال: تم تدقيق الأسماء، مطابقة المصادر، والتأكد من الصياغة اللغوية..."
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowCommentModal(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleConfirmStatus}
                className="px-4 py-2 text-xs font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-xs"
              >
                تأكيد ونقل الحالة
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
