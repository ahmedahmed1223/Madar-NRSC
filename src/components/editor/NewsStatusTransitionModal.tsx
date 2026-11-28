import React from 'react';
import type { NewsStatus } from '../../types';
import { toLocalInputValue } from '../../shared/dates';
import { Modal } from '../common/Modal';

export interface StatusDialogCopy {
  title: string;
  explain: string;
  label: string;
  placeholder: string;
  confirm: string;
  reasons: string[];
}

export interface NewsStatusTransitionModalProps {
  isOpen: boolean;
  onClose: () => void;
  statusSubmitting: boolean;
  dialogCopy: StatusDialogCopy;
  isDirty: boolean;
  canEditContent: boolean;
  pendingStatus: NewsStatus | null;
  scheduleAt: string;
  onScheduleAtChange: (value: string) => void;
  statusComment: string;
  onStatusCommentChange: React.Dispatch<React.SetStateAction<string>>;
  needsComment: boolean;
  scheduleInvalid: boolean;
  onConfirmStatus: () => void | Promise<void>;
}

export const NewsStatusTransitionModal: React.FC<NewsStatusTransitionModalProps> = ({
  isOpen,
  onClose,
  statusSubmitting,
  dialogCopy,
  isDirty,
  canEditContent,
  pendingStatus,
  scheduleAt,
  onScheduleAtChange,
  statusComment,
  onStatusCommentChange,
  needsComment,
  scheduleInvalid,
  onConfirmStatus,
}) => {
  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        if (!statusSubmitting) onClose();
      }}
      title={dialogCopy.title}
      maxWidth="md"
    >
      <div className="space-y-4 text-right" aria-busy={statusSubmitting}>
        <p className="text-xs text-slate-600 leading-relaxed">
          {dialogCopy.explain}
          {isDirty && canEditContent && <span className="block mt-1 text-amber-700 font-semibold">سيتم حفظ تعديلاتك غير المحفوظة أولاً.</span>}
        </p>
        {pendingStatus === 'SCHEDULED' && (
          <div>
            <label htmlFor="schedule-at-input" className="block text-xs font-bold text-slate-700 mb-1">موعد النشر (بتوقيت جهازك)</label>
            <input
              id="schedule-at-input"
              type="datetime-local"
              value={scheduleAt}
              min={toLocalInputValue()}
              onChange={(e) => onScheduleAtChange(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs font-mono"
              dir="ltr"
            />
            <p className="text-2xs text-slate-500 mt-1">ينشر الخادم الخبر تلقائياً في هذا الموعد حتى لو لم يكن أحد متصلاً.</p>
          </div>
        )}
        <label htmlFor="status-transition-comment" className="block text-sm font-semibold text-slate-700">
          {dialogCopy.label}
        </label>
        {dialogCopy.reasons.length > 0 && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="أسباب جاهزة">
            {dialogCopy.reasons.map((reason) => (
              <button
                key={reason}
                type="button"
                disabled={statusSubmitting}
                onClick={() => onStatusCommentChange((prev) => (prev.includes(reason) ? prev : prev.trim() ? `${prev.trim()}، ${reason}` : reason))}
                className="min-h-8 px-2.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs text-slate-700"
              >
                {reason}
              </button>
            ))}
          </div>
        )}
        <textarea
          id="status-transition-comment"
          rows={3}
          value={statusComment}
          disabled={statusSubmitting}
          onChange={(e) => onStatusCommentChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.repeat && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void onConfirmStatus();
            }
          }}
          aria-keyshortcuts="Control+Enter Meta+Enter"
          placeholder={dialogCopy.placeholder}
          className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
        />
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={statusSubmitting}
            className="min-h-11 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-lg disabled:opacity-50"
          >
            إلغاء
          </button>
          <button
            type="button"
            onClick={onConfirmStatus}
            disabled={statusSubmitting || (needsComment && !statusComment.trim()) || scheduleInvalid}
            className={`min-h-11 px-4 py-2 text-sm font-semibold text-white rounded-lg shadow-xs disabled:opacity-50 ${pendingStatus === 'REJECTED' ? 'bg-red-700 hover:bg-red-800' : 'bg-blue-600 hover:bg-blue-700'}`}
          >
            {statusSubmitting ? 'جارٍ تأكيد التحديث...' : dialogCopy.confirm}
          </button>
        </div>
      </div>
    </Modal>
  );
};
