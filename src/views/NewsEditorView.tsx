import { apiService } from '../services/api';
import React, { useState, useEffect, useMemo, useRef } from 'react';
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
  Clock,
  Tv,
  FileText,
  Copy,
  Sparkles,
  RotateCcw,
  Bot,
  X,
  Wand2,
  Eye,
  RefreshCw,
  Globe,
  Hash,
  Zap,
  Check,
  Lock,
} from 'lucide-react';
import { NewsItem, NewsStatus, NewsPriority, User, Category, NewsSource } from '../types';
import { RichTextEditor } from '../components/editor/RichTextEditor';
import { Badge } from '../components/common/Badge';
import { Breadcrumbs } from '../components/layout/Breadcrumbs';
import { RbacService } from '../services/rbacService';
import { useNewsEditLock } from '../hooks/useNewsEditLock';
import { NewsHistoryModal } from '../components/news/NewsHistoryModal';
import { NEWS_STATUS_LABELS, availableTransitions, canEditNewsContent, transitionDenial } from '../shared/newsWorkflow';
import type { Story, NewsDraftSeed } from '../types';
import { LowerThirdGeneratorModal } from '../components/editor/LowerThirdGeneratorModal';
import { AiNewsCoPilotModal } from '../components/editor/AiNewsCoPilotModal';

interface NewsEditorViewProps {
  newsItem?: NewsItem | null;
  currentUser: User;
  categories: Category[];
  sources: NewsSource[];
  stories?: Story[];
  /** Prefilled fields for a new story (e.g. written from an agency wire). */
  seed?: NewsDraftSeed;
  /** Pre-links a new story to a coverage (from the stories desk). */
  defaultStoryId?: string;
  /** Returns the saved story, or null if the save was refused. */
  onSave: (newsData: Partial<NewsItem> & { expectedUpdatedAt?: string }, opts?: { stay?: boolean }) => NewsItem | null;
  onUpdateStatus: (newsId: string, toStatus: NewsStatus, comment?: string, scheduledDate?: string) => void;
  onCancel: () => void;
}

