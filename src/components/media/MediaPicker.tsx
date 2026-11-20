import React, { useEffect, useMemo, useRef, useState } from 'react';
import { matchesQuery } from '../../shared/search';
import { Check, FileText, Film, Image as ImageIcon, Loader2, Music, RotateCcw, Search, Upload, X } from 'lucide-react';
import { Modal } from '../common/Modal';
import { apiService } from '../../services/api';
import { ACCEPTED_UPLOAD_TYPES, mediaTypeForMime, uploadMediaFile, type UploadedFile } from '../../services/mediaUpload';
import { dataStore } from '../../services/dataStore';
import type { MediaFile } from '../../types';
import { videoStatusName } from '../../shared/production';
import { AR, countLabel } from '../../shared/arabicPlural';
import { newId } from '../../shared/ids';

const TYPE_NAMES: Record<string, string> = { IMAGE: 'صورة', VIDEO: 'فيديو', AUDIO: 'صوت', DOCUMENT: 'وثيقة' };

export const mediaIcon = (type?: string) =>
  type === 'VIDEO' ? Film : type === 'AUDIO' ? Music : type === 'IMAGE' ? ImageIcon : FileText;

/** One file in the upload queue: files go up one after another, each with its own progress. */
interface QueuedUpload {
  key: string;
  file: File;
  status: 'waiting' | 'uploading' | 'confirming' | 'done' | 'error';
  percent: number | null;
  uploaded?: UploadedFile;
  mediaId?: string;
  error?: string;
}

interface MediaPickerProps {
  isOpen: boolean;
  onClose: () => void;
  /** Already attached items (shown as selected). */
  selectedIds: string[];
  onPick: (ids: string[]) => void;
  canUpload: boolean;
  initialFiles?: File[];
  resultMode?: 'video' | 'any';
}

function queueFiles(files: File[]): QueuedUpload[] {
  return files.map(file => ({ key: newId('upload'), file, status: 'waiting', percent: null }));
}

/** Chooses items from the media library, or uploads a new file straight into it. */
export const MediaPicker: React.FC<MediaPickerProps> = ({ isOpen, ...props }) => {
  if (!isOpen) return null;
  return <OpenMediaPicker {...props} />;
};

