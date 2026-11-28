import { ShowMore, useIncremental } from '../components/common/ShowMore';
import { confirmDialog } from '../services/dialogs';
import { matchesQuery } from '../shared/search';
import { apiService } from '../services/api';
import { VIDEO_STATUSES, isVideoReady, videoStatusName } from '../shared/production';
import { FormPage } from '../components/common/FormPage';
import { RbacService } from '../services/rbacService';
import { confirmSaved } from '../services/confirmSave';
import { notify } from '../services/notify';
import React, { useEffect, useRef, useState } from 'react';
import { ACCEPTED_UPLOAD_TYPES, UploadedFile, discardMediaUpload, mediaTypeForMime, readMediaDuration, uploadMediaFile } from '../services/mediaUpload';
import { storageClient, type ExternalSource, type ImportedFile } from '../services/storageClient';
import { ExternalFilePicker, availableSources } from '../components/media/ExternalFilePicker';
import { MediaFolderBar, useMediaFolders } from '../components/media/MediaFolderBar';
import { MediaSourceFilter, MediaUploadDestination, mediaUploadId, useMediaStorageFilter, type UploadDestination } from '../components/media/MediaStorageControls';
import { MediaEditorialPanel } from '../components/media/MediaEditorialPanel';
import { MediaQuoteDialog } from '../components/media/MediaQuoteDialog';
import { ExternalLinkPanel } from '../components/common/ExternalLinkPanel';
import { mediaRightsIssue, type MediaTranscriptSegment } from '../shared/mediaEditorial';
import { TARGET_NAMES, type StorageLocations, type StorageStatus } from '../shared/storage';
import { UploadCloud, Image as ImageIcon, Video, Music, FileText, Search, Tag, Trash2, Eye, X, Sparkles, Copy, Check, Clock, HardDrive, Download } from 'lucide-react';
import { MediaAsset, MediaType, User } from '../types';

/** «PDF», «MP3»… from a file name, for tiles without a picture. */
const fileExtension = (name?: string) => (name && /\.([a-z0-9]{1,5})$/i.exec(name)?.[1]?.toUpperCase()) || '';

/** A file name that may wrap after «_», «-» and «.» (long names otherwise break mid-word). */
const breakable = (name = '') =>
  name.split(/(?<=[_.-])/).map((part, i) => (
    <React.Fragment key={i}>
      {i > 0 && <wbr />}
      {part}
    </React.Fragment>
  ));
import { Badge } from '../components/common/Badge';
import { FilterTabs } from '../components/common/FilterTabs';
import { Modal } from '../components/common/Modal';

interface MediaLibraryViewProps {
  mediaAssets: MediaAsset[];
  currentUser: User;
  /** Resolves false when the item was not saved (the upload page then stays open with what was typed). */
  onUploadMedia: (asset: Partial<MediaAsset>) => void | boolean | Promise<boolean | void>;
  onDeleteMedia: (id: string) => void;
  /** Library item to open (from an address such as /media/<id>, e.g. a file attached to an assignment). */
  focusId?: string | null;
}

const MEDIA_TYPE_NAMES: Record<MediaType, string> = { IMAGE: 'صورة', VIDEO: 'فيديو', AUDIO: 'صوت', DOCUMENT: 'وثيقة', PDF: 'وثيقة PDF' };
const MEDIA_FILTERS = [
  { id: 'ALL', label: 'الكل' },
  { id: 'IMAGE', label: 'الصور' },
  { id: 'VIDEO', label: 'الفيديو' },
  { id: 'AUDIO', label: 'الصوتيات' },
  { id: 'DOCUMENT', label: 'الوثائق' },
] as const;
type MediaFilter = (typeof MEDIA_FILTERS)[number]['id'];
const mediaFilterType = (asset: MediaAsset) => asset.mediaType === 'PDF' ? 'DOCUMENT' : asset.mediaType;

const TAG_SUGGESTIONS = [
  'أخبار_عاجلة',
  'تقرير_ميداني',
  'مؤتمر_صحفي',
  'استوديو_وتحليل',
  'اقتصاد_وأسواق',
  'حوار_خاص',
  'أرشيف_وثائقي',
];

const DURATION_PRESETS = [
  { label: '30 ثانية', value: 30 },
  { label: 'دقيقة (60ث)', value: 60 },
  { label: 'دقيقتان (120ث)', value: 120 },
  { label: '3 دقائق (180ث)', value: 180 },
  { label: '5 دقائق (300ث)', value: 300 },
  { label: '10 دقائق (600ث)', value: 600 },
];

/** Thumbnail that shows the type icon while loading, when missing, or when the file fails. */
const ThumbImage: React.FC<{ src?: string; alt: string; className: string; icon?: React.ReactNode }> = ({ src, alt, className, icon }) => {
  const [state, setState] = React.useState<'loading' | 'ok' | 'failed'>(src ? 'loading' : 'failed');
  React.useEffect(() => setState(src ? 'loading' : 'failed'), [src]);
  return (
    <>
      {state !== 'ok' && icon && <span className="absolute inset-0 flex items-center justify-center text-slate-500 [&>svg]:w-10 [&>svg]:h-10">{icon}</span>}
      {src && state !== 'failed' && (
        <img src={src} alt={alt || ''} loading="lazy" onLoad={() => setState('ok')} onError={() => setState('failed')} className={`${className} ${state === 'ok' ? '' : 'opacity-0'}`} />
      )}
    </>
  );
};

