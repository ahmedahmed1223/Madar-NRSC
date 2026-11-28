import { useRef, useState } from 'react';
import { Bell, Check, ChevronLeft, Clock, Settings2, X } from 'lucide-react';
import { appLocale, zoneOptions } from '../../shared/dateFormat';
import { categoryName, requiresNotificationAcknowledgment } from '../../shared/notifications';
import { groupNoticeTargets, type groupNotifications } from '../../shared/notificationInbox';
import type { AppNotification } from '../../types';
import { parsePath } from '../../services/router';
import { apiService } from '../../services/api';
import { dataStore } from '../../services/dataStore';
import { isRequestClosed } from '../../shared/production';
import { isStepOpen } from '../../shared/productionCards';
import { taskAssigneeId } from '../../shared/assignedWork';
import { isTaskClosed } from '../../shared/taskWorkflow';

interface NotificationDropdownProps {
  inbox: ReturnType<typeof groupNotifications>;
  userId: string;
  storageFailed: boolean;
  onClose: () => void;
  onMarkAllRead: () => void;
  onMarkRead: (id: string) => void;
  onSnooze: (id: string, snoozed: boolean) => void;
  pathFor: (notification: AppNotification) => string | null;
  onNavigate: (path: string) => void;
}

const actionClass = 'inline-flex min-h-11 sm:min-h-9 items-center gap-1 rounded-md px-2 text-xs font-bold text-blue-700 hover:bg-blue-50 focus-visible:outline-2';

function noticeAction(path: string | null, userId: string) {
  if (!path) return null;
  const { view, id } = parsePath(path);
  if (!id) return null;
  if (view === 'tasks') {
    const task = apiService.getTasks().find(item => item.id === id);
    if (task && taskAssigneeId(task) === userId && !isTaskClosed(task.status)) {
      return { owner: task.assigneeName || task.assignedToName, dueAt: task.dueDate };
    }
  } else if (view === 'requests') {
    const request = apiService.getRequests().find(item => item.id === id);
    if (request && (request.assigneeId || request.addressedToId) === userId && !isRequestClosed(request.status)) {
      return { owner: request.assigneeName || request.addressedToName, dueAt: request.dueAt };
    }
  } else if (view === 'cards') {
    const card = apiService.getCard(id);
    const step = card?.steps.find(item => item.assigneeId === userId && isStepOpen(item));
    if (card?.status === 'OPEN' && step) return { owner: step.assigneeName, dueAt: step.dueAt || card.dueAt };
  }
  return null;
}

