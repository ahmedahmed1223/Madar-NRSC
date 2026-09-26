import { RbacService } from '../services/rbacService';
import React, { useState } from 'react';
import { ACCEPTED_UPLOAD_TYPES, UploadedFile, mediaTypeForMime, uploadMediaFile } from '../services/mediaUpload';
import {
  UploadCloud,
  Image as ImageIcon,
  Video,
  Music,
  FileText,
  Search,
  Tag,
  Trash2,
  Eye,
  X,
  Sparkles,
  Copy,
  Check,
  ExternalLink,
  Clock,
  Layers,
  HardDrive,
} from 'lucide-react';
import { MediaAsset, MediaType, User } from '../types';
import { Badge } from '../components/common/Badge';
import { Modal } from '../components/common/Modal';

interface MediaLibraryViewProps {
  mediaAssets: MediaAsset[];
  currentUser: User;
  onUploadMedia: (asset: Partial<MediaAsset>) => void;
  onDeleteMedia: (id: string) => void;
}

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

export const MediaLibraryView: React.FC<MediaLibraryViewProps> = ({
  mediaAssets = [],
  currentUser,
  onUploadMedia,
  onDeleteMedia,
}) => {
  const canUpload = RbacService.hasPermission(currentUser, 'media.upload');
  // Same rule as the server: media.delete, or the owner with upload rights.
  const canDeleteAsset = (a: MediaAsset) =>
    RbacService.hasPermission(currentUser, 'media.delete') || (canUpload && [a.ownerId, a.uploadedById].includes(currentUser.id));
  const [selectedType, setSelectedType] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [previewAsset, setPreviewAsset] = useState<MediaAsset | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  // Upload modal fields
  const [title, setTitle] = useState('');
  const [mediaType, setMediaType] = useState<MediaType>('IMAGE');
  const [fileUrl, setFileUrl] = useState('');
  const [durationSeconds, setDurationSeconds] = useState(120);
  const [tagsInput, setTagsInput] = useState('');
  const [description, setDescription] = useState('');
  const [uploaded, setUploaded] = useState<UploadedFile | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const handleOpenUpload = () => {
    setTitle('');
    setMediaType('IMAGE');
    setFileUrl('');
    setDurationSeconds(120);
    setTagsInput('');
    setDescription('');
    setUploaded(null);
    setUploadProgress(null);
    setUploadError(null);
    setIsUploadModalOpen(true);
  };

  const handleFileSelected = async (file: File | undefined) => {
    if (!file) return;
    setUploadError(null);
    setUploaded(null);
    setUploadProgress(0);
    try {
      const result = await uploadMediaFile(file, setUploadProgress).promise;
      setUploaded(result);
      setFileUrl(result.url);
      setMediaType(mediaTypeForMime(result.mimeType));
      if (!title.trim()) setTitle(file.name.replace(/\.[^.]+$/, ''));
    } catch (err: any) {
      setUploadError(err?.message || 'فشل رفع الملف');
    } finally {
      setUploadProgress(null);
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

  const handleSaveUpload = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    const tags = tagsInput
      .split(/[,،]+/)
      .map((t) => t.trim())
      .filter(Boolean);

    if (!fileUrl.trim()) {
      setUploadError('اختر ملفاً للرفع أو أدخل رابطاً خارجياً');
      return;
    }

    onUploadMedia({
      title: title.trim(),
      mediaType,
      fileUrl: fileUrl.trim(),
      url: fileUrl.trim(),
      fileName: uploaded?.originalName || fileUrl.trim().split('/').pop()?.split('?')[0] || title.trim(),
      originalName: uploaded?.originalName,
      mimeType: uploaded?.mimeType,
      fileSize: uploaded?.sizeBytes,
      fileSizeBytes: uploaded?.sizeBytes,
      durationSeconds: mediaType === 'VIDEO' || mediaType === 'AUDIO' ? Number(durationSeconds) : undefined,
      uploadedById: currentUser.id,
      uploadedByName: currentUser.fullName,
      description: description.trim(),
      tags: tags.length > 0 ? tags : ['عام'],
    });

    setIsUploadModalOpen(false);
  };

  const handleCopyUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const filteredAssets = (mediaAssets || []).filter((a) => {
    if (selectedType !== 'ALL' && a.mediaType !== selectedType) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchTitle = a.title?.toLowerCase().includes(q);
      const matchName = a.fileName?.toLowerCase().includes(q);
      const matchDesc = a.description?.toLowerCase().includes(q);
      const matchTags = (a.tags || []).some((t) => t.toLowerCase().includes(q));
      return matchTitle || matchName || matchDesc || matchTags;
    }
    return true;
  });

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
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
            <HardDrive className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-800 tracking-tight">
              مكتبة وأرشيف الوسائط (MAM System)
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              إدارة أصول الصور، لقطات الفيديو للبث، التسجيلات الصوتية، والمواد الوثائقية مع نظام وسوم متقدم
            </p>
          </div>
        </div>

        {canUpload && (
        <button
          type="button"
          onClick={handleOpenUpload}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs self-start sm:self-auto"
        >
          <UploadCloud className="w-4 h-4" />
          رفع مادة وسائط جديدة
        </button>
        )}
      </div>

      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            id="media-search-input"
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="بحث بالعنوان، اسم الملف، أو الوسوم..."
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

        <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0 text-xs">
          {[
            { key: 'ALL', label: 'الكل' },
            { key: 'IMAGE', label: 'الصور' },
            { key: 'VIDEO', label: 'الفيديو' },
            { key: 'AUDIO', label: 'الصوتيات' },
            { key: 'DOCUMENT', label: 'الوثائق' },
          ].map(({ key, label }) => {
            const count =
              key === 'ALL'
                ? mediaAssets.length
                : mediaAssets.filter((a) => a.mediaType === key).length;

            return (
              <button
                key={key}
                type="button"
                onClick={() => setSelectedType(key)}
                className={`px-3 py-1.5 rounded-xl font-bold transition-all whitespace-nowrap flex items-center gap-1.5 ${
                  selectedType === key
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                <span>{label}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-md ${
                    selectedType === key ? 'bg-white/25 text-white' : 'bg-slate-200 text-slate-700'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Assets Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
        {filteredAssets.map((asset) => (
          <div
            key={asset.id}
            className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden flex flex-col justify-between hover:shadow-md transition-all group"
          >
            {/* Visual Thumbnail */}
            <div className="theme-fixed relative h-44 bg-slate-900 flex items-center justify-center overflow-hidden">
              {asset.mediaType === 'IMAGE' ? (
                <img
                  src={asset.fileUrl || asset.url}
                  alt={asset.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
              ) : asset.mediaType === 'VIDEO' ? (
                <div className="w-full h-full relative flex items-center justify-center bg-slate-950">
                  <img
                    src={asset.fileUrl || asset.url || '/icon.svg'}
                    alt=""
                    className="w-full h-full object-cover opacity-60"
                  />
                  <div className="absolute w-11 h-11 rounded-full bg-blue-600/90 text-white flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                    <Video className="w-5 h-5" />
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 text-slate-400 p-4 text-center">
                  <div className="p-3 bg-slate-800 rounded-2xl text-blue-400">
                    {getMediaIcon(asset.mediaType)}
                  </div>
                  <span className="text-xs font-mono font-bold text-slate-300">
                    {asset.mediaType}
                  </span>
                </div>
              )}

              <div className="absolute top-2 right-2">
                <Badge variant="default" size="sm">
                  {asset.mediaType === 'IMAGE'
                    ? 'صورة'
                    : asset.mediaType === 'VIDEO'
                    ? 'فيديو'
                    : asset.mediaType === 'AUDIO'
                    ? 'صوت'
                    : 'وثيقة'}
                </Badge>
              </div>

              {asset.durationSeconds && (
                <div className="absolute bottom-2 left-2 bg-slate-950/80 text-white text-[10px] font-mono px-2 py-0.5 rounded-md flex items-center gap-1 backdrop-blur-xs">
                  <Clock className="w-3 h-3 text-slate-400" />
                  {Math.floor(asset.durationSeconds / 60)}:
                  {(asset.durationSeconds % 60).toString().padStart(2, '0')}
                </div>
              )}
            </div>

            {/* Content info */}
            <div className="p-4 space-y-2 flex-1 flex flex-col justify-between">
              <div>
                <h4
                  onClick={() => setPreviewAsset(asset)}
                  className="text-xs font-bold text-slate-800 line-clamp-2 leading-snug cursor-pointer hover:text-blue-600 transition-colors"
                >
                  {asset.title || asset.fileName}
                </h4>
                {asset.tags && asset.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {asset.tags.map((tg) => (
                      <span
                        key={tg}
                        className="text-[10px] font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md"
                      >
                        #{tg}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                <span className="text-[11px] truncate max-w-[120px]" title={asset.uploadedByName}>
                  {asset.uploadedByName || 'النظام'}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setPreviewAsset(asset)}
                    className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                    title="معاينة المادة"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                  {canDeleteAsset(asset) && (
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`حذف المادة «${asset.title || asset.fileName}» نهائياً مع ملفها؟`)) onDeleteMedia(asset.id);
                    }}
                    className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg transition-colors"
                    title="حذف من الأرشيف"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}

        {filteredAssets.length === 0 && (
          <div className="col-span-full py-16 flex flex-col items-center justify-center text-slate-400 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
            <HardDrive className="w-12 h-12 mb-3 text-slate-300" />
            <p className="font-semibold text-sm">لا توجد وسائط مطابقة لمعايير البحث</p>
            <p className="text-xs text-slate-400 mt-1">اضغط على زر "رفع مادة وسائط جديدة" لتسجيل ملف جديد بالأرشيف</p>
          </div>
        )}
      </div>

      {/* Upload Modal */}
      <Modal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        title="رفع وتسجيل مادة وسائط جديدة"
        subtitle="أرشفة الصور، التقارير المرئية، والمقاطع الصوتية في بنك الوسائط المركزي"
        maxWidth="lg"
      >
        <form onSubmit={handleSaveUpload} className="space-y-4">
          {/* File upload */}
          <div className="p-3 bg-blue-50/50 rounded-xl border border-blue-100 space-y-2">
            <label htmlFor="media-file-input" className="text-[11px] font-bold text-blue-800 flex items-center gap-1">
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
              <div className="w-full h-2 bg-blue-100 rounded-full overflow-hidden" role="progressbar" aria-valuenow={uploadProgress}>
                <div className="h-full bg-blue-600 transition-all" style={{ width: `${uploadProgress}%` }} />
              </div>
            )}
            {uploaded && (
              <p className="text-[11px] text-emerald-700 font-semibold">
                تم رفع الملف: {uploaded.originalName} ({(uploaded.sizeBytes / (1024 * 1024)).toFixed(2)} MB)
              </p>
            )}
            {uploadError && <p className="text-[11px] text-red-600 font-bold">{uploadError}</p>}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="media-title-input" className="block text-xs font-bold text-slate-700">عنوان المادة أو الملف *</label>
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
                      className="text-[9px] bg-slate-100 hover:bg-blue-50 text-slate-600 px-1.5 py-0.5 rounded"
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
                  className="text-[10px] text-slate-400 hover:text-rose-500"
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
                <span className="text-[11px] text-slate-600">معاينة حية للرابط</span>
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
                  className="text-[10px] text-slate-400 hover:text-rose-500"
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
              <span className="text-[10px] text-slate-400 flex items-center gap-0.5">
                <Tag className="w-3 h-3 text-slate-400" />
                اقتراحات:
              </span>
              {TAG_SUGGESTIONS.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => handleAddTag(tag)}
                  className="text-[9px] bg-slate-100 hover:bg-blue-50 text-slate-600 hover:text-blue-700 px-1.5 py-0.5 rounded transition-colors"
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
                  className="text-[10px] text-slate-400 hover:text-rose-500"
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
              onClick={() => setIsUploadModalOpen(false)}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
            >
              إلغاء
            </button>
            <button
              type="submit"
              className="px-5 py-2 text-xs font-bold bg-blue-600 text-white rounded-xl hover:bg-blue-700 shadow-xs"
            >
              تسجيل في الأرشيف
            </button>
          </div>
        </form>
      </Modal>

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
              <div className="theme-fixed relative rounded-xl overflow-hidden bg-slate-950">
                <img
                  src={previewAsset.fileUrl || previewAsset.url}
                  alt=""
                  className="w-full max-h-80 object-cover opacity-70"
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="p-4 bg-blue-600/90 text-white rounded-full shadow-lg">
                    <Video className="w-8 h-8" />
                  </div>
                </div>
              </div>
            ) : (
              <div className="theme-fixed p-8 bg-slate-900 rounded-xl text-center text-white space-y-2">
                <Music className="w-12 h-12 mx-auto text-purple-400" />
                <p className="text-xs font-mono">{previewAsset.fileName}</p>
              </div>
            )}

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-500">اسم الملف:</span>
                <span className="font-mono text-slate-700">{previewAsset.fileName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">النوع:</span>
                <span className="font-semibold text-slate-800">{previewAsset.mediaType}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">تم الرفع بواسطة:</span>
                <span className="font-semibold text-slate-800">{previewAsset.uploadedByName || 'النظام'}</span>
              </div>
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
                      <span key={t} className="text-[10px] bg-slate-200 px-2 py-0.5 rounded-md text-slate-700">
                        #{t}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => handleCopyUrl(previewAsset.fileUrl || previewAsset.url || '')}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 rounded-xl border border-slate-200 transition-colors"
              >
                {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedLink ? 'تم نسخ الرابط' : 'نسخ رابط الملف'}
              </button>

              <button
                type="button"
                onClick={() => setPreviewAsset(null)}
                className="px-4 py-1.5 text-xs font-bold bg-slate-800 text-white hover:bg-slate-900 rounded-xl"
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
