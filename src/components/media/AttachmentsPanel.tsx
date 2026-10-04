import React, { useState } from 'react';
import { Paperclip, Scissors, X } from 'lucide-react';
import { apiService } from '../../services/api';
import { RbacService } from '../../services/rbacService';
import { VIDEO_STATUSES, videoStatusName, isVideoReady } from '../../shared/production';
import type { MediaFile, User } from '../../types';
import { MediaPicker, mediaIcon } from './MediaPicker';

interface AttachmentsPanelProps {
  mediaIds: string[];
  onChange: (ids: string[]) => void;
  currentUser: User;
  readOnly?: boolean;
  /** Called when the user asks the montage desk to work on a video. */
  onRequestMontage?: (media: MediaFile) => void;
  title?: string;
}

/** Library items attached to a story or a segment, with the video workflow state. */
export const AttachmentsPanel: React.FC<AttachmentsPanelProps> = ({ mediaIds, onChange, currentUser, readOnly, onRequestMontage, title = 'المرفقات من مكتبة الوسائط' }) => {
  const [open, setOpen] = useState(false);
  const [, setTick] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const canUpload = RbacService.hasPermission(currentUser, 'media.upload');
  const library = apiService.getMedia();
  const attached = mediaIds.map((id) => library.find((m) => m.id === id)).filter(Boolean) as MediaFile[];
  const missing = mediaIds.length - attached.length;

  const setStatus = (m: MediaFile, videoStatus: string) => {
    try {
      apiService.updateMedia(m.id, {
        videoStatus: videoStatus as MediaFile['videoStatus'],
        ...(videoStatus === 'EDITING' && !m.editorId ? { editorId: currentUser.id, editorName: currentUser.fullName } : {}),
      });
      setTick((t) => t + 1);
    } catch (err: any) {
      setError(err?.message || 'تعذر تحديث حالة الفيديو');
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
          <Paperclip className="w-3.5 h-3.5 text-slate-500" />
          {title} ({attached.length})
        </span>
        {!readOnly && (
          <button type="button" onClick={() => setOpen(true)} className="text-xs font-bold text-blue-700 hover:underline">
            + إرفاق
          </button>
        )}
      </div>
      {error && <p className="text-[11px] text-rose-600 font-bold">{error}</p>}
      {attached.length === 0 && <p className="text-[11px] text-slate-500">لا توجد مرفقات.</p>}
      <ul className="space-y-1.5">
        {attached.map((m) => {
          const Icon = mediaIcon(m.mediaType);
          const isVideo = m.mediaType === 'VIDEO';
          return (
            <li key={m.id} className="flex items-center gap-2 p-2 rounded-xl border border-slate-200 bg-slate-50/60">
              <Icon className="w-4 h-4 text-slate-500 shrink-0" />
              <div className="min-w-0 flex-1">
                <a href={m.url || m.fileUrl} target="_blank" rel="noopener noreferrer" className="block text-xs font-bold text-slate-800 truncate hover:underline">
                  {m.title || m.fileName}
                </a>
                {isVideo && (
                  <span className={`text-[10px] font-bold ${isVideoReady(m.videoStatus) ? 'text-emerald-700' : 'text-amber-700'}`}>
                    {videoStatusName(m.videoStatus)}
                    {m.editorName ? ` · ${m.editorName}` : ''}
                  </span>
                )}
              </div>
              {isVideo && canUpload && !readOnly && (
                <select
                  value={m.videoStatus || 'RAW'}
                  onChange={(e) => setStatus(m, e.target.value)}
                  aria-label={`حالة الفيديو ${m.title || m.fileName}`}
                  className="text-[11px] px-1.5 py-1 border border-slate-300 rounded-lg bg-white"
                >
                  {VIDEO_STATUSES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              )}
              {isVideo && onRequestMontage && !readOnly && !isVideoReady(m.videoStatus) && (
                <button type="button" onClick={() => onRequestMontage(m)} title="طلب مونتاج لهذا الفيديو" className="p-1.5 rounded-lg text-violet-700 hover:bg-violet-50">
                  <Scissors className="w-3.5 h-3.5" />
                </button>
              )}
              {!readOnly && (
                <button type="button" onClick={() => onChange(mediaIds.filter((id) => id !== m.id))} aria-label={`إزالة ${m.title || m.fileName}`} className="p-1 text-slate-500 hover:text-rose-600">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {missing > 0 && <p className="text-[11px] text-amber-700">{missing} مرفق لم يعد موجوداً في المكتبة.</p>}
      {open && <MediaPicker isOpen={open} onClose={() => setOpen(false)} selectedIds={mediaIds} onPick={onChange} canUpload={canUpload} />}
    </div>
  );
};
