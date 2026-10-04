import React, { useMemo, useRef, useState } from 'react';
import { Check, FileText, Film, Image as ImageIcon, Loader2, Music, Search, Upload } from 'lucide-react';
import { Modal } from '../common/Modal';
import { apiService } from '../../services/api';
import { ACCEPTED_UPLOAD_TYPES, mediaTypeForMime, uploadMediaFile } from '../../services/mediaUpload';
import type { MediaFile } from '../../types';
import { videoStatusName } from '../../shared/production';

export const mediaIcon = (type?: string) =>
  type === 'VIDEO' ? Film : type === 'AUDIO' ? Music : type === 'IMAGE' ? ImageIcon : FileText;

interface MediaPickerProps {
  isOpen: boolean;
  onClose: () => void;
  /** Already attached items (shown as selected). */
  selectedIds: string[];
  onPick: (ids: string[]) => void;
  canUpload: boolean;
}

/** Chooses items from the media library, or uploads a new file straight into it. */
export const MediaPicker: React.FC<MediaPickerProps> = ({ isOpen, onClose, selectedIds, onPick, canUpload }) => {
  const [query, setQuery] = useState('');
  const [type, setType] = useState('ALL');
  const [picked, setPicked] = useState<string[]>(selectedIds);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return apiService
      .getMedia()
      .filter((m: any) => !m.deletedAt)
      .filter((m) => type === 'ALL' || m.mediaType === type)
      .filter((m) => !q || `${m.title || ''} ${m.fileName || ''} ${(m.tags || []).join(' ')}`.toLowerCase().includes(q));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, type, version, isOpen]);

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const upload = async (file: File) => {
    setError(null);
    setProgress(0);
    try {
      const up = await uploadMediaFile(file, setProgress).promise;
      const mediaType = mediaTypeForMime(up.mimeType);
      const saved = apiService.saveMedia({
        url: up.url,
        fileName: up.originalName,
        originalName: up.originalName,
        mimeType: up.mimeType,
        fileSizeBytes: up.sizeBytes,
        mediaType,
        title: file.name.replace(/\.[^.]+$/, ''),
        videoStatus: mediaType === 'VIDEO' ? 'RAW' : undefined,
        tags: [],
      } as Partial<MediaFile>);
      setPicked((p) => [...p, saved.id]);
      setVersion((v) => v + 1);
    } catch (err: any) {
      setError(err?.message || 'فشل رفع الملف');
    } finally {
      setProgress(null);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="إرفاق من مكتبة الوسائط" subtitle="اختر مادة أو أكثر، أو ارفع ملفاً جديداً" maxWidth="4xl">
      <div className="space-y-3 text-right">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-500 absolute right-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ابحث بالعنوان أو اسم الملف أو الوسم..."
              aria-label="بحث في مكتبة الوسائط"
              className="w-full pr-9 pl-3 py-2 border border-slate-300 rounded-xl text-xs"
            />
          </div>
          <select value={type} onChange={(e) => setType(e.target.value)} aria-label="نوع المادة" className="px-3 py-2 border border-slate-300 rounded-xl text-xs bg-white">
            <option value="ALL">كل الأنواع</option>
            <option value="VIDEO">فيديو</option>
            <option value="IMAGE">صور</option>
            <option value="AUDIO">صوت</option>
            <option value="DOCUMENT">مستندات</option>
          </select>
          {canUpload && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept={ACCEPTED_UPLOAD_TYPES.join(',')}
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void upload(f);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                disabled={progress !== null}
                onClick={() => fileRef.current?.click()}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold disabled:opacity-60"
              >
                {progress !== null ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {progress !== null ? `جارٍ الرفع ${progress}%` : 'رفع ملف جديد'}
              </button>
            </>
          )}
        </div>
        {error && <p className="p-2 rounded-lg bg-rose-50 text-rose-700 text-xs font-bold">{error}</p>}

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 max-h-[55vh] overflow-y-auto">
          {items.length === 0 && <p className="col-span-full text-center text-xs text-slate-500 py-8">لا توجد مواد مطابقة.</p>}
          {items.map((m) => {
            const Icon = mediaIcon(m.mediaType);
            const on = picked.includes(m.id);
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => toggle(m.id)}
                aria-pressed={on}
                className={`relative text-right rounded-xl border overflow-hidden transition-all ${on ? 'border-blue-500 ring-2 ring-blue-400/50' : 'border-slate-200 hover:border-slate-300'}`}
              >
                <div className="theme-fixed h-24 bg-slate-900 flex items-center justify-center overflow-hidden">
                  {m.mediaType === 'IMAGE' && (m.url || m.fileUrl) ? (
                    <img src={m.url || m.fileUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <Icon className="w-8 h-8 text-slate-500" />
                  )}
                </div>
                <div className="p-2 space-y-0.5">
                  <span className="block text-xs font-bold text-slate-800 truncate">{m.title || m.fileName}</span>
                  <span className="block text-[10px] text-slate-500">
                    {m.mediaType === 'VIDEO' ? videoStatusName(m.videoStatus) : m.mediaType}
                  </span>
                </div>
                {on && (
                  <span className="absolute top-1.5 left-1.5 w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center">
                    <Check className="w-4 h-4" />
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="text-xs text-slate-500">{picked.length} مادة محددة</span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-xs text-slate-600 hover:bg-slate-100 rounded-xl">
              إلغاء
            </button>
            <button
              type="button"
              onClick={() => {
                onPick(picked);
                onClose();
              }}
              className="px-4 py-2 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl"
            >
              اعتماد المرفقات
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
};
