import React, { useEffect, useMemo, useRef, useState } from 'react';
import { matchesQuery } from '../../shared/search';
import { Check, FileText, Film, Image as ImageIcon, Loader2, Music, RotateCcw, Search, Upload, X } from 'lucide-react';
import { Modal } from '../common/Modal';
import { apiService } from '../../services/api';
import { ACCEPTED_UPLOAD_TYPES, mediaTypeForMime, uploadMediaFile } from '../../services/mediaUpload';
import type { MediaFile } from '../../types';
import { videoStatusName } from '../../shared/production';
import { AR, countLabel } from '../../shared/arabicPlural';

const TYPE_NAMES: Record<string, string> = { IMAGE: 'صورة', VIDEO: 'فيديو', AUDIO: 'صوت', DOCUMENT: 'وثيقة' };

export const mediaIcon = (type?: string) =>
  type === 'VIDEO' ? Film : type === 'AUDIO' ? Music : type === 'IMAGE' ? ImageIcon : FileText;

/** One file in the upload queue: files go up one after another, each with its own progress. */
interface QueuedUpload {
  key: string;
  file: File;
  status: 'waiting' | 'uploading' | 'done' | 'error';
  percent: number;
  error?: string;
}

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
  const [queue, setQueue] = useState<QueuedUpload[]>([]);
  const [version, setVersion] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const running = useRef(false);
  const abortCurrent = useRef<(() => void) | null>(null);
  const queueRef = useRef(queue);
  queueRef.current = queue;

  const items = useMemo(() => {
    const q = query.trim();
    return apiService
      .getMedia()
      .filter((m: any) => !m.deletedAt)
      .filter((m) => type === 'ALL' || m.mediaType === type)
      .filter((m) => !q || matchesQuery(q, m.title, m.fileName, m.tags || []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, type, version, isOpen]);

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const patch = (key: string, change: Partial<QueuedUpload>) =>
    setQueue((list) => list.map((u) => (u.key === key ? { ...u, ...change } : u)));

  const uploadOne = async (item: QueuedUpload) => {
    patch(item.key, { status: 'uploading', percent: 0, error: undefined });
    try {
      const task = uploadMediaFile(item.file, (percent) => patch(item.key, { percent }));
      abortCurrent.current = task.abort;
      const up = await task.promise;
      const mediaType = mediaTypeForMime(up.mimeType);
      const saved = apiService.saveMedia({
        url: up.url,
        fileName: up.originalName,
        originalName: up.originalName,
        mimeType: up.mimeType,
        fileSizeBytes: up.sizeBytes,
        mediaType,
        title: item.file.name.replace(/\.[^.]+$/, ''),
        videoStatus: mediaType === 'VIDEO' ? 'RAW' : undefined,
        tags: [],
      } as Partial<MediaFile>);
      setPicked((p) => (p.includes(saved.id) ? p : [...p, saved.id]));
      setVersion((v) => v + 1);
      patch(item.key, { status: 'done', percent: 100 });
    } catch (err: any) {
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      patch(item.key, { status: 'error', error: offline ? 'لا اتصال — أعد المحاولة عند عودته' : err?.message || 'فشل رفع الملف' });
    } finally {
      abortCurrent.current = null;
    }
  };

  /** Sends waiting files one at a time (kinder to a weak field connection than all at once). */
  const runQueue = async () => {
    if (running.current) return;
    running.current = true;
    try {
      for (;;) {
        const next = queueRef.current.find((u) => u.status === 'waiting');
        if (!next) break;
        // Mark it before the await so the next loop turn does not pick it again.
        queueRef.current = queueRef.current.map((u) => (u.key === next.key ? { ...u, status: 'uploading' as const } : u));
        await uploadOne(next);
      }
    } finally {
      running.current = false;
    }
  };

  const addFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const added: QueuedUpload[] = [...files].map((file, i) => ({ key: `${Date.now()}-${i}-${file.name}`, file, status: 'waiting', percent: 0 }));
    setQueue((list) => [...list, ...added]);
  };

  // Start (or continue) whenever new files are waiting.
  useEffect(() => {
    if (queue.some((u) => u.status === 'waiting')) void runQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue]);

  const retryUpload = (key: string) => patch(key, { status: 'waiting', percent: 0, error: undefined });
  const removeUpload = (item: QueuedUpload) => {
    if (item.status === 'uploading') abortCurrent.current?.();
    setQueue((list) => list.filter((u) => u.key !== item.key));
  };

  const uploading = queue.some((u) => u.status === 'uploading' || u.status === 'waiting');
  const doneCount = queue.filter((u) => u.status === 'done').length;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="إرفاق من مكتبة الوسائط" subtitle="اختر مادة أو أكثر، أو ارفع ملفات جديدة" maxWidth="4xl">
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
                multiple
                accept={ACCEPTED_UPLOAD_TYPES.join(',')}
                className="hidden"
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="min-h-11 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold"
              >
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {uploading ? 'إضافة ملفات أخرى' : 'رفع ملفات جديدة'}
              </button>
            </>
          )}
        </div>
        {queue.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span role="status" className="font-bold text-slate-700">
                {uploading ? `رُفع ${doneCount} من ${queue.length}` : `اكتمل رفع ${doneCount} من ${queue.length}`}
              </span>
              {!uploading && (
                <button type="button" onClick={() => setQueue([])} className="min-h-9 px-2 rounded-lg text-slate-600 hover:bg-slate-100">
                  إخفاء القائمة
                </button>
              )}
            </div>
            <ul aria-label="الملفات المرفوعة" className="max-h-40 overflow-y-auto space-y-1.5 overscroll-contain">
              {queue.map((u) => (
                <li
                  key={u.key}
                  className={`flex items-center gap-2 px-2.5 py-1.5 rounded-xl border text-xs ${u.status === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-slate-200 bg-slate-50 text-slate-700'}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold" dir="auto">{u.file.name}</span>
                    {u.status === 'uploading' && (
                      <span className="mt-1 block h-1.5 rounded-full bg-slate-200 overflow-hidden" aria-hidden="true">
                        <span className="block h-full bg-blue-600 transition-[width]" style={{ width: `${u.percent}%` }} />
                      </span>
                    )}
                    {u.status === 'error' && <span className="block">{u.error}</span>}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {u.status === 'waiting' ? 'في الانتظار' : u.status === 'uploading' ? `${u.percent}%` : u.status === 'done' ? 'تم' : ''}
                  </span>
                  {u.status === 'error' && (
                    <button type="button" onClick={() => retryUpload(u.key)} aria-label={`إعادة رفع ${u.file.name}`} className="min-h-9 min-w-9 inline-flex items-center justify-center rounded-lg hover:bg-white">
                      <RotateCcw className="w-4 h-4" />
                    </button>
                  )}
                  {u.status !== 'done' && (
                    <button type="button" onClick={() => removeUpload(u)} aria-label={u.status === 'uploading' ? `إلغاء رفع ${u.file.name}` : `إزالة ${u.file.name}`} className="min-h-9 min-w-9 inline-flex items-center justify-center rounded-lg hover:bg-white">
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

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
                  <span className="block text-xs font-bold text-slate-800 truncate" dir="auto">{m.title || m.fileName}</span>
                  <span className="block text-2xs text-slate-500">
                    {m.mediaType === 'VIDEO' ? videoStatusName(m.videoStatus) : TYPE_NAMES[m.mediaType] || m.mediaType}
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
          <span className="text-xs text-slate-500" role="status">{picked.length ? `المحدد: ${countLabel(picked.length, AR.item)}` : 'لم تُحدَّد مادة بعد'}</span>
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
              title={uploading ? 'يُرفق ما اكتمل رفعه فقط؛ أعد الاختيار بعد اكتمال البقية' : undefined}
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