export const MediaLibraryView: React.FC<MediaLibraryViewProps> = ({
  mediaAssets = [],
  currentUser,
  onUploadMedia,
  onDeleteMedia,
  focusId,
}) => {
  const canUpload = RbacService.hasPermission(currentUser, 'media.upload');
  // How many stories/segments use each item (computed once per render).
  const usageMap = new Map<string, number>();
  apiService.getNews().forEach((n) => (n.mediaIds || []).forEach((id) => usageMap.set(id, (usageMap.get(id) || 0) + 1)));
  apiService.getEpisodes().forEach((e) => (e.rundown || []).forEach((seg) => (seg.mediaIds || []).forEach((id) => usageMap.set(id, (usageMap.get(id) || 0) + 1))));
  const usageCount = (id: string) => usageMap.get(id) || 0;
  // Same rule as the server: media.delete, or the owner with upload rights.
  const canDeleteAsset = (a: MediaAsset) =>
    (!a.privateMessageMedia || a.ownerId === currentUser.id) &&
    (RbacService.hasPermission(currentUser, 'media.delete') || (canUpload && [a.ownerId, a.uploadedById].includes(currentUser.id)));
  const [selectedType, setSelectedType] = useState<MediaFilter>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const sourceFilter = useMediaStorageFilter(mediaAssets);
  const folders = useMediaFolders(currentUser, mediaAssets, canUpload, searchQuery);
  const [destination, setDestination] = useState<UploadDestination>('default');
  const [dropboxOpen, setDropboxOpen] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [previewAsset, setPreviewAsset] = useState<MediaAsset | null>(null);
  const [quote, setQuote] = useState<{ asset: MediaAsset; segment: MediaTranscriptSegment }>();
  const canQuote = (RbacService.hasPermission(currentUser, 'news.create') && RbacService.canOpenScreen(currentUser, 'news')) ||
    (RbacService.hasPermission(currentUser, 'requests.create') && RbacService.canOpenScreen(currentUser, 'requests'));
  useEffect(() => {
    setPreviewAsset(previous => previous ? mediaAssets.find(asset => asset.id === previous.id) || null : null);
  }, [mediaAssets]);
  const previewPlayer = useRef<HTMLMediaElement | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  useEffect(() => {
    if (!focusId) return;
    const asset = mediaAssets.find((a) => a.id === focusId);
    if (asset) setPreviewAsset(asset);
    // Only when another item is asked for, not on every library change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId]);

  // Upload modal fields
  const [title, setTitle] = useState('');
  const [mediaType, setMediaType] = useState<MediaType>('IMAGE');
  const [fileUrl, setFileUrl] = useState('');
  const [durationSeconds, setDurationSeconds] = useState(0);
  // Where files can also be kept (Dropbox, Google Drive, the station's shared folder).
  const [storage, setStorage] = useState<StorageStatus | null>(null);
  const [keepInShare, setKeepInShare] = useState(true);
  const [showExternal, setShowExternal] = useState(false);
  const [locations, setLocations] = useState<{ id: string; data?: StorageLocations; failed?: boolean } | null>(null);
  useEffect(() => {
    let active = true;
    storageClient.status().then((st) => active && setStorage(st)).catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  const externalSources = availableSources(storage);
  const shareOffered = !!storage?.share.enabled && storage.share.mode !== 'none' && storage.isLocal;
  const previewUrl = previewAsset?.fileUrl || previewAsset?.url || '';
  const previewUploadId = previewAsset ? mediaUploadId(previewAsset) : undefined;
  const previewLocations = locations?.id === previewUploadId ? locations : null;
  useEffect(() => {
    if (!previewUploadId) return;
    let active = true;
    const refreshLocations = async () => {
      try {
        const data = await storageClient.locations(previewUploadId);
        if (active) setLocations({ id: previewUploadId, data });
      } catch {
        if (active) setLocations({ id: previewUploadId, failed: true });
      }
    };
    void refreshLocations();
    const timer = window.setInterval(refreshLocations, 15_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [previewUploadId]);
  const shareAddress = (relative?: string) => {
    const root = storage?.share.displayPath || '';
    if (!relative) return '';
    return root ? `${root.replace(/[\\/]+$/, '')}\\${relative.split('/').join('\\')}` : relative;
  };
  const canApproveVideo = RbacService.hasPermission(currentUser, 'news.approve') || RbacService.hasPermission(currentUser, 'media.delete');
  const [tagsInput, setTagsInput] = useState('');
  const [description, setDescription] = useState('');
  const [uploaded, setUploaded] = useState<(UploadedFile & { source?: ExternalSource }) | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [retryFile, setRetryFile] = useState<File | null>(null);
  const activeUpload = useRef<ReturnType<typeof uploadMediaFile> | null>(null);
  const uploadSelection = useRef(0);
  const [savingUpload, setSavingUpload] = useState(false);

  // Editing an item's metadata from its preview.
  const [editTitle, setEditTitle] = useState('');
  const [editTags, setEditTags] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  useEffect(() => {
    setEditTitle(previewAsset?.title || '');
    setEditTags((previewAsset?.tags || []).join('، '));
    setEditDescription(previewAsset?.description || '');
    // Reset only when another item is opened, not after each save of the same one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewAsset?.id]);
  const splitTags = (text: string) => text.split(/[,،]+/).map((t) => t.trim()).filter(Boolean);
  const editDirty = !!previewAsset && (
    editTitle.trim() !== (previewAsset.title || '') ||
    editDescription.trim() !== (previewAsset.description || '') ||
    splitTags(editTags).join('|') !== (previewAsset.tags || []).join('|'));

  const handleSaveDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!previewAsset || savingEdit) return;
    if (!editTitle.trim()) {
      notify({ type: 'error', message: 'عنوان المادة مطلوب' });
      return;
    }
    setSavingEdit(true);
    try {
      const tags = splitTags(editTags);
      const updated = apiService.updateMedia(previewAsset.id, {
        title: editTitle.trim(),
        description: editDescription.trim(),
        tags: tags.length > 0 ? tags : ['عام'],
      });
      setPreviewAsset(updated as MediaAsset);
      await confirmSaved('media', previewAsset.id, 'حُفظت بيانات المادة');
    } catch (err: any) {
      notify({ type: 'error', title: 'تعذر حفظ بيانات المادة', message: err?.message || 'حدث خطأ' });
    } finally {
      setSavingEdit(false);
    }
  };

  const handleOpenUpload = (imported?: ImportedFile) => {
    setTitle('');
    setMediaType('IMAGE');
    setFileUrl('');
    setDurationSeconds(0);
    setDestination('default');
    setKeepInShare(apiService.getSettings().storage?.share?.copyByDefault ?? true);
    setShowExternal(false);
    setTagsInput('');
    setDescription('');
    setUploaded(null);
    setUploadProgress(null);
    setUploadError(null);
    setRetryFile(null);
    setIsUploadModalOpen(true);
    if (imported) {
      setUploaded({ ...imported, source: 'dropbox' });
      setTitle(imported.originalName.replace(/\.[^.]+$/, ''));
      setFileUrl(imported.url);
      setMediaType(mediaTypeForMime(imported.mimeType));
    }
  };

  const closeUpload = () => {
    uploadSelection.current++;
    activeUpload.current?.abort();
    activeUpload.current = null;
    if (retryFile) void discardMediaUpload(retryFile);
    setRetryFile(null);
    setUploadProgress(null);
    setIsUploadModalOpen(false);
  };

  const handleFileSelected = async (file: File | undefined) => {
    if (!file || activeUpload.current) return;
    if (retryFile && retryFile !== file) void discardMediaUpload(retryFile);
    setRetryFile(file);
    setUploadError(null);
    if (uploaded) setFileUrl('');
    setUploaded(null);
    setUploadProgress(0);
    const selection = ++uploadSelection.current;
    setDurationSeconds(0);
    const task = uploadMediaFile(file, setUploadProgress, { keepInSharedFolder: destination !== 'local' && shareOffered && keepInShare,
      cloudTargets: destination === 'default' ? undefined : destination === 'local' ? [] : [destination] });
    activeUpload.current = task;
    try {
      // The real length of a clip, read while it uploads.
      void readMediaDuration(file).then(seconds => { if (seconds && selection === uploadSelection.current) setDurationSeconds(seconds); });
      const result = await task.promise;
      if (activeUpload.current !== task) return;
      setUploaded(result);
      setRetryFile(null);
      setFileUrl(result.url);
      setMediaType(mediaTypeForMime(result.mimeType));
      setTitle(current => current.trim() ? current : file.name.replace(/\.[^.]+$/, ''));
    } catch (err: any) {
      if (activeUpload.current === task) setUploadError(err?.message || 'فشل رفع الملف');
    } finally {
      if (activeUpload.current === task) {
        activeUpload.current = null;
        setUploadProgress(null);
      }
    }
  };

  const handleAddTag = (tag: string) => {
    const existing = tagsInput
      .split(/[,،]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (!existing.includes(tag)) {
      setTagsInput(existing.length > 0 ? `${tagsInput}، ${tag}` : tag);
    }
  };

  const handleSaveUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || savingUpload) return;

    const tags = tagsInput
      .split(/[,،]+/)
      .map((t) => t.trim())
      .filter(Boolean);

    if (!fileUrl.trim()) {
      setUploadError('اختر ملفاً للرفع أو أدخل رابطاً خارجياً');
      return;
    }

    setSavingUpload(true);
    try {
    const saved = await onUploadMedia({
      title: title.trim(),
      mediaType,
      fileUrl: fileUrl.trim(),
      url: fileUrl.trim(),
      fileName: uploaded?.originalName || fileUrl.trim().split('/').pop()?.split('?')[0] || title.trim(),
      originalName: uploaded?.originalName,
      mimeType: uploaded?.mimeType,
      fileSize: uploaded?.sizeBytes,
      fileSizeBytes: uploaded?.sizeBytes,
      durationSeconds: (mediaType === 'VIDEO' || mediaType === 'AUDIO') && Number(durationSeconds) > 0 ? Number(durationSeconds) : undefined,
      uploadedById: currentUser.id,
      folderId: folders.folder?.id ?? null,
      uploadedByName: currentUser.fullName,
      description: description.trim(),
      tags: tags.length > 0 ? tags : ['عام'],
    });
    // Close only once the item is saved; a refusal keeps everything typed on the page.
    if (saved !== false) setIsUploadModalOpen(false);
    } catch (err: any) {
      setUploadError(err?.message || 'تعذر حفظ المادة');
    } finally {
      setSavingUpload(false);
    }
  };

  const handleCopyUrl = (url: string) => {
    // A full address colleagues can paste anywhere (the stored one is relative to «مدار»).
    navigator.clipboard.writeText(url.startsWith('/') ? `${window.location.origin}${url}` : url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const filteredAssets = (mediaAssets || []).filter((a) => {
    if (!folders.accepts(a) || !sourceFilter.accepts(a) || (selectedType !== 'ALL' && mediaFilterType(a) !== selectedType)) return false;
    if (searchQuery.trim()) {
      return matchesQuery(searchQuery, a.title, a.fileName, (a as any).originalName, a.description, a.tags || []);
    }
    return true;
  });
  const assetPage = useIncremental(filteredAssets, 48, `${searchQuery}|${selectedType}|${sourceFilter.source}|${folders.folder?.id ?? ''}|${folders.searchEverywhere}`);
  const typeCounts = { ALL: mediaAssets.length, IMAGE: 0, VIDEO: 0, AUDIO: 0, DOCUMENT: 0 };
  for (const asset of mediaAssets) typeCounts[mediaFilterType(asset)]++;
  const resetFilters = () => { setSearchQuery(''); setSelectedType('ALL'); sourceFilter.setSource('all'); };

  const getMediaIcon = (type: MediaType) => {
    switch (type) {
      case 'IMAGE':
        return <ImageIcon className="w-5 h-5 text-emerald-500" />;
      case 'VIDEO':
        return <Video className="w-5 h-5 text-blue-500" />;
      case 'AUDIO':
        return <Music className="w-5 h-5 text-purple-500" />;
      case 'DOCUMENT':
      default:
        return <FileText className="w-5 h-5 text-amber-500" />;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <ImageIcon className="w-5 h-5 text-blue-600" />
            مكتبة الوسائط
          </h1>
          <p className="text-xs text-slate-500 mt-1">الصور والفيديو والصوت والوثائق، مع الوسوم والبحث.</p>
        </div>

        {canUpload && (
        <button
          type="button"
          onClick={() => handleOpenUpload()}
          className="flex items-center gap-2 min-h-11 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold self-start sm:self-auto"
        >
          <UploadCloud className="w-4 h-4" />
          رفع مادة وسائط جديدة
        </button>
        )}
        {externalSources.includes('dropbox') && <button type="button" onClick={() => setDropboxOpen(true)} className="min-h-11 rounded-xl border border-blue-200 px-4 text-sm font-bold text-blue-800 hover:bg-blue-50">تصفّح Dropbox</button>}
        {canUpload && <ExternalLinkPanel kind="upload" />}
      </div>

      <MediaFolderBar model={folders} clearSearch={() => setSearchQuery('')} />

      {/* Filter Bar */}
      <div role="group" aria-label="تصفية مكتبة الوسائط" className="bg-white p-3 rounded-xl border border-slate-200 grid gap-2 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
        <div className="relative min-w-0">
          <Search className="w-4 h-4 text-slate-500 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            id="media-search-input"
            type="search"
            aria-label="البحث في مكتبة الوسائط"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="ابحث في الملفات والوسوم…"
            autoComplete="off"
            spellCheck="false"
            className="w-full min-h-11 pr-10 pl-12 bg-white border border-slate-300 rounded-lg text-sm text-slate-800 placeholder:text-slate-500 focus-visible:ring-2 focus-visible:ring-blue-500 [&::-webkit-search-cancel-button]:hidden"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute left-0 inset-y-0 w-11 inline-flex items-center justify-center rounded-lg text-slate-600 hover:text-slate-900"
              aria-label="مسح البحث"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <FilterTabs<MediaFilter>
          label="نوع الوسائط"
          active={selectedType}
          onChange={setSelectedType}
          tabs={MEDIA_FILTERS.map((tab) => ({ ...tab, count: typeCounts[tab.id] }))}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {!!searchQuery.trim() && <label className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={folders.searchEverywhere} onChange={event => folders.setSearchEverywhere(event.target.checked)} /> البحث في كل المجلدات</label>}
        <MediaSourceFilter value={sourceFilter.source} onChange={sourceFilter.setSource} />
        {sourceFilter.loading && <p role="status" className="text-sm text-slate-600">جارٍ التحقق من أماكن التخزين…</p>}
        {sourceFilter.error && <div className="flex items-center gap-2 text-sm"><p role="alert" className="text-rose-800">{sourceFilter.error}</p><button type="button" onClick={sourceFilter.retry} className="min-h-11 rounded-lg px-2 font-bold text-blue-800">إعادة المحاولة</button></div>}
      </div>

      {/* Assets Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
        {assetPage.visible.map((asset) => (
          <article
            key={asset.id}
            className="min-w-0 bg-white rounded-xl border border-slate-200 overflow-hidden flex flex-col hover:border-blue-300 transition-colors"
          >
            {folders.selecting && folders.mayMove(asset) && <label className="flex min-h-11 items-center gap-2 border-b border-slate-200 px-3 text-sm font-semibold"><input type="checkbox" checked={folders.selected.has(asset.id)} onChange={() => folders.toggle(asset.id)} aria-label={`تحديد ${asset.title || asset.fileName}`} />تحديد</label>}
            {/* Visual Thumbnail */}
            <div className="theme-fixed relative aspect-video bg-slate-900 flex items-center justify-center overflow-hidden">
              {asset.mediaType === 'IMAGE' ? (
                <ThumbImage src={asset.fileUrl || asset.url} alt={asset.title} icon={getMediaIcon('IMAGE')} className="w-full h-full object-cover" />
              ) : asset.mediaType === 'VIDEO' ? (
                <div className="w-full h-full relative flex items-center justify-center bg-slate-950">
                  <ThumbImage src={(asset as any).thumbnailUrl || (asset as any).posterUrl} alt="" className="w-full h-full object-cover opacity-60" />
                  <div className="absolute w-11 h-11 rounded-full bg-blue-600/90 text-white flex items-center justify-center">
                    <Video className="w-5 h-5" />
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 text-slate-500 p-4 text-center">
                  <div className="p-3 bg-slate-800 rounded-2xl text-blue-400">
                    {getMediaIcon(asset.mediaType)}
                  </div>
                  {fileExtension(asset.fileName) && (
                    <span className="text-xs font-mono font-bold text-slate-300" dir="ltr">
                      {fileExtension(asset.fileName)}
                    </span>
                  )}
                </div>
              )}

              <div className="absolute top-2 right-2">
                <Badge variant="default" size="sm">
                  {MEDIA_TYPE_NAMES[asset.mediaType] || 'وثيقة'}
                </Badge>
              </div>

              {asset.durationSeconds && (
                <div className="absolute bottom-2 left-2 bg-slate-950/80 text-white text-2xs font-mono px-2 py-0.5 rounded-md flex items-center gap-1 backdrop-blur-xs">
                  <Clock className="w-3 h-3 text-slate-500" />
                  {Math.floor(asset.durationSeconds / 60)}:
                  {(asset.durationSeconds % 60).toString().padStart(2, '0')}
                </div>
              )}
            </div>

            {/* Content info */}
            <div className="p-4 space-y-2 flex-1 flex flex-col justify-between">
              <div>
                <h2 className="text-sm font-bold leading-snug">
                  <button
                    type="button"
                    onClick={() => setPreviewAsset(asset)}
                    aria-label={`معاينة المادة: ${asset.title || asset.fileName}`}
                    title="معاينة المادة"
                    className="w-full min-h-11 sm:min-h-9 flex items-center justify-between gap-2 text-start rounded-lg text-slate-800 hover:text-blue-700 focus-visible:ring-2 focus-visible:ring-blue-500"
                  >
                    <span dir="auto" className="min-w-0 line-clamp-2 [overflow-wrap:anywhere]">{asset.title || breakable(asset.fileName)}</span>
                    <Eye className="w-5 h-5 shrink-0 text-blue-700" aria-hidden="true" />
                  </button>
                </h2>
                {mediaRightsIssue(asset) && <p className="mt-1 text-2xs font-bold text-amber-800">{mediaRightsIssue(asset)}</p>}
                {(asset.mediaType === 'VIDEO' || usageCount(asset.id) > 0) && (
                  <div className="flex flex-wrap items-center gap-1.5 mt-1.5 text-2xs font-bold">
                    {asset.mediaType === 'VIDEO' && (
                      <span className={`px-1.5 py-0.5 rounded-md ${isVideoReady(asset.videoStatus) ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>
                        {videoStatusName(asset.videoStatus)}
                      </span>
                    )}
                    {usageCount(asset.id) > 0 && <span className="px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-700">مستخدمة في {usageCount(asset.id)}</span>}
                  </div>
                )}
                {asset.tags && asset.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {asset.tags.map((tg) => (
                      <span
                        key={tg}
                        className="max-w-full text-2xs font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md [overflow-wrap:anywhere]"
                      >
                        #{tg}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                <span className="text-2xs truncate max-w-[120px]" title={asset.uploadedByName}>
                  {asset.uploadedByName || 'النظام'}
                </span>
                <div className="flex items-center gap-1">
                  {canDeleteAsset(asset) && (
                  <button
                    type="button"
                    onClick={async () => {
                      const name = asset.title || asset.fileName;
                      const message = asset.privateMessageMedia
                        ? `إزالة مرجع المرفق «${name}» من مكتبة الوسائط؟ يبقى الملف في الرسالة.`
                        : `نقل «${name}» إلى سلة المحذوفات؟ يمكنك استعادة المادة وملفها ما دامت في السلة.`;
                      if (await confirmDialog(message)) onDeleteMedia(asset.id);
                    }}
                    className="w-11 h-11 sm:w-9 sm:h-9 inline-flex items-center justify-center text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                    title={asset.privateMessageMedia ? 'إزالة مرجع المرفق' : 'نقل إلى سلة المحذوفات'}
                    aria-label={`${asset.privateMessageMedia ? 'إزالة مرجع المرفق' : 'نقل إلى سلة المحذوفات'}: ${asset.title || asset.fileName}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  )}
                </div>
              </div>
            </div>
          </article>
        ))}

        {filteredAssets.length === 0 && !sourceFilter.loading && !sourceFilter.error && (
          <div className="col-span-full py-16 flex flex-col items-center justify-center text-slate-500 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
            <HardDrive className="w-10 h-10 mb-3 text-slate-400" aria-hidden="true" />
            <p role="status" className="font-semibold text-sm">{mediaAssets.length === 0 ? 'المكتبة فارغة.' : 'لا مواد تطابق البحث أو النوع المختار.'}</p>
            {mediaAssets.length > 0 ? (
              <button type="button" onClick={resetFilters} className="min-h-11 px-3 text-sm font-semibold text-blue-700 hover:underline">مسح الفلاتر</button>
            ) : canUpload && <p className="text-xs text-slate-500 mt-1">ارفع ملفاً من «رفع مادة وسائط جديدة».</p>}
          </div>
        )}
      </div>
      <ShowMore remaining={assetPage.remaining} onMore={assetPage.showMore} onAll={assetPage.showAll} noun="مادة" />

      <Modal isOpen={dropboxOpen} onClose={() => setDropboxOpen(false)} title="تصفّح Dropbox">
        <ExternalFilePicker sources={['dropbox']} onPicked={canUpload ? file => {
          setDropboxOpen(false);
          handleOpenUpload(file);
        } : undefined} />
      </Modal>

      {/* Upload Modal */}
      <FormPage
        isOpen={isUploadModalOpen}
        onClose={closeUpload}
        title="رفع وتسجيل مادة وسائط جديدة"
        subtitle="أرشفة الصور، التقارير المرئية، والمقاطع الصوتية في بنك الوسائط المركزي"
        maxWidth="lg"
      >
        <form onSubmit={handleSaveUpload} className="space-y-4">
          {!uploaded?.source && <MediaUploadDestination value={destination} onChange={setDestination} status={storage}
            disabled={uploadProgress !== null || !!uploaded || !!retryFile} share={keepInShare} onShare={setKeepInShare} />}
          {/* File upload */}
          <div className="p-3 bg-blue-50/50 rounded-xl border border-blue-100 space-y-2">
            <label htmlFor="media-file-input" className="text-2xs font-bold text-blue-800 flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-blue-600" />
              رفع ملف من الجهاز (صور، فيديو، صوت، PDF)
            </label>
            <input
              id="media-file-input"
              type="file"
              accept={ACCEPTED_UPLOAD_TYPES.join(',')}
              disabled={uploadProgress !== null}
              onChange={(e) => handleFileSelected(e.target.files?.[0])}
              className="block w-full text-xs text-slate-700 file:ml-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-blue-600 file:text-white file:text-xs file:font-bold"
            />
            {uploadProgress !== null && (
              <div className="space-y-1">
                <div className="w-full h-2 bg-blue-100 rounded-full overflow-hidden" role="progressbar" aria-label="تقدم رفع الملف" aria-valuemin={0} aria-valuemax={100} aria-valuenow={uploadProgress}>
                  <div className="h-full bg-blue-600 transition-all" style={{ width: `${uploadProgress}%` }} />
                </div>
                <button type="button" className="min-h-11 text-sm font-semibold text-blue-700 hover:underline" onClick={() => activeUpload.current?.abort()}>إيقاف الرفع</button>
              </div>
            )}
            {uploaded && (
              <p className="text-2xs text-emerald-700 font-semibold">
                {uploaded.source ? `أُضيف الملف من ${TARGET_NAMES[uploaded.source]}` : 'تم رفع الملف'} — {uploaded.originalName} ({(uploaded.sizeBytes / (1024 * 1024)).toFixed(2)} MB)
              </p>
            )}
            {uploadError && <p role="alert" className="text-sm text-rose-800 font-semibold">{uploadError}</p>}
            {uploadError && retryFile && <button type="button" className="min-h-11 px-3 bg-white border border-blue-300 rounded-lg text-sm font-bold text-blue-700 hover:bg-blue-50" onClick={() => void handleFileSelected(retryFile)}>إعادة محاولة رفع الملف</button>}
            {externalSources.length > 0 && !uploaded && (
              <button type="button" onClick={() => setShowExternal((v) => !v)} aria-expanded={showExternal} className="min-h-10 text-xs font-bold text-blue-700 underline">
                {showExternal ? 'إخفاء' : `أو أضف ملفاً موجوداً في ${externalSources.map((x) => TARGET_NAMES[x]).join(' أو ')}`}
              </button>
            )}
            {showExternal && !uploaded && (
              <ExternalFilePicker
                sources={externalSources}
                onPicked={(file, source) => {
                  setUploaded({ ...file, source });
                  setFileUrl(file.url);
                  setMediaType(mediaTypeForMime(file.mimeType));
                  if (!title.trim()) setTitle(file.originalName.replace(/\.[^.]+$/, ''));
                  setShowExternal(false);
                }}
              />
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="media-title-input" className="block text-xs font-bold text-slate-700">عنوان المادة أو الملف *</label>
              {title && (
                <button
                  type="button"
                  onClick={() => setTitle('')}
                  className="text-2xs text-slate-500 hover:text-rose-500"
                >
                  مسح
                </button>
              )}
            </div>
            <input
              id="media-title-input"
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="مثال: لقطات من المؤتمر الصحفي الاقتصادي"
              className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="media-type-select" className="block text-xs font-bold text-slate-700 mb-1">نوع الوسيط</label>
              <select
                id="media-type-select"
                value={mediaType}
                onChange={(e) => setMediaType(e.target.value as MediaType)}
                className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs font-semibold text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
              >
                <option value="IMAGE">صورة فوتوغرافية (JPG/PNG)</option>
                <option value="VIDEO">مقطع فيديو للبث (MP4)</option>
                <option value="AUDIO">ملف صوتي / مكالمة (MP3/WAV)</option>
                <option value="DOCUMENT">وثيقة صحفية / بيان (PDF/DOC)</option>
              </select>
            </div>

            <div>
              <label htmlFor="media-duration-input" className="block text-xs font-bold text-slate-700 mb-1">المدة (للفيديو والصوت)</label>
              <input
                id="media-duration-input"
                type="number"
                inputMode="numeric"
                min="0"
                value={durationSeconds}
                onChange={(e) => setDurationSeconds(Number(e.target.value))}
                disabled={mediaType !== 'VIDEO' && mediaType !== 'AUDIO'}
                className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs font-mono text-center focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all disabled:bg-slate-100 disabled:text-slate-400"
              />
              {(mediaType === 'VIDEO' || mediaType === 'AUDIO') && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {DURATION_PRESETS.map((dp) => (
                    <button
                      key={dp.value}
                      type="button"
                      onClick={() => setDurationSeconds(dp.value)}
                      className="text-2xs bg-slate-100 hover:bg-blue-50 text-slate-600 px-1.5 py-0.5 rounded"
                    >
                      {dp.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="media-url-input" className="block text-xs font-bold text-slate-700">أو رابط ملف خارجي (URL)</label>
              {fileUrl && (
                <button
                  type="button"
                  onClick={() => setFileUrl('')}
                  className="text-2xs text-slate-500 hover:text-rose-500"
                >
                  مسح
                </button>
              )}
            </div>
            <input
              id="media-url-input"
              type="text"
              inputMode="url"
              autoCapitalize="none"
              spellCheck="false"
              value={fileUrl}
              readOnly={!!uploaded}
              onChange={(e) => setFileUrl(e.target.value)}
              placeholder="https://..."
              className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-left focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono transition-all"
              dir="ltr"
            />
            {fileUrl && (mediaType === 'IMAGE' || mediaType === 'VIDEO') && (
              <div className="mt-2 p-2 bg-slate-100 rounded-xl flex items-center gap-3">
                <img
                  src={fileUrl}
                  alt="معاينة"
                  className="w-16 h-12 object-cover rounded-lg bg-slate-900 shrink-0"
                  onError={(e) => {
                    (e.target as HTMLElement).style.display = 'none';
                  }}
                />
                <span className="text-2xs text-slate-600">معاينة حية للرابط</span>
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="media-tags-input" className="block text-xs font-bold text-slate-700">الوسوم والكلمات الدلالية (مفصولة بفواصل)</label>
              {tagsInput && (
                <button
                  type="button"
                  onClick={() => setTagsInput('')}
                  className="text-2xs text-slate-500 hover:text-rose-500"
                >
                  مسح
                </button>
              )}
            </div>
            <input
              id="media-tags-input"
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="أخبار، اقتصاد، مباشر..."
              className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
            />
            <div className="mt-1.5 flex flex-wrap gap-1">
              <span className="text-2xs text-slate-500 flex items-center gap-0.5">
                <Tag className="w-3 h-3 text-slate-500" />
                اقتراحات:
              </span>
              {TAG_SUGGESTIONS.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => handleAddTag(tag)}
                  className="text-2xs bg-slate-100 hover:bg-blue-50 text-slate-600 hover:text-blue-700 px-1.5 py-0.5 rounded transition-colors"
                >
                  +{tag}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="media-desc-textarea" className="block text-xs font-bold text-slate-700">وصف المادة وسياق الاستخدام التحريري</label>
              {description && (
                <button
                  type="button"
                  onClick={() => setDescription('')}
                  className="text-2xs text-slate-500 hover:text-rose-500"
                >
                  مسح
                </button>
              )}
            </div>
            <textarea
              id="media-desc-textarea"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="ملاحظات حول حقوق الملكية، المصدر الأصلي، أو البرامج المستهدفة..."
              className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={closeUpload}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={savingUpload}
              className="px-5 py-2 text-xs font-bold bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-60"
            >
              {savingUpload ? 'جارٍ الحفظ...' : 'تسجيل في الأرشيف'}
            </button>
          </div>
        </form>
      </FormPage>

      {/* Preview Modal */}
      {previewAsset && (
        <Modal
          isOpen={true}
          onClose={() => setPreviewAsset(null)}
          title={`معاينة المادة: ${previewAsset.title || previewAsset.fileName}`}
          subtitle="استعراض الأصل الرقمي والتفاصيل التقنية للوسيط"
          maxWidth="lg"
        >
          <div className="space-y-4">
            {previewAsset.mediaType === 'IMAGE' ? (
              <img
                src={previewAsset.fileUrl || previewAsset.url}
                alt={previewAsset.title}
                className="theme-fixed w-full max-h-96 object-contain rounded-xl bg-slate-950"
              />
            ) : previewAsset.mediaType === 'VIDEO' ? (
              <video
                ref={element => { previewPlayer.current = element; }}
                key={previewAsset.id}
                src={previewAsset.fileUrl || previewAsset.url}
                controls
                preload="metadata"
                aria-label={`تشغيل الفيديو: ${previewAsset.title || previewAsset.fileName}`}
                className="theme-fixed w-full max-h-96 rounded-xl bg-slate-950"
              >
                المتصفح لا يدعم تشغيل هذا الفيديو؛ استخدم رابط التنزيل.
              </video>
            ) : previewAsset.mediaType === 'AUDIO' ? (
              <div className="theme-fixed p-6 bg-slate-900 rounded-xl text-center text-white space-y-3">
                <Music className="w-10 h-10 mx-auto text-purple-400" aria-hidden="true" />
                <p className="text-xs font-mono">{previewAsset.fileName}</p>
                <audio
                  ref={element => { previewPlayer.current = element; }}
                  key={previewAsset.id}
                  src={previewAsset.fileUrl || previewAsset.url}
                  controls
                  preload="metadata"
                  aria-label={`تشغيل الصوت: ${previewAsset.title || previewAsset.fileName}`}
                  className="w-full"
                >
                  المتصفح لا يدعم تشغيل هذا الملف الصوتي؛ استخدم رابط التنزيل.
                </audio>
              </div>
            ) : (
              <div className="theme-fixed p-8 bg-slate-900 rounded-xl text-center text-white space-y-2">
                <FileText className="w-12 h-12 mx-auto text-amber-400" aria-hidden="true" />
                <p className="text-xs font-mono">{previewAsset.fileName}</p>
              </div>
            )}

            <MediaEditorialPanel key={previewAsset.id} asset={previewAsset} player={previewPlayer} canEdit={canUpload} canManageRights={canApproveVideo}
              onQuote={canQuote ? segment => setQuote({ asset: previewAsset, segment }) : undefined}
              onSave={async patch => {
                const current = apiService.getMedia().find(asset => asset.id === previewAsset.id);
                if (!current) throw new Error('المادة لم تعد متاحة في المكتبة.');
                const field = patch.editRanges ? 'editRanges' : 'rights';
                if (JSON.stringify(current[field] ?? null) !== JSON.stringify(previewAsset[field] ?? null)) {
                  setPreviewAsset(current);
                  throw new Error('تغيّرت بيانات المادة لدى زميل. راجع النسخة المحدّثة ثم أعد الحفظ.');
                }
                apiService.updateMedia(previewAsset.id, patch);
                const saved = await confirmSaved('media', previewAsset.id, 'حُفظت بيانات المادة');
                const latest = apiService.getMedia().find(asset => asset.id === previewAsset.id);
                if (latest) setPreviewAsset(previous => previous?.id === latest.id ? latest : previous);
                return saved;
              }} />

            {canUpload && (
              <form onSubmit={handleSaveDetails} className="p-3 rounded-xl border border-slate-200 space-y-3" aria-label="بيانات المادة">
                <div>
                  <label htmlFor="media-edit-title" className="block text-xs font-bold text-slate-700 mb-1">العنوان *</label>
                  <input
                    id="media-edit-title"
                    type="text"
                    required
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="w-full min-h-11 px-3 border border-slate-300 rounded-lg text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label htmlFor="media-edit-tags" className="block text-xs font-bold text-slate-700 mb-1">الوسوم (افصل بينها بفاصلة)</label>
                  <input
                    id="media-edit-tags"
                    type="text"
                    value={editTags}
                    onChange={(e) => setEditTags(e.target.value)}
                    className="w-full min-h-11 px-3 border border-slate-300 rounded-lg text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label htmlFor="media-edit-desc" className="block text-xs font-bold text-slate-700 mb-1">الوصف</label>
                  <textarea
                    id="media-edit-desc"
                    rows={2}
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={!editDirty || savingEdit}
                    className="min-h-11 px-4 text-xs font-bold bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    {savingEdit ? 'جارٍ الحفظ...' : 'حفظ التعديلات'}
                  </button>
                </div>
              </form>
            )}

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-2">
              {!canUpload && previewAsset.description && (
                <p className="text-slate-700 pb-2 border-b border-slate-200">{previewAsset.description}</p>
              )}
              <div className="flex justify-between">
                <span className="text-slate-500">اسم الملف:</span>
                <span className="font-mono text-slate-700 break-all" dir="auto">{previewAsset.fileName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">النوع:</span>
                <span className="font-semibold text-slate-800">{MEDIA_TYPE_NAMES[previewAsset.mediaType] || previewAsset.mediaType}</span>
              </div>
              {previewAsset.mediaType === 'VIDEO' && (
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="preview-video-status" className="text-slate-500">حالة الفيديو:</label>
                  {canUpload ? (
                    <select
                      id="preview-video-status"
                      value={previewAsset.videoStatus || 'RAW'}
                      onChange={(e) => {
                        const updated = apiService.updateMedia(previewAsset.id, {
                          videoStatus: e.target.value as any,
                          ...(e.target.value === 'EDITING' && !previewAsset.editorId ? { editorId: currentUser.id, editorName: currentUser.fullName } : {}),
                        });
                        setPreviewAsset(updated as any);
                      }}
                      className="text-xs px-2 py-1 border border-slate-300 rounded-lg bg-white"
                    >
                      {VIDEO_STATUSES.map((v) => (
                        <option key={v.id} value={v.id} disabled={v.id === 'APPROVED' && !canApproveVideo && previewAsset.videoStatus !== 'APPROVED'}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="font-semibold text-slate-800">{videoStatusName(previewAsset.videoStatus)}</span>
                  )}
                </div>
              )}
              {previewAsset.editorName && (
                <div className="flex justify-between">
                  <span className="text-slate-500">المونتير:</span>
                  <span className="font-semibold text-slate-800">{previewAsset.editorName}</span>
                </div>
              )}
              <div className="pt-1 border-t border-slate-200">
                <span className="text-slate-500 block mb-1">مستخدمة في:</span>
                {apiService.getMediaUsage(previewAsset.id).length === 0 ? (
                  <span className="text-slate-500">غير مرتبطة بأي خبر أو فقرة بعد</span>
                ) : (
                  <ul className="space-y-0.5">
                    {apiService.getMediaUsage(previewAsset.id).map((u) => (
                      <li key={`${u.kind}:${u.id}`} className="text-slate-700">
                        {u.kind === 'news' ? 'خبر' : 'فقرة'}: <strong>{u.title}</strong>
                        {u.episodeTitle ? ` (${u.episodeTitle})` : ''}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">أُضيف بواسطة</span>
                <span className="font-semibold text-slate-800">{previewAsset.uploadedByName || 'النظام'}</span>
              </div>
              {previewUploadId && (
                <div className="pt-1 border-t border-slate-200 space-y-1">
                  <span className="text-slate-500 block">أماكن حفظ الملف</span>
                  {previewLocations?.failed ? (
                    <p className="text-slate-600">تعذر قراءة أماكن حفظ الملف.</p>
                  ) : previewLocations?.data ? (
                    <ul className="space-y-1">
                      <li className="text-slate-700">{previewLocations.data.local ? 'الخادم · نسخة متاحة' : 'الخادم · لا توجد نسخة'}</li>
                      {previewLocations.data.copies.map((c) => (
                        <li key={c.target} className="flex flex-wrap items-center gap-2 text-slate-700">
                          <span className={`px-1.5 py-0.5 rounded-md text-2xs font-bold ${c.state === 'DONE' ? 'bg-emerald-50 text-emerald-800' : c.state === 'FAILED' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-900'}`}>
                            {TARGET_NAMES[c.target]} · {c.state === 'DONE' ? 'نسخة مسجّلة' : c.state === 'FAILED' ? 'تعذّر النسخ' : 'بانتظار النسخ'}
                          </span>
                          {c.target === 'share' && c.state === 'DONE' && c.path && (
                            <button type="button" onClick={() => navigator.clipboard.writeText(shareAddress(c.path))} className="min-h-9 px-2 rounded-md border border-slate-300 text-2xs font-semibold hover:bg-slate-50 inline-flex items-center gap-1">
                              <Copy className="w-3 h-3" aria-hidden="true" /> {storage?.share.displayPath ? 'نسخ المسار في الشبكة' : 'نسخ المسار النسبي'}
                            </button>
                          )}
                          {c.target === 'dropbox' && c.path && <span className="text-2xs text-slate-500 break-all" dir="auto">{c.path}</span>}
                        </li>
                      ))}
                    </ul>
                  ) : <p className="text-slate-600">جارٍ قراءة أماكن الحفظ…</p>}
                </div>
              )}
              {!previewUploadId && /^https?:\/\//i.test(previewUrl) && (
                <p className="pt-1 border-t border-slate-200 text-slate-700">مصدر الملف · رابط خارجي</p>
              )}
              {previewAsset.durationSeconds && (
                <div className="flex justify-between">
                  <span className="text-slate-500">المدة:</span>
                  <span className="font-mono text-slate-700 font-bold">
                    {Math.floor(previewAsset.durationSeconds / 60)}:
                    {(previewAsset.durationSeconds % 60).toString().padStart(2, '0')} دقيقة
                  </span>
                </div>
              )}
              {previewAsset.tags && previewAsset.tags.length > 0 && (
                <div className="flex items-center gap-1 pt-1 border-t border-slate-200">
                  <span className="text-slate-500">الوسوم:</span>
                  <div className="flex flex-wrap gap-1">
                    {previewAsset.tags.map((t) => (
                      <span key={t} className="text-2xs bg-slate-200 px-2 py-0.5 rounded-md text-slate-700">
                        #{t}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
              <div className="flex flex-wrap items-center gap-2">
              {(previewAsset.fileUrl || previewAsset.url) && (
                <a
                  href={previewAsset.fileUrl || previewAsset.url}
                  download={previewAsset.originalName || previewAsset.fileName || true}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 min-h-11 px-3 text-xs font-bold text-blue-700 hover:bg-blue-50 rounded-lg border border-slate-200"
                >
                  <Download className="w-3.5 h-3.5" aria-hidden="true" />
                  تنزيل الملف
                </a>
              )}
              <button
                type="button"
                onClick={() => handleCopyUrl(previewAsset.fileUrl || previewAsset.url || '')}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 rounded-xl border border-slate-200 transition-colors"
              >
                {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-700" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedLink ? 'تم نسخ الرابط' : 'نسخ رابط الملف'}
              </button>
              </div>

              <button
                type="button"
                onClick={() => setPreviewAsset(null)}
                className="min-h-11 sm:min-h-10 px-4 py-1.5 text-xs font-bold bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-xl"
              >
                إغلاق
              </button>
            </div>
          </div>
        </Modal>
      )}
      {quote && <MediaQuoteDialog asset={quote.asset} segment={quote.segment} user={currentUser} onClose={() => setQuote(undefined)} />}
    </div>
  );
};