const OpenMediaPicker: React.FC<Omit<MediaPickerProps, 'isOpen'>> = ({ onClose, selectedIds, onPick, canUpload, initialFiles = [], resultMode }) => {
  const [query, setQuery] = useState('');
  const [type, setType] = useState(resultMode === 'video' ? 'VIDEO' : 'ALL');
  const [picked, setPicked] = useState<string[]>(resultMode ? selectedIds.slice(0, 1) : selectedIds);
  const [queue, setQueue] = useState(() => queueFiles(initialFiles));
  const [version, setVersion] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const running = useRef(false);
  const run = useRef(0);
  const abortCurrent = useRef<{ key: string; abort: () => void } | null>(null);
  const queueRef = useRef(queue);

  const items = useMemo(() => {
    const q = query.trim();
    return apiService
      .getMedia()
      .filter((m: any) => !m.deletedAt)
      .filter((m) => type === 'ALL' || m.mediaType === type)
      .filter((m) => !q || matchesQuery(q, m.title, m.fileName, m.tags || []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, type, version]);

  const toggle = (id: string) => setPicked(p => p.includes(id) ? p.filter(x => x !== id) : resultMode ? [id] : [...p, id]);

  const updateQueue = (update: (list: QueuedUpload[]) => QueuedUpload[]) => {
    queueRef.current = update(queueRef.current);
    setQueue(queueRef.current);
  };
  const patch = (key: string, change: Partial<QueuedUpload>) =>
    updateQueue(list => list.map(u => u.key === key ? { ...u, ...change } : u));

  const uploadOne = async (item: QueuedUpload, token: number) => {
    const current = () => token === run.current && queueRef.current.some(row => row.key === item.key);
    let up = item.uploaded;
    let mediaId = item.mediaId;
    try {
      if (!up) {
        if (resultMode === 'video' && item.file.type && mediaTypeForMime(item.file.type) !== 'VIDEO') throw new Error('اختر ملف فيديو للمونتاج.');
        patch(item.key, { status: 'uploading', percent: null, error: undefined });
        const task = uploadMediaFile(item.file, (percent) => { if (current()) patch(item.key, { percent }); });
        abortCurrent.current = { key: item.key, abort: task.abort };
        up = await task.promise;
        if (!current()) return;
      }
      if (resultMode === 'video' && mediaTypeForMime(up.mimeType) !== 'VIDEO') throw new Error('اختر ملف فيديو للمونتاج.');
      patch(item.key, { status: 'confirming', uploaded: up, error: undefined });
      if (mediaId && !apiService.getMedia().some(row => row.id === mediaId)) mediaId = undefined;
      if (!mediaId) {
        const mediaType = mediaTypeForMime(up.mimeType);
        mediaId = apiService.saveMedia({
          url: up.url,
          fileName: up.originalName,
          originalName: up.originalName,
          mimeType: up.mimeType,
          fileSizeBytes: up.sizeBytes,
          mediaType,
          title: item.file.name.replace(/\.[^.]+$/, ''),
          videoStatus: mediaType === 'VIDEO' ? 'RAW' : undefined,
          tags: [],
        } as Partial<MediaFile>).id;
        patch(item.key, { mediaId });
      }
      const outcome = await dataStore.awaitWrite('media', mediaId);
      if (!current()) return;
      if (!outcome.ok) {
        if (!outcome.pending) patch(item.key, { mediaId: undefined });
        throw new Error(outcome.pending ? 'لم يؤكد الخادم حفظ المرفق بعد' : outcome.message || 'تعذر حفظ المرفق');
      }
      if (!apiService.getMedia().some(row => row.id === mediaId)) throw new Error('تعذر العثور على المرفق المحفوظ');
      const confirmedId = mediaId;
      setPicked(p => resultMode ? [confirmedId] : p.includes(confirmedId) ? p : [...p, confirmedId]);
      setVersion((v) => v + 1);
      patch(item.key, { status: 'done', percent: 100 });
    } catch (err: any) {
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      if (current()) patch(item.key, { status: 'error', error: offline ? 'لا اتصال. أعد المحاولة عند عودته.' : err?.message || 'فشل رفع الملف' });
    } finally {
      abortCurrent.current = null;
    }
  };

  /** Sends waiting files one at a time (kinder to a weak field connection than all at once). */
  const runQueue = async (token: number) => {
    if (running.current || !canUpload) return;
    running.current = true;
    try {
      while (token === run.current) {
        const next = queueRef.current.find((u) => u.status === 'waiting');
        if (!next) break;
        await uploadOne(next, token);
      }
    } finally {
      running.current = false;
    }
  };

  const addFiles = (files: FileList | null) => {
    if (!canUpload || !files?.length) return;
    updateQueue(list => [...list, ...queueFiles([...files])]);
  };

  useEffect(() => {
    return () => {
      run.current++;
      abortCurrent.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!queue.some(u => u.status === 'waiting')) return;
    const token = run.current;
    queueMicrotask(() => { if (token === run.current) void runQueue(token); });
  }, [canUpload, queue]);

  const retryUpload = (key: string) => patch(key, { status: 'waiting', percent: null, error: undefined });
  const removeUpload = (item: QueuedUpload) => {
    updateQueue(list => list.filter(u => u.key !== item.key));
    if (abortCurrent.current?.key === item.key) abortCurrent.current.abort();
  };

  const uploading = queue.some(u => ['uploading', 'waiting', 'confirming'].includes(u.status));
  const failed = queue.some(u => u.status === 'error');
  const doneCount = queue.filter((u) => u.status === 'done').length;

  return (
    <Modal isOpen onClose={onClose} title={resultMode ? 'اختيار مادة التسليم' : 'إرفاق من مكتبة الوسائط'} subtitle={resultMode ? 'اختر مادة واحدة للتسليم' : 'اختر مادة أو أكثر، أو ارفع ملفات جديدة'} maxWidth="4xl">
      <div className="space-y-3 text-right">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-500 absolute right-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) e.preventDefault(); }}
              placeholder="ابحث بالعنوان أو اسم الملف أو الوسم..."
              aria-label="بحث في مكتبة الوسائط"
              className="w-full pr-9 pl-3 py-2 border border-slate-300 rounded-xl text-xs"
            />
          </div>
          {resultMode !== 'video' && <select value={type} onChange={(e) => setType(e.target.value)} aria-label="نوع المادة" className="px-3 py-2 border border-slate-300 rounded-xl text-xs bg-white">
            <option value="ALL">كل الأنواع</option>
            <option value="VIDEO">فيديو</option>
            <option value="IMAGE">صور</option>
            <option value="AUDIO">صوت</option>
            <option value="DOCUMENT">مستندات</option>
          </select>}
          {canUpload && (
            <>
              <input
                ref={fileRef}
                type="file"
                multiple={!resultMode}
                accept={ACCEPTED_UPLOAD_TYPES.filter(mime => resultMode !== 'video' || mediaTypeForMime(mime) === 'VIDEO').join(',')}
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
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span role="status" className="font-bold text-slate-700">
                {`المرفقات المؤكدة: ${doneCount} من ${queue.length}`}
              </span>
            </div>
            <ul aria-label="الملفات المرفوعة" className="max-h-40 overflow-y-auto space-y-1.5 overscroll-contain">
              {queue.map((u) => (
                <li
                  key={u.key}
                  className={`flex items-center gap-2 px-2.5 py-1.5 rounded-xl border text-xs ${u.status === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-slate-200 bg-slate-50 text-slate-700'}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold" dir="auto">{u.file.name}</span>
                    {u.status === 'uploading' && <progress aria-label={`رفع ${u.file.name}`} max={100} value={u.percent ?? undefined} className="mt-1 block h-2 w-full accent-blue-600" />}
                    {u.status === 'error' && <span className="block">{u.error}</span>}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {u.status === 'waiting' ? 'في الانتظار' : u.status === 'uploading' ? (u.percent === null ? 'جارٍ الرفع' : `${u.percent}%`) : u.status === 'confirming' ? 'بانتظار التأكيد' : u.status === 'done' ? 'تم' : ''}
                  </span>
                  {u.status === 'error' && (
                    <button type="button" disabled={!canUpload} onClick={() => retryUpload(u.key)} aria-label={`إعادة المحاولة: ${u.file.name}`} className="min-h-11 px-2 inline-flex items-center justify-center gap-1 rounded-lg hover:bg-white">
                      <RotateCcw className="w-4 h-4" /> إعادة المحاولة
                    </button>
                  )}
                  {u.status !== 'done' && u.status !== 'confirming' && (
                    <button type="button" onClick={() => removeUpload(u)} aria-label={u.status === 'uploading' ? `إلغاء رفع ${u.file.name}` : `إزالة ${u.file.name}`} className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-lg hover:bg-white">
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {(uploading || failed) && <p id="media-picker-queue-help" className="text-xs text-slate-600">{uploading ? 'أبقِ نافذة المرفقات مفتوحة حتى يكتمل الرفع والتأكيد.' : 'أعد المحاولة أو أزل الملفات المتعثرة لاعتماد المرفقات. نص الخبر باقٍ في المحرر.'}</p>}
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
              disabled={uploading || failed || (!!resultMode && !picked.length)}
              aria-describedby={uploading || failed ? 'media-picker-queue-help' : undefined}
              className="min-h-11 px-3 py-2 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl disabled:opacity-50"
            >
              {resultMode ? 'متابعة التسليم' : 'اعتماد المرفقات'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
};