export const NewsEditorView: React.FC<NewsEditorViewProps> = ({
  newsItem,
  currentUser,
  categories,
  sources,
  stories = [],
  defaultStoryId,
  seed,
  onSave,
  onUpdateStatus,
  onCancel,
}) => {
  const [storyId, setStoryId] = useState<string>(defaultStoryId || '');
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [scheduleAt, setScheduleAt] = useState('');
  // Version of the story this editor is based on; a different server copy means someone else saved.
  const [baseUpdatedAt, setBaseUpdatedAt] = useState<string | undefined>(newsItem?.updatedAt);
  const loadedSnapshotRef = useRef<string>('');

  const can = (perm: string) => RbacService.hasPermission(currentUser, perm);
  const lock = useNewsEditLock(newsItem?.id);
  const lockedByOther = lock.status === 'locked';
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

  // Broadcast Production State
  const [isCgModalOpen, setIsCgModalOpen] = useState(false);
  const [isAiCopilotOpen, setIsAiCopilotOpen] = useState(false);
  const [hasEmergencyDraft, setHasEmergencyDraft] = useState(false);
  const [copiedPrompter, setCopiedPrompter] = useState(false);
  const [copiedTitle, setCopiedTitle] = useState(false);
  const [showTickerPreview, setShowTickerPreview] = useState(true);

  const LOCATION_PRESETS = [
    'الرياض',
    'القدس',
    'واشنطن',
    'لندن',
    'القاهرة',
    'دبي',
    'بيروت',
    'جنيف',
    'باريس',
    'إسطنبول',
    'غزة',
    'موسكو',
  ];

  const TRENDING_TAGS = [
    'عاجل',
    'اقتصاد',
    'الشرق_الأوسط',
    'تقنية',
    'بيان_رسمي',
    'مؤتمر_صحفي',
    'قمة_عربية',
    'أسواق_المال',
  ];

  const LEAD_STARTERS = [
    'عاجل: أفادت مصادر رسمية مطلعة...',
    'في تطور لافت، أعلنت السلطات اليوم عن...',
    'كشف بيان صحفي صادر عن الوزارة تفاصيل...',
    'عقدت اليوم جلسة مباحثات موسعة تناولت...',
  ];

  const DIRECTIVE_PRESETS = [
    '[للمذيع: نبرة جادة والتركيز على الأرقام]',
    '[للمخرج: كاميرا 2 عند الدقيقة الأولى]',
    '[التحقق من صحة نطق الأسماء الأجنبية]',
    '[إدراج شارة جرافيكس CG عند الفقرة 2]',
  ];

  // Quick picks come from the station's own media library (latest images).
  const IMAGE_PRESETS = useMemo(
    () =>
      apiService
        .getMedia()
        .filter((m) => m.mediaType === 'IMAGE' && (m.url || m.fileUrl))
        .slice(0, 6)
        .map((m) => ({ label: (m.title || m.originalName || m.fileName || 'صورة').slice(0, 24), url: (m.url || m.fileUrl)! })),
    []
  );


  const handleGenerateShortTitle = () => {
    if (!title.trim()) return;
    const words = title.trim().split(/\s+/);
    const shortened = words.slice(0, 8).join(' ');
    setShortTitle(shortened);
  };

  const handleCopyTitle = () => {
    if (!title) return;
    navigator.clipboard.writeText(title);
    setCopiedTitle(true);
    setTimeout(() => setCopiedTitle(false), 2000);
  };

  // Drafts are per user so colleagues sharing a workstation never see each other's unsaved text.
  const draftKey = `nrcs_draft_${currentUser.id}_${newsItem?.id || 'new'}`;

  const handleApplyAiChanges = (data: {
    title?: string;
    summary?: string;
    content?: string;
    shortTitle?: string;
  }) => {
    if (data.title) setTitle(data.title);
    if (data.shortTitle) setShortTitle(data.shortTitle);
    if (data.summary) setSummary(data.summary);
    if (data.content) setContent(data.content);
  };

  // Broadcast Speech Calculations
  const textStats = useMemo(() => {
    const cleanContent = content.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ');
    const fullText = `${title} ${summary} ${cleanContent}`;
    const words = (fullText.match(/\S+/g) || []).length;
    const chars = fullText.length;
    
    // Arabic TV Broadcast standard: 130 words per minute (~2.16 words per second)
    const readingSeconds = Math.ceil(words / 2.16);
    const mins = Math.floor(readingSeconds / 60);
    const secs = readingSeconds % 60;
    const timeFormatted = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

    return { words, chars, readingSeconds, timeFormatted };
  }, [title, summary, content]);

  const formFields = () => ({
    title,
    shortTitle,
    summary,
    content,
    categoryId,
    sourceId,
    priority,
    locationName,
    eventDate,
    mainImageUrl,
    videoUrl,
    keywords,
    isBreaking,
    internalNotes,
    storyId,
  });
  const isDirty = JSON.stringify(formFields()) !== loadedSnapshotRef.current;

  const clearDraft = () => {
    try {
      localStorage.removeItem(draftKey);
    } catch {
      // ignore
    }
    setHasEmergencyDraft(false);
  };

  // Offer a local draft only if it was based on the server version now loaded and holds different text.
  const checkForDraft = (serverUpdatedAt: string | undefined) => {
    try {
      const raw = localStorage.getItem(draftKey);
      if (!raw) return;
      const draft = JSON.parse(raw);
      const sameBase = !newsItem?.id || draft.baseUpdatedAt === serverUpdatedAt;
      const { savedAt: _s, baseUpdatedAt: _b, ...fields } = draft;
      if (sameBase && JSON.stringify({ ...JSON.parse(loadedSnapshotRef.current || '{}'), ...fields }) !== loadedSnapshotRef.current) {
        setHasEmergencyDraft(true);
      } else if (!sameBase) {
        localStorage.removeItem(draftKey); // based on an older version: would overwrite newer work
      }
    } catch {
      // ignore
    }
  };

  // Local crash-recovery copy, written only while there are unsaved changes.
  useEffect(() => {
    if (!isDirty || lockedByOther) {
      setIsAutoSaving(false);
      return;
    }
    setIsAutoSaving(true);
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(draftKey, JSON.stringify({ ...formFields(), savedAt: new Date().toISOString(), baseUpdatedAt }));
      } catch {
        // storage full or disabled
      }
      setIsAutoSaving(false);
      setLastSaved(new Date());
    }, 1200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, shortTitle, summary, content, categoryId, sourceId, priority, locationName, eventDate, mainImageUrl, videoUrl, keywords, isBreaking, internalNotes, storyId, draftKey, lockedByOther]);

  const handleRestoreEmergencyDraft = () => {
    try {
      const savedDraft = localStorage.getItem(draftKey);
      if (savedDraft) {
        const parsed = JSON.parse(savedDraft);
        if (parsed.title !== undefined) setTitle(parsed.title);
        if (parsed.shortTitle !== undefined) setShortTitle(parsed.shortTitle);
        if (parsed.summary !== undefined) setSummary(parsed.summary);
        if (parsed.content !== undefined) setContent(parsed.content);
        if (parsed.categoryId) setCategoryId(parsed.categoryId);
        if (parsed.sourceId) setSourceId(parsed.sourceId);
        if (parsed.priority) setPriority(parsed.priority);
        if (parsed.locationName !== undefined) setLocationName(parsed.locationName);
        if (parsed.eventDate) setEventDate(parsed.eventDate);
        if (parsed.mainImageUrl !== undefined) setMainImageUrl(parsed.mainImageUrl);
        if (parsed.videoUrl !== undefined) setVideoUrl(parsed.videoUrl);
        if (Array.isArray(parsed.keywords)) setKeywords(parsed.keywords);
        if (parsed.isBreaking !== undefined) setIsBreaking(parsed.isBreaking);
        if (parsed.internalNotes !== undefined) setInternalNotes(parsed.internalNotes);
        if (parsed.storyId !== undefined) setStoryId(parsed.storyId);
        setHasEmergencyDraft(false);
      }
    } catch {
      // ignore
    }
  };

  const handleCopyPrompterText = () => {
    const cleanContent = content
      .replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, '\n--- $1 ---\n')
      .replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .trim();

    const prompterScript = `[TITLE: ${title}]\n[LOCATION: ${locationName}]\n[DURATION: ${textStats.timeFormatted}]\n\n${summary ? `=== مقدمة المذيع ===\n${summary}\n\n` : ''}=== نص التقرير ===\n${cleanContent}`;

    navigator.clipboard.writeText(prompterScript);
    setCopiedPrompter(true);
    setTimeout(() => setCopiedPrompter(false), 2500);
  };

  const handleInsertCgTag = (tag: string) => {
    setContent((prev) => `${prev}<p><strong>${tag}</strong></p>`);
  };

  /** Loads a server copy into the form and marks it as the clean baseline. */
  const loadFromItem = (item: NewsItem) => {
    const fields = {
      title: item.title || '',
      shortTitle: item.shortTitle || '',
      summary: item.summary || '',
      content: item.content || '',
      categoryId: item.categoryId || '',
      sourceId: item.sourceId || '',
      priority: item.priority || 'NORMAL',
      locationName: item.locationName || '',
      eventDate: item.eventDate ? item.eventDate.slice(0, 16) : new Date().toISOString().slice(0, 16),
      mainImageUrl: item.mainImageUrl || '',
      videoUrl: item.videoUrl || '',
      keywords: item.keywords || [],
      isBreaking: !!item.isBreaking,
      internalNotes: item.internalNotes || '',
      storyId: item.storyId || '',
    };
    setTitle(fields.title);
    setShortTitle(fields.shortTitle);
    setSummary(fields.summary);
    setContent(fields.content);
    setCategoryId(fields.categoryId);
    setSourceId(fields.sourceId);
    setPriority(fields.priority);
    setLocationName(fields.locationName);
    setEventDate(fields.eventDate);
    setMainImageUrl(fields.mainImageUrl);
    setVideoUrl(fields.videoUrl);
    setKeywords(fields.keywords);
    setIsBreaking(fields.isBreaking);
    setInternalNotes(fields.internalNotes);
    setStoryId(fields.storyId);
    loadedSnapshotRef.current = JSON.stringify(fields);
    setBaseUpdatedAt(item.updatedAt);
  };

  // Load once per story (the editor is re-mounted per story); later refreshes never wipe typing.
  useEffect(() => {
    if (newsItem) {
      loadFromItem(newsItem);
    } else {
      const fields = {
        title: '',
        shortTitle: '',
        summary: '',
        content: '',
        categoryId: categories[0]?.id || '',
        sourceId: sources[0]?.id || '',
        priority: 'NORMAL' as NewsPriority,
        locationName: '',
        eventDate: new Date().toISOString().slice(0, 16),
        mainImageUrl: '',
        videoUrl: '',
        keywords: [] as string[],
        isBreaking: false,
        internalNotes: '',
        storyId: defaultStoryId || '',
      };
      setCategoryId(fields.categoryId);
      setSourceId(seed?.sourceId || fields.sourceId);
      setStoryId(fields.storyId);
      loadedSnapshotRef.current = JSON.stringify(fields);
      if (seed) {
        setTitle(seed.title);
        setShortTitle(seed.title.slice(0, 80));
        setSummary(seed.summary);
        setContent(seed.content);
        setInternalNotes(seed.internalNotes);
      }
    }
    checkForDraft(newsItem?.updatedAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newsItem?.id]);

  const newerVersionAvailable = !!newsItem?.updatedAt && !!baseUpdatedAt && newsItem.updatedAt !== baseUpdatedAt;

  // With nothing typed, follow the server copy (e.g. while read-only, or after a colleague releases the story).
  useEffect(() => {
    if (newsItem && newerVersionAvailable && !isDirty) loadFromItem(newsItem);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newsItem?.updatedAt, lock.status]);
  const canEditContent = canEditNewsContent(can, currentUser.id, newsItem) && !lockedByOther;
  const transitions = newsItem?.id ? availableTransitions(can, currentUser.id, newsItem) : [];
  const canCreateForReview = !newsItem?.id && transitionDenial(can, currentUser.id, null, 'UNDER_REVIEW') === null;


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

  const buildPayload = () => {
    const selectedCat = categories.find((c) => c.id === categoryId);
    const selectedSrc = sources.find((src) => src.id === sourceId);
    return {
      id: newsItem?.id,
      title: title || 'خبر جديد بدون عنوان',
      shortTitle: shortTitle || title,
      summary,
      content,
      categoryId,
      categoryName: selectedCat?.nameAr || '',
      sourceId,
      sourceName: selectedSrc?.name || '',
      priority,
      locationName,
      eventDate,
      mainImageUrl,
      videoUrl: videoUrl || undefined,
      keywords,
      isBreaking,
      internalNotes,
      storyId: storyId || undefined,
      wireId: newsItem?.wireId ?? seed?.wireId,
      expectedUpdatedAt: newsItem?.id ? baseUpdatedAt : undefined,
    };
  };

  /** Saves the text (never the status). Returns the stored story or null. */
  const saveContent = (stay: boolean, extra: Partial<NewsItem> = {}): NewsItem | null => {
    const saved = onSave({ ...buildPayload(), ...extra }, { stay });
    if (saved) {
      clearDraft();
      loadedSnapshotRef.current = JSON.stringify(formFields());
      setBaseUpdatedAt(saved.updatedAt);
    }
    return saved;
  };

  const handleSaveDraft = () => {
    saveContent(false);
  };

  const handleTriggerStatusChange = (status: NewsStatus) => {
    if (!newsItem?.id) {
      saveContent(false, { status });
      return;
    }
    setPendingStatus(status);
    setShowCommentModal(true);
  };

  const needsComment = pendingStatus === 'NEEDS_REVISION' || pendingStatus === 'REJECTED';
  const scheduleInvalid = pendingStatus === 'SCHEDULED' && (!scheduleAt || new Date(scheduleAt).getTime() < Date.now());

  const handleConfirmStatus = () => {
    if (!newsItem?.id || !pendingStatus) return;
    if (needsComment && !statusComment.trim()) return;
    if (scheduleInvalid) return;
    // Unsaved text is saved first so a transition never silently drops edits.
    if (isDirty && canEditContent) {
      const saved = saveContent(true);
      if (!saved) return;
    }
    // datetime-local is local time; send an absolute instant.
    onUpdateStatus(newsItem.id, pendingStatus, statusComment, pendingStatus === 'SCHEDULED' ? new Date(scheduleAt).toISOString() : undefined);
    const fresh = apiService.getNewsById(newsItem.id);
    if (fresh) setBaseUpdatedAt(fresh.updatedAt);
    setShowCommentModal(false);
    setStatusComment('');
  };

  const TRANSITION_BUTTONS: Partial<Record<NewsStatus, { label: string; className: string }>> = {
    UNDER_REVIEW: { label: 'إرسال للمراجعة والتدقيق', className: 'bg-amber-600 hover:bg-amber-700' },
    APPROVED: { label: 'اعتماد الخبر للنشر', className: 'bg-purple-600 hover:bg-purple-700' },
    NEEDS_REVISION: { label: 'إعادة للكاتب مع ملاحظات', className: 'bg-orange-600 hover:bg-orange-700' },
    REJECTED: { label: 'رفض الخبر', className: 'bg-red-700 hover:bg-red-800' },
    PUBLISHED: { label: 'نشر فوري على المنصات', className: 'bg-emerald-600 hover:bg-emerald-700' },
    SCHEDULED: { label: 'جدولة النشر', className: 'bg-sky-600 hover:bg-sky-700' },
    UNPUBLISHED: { label: 'سحب النشر', className: 'bg-slate-700 hover:bg-slate-800' },
    ARCHIVED: { label: 'أرشفة الخبر', className: 'bg-slate-800 hover:bg-slate-900' },
  };

  return (
    <div className="space-y-6">
      {/* Contextual Breadcrumbs */}
      <Breadcrumbs
        items={[
          { label: 'غرفة الأخبار', onClick: onCancel },
          { label: newsItem ? (newsItem.title ? `تحرير: ${newsItem.title.slice(0, 35)}...` : 'تحرير الخبر') : 'إنشاء مادة إخبارية جديدة' },
        ]}
        statusBadge={
          newsItem
            ? {
                label: `الحالة: ${NEWS_STATUS_LABELS[newsItem.status] || newsItem.status}`,
                variant: newsItem.status === 'PUBLISHED' ? 'success' : newsItem.status === 'APPROVED' ? 'primary' : 'warning',
              }
            : undefined
        }
        onBack={onCancel}
        backLabel="العودة لقائمة الأخبار"
      />

      {/* Emergency Draft Recovery Alert */}
      {hasEmergencyDraft && (
        <div className="bg-amber-50 border border-amber-200 p-4 rounded-2xl flex flex-wrap items-center justify-between gap-3 text-amber-900 shadow-xs animate-in fade-in">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
            <div>
              <strong className="text-xs font-bold block">تنبيه حماية البث الحي: تم العثور على مسودة أحدث محفوظة محلياً</strong>
              <span className="text-[11px] text-amber-700">
                يمكنك استعادة محتوى النص والملخص قبل فقدانه أو إغلاق المتصفح.
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleRestoreEmergencyDraft}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold transition-colors shadow-xs"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              استعادة المسودة الآن
            </button>
            <button
              type="button"
              onClick={() => setHasEmergencyDraft(false)}
              className="px-2.5 py-1.5 text-xs text-amber-700 hover:bg-amber-100 rounded-lg"
            >
              تجاهل
            </button>
          </div>
        </div>
      )}

      {/* Edit lock: someone else is editing this story */}
      {lockedByOther && lock.holder && (
        <div role="alert" className="bg-amber-50 border border-amber-300 p-4 rounded-2xl flex flex-wrap items-center justify-between gap-3 text-amber-900">
          <div className="flex items-center gap-2.5">
            <Lock className="w-5 h-5 text-amber-600 shrink-0" />
            <div>
              <strong className="text-xs font-bold block">هذا الخبر قيد التحرير الآن لدى {lock.holder.userName}</strong>
              <span className="text-[11px] text-amber-700">يمكنك القراءة فقط حتى ينتهي من التحرير. ستُتاح الكتابة تلقائياً عند إغلاقه للخبر.</span>
            </div>
          </div>
          {can('news.edit_any') && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm(`سيفقد ${lock.holder?.userName} أي تعديلات غير محفوظة. تولي تحرير الخبر؟`)) void lock.takeOver();
              }}
              className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold"
            >
              تولي التحرير
            </button>
          )}
        </div>
      )}

      {!lockedByOther && newsItem?.id && !canEditNewsContent(can, currentUser.id, newsItem) && (
        <div className="bg-slate-50 border border-slate-200 p-3 rounded-2xl text-xs text-slate-700 font-semibold flex items-center gap-2">
          <Lock className="w-4 h-4 text-slate-500" />
          للقراءة فقط: {newsItem.status === 'PUBLISHED' || newsItem.status === 'APPROVED' ? 'تعديل خبر معتمد أو منشور يتطلب صلاحية الاعتماد أو النشر.' : 'لا تملك صلاحية تعديل هذا الخبر.'}
        </div>
      )}

      {newsItem?.status === 'SCHEDULED' && newsItem.scheduledDate && (
        <div className="bg-sky-50 border border-sky-200 p-3 rounded-2xl text-xs text-sky-900 font-semibold flex items-center gap-2">
          <Clock className="w-4 h-4 text-sky-600" />
          مجدول للنشر تلقائياً في {new Date(newsItem.scheduledDate).toLocaleString('ar-SA')}
        </div>
      )}

      {newerVersionAvailable && !lockedByOther && (
        <div className="bg-blue-50 border border-blue-200 p-3 rounded-2xl flex flex-wrap items-center justify-between gap-2 text-xs text-blue-900">
          <span className="font-semibold">حُفظت نسخة أحدث من هذا الخبر على الخادم بعد فتحك له.</span>
          <button
            type="button"
            onClick={() => newsItem && loadFromItem(newsItem)}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold"
          >
            تحميل أحدث نسخة (تُفقد تعديلاتك غير المحفوظة)
          </button>
        </div>
      )}

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
                الحالة: {newsItem?.status ? NEWS_STATUS_LABELS[newsItem.status] : 'مسودة جديدة'}
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
                    نسخة احتياطية محلية...
                  </>
                ) : lastSaved && isDirty ? (
                  <>
                    <CheckCircle className="w-3 h-3 text-amber-500" />
                    تغييرات غير محفوظة (نسخة احتياطية على هذا الجهاز {lastSaved.toLocaleTimeString('ar-SA')})
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        {/* Action Buttons (only what the server will accept) */}
        <div className="flex flex-wrap items-center gap-2">
          {newsItem?.id && (
            <button
              type="button"
              onClick={() => setIsHistoryOpen(true)}
              className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-bold"
            >
              <History className="w-4 h-4" />
              سجل النسخ
            </button>
          )}

          {canEditContent && (
            <button
              type="button"
              onClick={handleSaveDraft}
              disabled={lock.status === 'acquiring'}
              className="flex items-center gap-1.5 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-colors disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {newsItem?.id ? 'حفظ التغييرات' : 'حفظ كمسودة'}
            </button>
          )}

          {canCreateForReview && (
            <button
              type="button"
              onClick={() => handleTriggerStatusChange('UNDER_REVIEW')}
              className="flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs"
            >
              <Send className="w-4 h-4" />
              حفظ وإرسال للمراجعة
            </button>
          )}

          {!lockedByOther &&
            transitions
              .filter((t) => TRANSITION_BUTTONS[t])
              .map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => handleTriggerStatusChange(t)}
                  className={`flex items-center gap-1.5 px-4 py-2 text-white rounded-xl text-xs font-bold transition-all shadow-xs ${TRANSITION_BUTTONS[t]!.className}`}
                >
                  {t === 'UNDER_REVIEW' && <Send className="w-4 h-4" />}
                  {t === 'APPROVED' && <CheckCircle className="w-4 h-4" />}
                  {t === 'PUBLISHED' && <Radio className="w-4 h-4" />}
                  {newsItem?.status === 'SCHEDULED' && t === 'APPROVED' ? 'إلغاء الجدولة' : TRANSITION_BUTTONS[t]!.label}
                </button>
              ))}
        </div>
      </div>

      {/* Broadcast Timing & Production Tools Banner */}
      <div className="bg-slate-900 text-white p-3.5 rounded-2xl border border-slate-800 flex flex-wrap items-center justify-between gap-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-4 sm:gap-6 text-xs">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-blue-500/20 text-blue-400 rounded-lg">
              <Clock className="w-4 h-4" />
            </div>
            <div>
              <span className="text-[10px] text-slate-400 block">زمن الإلقاء المقدر (130 ك/د):</span>
              <strong className="text-sm font-mono text-emerald-400">{textStats.timeFormatted} دقيقة</strong>
            </div>
          </div>

          <div className="h-6 w-px bg-slate-800 hidden sm:block" />

          <div>
            <span className="text-[10px] text-slate-400 block">عدد الكلمات:</span>
            <span className="font-mono font-bold text-slate-200">{textStats.words} كلمة</span>
          </div>

          <div className="h-6 w-px bg-slate-800 hidden sm:block" />

          <div>
            <span className="text-[10px] text-slate-400 block">عدد الأحرف:</span>
            <span className="font-mono text-slate-300">{textStats.chars} حرف</span>
          </div>
        </div>

        {/* Broadcast Helper Tools */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setIsAiCopilotOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs border border-blue-400/30"
            title="المساعد التحريري الذكي: إعادة الصياغة التلفزيونية وتوليد العناوين والشارات"
          >
            <Bot className="w-3.5 h-3.5 text-amber-300" />
            المساعد الذكي (AI Co-Pilot)
          </button>

          <button
            type="button"
            onClick={() => setIsCgModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-blue-300 rounded-xl text-xs font-bold transition-colors border border-slate-700"
            title="توليد وسوم شارات الجرافيكس التلفزيوني وعناوين الشاشة"
          >
            <Sparkles className="w-3.5 h-3.5 text-blue-400" />
            مولد الشارات (CG Lower Thirds)
          </button>

          <button
            type="button"
            onClick={handleCopyPrompterText}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600/30 hover:bg-purple-600/50 text-purple-200 rounded-xl text-xs font-bold transition-colors border border-purple-500/30"
            title="نسخ نص الملقن المباشر للمذيع (AutoCue Format)"
          >
            {copiedPrompter ? <CheckCircle className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copiedPrompter ? 'تم نسخ نص الملقن' : 'نسخ للأوتوكيو'}
          </button>
        </div>
      </div>

      {/* Main Grid: Content Area & Metadata Sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Main Editor */}
        <div className="lg:col-span-2 space-y-5">
          {/* Main Title & Strap Controls */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-4">
            {/* Title Input */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="news-headline-input" className="block text-xs font-bold text-slate-700">
                  العنوان الرئيسي للمادة الصحفية *
                </label>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-[11px] font-mono px-2 py-0.5 rounded-md font-semibold transition-colors ${
                      title.length === 0
                        ? 'text-slate-400 bg-slate-100'
                        : title.length < 30
                        ? 'text-amber-700 bg-amber-50 border border-amber-200'
                        : title.length <= 75
                        ? 'text-emerald-700 bg-emerald-50 border border-emerald-200'
                        : 'text-rose-700 bg-rose-50 border border-rose-200'
                    }`}
                  >
                    {title.length}/75 حرف{' '}
                    {title.length >= 30 && title.length <= 75 ? '(طول مثالي للبث)' : title.length > 75 ? '(طويل نسبياً)' : ''}
                  </span>
                  {title && (
                    <button
                      type="button"
                      onClick={handleCopyTitle}
                      className="text-[11px] text-slate-500 hover:text-blue-600 flex items-center gap-1 bg-slate-100 hover:bg-blue-50 px-2 py-0.5 rounded transition-colors"
                      title="نسخ العنوان"
                    >
                      {copiedTitle ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                      {copiedTitle ? 'تم النسخ' : 'نسخ'}
                    </button>
                  )}
                </div>
              </div>

              <div className="relative">
                <input
                  id="news-headline-input"
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="اكتب عنواناً جذاباً ودقيقاً يصف جوهر الحدث..."
                  className="w-full pl-10 pr-4 py-3 bg-white border border-slate-300 rounded-xl text-base font-bold text-slate-800 placeholder:font-normal placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                />
                {title && (
                  <button
                    type="button"
                    onClick={() => setTitle('')}
                    className="absolute left-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-rose-600 rounded-full hover:bg-slate-100"
                    title="مسح العنوان"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Short Title & Ticker Simulator */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="news-short-title-input" className="block text-xs font-bold text-slate-700">
                  العنوان المختصر (يستخدم في شريط البث السفلي Ticker والأوتوكيو)
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-mono text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                    {shortTitle.length} حرف
                  </span>
                  {title && !shortTitle && (
                    <button
                      type="button"
                      onClick={handleGenerateShortTitle}
                      className="text-[11px] text-blue-600 hover:text-blue-700 font-bold flex items-center gap-1 bg-blue-50 px-2 py-0.5 rounded hover:bg-blue-100 transition-colors"
                    >
                      <Wand2 className="w-3 h-3" />
                      توليد من العنوان
                    </button>
                  )}
                </div>
              </div>

              <div className="relative">
                <input
                  id="news-short-title-input"
                  type="text"
                  value={shortTitle}
                  onChange={(e) => setShortTitle(e.target.value)}
                  placeholder="عنوان مختصر ومكثف لا يتجاوز 10 كلمات..."
                  className="w-full pl-10 pr-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                  maxLength={120}
                />
                {shortTitle && (
                  <button
                    type="button"
                    onClick={() => setShortTitle('')}
                    className="absolute left-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-rose-600 rounded-full hover:bg-slate-100"
                    title="مسح العنوان المختصر"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Live Ticker Strap Preview Simulator */}
              {(shortTitle || title) && showTickerPreview && (
                <div className="mt-2 p-2.5 bg-slate-950 text-white rounded-xl border border-slate-800 shadow-inner flex items-center gap-3 overflow-hidden">
                  <div className="flex items-center gap-1.5 px-2.5 py-1 bg-red-600 text-white font-black text-[11px] rounded tracking-wide shrink-0 animate-pulse">
                    <Flame className="w-3 h-3" />
                    شريط الأخبار
                  </div>
                  <div className="text-xs font-bold text-amber-200 truncate flex-1 font-sans">
                    {shortTitle || title}
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono shrink-0 hidden sm:inline">
                    LIVE ON-AIR CUE
                  </span>
                </div>
              )}
            </div>

            {/* Summary / Lead Paragraph */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="news-summary-textarea" className="block text-xs font-bold text-slate-700">
                  المقدمة والملخص الإخباري (Lead Paragraph)
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-mono text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                    {(summary.match(/\S+/g) || []).length} كلمة
                  </span>
                  {summary && (
                    <button
                      type="button"
                      onClick={() => setSummary('')}
                      className="text-[11px] text-rose-500 hover:text-rose-700"
                      title="مسح الملخص"
                    >
                      مسح
                    </button>
                  )}
                </div>
              </div>

              <textarea
                id="news-summary-textarea"
                rows={3}
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="يجيب عن الأسئلة الصحفية الستة (من، ماذا، أين، متى، لماذا، كيف)..."
                className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs leading-relaxed text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
              />

              {/* Quick Lead Templates */}
              {!summary && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] text-slate-400 font-bold">بدايات سريعة:</span>
                  {LEAD_STARTERS.map((starter, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setSummary(starter)}
                      className="text-[10px] bg-slate-100 hover:bg-blue-50 text-slate-600 hover:text-blue-700 px-2 py-0.5 rounded-md transition-colors border border-slate-200"
                    >
                      {starter.slice(0, 24)}...
                    </button>
                  ))}
                </div>
              )}
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

          {/* Internal Notes with Quick Directives */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <Info className="w-4 h-4 text-blue-500" />
                ملاحظات داخلية لغرفة الأخبار وهيئة التحرير والمخرج
              </label>
              {internalNotes && (
                <button
                  type="button"
                  onClick={() => setInternalNotes('')}
                  className="text-[11px] text-rose-500 hover:text-rose-700"
                >
                  مسح
                </button>
              )}
            </div>
            <textarea
              rows={2}
              value={internalNotes}
              onChange={(e) => setInternalNotes(e.target.value)}
              placeholder="تعليمات للمذيعين، التحقق من الترجمة، توجيهات المخرج..."
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="text-[10px] text-slate-400 font-bold">توجيهات نموذجية:</span>
              {DIRECTIVE_PRESETS.map((preset, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() =>
                    setInternalNotes((prev) => (prev ? `${prev} ${preset}` : preset))
                  }
                  className="text-[10px] bg-blue-50 hover:bg-blue-100 text-blue-700 px-2 py-0.5 rounded-md transition-colors border border-blue-200/50"
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right 1 Col: Editorial Metadata & Publishing Controls */}
        <div className="space-y-5">
          {/* Publishing & Category Box */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-4">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider border-b border-slate-100 pb-2">
              البيانات الوصفية والتصنيف
            </h3>

            {/* Breaking News Toggle (goes on air once the story is published) */}
            {can('news.breaking_push') && (
            <div className="p-3 bg-red-50/70 border border-red-200 rounded-xl flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Flame className="w-5 h-5 text-red-600 animate-pulse" />
                <div>
                  <span className="text-xs font-bold text-red-900 block">خبر عاجل للبث</span>
                  <span className="text-[10px] text-red-700 block">يظهر على شريط العاجل عند نشره ولمدة 4 ساعات</span>
                </div>
              </div>
              <input
                type="checkbox"
                checked={isBreaking}
                onChange={(e) => setIsBreaking(e.target.checked)}
                className="w-5 h-5 text-red-600 rounded-md focus:ring-red-500 cursor-pointer"
              />
            </div>
            )}

            {/* Link to a running coverage (story) */}
            <div>
              <label htmlFor="news-story-select" className="block text-xs font-bold text-slate-700 mb-1">القصة / التغطية المرتبطة</label>
              <select
                id="news-story-select"
                value={storyId}
                onChange={(e) => setStoryId(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs font-semibold text-slate-800"
              >
                <option value="">— بدون قصة —</option>
                {stories
                  .filter((st) => st.status !== 'ARCHIVED' || st.id === storyId)
                  .map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.title}
                    </option>
                  ))}
              </select>
            </div>

            {/* Category */}
            <div>
              <label htmlFor="news-category-select" className="block text-xs font-bold text-slate-700 mb-1">القسم الصحفي *</label>
              <select
                id="news-category-select"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
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
              <label htmlFor="news-source-select" className="block text-xs font-bold text-slate-700 mb-1">مصدر الخبر *</label>
              <select
                id="news-source-select"
                value={sourceId}
                onChange={(e) => setSourceId(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all font-medium"
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
              <label htmlFor="news-priority-select" className="block text-xs font-bold text-slate-700 mb-1">الأولوية والخطورة</label>
              <select
                id="news-priority-select"
                value={priority}
                onChange={(e) => setPriority(e.target.value as NewsPriority)}
                className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs bg-white font-bold text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
              >
                <option value="URGENT">🔴 عاجل جداً (Urgent)</option>
                <option value="HIGH">🟠 أولوية عالية (High)</option>
                <option value="NORMAL">🔵 أولوية عادية (Normal)</option>
                <option value="LOW">⚪ أولوية منخفضة (Low)</option>
              </select>
            </div>

            {/* Location & Event Date with Quick-Select Chips */}
            <div className="space-y-3 pt-2 border-t border-slate-100">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label htmlFor="news-location-input" className="block text-xs font-bold text-slate-700 flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5 text-slate-400" />
                    مكان الحدث والمكتب
                  </label>
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
                <div className="relative">
                  <input
                    id="news-location-input"
                    type="text"
                    value={locationName}
                    onChange={(e) => setLocationName(e.target.value)}
                    placeholder="مثال: الرياض، القاهرة، جنيف..."
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs font-semibold text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                  />
                </div>
                {/* Location Quick Presets */}
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {LOCATION_PRESETS.map((loc) => (
                    <button
                      key={loc}
                      type="button"
                      onClick={() => setLocationName(loc)}
                      className={`text-[10px] px-2 py-0.5 rounded-md transition-all ${
                        locationName === loc
                          ? 'bg-blue-600 text-white font-bold'
                          : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                      }`}
                    >
                      {loc}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label htmlFor="news-event-date-input" className="block text-xs font-bold text-slate-700 flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                    تاريخ وتوقيت وقوع الحدث
                  </label>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setEventDate(new Date().toISOString().slice(0, 16))}
                      className="text-[10px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded hover:bg-blue-100"
                    >
                      الآن
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setEventDate(new Date(Date.now() - 30 * 60000).toISOString().slice(0, 16))
                      }
                      className="text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded hover:bg-slate-200"
                    >
                      -30د
                    </button>
                  </div>
                </div>
                <input
                  id="news-event-date-input"
                  type="datetime-local"
                  value={eventDate}
                  onChange={(e) => setEventDate(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs font-mono text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
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
                          {new Date(log.timestamp).toLocaleString('ar-SA', {
                            hour: '2-digit',
                            minute: '2-digit',
                            month: 'short',
                            day: 'numeric',
                          })}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600">
                        غيّر الحالة إلى:{' '}
                        <span className="font-bold text-blue-700 bg-blue-50 px-1 rounded">
                          {log.toStatus}
                        </span>
                      </p>
                      {log.comment && (
                        <p className="text-[10px] text-slate-500 italic bg-white p-1.5 rounded border border-slate-100 mt-1">
                          "{log.comment}"
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Media Links & Presets */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-3">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider border-b border-slate-100 pb-2">
              الوسائط المرفقة وسيرفرات البث
            </h3>

            {/* Image URL */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="news-image-url-input" className="block text-xs font-bold text-slate-700 flex items-center gap-1">
                  <ImageIcon className="w-3.5 h-3.5 text-slate-400" />
                  رابط الصورة البارزة (URL)
                </label>
                {mainImageUrl && (
                  <button
                    type="button"
                    onClick={() => setMainImageUrl('')}
                    className="text-[10px] text-slate-400 hover:text-rose-500"
                  >
                    مسح
                  </button>
                )}
              </div>

              <input
                id="news-image-url-input"
                type="url"
                inputMode="url"
                autoCapitalize="none"
                spellCheck="false"
                value={mainImageUrl}
                onChange={(e) => setMainImageUrl(e.target.value)}
                placeholder="https://...jpg"
                className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-left font-mono text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                dir="ltr"
              />

              {/* Recent images from the media library */}
              {IMAGE_PRESETS.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                <span className="text-[10px] text-slate-400 font-bold">من مكتبة الوسائط:</span>
                {IMAGE_PRESETS.map((img) => (
                  <button
                    key={img.label}
                    type="button"
                    onClick={() => setMainImageUrl(img.url)}
                    className="text-[10px] bg-slate-100 hover:bg-blue-50 text-slate-600 hover:text-blue-700 px-2 py-0.5 rounded-md transition-colors"
                  >
                    {img.label}
                  </button>
                ))}
              </div>
              )}

              {mainImageUrl && (
                <div className="relative mt-2 rounded-xl overflow-hidden border border-slate-200 group">
                  <img
                    src={mainImageUrl}
                    alt="معاينة الصورة"
                    className="w-full h-32 object-cover"
                  />
                  <div className="absolute bottom-1 right-1 px-1.5 py-0.5 bg-black/70 text-[9px] font-mono text-white rounded">
                    16:9 Broadcast Frame
                  </div>
                </div>
              )}
            </div>

            {/* Video Playout URL */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="news-video-url-input" className="block text-xs font-bold text-slate-700 flex items-center gap-1">
                  <Video className="w-3.5 h-3.5 text-slate-400" />
                  رابط الفيديو وسيرفر البث (Playout)
                </label>
                {videoUrl && (
                  <button
                    type="button"
                    onClick={() => setVideoUrl('')}
                    className="text-[10px] text-slate-400 hover:text-rose-500"
                  >
                    مسح
                  </button>
                )}
              </div>

              <input
                id="news-video-url-input"
                type="text"
                autoCapitalize="none"
                spellCheck="false"
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                placeholder="https://...mp4"
                className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-left font-mono text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                dir="ltr"
              />

            </div>
          </div>

          {/* Keywords / Tags with Trending Suggestions */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <label htmlFor="news-tag-input" className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5 cursor-pointer">
                <Tag className="w-3.5 h-3.5 text-blue-500" />
                الكلمات المفتاحية والوسوم
              </label>
              {keywords.length > 0 && (
                <button
                  type="button"
                  onClick={() => setKeywords([])}
                  className="text-[10px] text-slate-400 hover:text-rose-500"
                >
                  مسح الكل
                </button>
              )}
            </div>

            <div className="relative">
              <input
                id="news-tag-input"
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleAddTag}
                placeholder="اكتب الوسم واضغط Enter للإضافة..."
                className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
              />
            </div>

            {/* Trending Suggestions */}
            <div>
              <span className="text-[10px] text-slate-400 font-bold block mb-1">
                وسوم مقترحة وشائعة:
              </span>
              <div className="flex flex-wrap gap-1">
                {TRENDING_TAGS.map((t) => {
                  const alreadyAdded = keywords.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => {
                        if (!alreadyAdded) {
                          setKeywords((prev) => [...prev, t]);
                        }
                      }}
                      disabled={alreadyAdded}
                      className={`text-[10px] px-2 py-0.5 rounded-full transition-all flex items-center gap-0.5 ${
                        alreadyAdded
                          ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                          : 'bg-blue-50 hover:bg-blue-100 text-blue-700 font-medium'
                      }`}
                    >
                      <span>#{t}</span>
                      {alreadyAdded && <Check className="w-2.5 h-2.5 text-slate-400" />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Active Tags */}
            {keywords.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-2 border-t border-slate-100">
                {keywords.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-600 text-white shadow-2xs"
                  >
                    <span>#{tag}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveTag(tag)}
                      className="hover:text-amber-200 text-white"
                      title="حذف الوسم"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Status Transition Comment Modal */}
      {showCommentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-6 max-w-md w-full space-y-4 text-right">
            <h3 className="text-base font-bold text-slate-800">
              تأكيد نقل الحالة التحريرية إلى: «{pendingStatus ? NEWS_STATUS_LABELS[pendingStatus] : ''}»
            </h3>
            <p className="text-xs text-slate-500">
              {needsComment
                ? 'اكتب ملاحظاتك للكاتب (إلزامية) لتُسجل في سجل سير العمل:'
                : 'أدخل ملاحظات التدقيق أو المراجعة لتسجيلها في سجل سير العمل (اختياري):'}
              {isDirty && canEditContent && <span className="block mt-1 text-amber-700 font-semibold">سيتم حفظ تعديلاتك غير المحفوظة أولاً.</span>}
            </p>
            {pendingStatus === 'SCHEDULED' && (
              <div>
                <label htmlFor="schedule-at-input" className="block text-xs font-bold text-slate-700 mb-1">موعد النشر (بتوقيت جهازك)</label>
                <input
                  id="schedule-at-input"
                  type="datetime-local"
                  value={scheduleAt}
                  min={new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}
                  onChange={(e) => setScheduleAt(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs font-mono"
                  dir="ltr"
                />
                <p className="text-[10px] text-slate-500 mt-1">ينشر الخادم الخبر تلقائياً في هذا الموعد حتى لو لم يكن أحد متصلاً.</p>
              </div>
            )}
            <textarea
              id="status-transition-comment"
              rows={3}
              value={statusComment}
              onChange={(e) => setStatusComment(e.target.value)}
              placeholder="مثال: تم تدقيق الأسماء، مطابقة المصادر، والتأكد من الصياغة اللغوية..."
              className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
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
                disabled={(needsComment && !statusComment.trim()) || scheduleInvalid}
                className="px-4 py-2 text-xs font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-xs disabled:opacity-50"
              >
                تأكيد ونقل الحالة
              </button>
            </div>
          </div>
        </div>
      )}

      {newsItem?.id && (
        <NewsHistoryModal
          isOpen={isHistoryOpen}
          onClose={() => setIsHistoryOpen(false)}
          newsId={newsItem.id}
          canRestore={canEditContent}
          onRestore={(data) => {
            // Loaded as unsaved changes on top of the current version.
            setTitle(data.title || '');
            setShortTitle(data.shortTitle || '');
            setSummary(data.summary || '');
            setContent(data.content || '');
            setKeywords(data.keywords || []);
            if (data.categoryId) setCategoryId(data.categoryId);
            if (data.sourceId) setSourceId(data.sourceId);
            setLocationName(data.locationName || '');
            setMainImageUrl(data.mainImageUrl || '');
            setVideoUrl(data.videoUrl || '');
            setInternalNotes(data.internalNotes || '');
          }}
        />
      )}

      {/* Lower Thirds / CG Graphics Generator Modal */}
      <LowerThirdGeneratorModal
        isOpen={isCgModalOpen}
        onClose={() => setIsCgModalOpen(false)}
        onInsertTag={handleInsertCgTag}
        defaultTitle={title}
      />

      {/* AI Newsroom Co-Pilot Modal */}
      <AiNewsCoPilotModal
        isOpen={isAiCopilotOpen}
        onClose={() => setIsAiCopilotOpen(false)}
        currentTitle={title}
        currentSummary={summary}
        currentContent={content}
        onApplyChanges={handleApplyAiChanges}
      />
    </div>
  );
};
