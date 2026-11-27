import { notify } from '../services/notify';
import { ReviewThreads, type ReviewSeed } from '../components/editor/ReviewThreads';
import { FieldBreakingForm } from '../components/news/FieldBreakingForm';
import { spokenReadTime } from '../shared/readTime';
import { dataStore, QUEUED_MESSAGE } from '../services/dataStore';
import { claimReview, passQuality, releaseReview, closeBreakingRequest } from '../services/newsReview';
import { activeReviewClaim, canRequestBreaking, canReviewNews, claimDenial, isQualityPassed, qualityPassDenial } from '../shared/newsWorkflow';
import { categoryTree } from '../shared/newsCategories';
import { digitalApprovalStatus, digitalCopyOf, digitalPackageError, hasDigitalCopy } from '../shared/digitalPublishing';
import { emptyEditorialPublishing } from '../shared/editorialStylebook';
import { EditorialPublishingPanel } from '../components/editor/EditorialPublishingPanel';
import { appLocale, zoneOptions } from '../shared/dateFormat';
import { PronunciationPanel } from '../components/rundown/PronunciationPanel';
import { NewsCorrectionsPanel } from '../components/editor/NewsCorrectionsPanel';
import { matchingPronunciations } from '../shared/pronunciation';
import { confirmDialog, promptDialog } from '../services/dialogs';
import { ProofreadButton } from '../components/editor/WritingAids';
import { contentDenial, embargoLabel, isUnderEmbargo } from '../shared/newsWorkflow';
import { toLocalInputValue, fromLocalInputValue } from '../shared/dates';
import { RequestFormPage, RequestDraft } from '../components/requests/RequestFormPage';
import { MessageOriginLabel } from '../components/messages/MessageOriginLabel';
import { apiService } from '../services/api';
import { countLabel } from '../shared/arabicPlural';
import React, { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { NewsVideo, primaryVideoUrl, videosError, videosOf } from '../shared/newsVideos';
import {
  Save,
  Send,
  CheckCircle,
  Radio,
  ArrowRight,
  Flame,
  AlertTriangle,
  History,
  Info,
  Clock,
  Copy,
  RotateCcw,
  X,
  Wand2,
  Check,
  Lock,
  ShieldCheck,
  Hand,
  SkipForward,
  MessageSquarePlus,
  CornerUpLeft,
} from 'lucide-react';
import { NewsItem, NewsStatus, NewsPriority, User, Category, NewsSource } from '../types';
import { RichTextEditor } from '../components/editor/RichTextEditor';
import { Badge } from '../components/common/Badge';
import { RbacService } from '../services/rbacService';
import { useNewsEditLock } from '../hooks/useNewsEditLock';
import { NewsHistoryModal } from '../components/news/NewsHistoryModal';
import { NEWS_STATUS_LABELS, availableTransitions, canEditNewsContent, transitionDenial } from '../shared/newsWorkflow';
import type { Story, NewsDraftSeed } from '../types';
import { LowerThirdGeneratorModal } from '../components/editor/LowerThirdGeneratorModal';
import { AiNewsCoPilotModal } from '../components/editor/AiNewsCoPilotModal';
import { wordDiff, type DiffRun } from '../shared/textDiff';
import { plainText } from '../shared/bulletins';
import { CoverageOverlap } from '../components/news/CoverageOverlap';
import { NewsMetadataPanel } from '../components/editor/NewsMetadataPanel';
import { NewsBroadcastToolsBar } from '../components/editor/NewsBroadcastToolsBar';
import { NewsStatusTransitionModal } from '../components/editor/NewsStatusTransitionModal';

interface NewsEditorViewProps {
  newsItem?: NewsItem | null;
  initialBreaking?: boolean;
  currentUser: User;
  categories: Category[];
  sources: NewsSource[];
  stories?: Story[];
  /** Prefilled fields for a new story (e.g. written from an agency wire). */
  seed?: NewsDraftSeed;
  /** Pre-links a new story to a coverage (from the stories desk). */
  defaultStoryId?: string;
  /** Returns the saved story, or null if the save was refused. */
  onSave: (newsData: Partial<NewsItem> & { expectedUpdatedAt?: string }, opts?: { stay?: boolean }) => Promise<NewsItem | null>;
  onUpdateStatus: (newsId: string, toStatus: NewsStatus, comment?: string, scheduledDate?: string) => Promise<boolean>;
  onCancel: () => void;
  nextReviewId?: string;
  onNextReview?: (id: string) => void;
  reviewing?: boolean;
  /** The filtered review queue this story was opened from (for «3 من 18»). */
  reviewQueue?: string[];
}

export const NewsEditorView: React.FC<NewsEditorViewProps> = ({
  newsItem,
  initialBreaking,
  currentUser,
  categories,
  sources,
  stories = [],
  defaultStoryId,
  seed,
  onSave,
  onUpdateStatus,
  onCancel,
  nextReviewId,
  onNextReview,
  reviewing = false,
  reviewQueue = [],
}) => {
  const [storyId, setStoryId] = useState<string>(defaultStoryId || '');
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [scheduleAt, setScheduleAt] = useState('');
  // Version of the story this editor is based on; a different server copy means someone else saved.
  const [baseUpdatedAt, setBaseUpdatedAt] = useState<string | undefined>(newsItem?.updatedAt);
  const loadedSnapshotRef = useRef<string>('');
  const headlineRef = useRef<HTMLTextAreaElement>(null);

  const can = (perm: string) => RbacService.hasPermission(currentUser, perm);
  const canUseEditorialAi = RbacService.canUseModule(currentUser, 'editorialAi');
  // Whether this person may change the story at all (before looking at locks).
  const editableStory = canEditNewsContent(can, currentUser.id, newsItem);
  const lock = useNewsEditLock(newsItem?.id, editableStory);
  const lockHolder = lock.holder || lock.readerSees;
  const lockedByOther = lock.status === 'locked' || !!lock.readerSees;
  const [fieldBreaking, setFieldBreaking] = useState(() => !newsItem && !!initialBreaking && canRequestBreaking(can));
  const [title, setTitle] = useState('');
  // The headline wraps instead of scrolling sideways, so the editor always sees all of it.
  useLayoutEffect(() => {
    const el = headlineRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [title]);
  const [shortTitle, setShortTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [content, setContent] = useState('');
  const [digitalDraft, setDigitalDraft] = useState(() => digitalCopyOf(newsItem?.digitalPackage));
  const categoryOptions = useMemo(() => categoryTree(categories), [categories]);
  const [categoryId, setCategoryId] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [priority, setPriority] = useState<NewsPriority>(apiService.getSettings().defaultNewsPriority || 'NORMAL');
  const [locationName, setLocationName] = useState('المقر الرئيسي');
  const [eventDate, setEventDate] = useState(() => toLocalInputValue());
  const [mainImageUrl, setMainImageUrl] = useState('');
  const [videos, setVideos] = useState<NewsVideo[]>([]);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [isBreaking, setIsBreaking] = useState(false);
  const [internalNotes, setInternalNotes] = useState('');
  // Embargo as a local datetime-local value ('' = none).
  const [embargoUntil, setEmbargoUntil] = useState('');
  const [embargoNote, setEmbargoNote] = useState('');
  const [mediaIds, setMediaIds] = useState<string[]>([]);
  const [requestDraft, setRequestDraft] = useState<RequestDraft | null>(null);
  const [requestNotice, setRequestNotice] = useState<string | null>(null);

  const [statusComment, setStatusComment] = useState('');
  const [showCommentModal, setShowCommentModal] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<NewsStatus | null>(null);
  const [draftSavedMinute, setDraftSavedMinute] = useState<number | null>(null);
  const [draftStorageFailed, setDraftStorageFailed] = useState(false);

  // Broadcast Production State
  const [isCgModalOpen, setIsCgModalOpen] = useState(false);
  const [isAiCopilotOpen, setIsAiCopilotOpen] = useState(false);
  const [hasEmergencyDraft, setHasEmergencyDraft] = useState(false);
  const [draftComparison, setDraftComparison] = useState<{ key: string; fields: { label: string; runs: DiffRun[] }[] }>();
  const [draftVersionChanged, setDraftVersionChanged] = useState(false);
  const [copiedPrompter, setCopiedPrompter] = useState(false);
  const [copiedTitle, setCopiedTitle] = useState(false);
  // A secondary preview: closed until the editor asks for it, open from the start for breaking news.
  const [tickerChoice, setTickerChoice] = useState<boolean | null>(null);
  const showTickerPreview = tickerChoice ?? isBreaking;

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

  // One read-time figure (the same function as the body editor's footer): the lead and the body.
  const textStats = useMemo(() => {
    const spoken = spokenReadTime(summary, content);
    const chars = [summary, content.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ')].map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' ').length;
    return { words: spoken.words, chars, readingSeconds: spoken.seconds, timeFormatted: spoken.clock, label: spoken.label };
  }, [summary, content]);

  const formFields = () => ({
    title,
    shortTitle,
    summary,
    content,
    digitalDraft,
    categoryId,
    sourceId,
    priority,
    locationName,
    eventDate,
    mainImageUrl,
    videos,
    keywords,
    isBreaking,
    internalNotes,
    storyId,
    mediaIds,
    embargoUntil,
    embargoNote,
    tagInput,
  });
  const formFieldsRef = useRef(formFields);
  formFieldsRef.current = formFields;
  const isDirty = JSON.stringify(formFields()) !== loadedSnapshotRef.current;
  // The baseline this render compared against: a callback from an older render (before the story loaded)
  // must not store its empty fields as a "draft" of the loaded story.
  const renderSnapshot = loadedSnapshotRef.current;
  const persistDraftRef = useRef<() => void>(() => {});
  persistDraftRef.current = () => {
    if (!loadedSnapshotRef.current || loadedSnapshotRef.current !== renderSnapshot || !isDirty || !editableStory || lockedByOther || hasEmergencyDraft) return;
    try {
      const savedAt = new Date();
      localStorage.setItem(draftKey, JSON.stringify({ ...formFields(), savedAt: savedAt.toISOString(), baseUpdatedAt }));
      setDraftStorageFailed(false);
      // Preserve immediate crash recovery while keeping the status text stable as the user types.
      setDraftSavedMinute(Math.floor(savedAt.getTime() / 60_000));
    } catch {
      setDraftStorageFailed(true);
    }
  };

  // Closing or reloading the tab with unsaved text asks first (the local recovery copy stays as a safety net).
  useEffect(() => {
    if (!isDirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      persistDraftRef.current();
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isDirty]);

  const clearDraft = () => {
    try {
      localStorage.removeItem(draftKey);
    } catch {
      // ignore
    }
    setHasEmergencyDraft(false);
    setDraftComparison(undefined);
  };

  const compareEmergencyDraft = () => {
    const raw = localStorage.getItem(draftKey);
    if (!raw) return;
    try {
      const draft = JSON.parse(raw);
      const fields = [
        { label: 'العنوان', runs: wordDiff(title, typeof draft.title === 'string' ? draft.title : title) },
        { label: 'المقدمة', runs: wordDiff(summary, typeof draft.summary === 'string' ? draft.summary : summary) },
        { label: 'النص', runs: wordDiff(plainText(content), plainText(typeof draft.content === 'string' ? draft.content : content)) },
      ].filter(({ runs }) => runs.some(({ kind }) => kind !== 'same'));
      setDraftComparison({ key: draftKey, fields });
    } catch {
      setDraftComparison(undefined);
    }
  };

  // Offer a local draft only if it was based on the server version now loaded and holds different text.
  const checkForDraft = (serverUpdatedAt: string | undefined) => {
    try {
      const raw = localStorage.getItem(draftKey);
      if (!raw) return;
      const draft = JSON.parse(raw);
      if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return;
      const sameBase = !newsItem?.id || draft.baseUpdatedAt === serverUpdatedAt;
      const { savedAt: _s, baseUpdatedAt: _b, ...fields } = draft;
      const differs = JSON.stringify({ ...JSON.parse(loadedSnapshotRef.current || '{}'), ...fields }) !== loadedSnapshotRef.current;
      if (!differs) {
        // The server already holds this text (e.g. sent after the connection came back): nothing to recover.
        if (newsItem?.id) localStorage.removeItem(draftKey);
      } else if (sameBase) {
        setHasEmergencyDraft(true);
      } else {
        setDraftVersionChanged(true);
        setHasEmergencyDraft(true);
      }
    } catch {
      // ignore
    }
  };

  // Persist each change; a reload must not race a debounce timer.
  useEffect(() => {
    persistDraftRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, shortTitle, summary, content, digitalDraft, categoryId, sourceId, priority, locationName, eventDate, mainImageUrl, videos, keywords, isBreaking, internalNotes, storyId, mediaIds, embargoUntil, embargoNote, tagInput, draftKey, lockedByOther, hasEmergencyDraft, baseUpdatedAt]);

  const handleRestoreEmergencyDraft = async () => {
    if (draftVersionChanged && !(await confirmDialog({
      title: 'استعادة مسودة من إصدار سابق',
      message: 'تم تحديث الخبر بعد إنشاء هذه المسودة. استعادتها ستضع نص المسودة في المحرر؛ راجع الفروق قبل حفظ التغييرات.',
      confirmLabel: 'استعادة للمراجعة',
    }))) return;
    try {
      const savedDraft = localStorage.getItem(draftKey);
      if (savedDraft) {
        const parsed = JSON.parse(savedDraft);
        if (parsed.title !== undefined) setTitle(parsed.title);
        if (parsed.shortTitle !== undefined) setShortTitle(parsed.shortTitle);
        if (parsed.summary !== undefined) setSummary(parsed.summary);
        if (parsed.content !== undefined) setContent(parsed.content);
        if (parsed.digitalDraft !== undefined) setDigitalDraft(digitalCopyOf(parsed.digitalDraft));
        if (parsed.categoryId !== undefined) setCategoryId(parsed.categoryId);
        if (parsed.sourceId !== undefined) setSourceId(parsed.sourceId);
        if (parsed.priority) setPriority(parsed.priority);
        if (parsed.locationName !== undefined) setLocationName(parsed.locationName);
        if (parsed.eventDate) setEventDate(parsed.eventDate);
        if (parsed.mainImageUrl !== undefined) setMainImageUrl(parsed.mainImageUrl);
        if (Array.isArray(parsed.videos)) setVideos(parsed.videos);
        else if (parsed.videoUrl) setVideos(videosOf({ videoUrl: parsed.videoUrl }));
        if (Array.isArray(parsed.keywords)) setKeywords(parsed.keywords);
        if (parsed.isBreaking !== undefined) setIsBreaking(parsed.isBreaking);
        if (parsed.internalNotes !== undefined) setInternalNotes(parsed.internalNotes);
        if (parsed.storyId !== undefined) setStoryId(parsed.storyId);
        if (Array.isArray(parsed.mediaIds)) setMediaIds(parsed.mediaIds);
        if (parsed.embargoUntil !== undefined) setEmbargoUntil(parsed.embargoUntil);
        if (parsed.embargoNote !== undefined) setEmbargoNote(parsed.embargoNote);
        if (parsed.tagInput !== undefined) setTagInput(parsed.tagInput);
        setHasEmergencyDraft(false);
        setDraftComparison(undefined);
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
      digitalDraft: digitalCopyOf(item.digitalPackage),
      categoryId: item.categoryId || '',
      sourceId: item.sourceId || '',
      priority: item.priority || 'NORMAL',
      locationName: item.locationName || '',
      // The field shows the station's/device's wall time for the stored instant.
      eventDate: toLocalInputValue(item.eventDate || new Date()),
      mainImageUrl: item.mainImageUrl || '',
      videos: videosOf(item),
      keywords: item.keywords || [],
      isBreaking: !!item.isBreaking,
      internalNotes: item.internalNotes || '',
      storyId: item.storyId || '',
      mediaIds: item.mediaIds || [],
      embargoUntil: item.embargoUntil ? toLocalInputValue(item.embargoUntil) : '',
      embargoNote: item.embargoNote || '',
      tagInput: '',
    };
    setTitle(fields.title);
    setShortTitle(fields.shortTitle);
    setSummary(fields.summary);
    setContent(fields.content);
    setDigitalDraft(fields.digitalDraft);
    setCategoryId(fields.categoryId);
    setSourceId(fields.sourceId);
    setPriority(fields.priority);
    setLocationName(fields.locationName);
    setEventDate(fields.eventDate);
    setMainImageUrl(fields.mainImageUrl);
    setVideos(fields.videos);
    setKeywords(fields.keywords);
    setIsBreaking(fields.isBreaking);
    setInternalNotes(fields.internalNotes);
    setStoryId(fields.storyId);
    setMediaIds(fields.mediaIds);
    setEmbargoUntil(fields.embargoUntil);
    setEmbargoNote(fields.embargoNote);
    setTagInput('');
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
        digitalDraft: digitalCopyOf(),
        categoryId: categories[0]?.id || '',
        sourceId: sources[0]?.id || '',
        priority: apiService.getSettings().defaultNewsPriority || 'NORMAL' as NewsPriority,
        locationName: 'المقر الرئيسي',
        eventDate: toLocalInputValue(),
        mainImageUrl: '',
        videos: [],
        keywords: [] as string[],
        isBreaking: false,
        internalNotes: '',
        storyId: defaultStoryId || '',
        mediaIds: [] as string[],
        embargoUntil: '',
        embargoNote: '',
        tagInput: '',
      };
      setEmbargoUntil('');
      setEmbargoNote('');
      setCategoryId(fields.categoryId);
      setSourceId(fields.sourceId);
      setStoryId(fields.storyId);
      setPriority(fields.priority);
      setLocationName(fields.locationName);
      setEventDate(fields.eventDate);
      // An untouched new form is clean: the baseline is exactly what it shows, so nothing is kept as a "draft".
      loadedSnapshotRef.current = JSON.stringify(fields);
      if (seed?.sourceId) setSourceId(seed.sourceId);
      if (seed) {
        setTitle(seed.title);
        setShortTitle(seed.title.slice(0, 80));
        setSummary(seed.summary);
        setContent(seed.content);
        setInternalNotes(seed.internalNotes);
        if (seed.storyId) setStoryId(seed.storyId);
        if (seed.categoryId) setCategoryId(seed.categoryId);
        if (seed.locationName) setLocationName(seed.locationName);
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
  const canEditContent = editableStory && !lockedByOther;
  /** Read-only: every field shows the text without accepting input. */
  const ro = !canEditContent;
  const transitions = newsItem?.id ? availableTransitions(can, currentUser.id, newsItem) : [];
  // Review mode: the story waits for review and this person reviews or approves.
  const underReview = newsItem?.status === 'UNDER_REVIEW';
  const reviewClaim = activeReviewClaim(newsItem);
  const takeOverReview = async () => {
    if (!reviewClaim || !newsItem) return;
    if (await confirmDialog(`يراجع ${reviewClaim.userName} هذا الخبر الآن. تولّي مراجعته؟`)) {
      void runReview(() => claimReview(newsItem.id), 'تولّيت مراجعة الخبر');
    }
  };
  const mayClaim = underReview && claimDenial(can, currentUser.id, newsItem) === null;
  // Approvers decide directly; the pass is for reviewers without publishing authority.
  const mayPassQuality = underReview && !can('news.approve') && qualityPassDenial(can, currentUser.id, newsItem) === null;
  const qualityPassed = !!newsItem && isQualityPassed(newsItem);
  // Review mode whenever this person has a review decision to take on the story (not its author's withdraw).
  const reviewMode = underReview && !!newsItem && canReviewNews(can) && (transitions.some((t) => t === 'APPROVED' || t === 'NEEDS_REVISION' || t === 'REJECTED') || mayPassQuality || mayClaim || !!reviewClaim);
  const canPostReview = !!newsItem?.id && (canEditContent || can('news.review') || can('news.edit_any'));
  const queueIndex = newsItem?.id ? reviewQueue.indexOf(newsItem.id) : -1;
  const queuePosition = queueIndex >= 0 && reviewQueue.length > 1 ? `${queueIndex + 1} من ${reviewQueue.length}` : null;
  const [reviewSeed, setReviewSeed] = useState<ReviewSeed | null>(null);
  const [selectedQuote, setSelectedQuote] = useState('');
  const [reviewBusy, setReviewBusy] = useState(false);
  const primaryTransition = ['UNDER_REVIEW', 'APPROVED', 'PUBLISHED'].find(status => transitions.includes(status as NewsStatus)) || transitions[0];
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
      digitalPackage: hasDigitalCopy(digitalDraft) || newsItem?.digitalPackage ? digitalDraft : undefined,
      categoryId,
      categoryName: selectedCat?.nameAr || '',
      sourceId,
      sourceName: selectedSrc?.name || '',
      priority,
      locationName,
      eventDate: fromLocalInputValue(eventDate) || eventDate,
      mainImageUrl,
      videos,
      videoUrl: primaryVideoUrl(videos, (id) => { const m: any = apiService.getMedia().find((x: any) => x.id === id); return m?.fileUrl || m?.url; }) || undefined,
      keywords,
      isBreaking,
      internalNotes,
      storyId: storyId || undefined,
      mediaIds,
      wireId: newsItem?.wireId ?? seed?.wireId,
      diaryId: newsItem?.diaryId ?? seed?.diaryId,
      embargoUntil: embargoUntil ? fromLocalInputValue(embargoUntil) : undefined,
      embargoNote: embargoUntil ? embargoNote.trim() || undefined : undefined,
      expectedUpdatedAt: newsItem?.id ? baseUpdatedAt : undefined,
    };
  };

  /** Saves the text (never the status). Returns the stored story or null. */
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'failed' | 'queued'>('idle');
  // A decision in the review queue opens the next story («اعتماد والتالي»).
  const continueReview = true;
  const actionBarRef = useRef<HTMLDivElement>(null);
  const [actionBarHeight, setActionBarHeight] = useState(100);
  useEffect(() => {
    const bar = actionBarRef.current;
    if (!bar) return;
    const observer = new ResizeObserver(() => {
      setActionBarHeight(bar.offsetHeight + 24);
      document.documentElement.style.setProperty('--editor-actions-height', `${bar.offsetHeight + 12}px`);
    });
    observer.observe(bar);
    return () => { observer.disconnect(); document.documentElement.style.removeProperty('--editor-actions-height'); };
  }, []);
  const savingRef = useRef(false);
  const saveContent = async (stay: boolean, extra: Partial<NewsItem> = {}, quiet = false): Promise<NewsItem | null> => {
    if (savingRef.current) return null;
    const packageProblem = digitalPackageError(extra.digitalPackage || digitalDraft);
    if (packageProblem) {
      notify({ type: 'warning', title: 'راجع حزمة النشر', message: packageProblem });
      return null;
    }
    const badClip = videosError(videos);
    if (badClip) {
      notify({ type: 'warning', title: 'راجع مقاطع الفيديو', message: badClip });
      document.querySelector('[data-testid="news-videos"]')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return null;
    }
    const snapshot = JSON.stringify(formFields());
    persistDraftRef.current();
    savingRef.current = true;
    setSaving(true);
    setSaveState('idle');
    try {
      const payload = extra.digitalPackage?.requestApproval && newsItem
        ? { id: newsItem.id, expectedUpdatedAt: baseUpdatedAt, digitalPackage: extra.digitalPackage }
        : { ...buildPayload(), ...extra };
      const saved = await onSave(payload, { stay: true });
      if (saved) {
        setSaveState('saved');
        loadedSnapshotRef.current = snapshot;
        setBaseUpdatedAt(saved.updatedAt);
        if (snapshot === JSON.stringify(formFieldsRef.current())) {
          clearDraft();
          if (!stay) onCancel();
        }
      }
      else if (waitingForConnection()) {
        // Kept on this device and sent when the connection is back: the text is safe, carry on from it.
        setSaveState('queued');
        if (!quiet) notify({ type: 'warning', title: 'غير متصل: سيُرسل عند عودة الاتصال', message: QUEUED_MESSAGE });
        if (!newsItem?.id) {
          clearDraft();
          onCancel();
          return null;
        }
        const local = apiService.getNewsById(newsItem.id);
        if (local) {
          loadedSnapshotRef.current = snapshot;
          setBaseUpdatedAt(local.updatedAt);
          if (!stay && snapshot === JSON.stringify(formFieldsRef.current())) onCancel();
        }
      } else setSaveState('failed');
      return saved;
    } catch {
      setSaveState('failed');
      return null;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  /** No connection: writes stay on this device and are sent when it is back. */
  const waitingForConnection = () => {
    const state = dataStore.syncState();
    return !state.browserOnline || !state.online;
  };

  const handleSaveDraft = () => {
    saveContent(true);
  };

  /** Title/body problem that blocks sending this story onwards (drafts may stay incomplete). */
  const [contentError, setContentError] = useState<{ field: 'title' | 'content'; message: string } | null>(null);
  const blockedByContent = (status: NewsStatus) => {
    const problem = contentDenial({ title, content }, status);
    setContentError(problem);
    if (problem) {
      const target = problem.field === 'title' ? document.getElementById('news-headline-input') : document.getElementById('news-body-editor');
      target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      (problem.field === 'title' ? target : target?.querySelector<HTMLElement>('[contenteditable], textarea'))?.focus();
    }
    return !!problem;
  };

  const handleTriggerStatusChange = (status: NewsStatus) => {
    if (blockedByContent(status)) return;
    if (!newsItem?.id) {
      saveContent(false, { status });
      return;
    }
    setPendingStatus(status);
    setShowCommentModal(true);
  };

  // Keyboard: Ctrl+S saves and stays in the editor; Ctrl+Enter sends a draft for review, or approves a story under review.
  const shortcutRef = useRef<(e: KeyboardEvent) => void>(() => {});
  shortcutRef.current = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.repeat || e.isComposing || !(e.ctrlKey || e.metaKey) || e.altKey || showCommentModal || document.body.classList.contains('form-page-open') || document.querySelector('[role=dialog], [role=alertdialog]')) return;
    if (e.key === 's' || e.key === 'S' || e.code === 'KeyS') {
      e.preventDefault();
      if (canEditContent && lock.status !== 'acquiring') saveContent(true);
    } else if (e.key === 'Enter' && e.shiftKey && reviewMode && transitions.includes('NEEDS_REVISION')) {
      // Ctrl+Shift+Enter: return to the writer with a reason.
      e.preventDefault();
      handleTriggerStatusChange('NEEDS_REVISION');
    } else if (e.key === 'Enter' && reviewMode && transitions.includes('APPROVED')) {
      // Under review: Ctrl+Enter approves, through the same confirmation as the button.
      e.preventDefault();
      handleTriggerStatusChange('APPROVED');
    } else if (e.key === 'Enter' && (canCreateForReview || (newsItem?.id && ['DRAFT', 'IN_PROGRESS', 'NEEDS_REVISION'].includes(newsItem.status) && transitions.includes('UNDER_REVIEW')))) {
      // Drafts: Ctrl+Enter sends for review.
      e.preventDefault();
      handleTriggerStatusChange('UNDER_REVIEW');
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => shortcutRef.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const needsComment = pendingStatus === 'NEEDS_REVISION' || pendingStatus === 'REJECTED';
  const writerName = newsItem?.authorName || 'الكاتب';
  const dialogCopy =
    pendingStatus === 'NEEDS_REVISION'
      ? {
          title: 'إعادة الخبر للكاتب',
          explain: `يعود الخبر إلى ${writerName} بحالة «مُعاد للتعديل» ليعدّله ثم يرسله للمراجعة من جديد. يصله سببك في تنبيه وفي سجل سير العمل.`,
          label: 'سبب الإعادة (مطلوب)',
          placeholder: 'مثال: الرقم في الفقرة الثانية يحتاج مصدراً رسمياً',
          reasons: ['المصدر غير موثق', 'أرقام بحاجة لتدقيق', 'الصياغة', 'العنوان لا يطابق النص', 'ينقص رد الطرف الآخر'],
          confirm: 'إعادة للكاتب',
        }
      : pendingStatus === 'REJECTED'
      ? {
          title: 'رفض الخبر نهائياً',
          explain: 'يخرج الخبر من المراجعة ولا يُنشر ولا يُدرج في النشرات. لا يعود إلى المراجعة إلا إذا أعاده كاتبه مسودةً وبدأ من جديد. إن كان يحتاج تعديلاً فقط فاختر «إعادة مع سبب».',
          label: 'سبب الرفض (مطلوب)',
          placeholder: 'مثال: الخبر غير مؤكد من أي مصدر مستقل',
          reasons: ['غير مؤكد', 'مكرر لخبر منشور', 'خارج سياسة التحرير', 'تجاوزه الحدث'],
          confirm: 'رفض نهائي',
        }
      : {
          title: `نقل الخبر إلى «${pendingStatus ? NEWS_STATUS_LABELS[pendingStatus] : ''}»`,
          explain:
            pendingStatus === 'APPROVED'
              ? 'يصبح الخبر معتمداً وجاهزاً للنشر والإدراج في النشرات. يمكنك إضافة ملاحظة تُسجَّل في سجل سير العمل.'
              : 'أدخل ملاحظات التدقيق أو المراجعة لتسجيلها في سجل سير العمل (اختياري):',
          label: 'ملاحظات المراجعة (اختيارية)',
          placeholder: pendingStatus === 'APPROVED' ? 'مثال: تم تدقيق الأسماء، مطابقة المصادر، والتأكد من الصياغة اللغوية...' : 'ملاحظة للزملاء (اختيارية)',
          reasons: [] as string[],
          confirm: 'تأكيد ونقل الحالة',
        };
  const scheduleInvalid = pendingStatus === 'SCHEDULED' && (!scheduleAt || Date.parse(fromLocalInputValue(scheduleAt)) < Date.now());

  const [statusSubmitting, setStatusSubmitting] = useState(false);
  const handleConfirmStatus = async () => {
    if (!newsItem?.id || !pendingStatus || statusSubmitting) return;
    if (needsComment && !statusComment.trim()) return;
    if (scheduleInvalid) return;
    setStatusSubmitting(true);
    try {
      // Confirm the text save before changing its editorial status.
      let queued = false;
      if (isDirty && canEditContent) {
        const saved = await saveContent(true, {}, true);
        if (!saved) {
          // Offline the text is kept on this device and sent later; the status change can wait with it.
          if (!waitingForConnection()) return;
          queued = true;
        }
      }
      // datetime-local is local time; send an absolute instant.
      const accepted = await onUpdateStatus(newsItem.id, pendingStatus, statusComment, pendingStatus === 'SCHEDULED' ? fromLocalInputValue(scheduleAt) : undefined);
      if (!accepted) {
        const stored = apiService.getNewsById(newsItem.id)?.status === pendingStatus;
        if (!(stored && waitingForConnection())) return;
        queued = true;
      }
      if (queued) {
        // Say it once, plainly, and close: nothing is lost and nothing more to press.
        notify({ type: 'warning', title: 'غير متصل: سيُرسل عند عودة الاتصال', message: QUEUED_MESSAGE });
        setShowCommentModal(false);
        setStatusComment('');
        if (['NEEDS_REVISION', 'UNDER_REVIEW', 'REJECTED'].includes(pendingStatus)) onCancel();
        return;
      }
      const fresh = apiService.getNewsById(newsItem.id);
      if (fresh) setBaseUpdatedAt(fresh.updatedAt);
      setShowCommentModal(false);
      setStatusComment('');
      // Leave the editor to release its lock for the next colleague.
      if (continueReview && nextReviewId && onNextReview && ['APPROVED', 'NEEDS_REVISION', 'REJECTED'].includes(pendingStatus)) onNextReview(nextReviewId);
      else if (reviewing && continueReview && ['APPROVED', 'NEEDS_REVISION', 'REJECTED'].includes(pendingStatus)) onCancel();
      else if (['NEEDS_REVISION', 'UNDER_REVIEW', 'REJECTED'].includes(pendingStatus)) onCancel();
    } finally {
      setStatusSubmitting(false);
    }
  };

  /** Review bookkeeping (claim, release, quality pass, breaking request): written, then confirmed. */
  const runReview = async (action: () => NewsItem, done: string): Promise<boolean> => {
    if (!newsItem?.id || reviewBusy) return false;
    setReviewBusy(true);
    try {
      const updated = action();
      // Our own bookkeeping write is the new base: the text in the form stays valid on top of it.
      setBaseUpdatedAt(updated.updatedAt);
      const outcome = await dataStore.awaitWrite('news', newsItem.id);
      if (outcome.ok) notify({ type: 'success', message: done });
      else if (outcome.queued) notify({ type: 'warning', title: 'غير متصل: سيُرسل عند عودة الاتصال', message: QUEUED_MESSAGE });
      else if (outcome.pending) notify({ type: 'warning', title: 'لم يؤكد الخادم بعد', message: outcome.message || '' });
      return outcome.ok || !!outcome.pending;
    } catch (err: any) {
      notify({ type: 'error', title: 'لم يُسجَّل الإجراء', message: err?.message || 'تعذر الحفظ' });
      return false;
    } finally {
      setReviewBusy(false);
    }
  };

  const handlePassQuality = async () => {
    if (!newsItem?.id) return;
    const note = await promptDialog({
      title: 'اجتازت التدقيق',
      message: 'يُسجَّل باسمك ووقتك أنك دققت هذا النص، فيخرج من طابور الجودة ويرى المعتمد شارة «اجتازت التدقيق». لا يعني ذلك اعتماده أو نشره.',
      label: 'ملاحظة للمعتمد (اختيارية)',
      placeholder: 'مثال: الأسماء والأرقام مطابقة للمصدر',
      confirmLabel: 'تسجيل اجتياز التدقيق',
    });
    if (note === null) return;
    const ok = await runReview(() => passQuality(newsItem.id, note), `اجتازت التدقيق: «${newsItem.title.slice(0, 40)}»`);
    if (ok && nextReviewId && onNextReview) onNextReview(nextReviewId);
    else if (ok && reviewing) onCancel();
  };

  /** A note on the headline or lead (review threads anchor in the body): goes to the team discussion. */
  const noteOnHeadline = (excerpt: string, note: string) => {
    if (!newsItem?.id) return;
    try {
      apiService.addComment({ kind: 'news', id: newsItem.id, title: newsItem.title }, `ملاحظة تدقيق على العنوان أو المقدمة: «${excerpt}» — ${note}`, []);
      notify({ type: 'success', message: 'أُضيفت الملاحظة إلى نقاش الفريق على الخبر' });
    } catch (err: any) {
      notify({ type: 'error', message: err?.message || 'تعذر إضافة الملاحظة' });
    }
  };

  /** Quotes the text selected in the body for a review note. */
  const trackSelection = () => {
    const sel = window.getSelection();
    const box = document.getElementById('news-body-editor');
    if (!sel || sel.isCollapsed || !box || !sel.anchorNode || !box.contains(sel.anchorNode) || !box.contains(sel.focusNode)) {
      setSelectedQuote('');
      return;
    }
    setSelectedQuote(sel.toString().replace(/\s+/g, ' ').trim().slice(0, 2000));
  };

  // One signal colour for the next step; the other decisions are quiet outlines, refusal in red text.
  const TRANSITION_BUTTONS: Partial<Record<NewsStatus, { label: string }>> = {
    UNDER_REVIEW: { label: 'إرسال للمراجعة والتدقيق' },
    APPROVED: { label: 'اعتماد الخبر للنشر' },
    NEEDS_REVISION: { label: 'إعادة للكاتب مع ملاحظات' },
    REJECTED: { label: 'رفض الخبر' },
    PUBLISHED: { label: 'نشر الخبر داخل النظام' },
    SCHEDULED: { label: 'جدولة النشر' },
    UNPUBLISHED: { label: 'سحب النشر' },
    ARCHIVED: { label: 'أرشفة الخبر' },
  };
  const PRIMARY_BUTTON = 'bg-blue-600 hover:bg-blue-700 text-white border border-blue-600 shadow-xs';
  const QUIET_BUTTON = 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-300';
  const transitionClass = (t: NewsStatus) =>
    t === primaryTransition ? PRIMARY_BUTTON : t === 'REJECTED' ? 'bg-white hover:bg-red-50 text-red-700 border border-red-200' : QUIET_BUTTON;

  if (fieldBreaking && !newsItem) {
    return (
      <FieldBreakingForm
        currentUser={currentUser}
        onCancel={onCancel}
        onOpenFullEditor={() => {
          setFieldBreaking(false);
          // Whoever may put it on air starts the full form already flagged as breaking.
          if (can('news.breaking_push')) setIsBreaking(true);
        }}
      />
    );
  }

  return (
    <div className="space-y-2 sm:space-y-6">
      {draftStorageFailed && (
        <p role="alert" className="bg-red-50 border border-red-200 p-3 text-sm text-red-800 rounded-lg">
          تعذر حفظ النسخة المحلية. احفظ تغييراتك قبل تحديث الصفحة أو إغلاقها.
        </p>
      )}
      {/* Emergency Draft Recovery Alert */}
      {hasEmergencyDraft && (
        <div className="bg-amber-50 border border-amber-200 p-4 rounded-2xl flex flex-wrap items-center justify-between gap-3 text-amber-900 shadow-xs animate-in fade-in">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0" />
            <div>
              <strong className="text-xs font-bold block">توجد مسودة غير محفوظة على هذا الجهاز</strong>
              <span className="text-2xs text-amber-700">
                {draftVersionChanged ? 'تم تحديث الخبر على الخادم. المسودة محفوظة ويمكن استعادتها للمراجعة قبل الحفظ.' : 'يمكنك استعادة جميع حقول الخبر غير المحفوظة بعد تحديث الصفحة.'}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={compareEmergencyDraft} className="min-h-11 px-3 rounded-lg border border-amber-300 bg-white text-xs font-bold text-amber-900">
              قارن النصين
            </button>
            <button
              type="button"
              onClick={handleRestoreEmergencyDraft}
              className="flex items-center gap-1.5 min-h-11 sm:min-h-9 px-3 py-1.5 bg-amber-700 hover:bg-amber-800 text-white rounded-lg text-xs font-bold transition-colors shadow-xs"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              استعادة المسودة الآن
            </button>
            <button
              type="button"
              onClick={clearDraft}
              className="min-h-11 sm:min-h-9 px-2.5 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 rounded-lg"
            >
              حذف النسخة المحلية
            </button>
          </div>
          {draftComparison?.key === draftKey && <div className="basis-full rounded-lg border border-amber-200 bg-white p-3 text-sm text-slate-900" aria-live="polite">
            <p className="mb-2 text-xs text-slate-600">النص المشطوب من النسخة المفتوحة، والمميّز بالأخضر من المسودة المحلية.</p>
            {!draftComparison.fields.length && <p>العنوان والمقدمة والنص متطابقة. قد تختلف حقول أخرى.</p>}
            {draftComparison.fields.map(({ label, runs }) => <section key={label} className="mb-3 last:mb-0">
              <h3 className="mb-1 font-semibold">{label}</h3>
              <p>{runs.map(({ kind, text }, index) => kind === 'del'
                ? <del key={index} className="bg-red-50 text-red-800">{text}{' '}</del>
                : kind === 'add' ? <ins key={index} className="bg-emerald-50 text-emerald-800">{text}{' '}</ins>
                  : <React.Fragment key={index}>{text}{' '}</React.Fragment>)}</p>
            </section>)}
          </div>}
        </div>
      )}

      {/* Edit lock: someone else is editing this story */}
      {lockedByOther && lockHolder && (
        <div role="alert" className="bg-amber-50 border border-amber-300 p-4 rounded-2xl flex flex-wrap items-center justify-between gap-3 text-amber-900">
          <div className="flex items-center gap-2.5">
            <Lock className="w-5 h-5 text-amber-700 shrink-0" />
            <div>
              <strong className="text-xs font-bold block">هذا الخبر قيد التحرير الآن لدى {lockHolder.userName}</strong>
              <span className="text-2xs text-amber-700">{editableStory ? 'يمكنك القراءة فقط حتى ينتهي من التحرير. ستُتاح الكتابة تلقائياً عند إغلاقه للخبر.' : 'يتحدث النص هنا تلقائياً حين يحفظ تعديلاته.'}</span>
            </div>
          </div>
          {editableStory && lock.status === 'locked' && can('news.edit_any') && (
            <button
              type="button"
              onClick={async () => {
                if ((await confirmDialog(`سيفقد ${lock.holder?.userName} أي تعديلات غير محفوظة. تولي تحرير الخبر؟`))) void lock.takeOver();
              }}
              className="min-h-11 sm:min-h-9 px-3 py-1.5 bg-amber-700 hover:bg-amber-800 text-white rounded-lg text-xs font-bold"
            >
              تولي التحرير
            </button>
          )}
        </div>
      )}

      {!lockedByOther && newsItem?.id && !editableStory && (
        <div className="bg-slate-50 border border-slate-200 px-3 py-2 rounded-2xl text-xs text-slate-700 font-semibold flex items-center gap-2">
          <Lock className="w-4 h-4 text-slate-500 shrink-0" />
          للقراءة فقط:{' '}
          {reviewMode
            ? 'راجع النص وحدّد أي مقطع لتضيف عليه ملاحظة للكاتب؛ التعديل لكاتبه أو للمحرر.'
            : newsItem.status === 'PUBLISHED' || newsItem.status === 'APPROVED'
            ? 'تعديل خبر معتمد أو منشور يتطلب صلاحية الاعتماد أو النشر.'
            : 'لا تملك صلاحية تعديل هذا الخبر.'}
        </div>
      )}

      {newsItem?.breakingRequest && (
        <div role="status" className="bg-red-50 border border-red-200 p-3 rounded-2xl text-xs text-red-900 flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold flex items-center gap-2">
            <Flame className="w-4 h-4 text-red-600 shrink-0" />
            عاجل من الميدان: أرسله {newsItem.breakingRequest.byName} {new Date(newsItem.breakingRequest.at).toLocaleTimeString(appLocale(), { ...zoneOptions(), hour: '2-digit', minute: '2-digit' })}.{' '}
            {can('news.breaking_push') ? 'قرار بثه لك: فعّل «خبر عاجل للبث» ثم اعتمد الخبر وانشره.' : 'قرار بثه لرئيس التحرير.'}
          </span>
          <span className="flex flex-wrap gap-2">
            {can('news.breaking_push') && canEditContent && !isBreaking && (
              <button type="button" onClick={() => setIsBreaking(true)} className="min-h-9 px-3 rounded-lg bg-red-600 hover:bg-red-700 text-white font-bold">
                تفعيل العاجل للبث
              </button>
            )}
            {(can('news.breaking_push') || can('news.approve')) && (
              <button type="button" disabled={reviewBusy} onClick={() => void runReview(() => closeBreakingRequest(newsItem.id), 'أُغلق طلب العاجل')} className="min-h-9 px-3 rounded-lg border border-red-300 text-red-800 font-semibold hover:bg-red-100 disabled:opacity-50">
                إغلاق الطلب
              </button>
            )}
          </span>
        </div>
      )}

      {isUnderEmbargo(newsItem) && (
        <div role="status" className="bg-rose-50 border border-rose-200 p-3 rounded-2xl text-xs text-rose-900 font-semibold flex items-center gap-2">
          <Lock className="w-4 h-4 text-rose-600" />
          تحت الحظر حتى {embargoLabel(newsItem!.embargoUntil)} — يمكن تحريره واعتماده، لكن لا يُنشر ولا يُذاع قبل ذلك.
          {newsItem!.embargoNote ? ` (${newsItem!.embargoNote})` : ''}
        </div>
      )}

      {newsItem?.status === 'SCHEDULED' && newsItem.scheduledDate && (
        <div className="bg-sky-50 border border-sky-200 p-3 rounded-2xl text-xs text-sky-900 font-semibold flex items-center gap-2">
          <Clock className="w-4 h-4 text-sky-600" />
          مجدول للنشر تلقائياً في {new Date(newsItem.scheduledDate).toLocaleString(appLocale(), zoneOptions())}
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

      <PronunciationPanel notes={matchingPronunciations(content, apiService.getPronunciationTerms())} />
      {/* Top Header & Actions Bar: one back control, the status once, then the decisions */}
      <div className="sm:sticky sm:top-16 z-20 bg-white border-b border-slate-200 py-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-11 min-w-11 flex items-center justify-center text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
            title="العودة لقائمة الأخبار"
            aria-label="العودة لقائمة الأخبار"
          >
            <ArrowRight className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <h1 className="text-base sm:text-lg font-bold text-slate-800">
              {reviewMode ? 'مراجعة الخبر' : newsItem ? (ro ? 'قراءة الخبر' : 'تحرير الخبر') : 'إنشاء خبر جديد'}
            </h1>
            <MessageOriginLabel origin={newsItem?.messageOrigin} />
            <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
              <Badge variant={newsItem?.status === 'PUBLISHED' ? 'success' : newsItem?.status === 'APPROVED' ? 'primary' : newsItem?.status === 'UNDER_REVIEW' ? 'warning' : 'default'} size="sm">
                الحالة: {newsItem?.status ? NEWS_STATUS_LABELS[newsItem.status] : 'مسودة جديدة'}
              </Badge>
              {queuePosition && (
                <span className="px-2 py-0.5 rounded-md bg-slate-900 text-white text-xs font-bold tabular-nums" aria-label={`الخبر ${queuePosition} في طابور المراجعة`} title="الموضع في طابور المراجعة">
                  {queuePosition}
                </span>
              )}
              {isBreaking && (
                <Badge variant="danger" size="sm" dot>
                  خبر عاجل
                </Badge>
              )}
              {qualityPassed && newsItem?.qualityCheck && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold" title={newsItem.qualityCheck.note || undefined}>
                  <ShieldCheck className="w-3.5 h-3.5" />
                  اجتازت التدقيق — {newsItem.qualityCheck.byName}، {new Date(newsItem.qualityCheck.at).toLocaleTimeString(appLocale(), { ...zoneOptions(), hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
              {reviewClaim && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-sky-50 border border-sky-200 text-sky-800 text-xs font-bold">
                  <Hand className="w-3.5 h-3.5" />
                  {reviewClaim.userId === currentUser.id ? 'تراجعها أنت الآن' : `يراجعها الآن ${reviewClaim.userName}`}
                </span>
              )}
              {reviewMode && <span className="text-xs text-slate-600">زمن الإلقاء: <strong className="text-slate-800">{textStats.label}</strong></span>}
              {!ro && (
                <div role="status" aria-live="polite" className="flex items-center gap-1.5 text-xs text-slate-600 font-medium">
                  {saving ? 'جارٍ الحفظ على الخادم...' : saveState === 'queued' && !isDirty ? 'غير متصل: محفوظ على جهازك وسيُرسل عند عودة الاتصال' : saveState === 'failed' ? 'تعذر الحفظ؛ تعديلاتك باقية في المحرر' : saveState === 'saved' && !isDirty ? 'تم الحفظ على الخادم' : draftSavedMinute !== null && isDirty && !draftStorageFailed ? (
                    <>
                      <CheckCircle className="w-3 h-3 text-amber-500" />
                      تغييرات غير محفوظة (نسخة احتياطية على هذا الجهاز {new Date(draftSavedMinute * 60_000).toLocaleTimeString(appLocale(), { ...zoneOptions(), hour: '2-digit', minute: '2-digit' })})
                    </>
                  ) : isDirty ? 'تغييرات غير محفوظة' : newsItem?.id ? 'لا توجد تغييرات غير محفوظة' : null}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Action Buttons (only what the server will accept) */}
        <div ref={actionBarRef} role="toolbar" aria-label="إجراءات تحرير الخبر" className="fixed sm:static bottom-0 inset-x-0 sm:inset-auto z-30 bg-white border-t sm:border-t-0 border-slate-200 p-3 sm:p-0 flex flex-wrap items-center gap-2 shadow-md sm:shadow-none" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
          {reviewMode ? (
            <>
              {transitions.includes('APPROVED') && (
                <button
                  type="button"
                  onClick={() => handleTriggerStatusChange('APPROVED')}
                  title="Ctrl+Enter"
                  aria-keyshortcuts="Control+Enter Meta+Enter"
                  className={`min-h-11 flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold ${PRIMARY_BUTTON}`}
                >
                  <CheckCircle className="w-4 h-4" />
                  {nextReviewId && onNextReview ? 'اعتماد والتالي' : 'اعتماد الخبر للنشر'}
                </button>
              )}
              {mayPassQuality && (
                <button
                  type="button"
                  onClick={() => void handlePassQuality()}
                  disabled={reviewBusy || isDirty}
                  title={isDirty ? 'احفظ تعديلاتك أولاً' : 'يسجّل أنك دققت النص، دون اعتماده أو نشره'}
                  className={`min-h-11 flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold disabled:opacity-50 ${transitions.includes('APPROVED') ? QUIET_BUTTON : PRIMARY_BUTTON}`}
                >
                  <ShieldCheck className="w-4 h-4" />
                  اجتازت التدقيق
                </button>
              )}
              {transitions.includes('NEEDS_REVISION') && (
                <button
                  type="button"
                  onClick={() => handleTriggerStatusChange('NEEDS_REVISION')}
                  title="Ctrl+Shift+Enter"
                  aria-keyshortcuts="Control+Shift+Enter"
                  className={`min-h-11 flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold ${QUIET_BUTTON}`}
                >
                  <CornerUpLeft className="w-4 h-4" />
                  إعادة مع سبب
                </button>
              )}
              {!reviewClaim && mayClaim && (
                <button type="button" disabled={reviewBusy} onClick={() => void runReview(() => claimReview(newsItem!.id), 'الخبر محجوز لمراجعتك (30 دقيقة)')} title="يحجز الخبر لك كي لا يراجعه زميل في الوقت نفسه" className="hidden sm:flex min-h-11 items-center gap-1.5 px-3 py-2 border border-sky-300 bg-sky-50 hover:bg-sky-100 text-sky-800 rounded-lg text-xs font-bold disabled:opacity-50">
                  <Hand className="w-4 h-4" />
                  أراجعها الآن
                </button>
              )}
              {reviewClaim?.userId === currentUser.id && (
                <button type="button" disabled={reviewBusy} onClick={() => void runReview(() => releaseReview(newsItem!.id), 'عاد الخبر إلى طابور المراجعة')} className="hidden sm:flex min-h-11 items-center gap-1.5 px-3 py-2 border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-bold disabled:opacity-50">
                  إنهاء استلامي
                </button>
              )}
              {reviewClaim && reviewClaim.userId !== currentUser.id && mayClaim && (
                <button
                  type="button"
                  disabled={reviewBusy}
                  onClick={() => void takeOverReview()}
                  className="hidden sm:flex min-h-11 items-center gap-1.5 px-3 py-2 border border-sky-300 text-sky-800 rounded-lg text-xs font-bold disabled:opacity-50"
                >
                  <Hand className="w-4 h-4" />
                  تولّي المراجعة
                </button>
              )}
              {nextReviewId && onNextReview && (
                <button type="button" onClick={() => onNextReview(nextReviewId)} title="الانتقال إلى الخبر التالي في الطابور دون قرار" className="hidden sm:flex min-h-11 items-center gap-1.5 px-3 py-2 border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-bold">
                  <SkipForward className="w-4 h-4 rtl:-scale-x-100" />
                  تخطٍّ
                </button>
              )}
              {canEditContent && (
                <button type="button" onClick={handleSaveDraft} disabled={saving || lock.status === 'acquiring'} title="حفظ (Ctrl+S)" aria-keyshortcuts="Control+S Meta+S" className="hidden sm:flex min-h-11 items-center gap-1.5 px-3 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-bold disabled:opacity-50">
                  <Save className="w-4 h-4" />
                  {saving ? 'جارٍ الحفظ...' : saveState === 'failed' ? 'إعادة محاولة الحفظ' : 'حفظ التغييرات'}
                </button>
              )}
              {transitions.includes('REJECTED') && (
                <button type="button" onClick={() => handleTriggerStatusChange('REJECTED')} className="hidden sm:flex min-h-11 items-center gap-1.5 px-3 py-2 text-red-700 hover:bg-red-50 rounded-lg text-xs font-bold">
                  رفض نهائي
                </button>
              )}
              <button type="button" onClick={() => setIsHistoryOpen(true)} className="hidden sm:flex min-h-11 items-center gap-1.5 px-3 py-2 text-slate-700 hover:bg-slate-50 rounded-lg text-xs font-bold">
                <History className="w-4 h-4" />
                سجل النسخ
              </button>
            </>
          ) : (
            <>
          {newsItem?.id && (
            <button
              type="button"
              onClick={() => setIsHistoryOpen(true)}
              className="hidden sm:flex min-h-11 items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-bold"
            >
              <History className="w-4 h-4" />
              سجل النسخ
            </button>
          )}
          {canEditContent && (
            <button
              type="button"
              onClick={handleSaveDraft}
              disabled={saving || lock.status === 'acquiring'}
              title="حفظ (Ctrl+S)"
              aria-keyshortcuts="Control+S Meta+S"
              className="min-h-11 flex items-center gap-1.5 px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-bold transition-colors disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {saving ? 'جارٍ الحفظ...' : saveState === 'failed' ? 'إعادة محاولة الحفظ' : newsItem?.id ? 'حفظ التغييرات' : 'حفظ كمسودة'}
            </button>
          )}

          {canEditContent && (
             <button type="button" onClick={() => saveContent(false)} disabled={saving || lock.status === 'acquiring'}
              className="hidden sm:flex min-h-11 items-center gap-1.5 px-4 py-2 border border-slate-200 text-slate-700 rounded-lg text-xs font-bold hover:bg-slate-50 disabled:opacity-50">
              <Save className="w-4 h-4" /> حفظ وإغلاق
            </button>
          )}

          {canCreateForReview && (
            <button
              type="button"
              onClick={() => handleTriggerStatusChange('UNDER_REVIEW')}
              title="Ctrl+Enter"
              aria-keyshortcuts="Control+Enter Meta+Enter"
              className={`min-h-11 flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold transition-colors ${PRIMARY_BUTTON}`}
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
                  className={`${t === primaryTransition ? 'flex' : 'hidden sm:flex'} min-h-11 items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold transition-colors ${transitionClass(t)}`}
                >
                  {t === 'UNDER_REVIEW' && <Send className="w-4 h-4" />}
                  {t === 'APPROVED' && <CheckCircle className="w-4 h-4" />}
                  {t === 'PUBLISHED' && <Radio className="w-4 h-4" />}
                  {newsItem?.status === 'SCHEDULED' && t === 'APPROVED' ? 'إلغاء الجدولة' : TRANSITION_BUTTONS[t]!.label}
                </button>
              ))}
            </>
          )}
        </div>
      </div>

      {newsItem?.id && <details className="sm:hidden border-b border-slate-200 py-2">
        <summary className="min-h-11 flex items-center text-sm font-semibold text-slate-700 cursor-pointer">إجراءات إضافية</summary>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setIsHistoryOpen(true)} className="min-h-11 px-3 flex items-center gap-2 text-sm"><History className="w-4 h-4" />سجل النسخ</button>
          {reviewMode && canEditContent && <button type="button" disabled={saving || lock.status === 'acquiring'} onClick={handleSaveDraft} className="min-h-11 px-3 flex items-center gap-2 text-sm disabled:opacity-50"><Save className="w-4 h-4" />{saving ? 'جارٍ الحفظ...' : saveState === 'failed' ? 'إعادة محاولة الحفظ' : 'حفظ التغييرات'}</button>}
          {canEditContent && <button type="button" disabled={saving || lock.status === 'acquiring'} onClick={() => void saveContent(false)} className="min-h-11 px-3 flex items-center gap-2 text-sm disabled:opacity-50"><Save className="w-4 h-4" />حفظ وإغلاق</button>}
          {reviewMode && !reviewClaim && mayClaim && <button type="button" disabled={reviewBusy} onClick={() => void runReview(() => claimReview(newsItem.id), 'الخبر محجوز لمراجعتك (30 دقيقة)')} className="min-h-11 px-3 text-sm font-semibold text-sky-700">أراجعها الآن</button>}
          {reviewMode && reviewClaim?.userId === currentUser.id && <button type="button" disabled={reviewBusy} onClick={() => void runReview(() => releaseReview(newsItem.id), 'عاد الخبر إلى طابور المراجعة')} className="min-h-11 px-3 text-sm font-semibold text-slate-700">إنهاء استلامي</button>}
          {reviewMode && reviewClaim && reviewClaim.userId !== currentUser.id && mayClaim && <button type="button" disabled={reviewBusy} onClick={() => void takeOverReview()} className="min-h-11 px-3 text-sm font-semibold text-sky-700">تولّي المراجعة</button>}
          {reviewMode && nextReviewId && onNextReview && <button type="button" onClick={() => onNextReview(nextReviewId)} className="min-h-11 px-3 text-sm font-semibold text-slate-700">تخطٍّ</button>}
          {!lockedByOther && transitions.filter(t => (reviewMode ? t === 'REJECTED' || t === 'DRAFT' : t !== primaryTransition) && TRANSITION_BUTTONS[t]).map(t => <button key={t} type="button" onClick={() => handleTriggerStatusChange(t)} className="min-h-11 px-3 text-sm font-semibold text-blue-700">{t === 'REJECTED' && reviewMode ? 'رفض نهائي' : newsItem?.status === 'SCHEDULED' && t === 'APPROVED' ? 'إلغاء الجدولة' : TRANSITION_BUTTONS[t]!.label}</button>)}
        </div>
      </details>}

      {/* Broadcast Timing & Production Tools Banner (in review mode the text comes first) */}
      {!reviewMode && (
        <NewsBroadcastToolsBar
          textStats={textStats}
          content={content}
          onContentChange={setContent}
          canEditContent={canEditContent}
          saving={saving}
          canUseEditorialAi={canUseEditorialAi}
          onOpenAiCopilot={() => setIsAiCopilotOpen(true)}
          onOpenCgModal={() => setIsCgModalOpen(true)}
          newsItem={newsItem}
          canCreateRequest={can('requests.create')}
          onCreateRequest={setRequestDraft}
          title={title}
          shortTitle={shortTitle}
          summary={summary}
          priority={priority}
          locationName={locationName}
          keywords={keywords}
          copiedPrompter={copiedPrompter}
          onCopyPrompterText={handleCopyPrompterText}
        />
      )}

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
                    className={`text-2xs tabular-nums px-2 py-0.5 rounded-md font-semibold transition-colors ${
                      title.length === 0
                        ? 'text-slate-500 bg-slate-100'
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
                      className="text-2xs text-slate-500 hover:text-blue-600 flex items-center gap-1 bg-slate-100 hover:bg-blue-50 min-h-6 px-2 py-0.5 rounded transition-colors"
                      title="نسخ العنوان"
                    >
                      {copiedTitle ? <Check className="w-3 h-3 text-emerald-700" /> : <Copy className="w-3 h-3" />}
                      {copiedTitle ? 'تم النسخ' : 'نسخ'}
                    </button>
                  )}
                </div>
              </div>

              <div className="relative">
                <textarea
                  id="news-headline-input"
                  ref={headlineRef}
                  rows={1}
                  required
                  readOnly={ro}
                  value={title}
                  onKeyDown={(e) => {
                    // A headline is one line of copy: Enter does not break it (Ctrl/Cmd+Enter still sends).
                    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.nativeEvent.isComposing) e.preventDefault();
                  }}
                  onChange={(e) => {
                    setTitle(e.target.value.replace(/\s*[\r\n]+\s*/g, ' '));
                    if (contentError?.field === 'title') setContentError(null);
                  }}
                  aria-invalid={contentError?.field === 'title' || undefined}
                  aria-describedby={contentError?.field === 'title' ? 'news-content-error' : undefined}
                  placeholder="اكتب عنواناً جذاباً ودقيقاً يصف جوهر الحدث..."
                  className="block w-full resize-none overflow-hidden leading-snug pl-10 pr-4 py-3 bg-white border border-slate-300 aria-[invalid=true]:border-rose-500 rounded-xl text-base font-bold text-slate-800 placeholder:font-normal placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                />
                {title && !ro && (
                  <button
                    type="button"
                    onClick={() => setTitle('')}
                    className="absolute left-3 top-2.5 p-1.5 text-slate-500 hover:text-rose-600 rounded-full hover:bg-slate-100"
                    title="مسح العنوان"
                    aria-label="مسح العنوان"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              {contentError?.field === 'title' && (
                <p id="news-content-error" role="alert" className="mt-1.5 text-xs font-bold text-rose-700">
                  {contentError.message}
                </p>
              )}
              {!ro && !newsItem && currentUser.stationId && <CoverageOverlap title={title} stationId={currentUser.stationId} />}
            </div>

            {/* Short Title & Ticker Simulator */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="news-short-title-input" className="block text-xs font-bold text-slate-700">
                  العنوان المختصر (يستخدم في شريط البث السفلي Ticker والأوتوكيو)
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-2xs tabular-nums text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                    {countLabel(shortTitle.length, { one: 'حرف واحد', two: 'حرفان', few: 'أحرف', many: 'حرفاً', zero: '0 حرف' })}
                  </span>
                  {(shortTitle || title) && (
                    <button
                      type="button"
                      onClick={() => setTickerChoice(!showTickerPreview)}
                      aria-pressed={showTickerPreview}
                      className="min-h-6 px-2 rounded-md text-2xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 aria-pressed:bg-slate-800 aria-pressed:text-white"
                    >
                      معاينة الشريط
                    </button>
                  )}
                  {title && !shortTitle && !ro && (
                    <button
                      type="button"
                      onClick={handleGenerateShortTitle}
                      className="text-2xs text-blue-600 hover:text-blue-700 font-bold flex items-center gap-1 bg-blue-50 px-2 py-0.5 rounded hover:bg-blue-100 transition-colors"
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
                  readOnly={ro}
                  onChange={(e) => setShortTitle(e.target.value)}
                  placeholder="عنوان مختصر ومكثف لا يتجاوز 10 كلمات..."
                  className="w-full pl-10 pr-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                  maxLength={120}
                />
                {shortTitle && !ro && (
                  <button
                    type="button"
                    onClick={() => setShortTitle('')}
                    className="absolute left-3 top-1/2 -translate-y-1/2 p-1.5 text-slate-500 hover:text-rose-600 rounded-full hover:bg-slate-100"
                    title="مسح العنوان المختصر"
                    aria-label="مسح العنوان المختصر"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Live Ticker Strap Preview Simulator */}
              {(shortTitle || title) && showTickerPreview && (
                <div id="news-ticker-preview" className="theme-fixed mt-2 p-2.5 bg-slate-950 text-white rounded-xl border border-slate-800 shadow-inner flex items-center gap-3 overflow-hidden">
                  <div className="flex items-center gap-1.5 px-2.5 py-1 bg-red-600 text-white font-bold text-2xs rounded tracking-wide shrink-0">
                    <Flame className="w-3 h-3" />
                    شريط الأخبار
                  </div>
                  <div className="text-xs font-bold text-amber-200 truncate flex-1 font-sans">
                    {shortTitle || title}
                  </div>
                </div>
              )}
            </div>

            {/* Summary / Lead Paragraph */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="news-summary-textarea" className="block text-xs font-bold text-slate-700">
                  المقدمة والملخص الإخباري
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-2xs tabular-nums text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                    {countLabel((summary.match(/\S+/g) || []).length, { one: 'كلمة واحدة', two: 'كلمتان', few: 'كلمات', many: 'كلمة', zero: '0 كلمة' })}
                  </span>
                  {summary && !ro && (
                    <button
                      type="button"
                      onClick={() => setSummary('')}
                      className="inline-flex items-center min-h-6 px-1.5 rounded-md text-2xs text-rose-700 hover:text-rose-800 hover:bg-rose-50"
                      title="مسح الملخص"
                    >
                      مسح
                    </button>
                  )}
                </div>
              </div>

              {canEditContent ? (
                <div className="flex justify-end mb-1">
                  <ProofreadButton value={`${title}\n${summary}`} onFix={(next) => {
                    const [t, ...rest] = next.split('\n');
                    setTitle(t);
                    setSummary(rest.join('\n'));
                  }} />
                </div>
              ) : canPostReview && (
                <div className="flex justify-end mb-1">
                  <ProofreadButton value={`${title}\n${summary}`} onSuggest={(sg) => noteOnHeadline(sg.excerpt, sg.note)} />
                </div>
              )}
              <textarea
                id="news-summary-textarea"
                rows={3}
                lang="ar"
                spellCheck
                readOnly={ro}
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="يجيب عن الأسئلة الصحفية الستة (من، ماذا، أين، متى، لماذا، كيف)..."
                className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs leading-relaxed text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
              />

              {/* Quick Lead Templates */}
              {!summary && !ro && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <span className="text-2xs text-slate-500 font-bold">بدايات سريعة:</span>
                  {LEAD_STARTERS.map((starter, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setSummary(starter)}
                      className="text-2xs bg-slate-100 hover:bg-blue-50 text-slate-600 hover:text-blue-700 px-2 py-0.5 rounded-md transition-colors border border-slate-200"
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
              {ro ? (
                canPostReview && (
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    disabled={!selectedQuote}
                    onClick={() => {
                      setReviewSeed({ quote: selectedQuote, key: Date.now() });
                      setSelectedQuote('');
                    }}
                    title={selectedQuote ? `«${selectedQuote.slice(0, 60)}»` : 'حدّد بالفأرة جملة من النص أولاً'}
                    className="min-h-9 inline-flex items-center gap-1.5 px-3 rounded-lg border border-blue-300 bg-blue-50 text-blue-800 text-xs font-bold disabled:opacity-50"
                  >
                    <MessageSquarePlus className="w-4 h-4" />
                    ملاحظة على المقطع المحدد
                  </button>
                )
              ) : (
                <span className="text-2xs text-slate-500">يمكن حفظ مسودة ناقصة؛ العنوان والنص مطلوبان للإرسال للمراجعة والنشر</span>
              )}
            </div>
            {contentError?.field === 'content' && (
              <p id="news-content-error" role="alert" className="text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                {contentError.message}
              </p>
            )}
            <div id="news-body-editor" onMouseUp={trackSelection} onKeyUp={trackSelection} onTouchEnd={() => window.setTimeout(trackSelection, 0)}>
            <RichTextEditor
              value={content}
              onChange={(val) => {
                setContent(val);
                if (contentError?.field === 'content') setContentError(null);
              }}
              readOnly={!canEditContent}
              readTimeLead={summary}
              onProofSuggestion={ro && canPostReview ? (sg) => setReviewSeed({ quote: sg.excerpt, note: sg.note, key: Date.now() }) : undefined}
              minHeight={reviewMode ? '240px' : '400px'}
              placeholder="اكتب تفاصيل القصة الإخبارية كاملة، التصريحات، الخلفيات، والتحليلات الميدانية..."
            />
            </div>
          </div>

          {/* Review notes sit right under the text they quote */}
          {newsItem?.id && (
            <ReviewThreads
              collection="news"
              entityId={newsItem.id}
              text={newsItem.content || ''}
              version={newsItem.updatedAt || 'legacy'}
              canPost={!saving && canPostReview}
              title={newsItem.title}
              seed={reviewSeed}
            />
          )}

          <EditorialPublishingPanel
            fields={[
              { label: 'العنوان الرئيسي', text: title, change: setTitle },
              { label: 'العنوان المختصر', text: shortTitle, change: setShortTitle },
              { label: 'المقدمة', text: summary, change: setSummary },
              { label: 'نص الخبر', text: content, html: true, change: setContent },
            ]}
            copy={digitalDraft}
            settings={apiService.getSettings().editorialPublishing ?? emptyEditorialPublishing()}
            readOnly={ro}
            saving={saving}
            approved={!!newsItem?.digitalPackage?.approval && digitalApprovalStatus(newsItem.status) && !isDirty && !newerVersionAvailable}
            canCopy={!isUnderEmbargo(newsItem)}
            canApprove={!!newsItem?.id && digitalApprovalStatus(newsItem.status) && can('news.approve') && !isDirty && !newerVersionAvailable && !waitingForConnection()}
            canSave={isDirty && !newerVersionAvailable}
            onChange={setDigitalDraft}
            onSave={() => void saveContent(true)}
            onApprove={() => void saveContent(true, { digitalPackage: { ...digitalDraft, requestApproval: true } })}
          />

          {/* Embargo */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-2">
            <label htmlFor="news-embargo" className="block text-xs font-bold text-slate-700 flex items-center gap-1.5">
              <Lock className="w-4 h-4 text-rose-500" />
              حظر النشر (Embargo)
            </label>
            <p className="text-2xs text-slate-500">للمواد الواردة تحت حظر زمني: لا يُنشر الخبر ولا يُجدول قبل هذا الموعد، ويظهر تحذير لمحرري النشرات.</p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                id="news-embargo"
                type="datetime-local"
                value={embargoUntil}
                readOnly={ro}
                onChange={(e) => setEmbargoUntil(e.target.value)}
                className="px-3 py-2 border border-slate-300 rounded-xl text-xs"
              />
              <input
                aria-label="مصدر الحظر أو ملاحظته"
                value={embargoNote}
                onChange={(e) => setEmbargoNote(e.target.value)}
                disabled={!embargoUntil}
                readOnly={ro}
                placeholder="مثال: بطلب من الوزارة حتى المؤتمر الصحفي"
                className="flex-1 min-w-[12rem] px-3 py-2 border border-slate-300 rounded-xl text-xs disabled:bg-slate-50"
              />
              {embargoUntil && !ro && (
                <button type="button" onClick={() => { setEmbargoUntil(''); setEmbargoNote(''); }} className="text-2xs text-rose-600 font-bold hover:underline">
                  إزالة الحظر
                </button>
              )}
            </div>
          </div>

          {/* Internal Notes with Quick Directives */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-2">
            <div className="flex items-center justify-between">
              <label htmlFor="news-editor-view-field-1" className="block text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <Info className="w-4 h-4 text-blue-500" />
                ملاحظات داخلية لغرفة الأخبار وهيئة التحرير والمخرج
              </label>
              {internalNotes && !ro && (
                <button
                  type="button"
                  onClick={() => setInternalNotes('')}
                  className="inline-flex items-center min-h-6 px-1.5 rounded-md text-2xs text-rose-700 hover:text-rose-800 hover:bg-rose-50"
                >
                  مسح
                </button>
              )}
            </div>
            <textarea id="news-editor-view-field-1"
              rows={2}
              value={internalNotes}
              readOnly={ro}
              onChange={(e) => setInternalNotes(e.target.value)}
              placeholder="تعليمات للمذيعين، التحقق من الترجمة، توجيهات المخرج..."
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-blue-500"
            />
            {!ro && <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="text-2xs text-slate-500 font-bold">توجيهات نموذجية:</span>
              {DIRECTIVE_PRESETS.map((preset, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() =>
                    setInternalNotes((prev) => (prev ? `${prev} ${preset}` : preset))
                  }
                  className="text-2xs bg-blue-50 hover:bg-blue-100 text-blue-700 px-2 py-0.5 rounded-md transition-colors border border-blue-200/50"
                >
                  {preset}
                </button>
              ))}
            </div>}
          </div>
        </div>

        {/* Right 1 Col: Editorial Metadata & Publishing Controls */}
        <NewsMetadataPanel
          newsItem={newsItem}
          currentUser={currentUser}
          ro={ro}
          canEditContent={canEditContent}
          canBreakingPush={can('news.breaking_push')}
          isBreaking={isBreaking}
          onBreakingChange={setIsBreaking}
          stories={stories}
          storyId={storyId}
          onStoryIdChange={setStoryId}
          categoryOptions={categoryOptions}
          categoryId={categoryId}
          onCategoryIdChange={setCategoryId}
          sources={sources}
          sourceId={sourceId}
          onSourceIdChange={setSourceId}
          priority={priority}
          onPriorityChange={setPriority}
          locationName={locationName}
          onLocationNameChange={setLocationName}
          eventDate={eventDate}
          onEventDateChange={setEventDate}
          mediaIds={mediaIds}
          onMediaIdsChange={setMediaIds}
          onRequestMontage={setRequestDraft}
          mainImageUrl={mainImageUrl}
          onMainImageUrlChange={setMainImageUrl}
          imagePresets={IMAGE_PRESETS}
          videos={videos}
          onVideosChange={setVideos}
          keywords={keywords}
          onKeywordsChange={setKeywords}
          tagInput={tagInput}
          onTagInputChange={setTagInput}
          onAddTag={handleAddTag}
          onRemoveTag={handleRemoveTag}
        />
      </div>

      {/* Status Transition Comment Modal: returning and rejecting say plainly what each does */}
      <NewsStatusTransitionModal
        isOpen={showCommentModal}
        onClose={() => setShowCommentModal(false)}
        statusSubmitting={statusSubmitting}
        dialogCopy={dialogCopy}
        isDirty={isDirty}
        canEditContent={canEditContent}
        pendingStatus={pendingStatus}
        scheduleAt={scheduleAt}
        onScheduleAtChange={setScheduleAt}
        statusComment={statusComment}
        onStatusCommentChange={setStatusComment}
        needsComment={needsComment}
        scheduleInvalid={scheduleInvalid}
        onConfirmStatus={handleConfirmStatus}
      />

      {newsItem?.id && (
        <NewsHistoryModal
          isOpen={isHistoryOpen}
          onClose={() => setIsHistoryOpen(false)}
          newsId={newsItem.id}
          canRestore={canEditContent}
          current={{ title, summary, content, status: newsItem.status, updatedAt: newsItem.updatedAt, updatedByName: undefined }}
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
            if (data.videoUrl) setVideos(videosOf({ videoUrl: data.videoUrl }));
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
        onSendToGraphics={
          newsItem?.id && can('requests.create')
            ? (tag) => setRequestDraft({ type: 'GRAPHICS', title: `شارات: ${title}`, lines: [tag], link: { kind: 'news', newsId: newsItem.id, title: newsItem.title } })
            : undefined
        }
      />

      {newsItem?.id && <NewsCorrectionsPanel newsId={newsItem.id} dirty={isDirty} canRegister={can('news.review') || can('news.edit_any')} />}
      <RequestFormPage
        isOpen={!!requestDraft}
        onClose={() => setRequestDraft(null)}
        draft={requestDraft || undefined}
        onCreated={(text) => {
          setRequestNotice(text);
          window.setTimeout(() => setRequestNotice(null), 5000);
        }}
      />
      {requestNotice && (
        <div role="status" className="fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl bg-emerald-700 text-white text-xs font-bold shadow-lg">
          {requestNotice}
        </div>
      )}

      {/* AI Newsroom Co-Pilot Modal */}
      <AiNewsCoPilotModal
        isOpen={isAiCopilotOpen && canEditContent && canUseEditorialAi}
        onClose={() => setIsAiCopilotOpen(false)}
        currentTitle={title}
        currentShortTitle={shortTitle}
        currentSummary={summary}
        currentContent={content}
        onApplyChanges={handleApplyAiChanges}
      />
      <div aria-hidden="true" className="sm:hidden" style={{ height: actionBarHeight }} />
    </div>
  );
};
