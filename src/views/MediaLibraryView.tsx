import React, { useState } from 'react';
import {
  UploadCloud,
  Image as ImageIcon,
  Video,
  Music,
  FileText,
  Search,
  Tag,
  Download,
  Trash2,
  Eye,
  Plus,
  Filter,
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

export const MediaLibraryView: React.FC<MediaLibraryViewProps> = ({
  mediaAssets = [],
  currentUser,
  onUploadMedia,
  onDeleteMedia,
}) => {
  const [selectedType, setSelectedType] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [previewAsset, setPreviewAsset] = useState<MediaAsset | null>(null);

  // Upload modal fields
  const [title, setTitle] = useState('');
  const [mediaType, setMediaType] = useState<MediaType>('IMAGE');
  const [fileUrl, setFileUrl] = useState('');
  const [durationSeconds, setDurationSeconds] = useState(120);
  const [tagsInput, setTagsInput] = useState('');

  const handleOpenUpload = () => {
    setTitle('');
    setMediaType('IMAGE');
    setFileUrl('https://images.unsplash.com/photo-1585829365295-ab7cd400c167?auto=format&fit=crop&w=1200&q=80');
    setDurationSeconds(120);
    setTagsInput('أخبار, تغطية');
    setIsUploadModalOpen(true);
  };

  const handleSaveUpload = (e: React.FormEvent) => {
    e.preventDefault();
    const tags = tagsInput.split(/[,،]/).map((t) => t.trim()).filter(Boolean);

    onUploadMedia({
      title: title || 'ملف وسائط جديد',
      mediaType,
      fileUrl,
      fileName: `${title || 'asset'}.${mediaType === 'VIDEO' ? 'mp4' : mediaType === 'AUDIO' ? 'mp3' : 'jpg'}`,
      fileSize: 4500000,
      durationSeconds: mediaType === 'VIDEO' || mediaType === 'AUDIO' ? Number(durationSeconds) : undefined,
      uploadedById: currentUser.id,
      uploadedByName: currentUser.fullName,
      tags,
    });

    setIsUploadModalOpen(false);
  };

  const filteredAssets = (mediaAssets || []).filter((a) => {
    if (selectedType !== 'ALL' && a.mediaType !== selectedType) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        a.title.toLowerCase().includes(q) ||
        (a.tags || []).some((t) => t.toLowerCase().includes(q))
      );
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
        return <FileText className="w-5 h-5 text-amber-500" />;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-800 tracking-tight">
            مكتبة وأرشيف الوسائط (MAM System)
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            إدارة الصور، مقاطع الفيديو للبث، التسجيلات الصوتية، والمواد الوثائقية
          </p>
        </div>

        <button
          type="button"
          onClick={handleOpenUpload}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs self-start sm:self-auto"
        >
          <UploadCloud className="w-4 h-4" />
          رفع مادة وسائط جديدة
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
            placeholder="بحث بالعنوان أو الوسوم..."
            className="w-full pr-9 pl-4 py-2 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0 text-xs">
          {['ALL', 'IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT'].map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setSelectedType(t)}
              className={`px-3 py-1.5 rounded-lg font-bold transition-colors whitespace-nowrap ${
                selectedType === t
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {t === 'ALL'
                ? 'الكل'
                : t === 'IMAGE'
                ? 'الصور'
                : t === 'VIDEO'
                ? 'الفيديو'
                : t === 'AUDIO'
                ? 'الصوتيات'
                : 'الوثائق'}
            </button>
          ))}
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
            <div className="relative h-40 bg-slate-900 flex items-center justify-center overflow-hidden">
              {asset.mediaType === 'IMAGE' ? (
                <img
                  src={asset.fileUrl}
                  alt={asset.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                />
              ) : asset.mediaType === 'VIDEO' ? (
                <div className="w-full h-full relative flex items-center justify-center bg-slate-950">
                  <img
                    src="https://images.unsplash.com/photo-1585829365295-ab7cd400c167?auto=format&fit=crop&w=400&q=80"
                    alt=""
                    className="w-full h-full object-cover opacity-60"
                  />
                  <div className="absolute w-10 h-10 rounded-full bg-blue-600/90 text-white flex items-center justify-center">
                    <Video className="w-5 h-5" />
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 text-slate-400">
                  {getMediaIcon(asset.mediaType)}
                  <span className="text-xs font-mono">{asset.mediaType}</span>
                </div>
              )}

              <div className="absolute top-2 right-2">
                <Badge variant="default" size="sm">
                  {asset.mediaType}
                </Badge>
              </div>

              {asset.durationSeconds && (
                <div className="absolute bottom-2 left-2 bg-slate-950/80 text-white text-[10px] font-mono px-1.5 py-0.5 rounded">
                  {Math.floor(asset.durationSeconds / 60)}:{(asset.durationSeconds % 60).toString().padStart(2, '0')}
                </div>
              )}
            </div>

            {/* Content info */}
            <div className="p-4 space-y-2 flex-1 flex flex-col justify-between">
              <div>
                <h4 className="text-xs font-bold text-slate-800 line-clamp-2 leading-snug">
                  {asset.title}
                </h4>
                <div className="flex flex-wrap gap-1 mt-2">
                  {asset.tags.map((tg) => (
                    <span
                      key={tg}
                      className="text-[10px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded"
                    >
                      #{tg}
                    </span>
                  ))}
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                <span className="text-[11px]">{asset.uploadedByName}</span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setPreviewAsset(asset)}
                    className="p-1.5 text-blue-600 hover:bg-blue-50 rounded"
                    title="معاينة المادة"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteMedia(asset.id)}
                    className="p-1.5 text-red-500 hover:bg-red-50 rounded"
                    title="حذف من الأرشيف"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Upload Modal */}
      <Modal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        title="رفع وتسجيل مادة وسائط جديدة"
        maxWidth="md"
      >
        <form onSubmit={handleSaveUpload} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">عنوان المادة أو الملف *</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="مثال: لقطات من المؤتمر الصحفي الاقتصادي"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">نوع الوسيط</label>
              <select
                value={mediaType}
                onChange={(e) => setMediaType(e.target.value as MediaType)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white focus:ring-2 focus:ring-blue-500"
              >
                <option value="IMAGE">صورة فوتوغرافية (JPG/PNG)</option>
                <option value="VIDEO">مقطع فيديو للبث (MP4)</option>
                <option value="AUDIO">ملف صوتي (MP3/WAV)</option>
                <option value="DOCUMENT">وثيقة صحفية (PDF/DOC)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">المدة بالثواني (للفيديو والصوت)</label>
              <input
                type="number"
                value={durationSeconds}
                onChange={(e) => setDurationSeconds(Number(e.target.value))}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono text-center focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">رابط الملف المباشر (URL أو مسار السيرفر) *</label>
            <input
              type="url"
              required
              value={fileUrl}
              onChange={(e) => setFileUrl(e.target.value)}
              placeholder="https://..."
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs text-left focus:ring-2 focus:ring-blue-500"
              dir="ltr"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">الوسوم والكلمات الدلالية (مفصولة بفواصل)</label>
            <input
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="أخبار, اقتصاد, مباشر"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setIsUploadModalOpen(false)}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
            >
              إلغاء
            </button>
            <button
              type="submit"
              className="px-5 py-2 text-xs font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-xs"
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
          title={`معاينة: ${previewAsset.title}`}
          maxWidth="lg"
        >
          <div className="space-y-4">
            {previewAsset.mediaType === 'IMAGE' ? (
              <img
                src={previewAsset.fileUrl}
                alt={previewAsset.title}
                className="w-full max-h-96 object-contain rounded-xl bg-slate-950"
              />
            ) : (
              <div className="p-8 bg-slate-900 rounded-xl text-center text-white space-y-2">
                <Video className="w-12 h-12 mx-auto text-blue-400" />
                <p className="text-xs font-mono">{previewAsset.fileUrl}</p>
              </div>
            )}

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-1.5">
              <div className="flex justify-between">
                <span className="text-slate-500">اسم الملف:</span>
                <span className="font-mono text-slate-700">{previewAsset.fileName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">تم الرفع بواسطة:</span>
                <span className="font-semibold text-slate-800">{previewAsset.uploadedByName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">الحجم:</span>
                <span className="font-mono text-slate-700">{(previewAsset.fileSize / (1024 * 1024)).toFixed(2)} MB</span>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