export function NotificationDropdown({ inbox, userId, storageFailed, onClose, onMarkAllRead, onMarkRead, onSnooze, pathFor, onNavigate }: NotificationDropdownProps) {
  const list = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);
  const visibleNotices = inbox.groups.flatMap(group => group.items);
  const hasUnread = visibleNotices.some(notice => !notice.isRead && notice.userId === userId && !requiresNotificationAcknowledgment(notice));
  const hasUnacknowledged = visibleNotices.some(notice => !notice.isRead && notice.userId === userId && requiresNotificationAcknowledgment(notice));
  const snooze = (id: string, value: boolean) => {
    list.current?.focus({ preventScroll: true });
    onSnooze(id, value);
  };
  const acknowledge = async (id: string) => {
    list.current?.focus({ preventScroll: true });
    setStatus(null);
    onMarkRead(id);
    const outcome = await dataStore.awaitWrite('notifications', id);
    setStatus(outcome.ok
      ? { text: 'أكد الخادم إقرار القراءة.' }
      : outcome.pending
        ? { text: 'إقرار القراءة بانتظار المزامنة.' }
        : { text: outcome.message || 'لم يؤكد الخادم إقرار القراءة. أعد المحاولة.', error: true });
  };

  return (
    <>
      <div className="fixed inset-0 z-40" aria-hidden="true" onClick={onClose} />
      <section id="notification-inbox" aria-labelledby="notification-inbox-title" className="absolute inset-x-2 top-full mt-1 flex max-h-[min(36rem,72dvh)] flex-col sm:inset-x-auto sm:left-4 sm:w-96 bg-white rounded-2xl shadow-xl border border-slate-200 z-50 overflow-auto overscroll-contain text-start">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-2 px-3 py-1 bg-slate-50 border-b border-slate-200">
          <h2 id="notification-inbox-title" className="flex items-center gap-2 text-sm font-bold text-slate-800">
            <Bell className="w-4 h-4 text-blue-600" aria-hidden="true" />
            مركز الإشعارات التحريرية
            {inbox.unreadCount > 0 && <span className="bg-blue-600 text-white text-2xs font-bold px-1.5 py-0.5 rounded-full tabular-nums">{inbox.unreadCount}</span>}
          </h2>
          <button type="button" onClick={onClose} aria-label="إغلاق الإشعارات" className="grid size-11 place-items-center rounded-lg text-slate-600 hover:bg-slate-200">
            <X className="size-4" aria-hidden />
          </button>
          {hasUnread && (
            <button type="button" onClick={() => { list.current?.focus({ preventScroll: true }); onMarkAllRead(); }} className={`${actionClass} w-full`}>
              <Check className="w-3 h-3" aria-hidden="true" />
              {hasUnacknowledged ? 'تحديد التنبيهات العادية كمقروءة' : 'تحديد الكل كمقروء'}
            </button>
          )}
        </header>

        {storageFailed && <p role="status" className="px-4 py-2 text-xs text-amber-800 bg-amber-50">تعذّر حفظ التأجيل على الجهاز. يسري حتى مغادرة الصفحة.</p>}
        {status && <p role={status.error ? 'alert' : 'status'} className={`px-4 py-2 text-xs ${status.error ? 'bg-rose-50 text-rose-800' : 'bg-slate-50 text-slate-700'}`}>{status.text}</p>}

        <div ref={list} tabIndex={-1} aria-label="قائمة الإشعارات" className="min-h-11 max-h-96 overflow-y-auto overscroll-contain divide-y divide-slate-100">
          {inbox.groups.length === 0 && <p className="py-8 text-center text-xs text-slate-500">لا توجد إشعارات معروضة حالياً</p>}
          {inbox.groups.map(({ id, items }) => (
            <div key={id}>
              <h3 className={`px-4 py-2 text-xs font-bold ${id === 'urgent' ? 'bg-rose-50 text-rose-800' : 'bg-slate-50 text-slate-700'}`}>
                {id === 'urgent' ? 'إشعارات عاجلة' : id === 'other' ? 'إشعارات أخرى' : categoryName(id)}
              </h3>
              <ul className="divide-y divide-slate-100">
                {groupNoticeTargets(items, pathFor).flatMap(entries => entries.map((notice, index) => {
                  const path = pathFor(notice);
                  const markable = !notice.isRead && notice.userId === userId;
                  const needsAck = notice.userId === userId && requiresNotificationAcknowledgment(notice);
                  const titleId = `notification-title-${notice.id}`;
                  const action = noticeAction(path, userId);
                  return (
                    <li key={notice.id} className={`px-4 py-2.5 ${notice.isRead ? '' : 'bg-blue-50/40'}`}>
                      {index === 0 && entries.length > 1 && <p className="pb-1 text-xs font-semibold text-slate-700">إشعارات عن المادة نفسها ({entries.length})</p>}
                      <div className="flex items-start justify-between gap-2">
                        {path ? <button type="button" className="flex min-h-11 sm:min-h-9 min-w-0 items-center gap-1 rounded-md text-start text-xs font-bold text-blue-700 hover:underline focus-visible:outline-2" onClick={() => {
                          if (markable && !needsAck) onMarkRead(notice.id);
                          onNavigate(path);
                        }}>
                          <span id={titleId} className="min-w-0 break-words">{notice.title}</span>
                          <ChevronLeft className="w-3 h-3 shrink-0" aria-hidden="true" />
                        </button> : <span id={titleId} className={`min-w-0 break-words text-xs font-bold ${notice.urgent ? 'text-rose-800' : 'text-slate-800'}`}>{notice.title}</span>}
                        {!notice.isRead && <span className="w-2 h-2 rounded-full bg-blue-600 shrink-0 mt-1"><span className="sr-only">غير مقروء</span></span>}
                      </div>
                      <p className="text-xs text-slate-600 mt-1 leading-relaxed break-words">{notice.message}</p>
                      {action && <p className="mt-1 break-words text-xs font-semibold text-blue-700">
                        يتطلب إجراءً{action.owner ? ` · ${action.owner}` : ''}
                        {action.dueAt && Number.isFinite(Date.parse(action.dueAt)) && <> · قبل <time dateTime={action.dueAt}>{new Date(action.dueAt).toLocaleString(appLocale(), { ...zoneOptions(), day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time></>}
                      </p>}
                      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2">
                        <time className="text-2xs text-slate-500" dateTime={notice.createdAt}>
                          {new Date(notice.createdAt).toLocaleString(appLocale(), { ...zoneOptions(), day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </time>
                        <div className="flex flex-wrap items-center gap-1">
                          {needsAck && !markable && <span className="text-xs font-semibold text-slate-700">{dataStore.hasPendingWrite('notifications', notice.id) ? 'إقرار قيد المزامنة' : 'قُرئ التنبيه'}</span>}
                          {markable && <button type="button" aria-describedby={titleId} className={actionClass} onClick={() => {
                            if (needsAck) { void acknowledge(notice.id); return; }
                            list.current?.focus({ preventScroll: true });
                            onMarkRead(notice.id);
                          }}>{needsAck ? 'إقرار القراءة' : 'تحديد كمقروء'}</button>}
                          {!notice.urgent && <button type="button" aria-describedby={titleId} className={actionClass} onClick={() => snooze(notice.id, true)}>
                            <Clock className="w-3 h-3" aria-hidden="true" /> تأجيل لساعة
                          </button>}
                        </div>
                      </div>
                    </li>
                  );
                }))}
              </ul>
            </div>
          ))}
          {inbox.snoozed.length > 0 && <details className="bg-slate-50">
            <summary className="cursor-pointer px-4 py-3 text-xs font-bold text-slate-700">المؤجلة ({inbox.snoozed.length})</summary>
            <ul className="divide-y divide-slate-100">
              {inbox.snoozed.map((notice) => (
                <li key={notice.id} className="flex items-center justify-between gap-2 px-4 py-1 text-xs text-slate-700">
                  <span className="min-w-0 break-words">{notice.title}</span>
                  <button type="button" aria-label={`إلغاء التأجيل: ${notice.title}`} className={`${actionClass} shrink-0`} onClick={() => snooze(notice.id, false)}>إلغاء التأجيل</button>
                </li>
              ))}
            </ul>
          </details>}
        </div>
        <button type="button" onClick={() => onNavigate('/alerts')} className="w-full flex shrink-0 min-h-11 items-center justify-center gap-1.5 border-t border-slate-200 text-xs font-bold text-blue-700 hover:bg-blue-50">
          <Settings2 className="w-3.5 h-3.5" aria-hidden="true" />
          ما يصلني على البريد والجوال
        </button>
      </section>
    </>
  );
}
