import { useRef } from 'react';
import { Bell, Check, ChevronLeft, Clock, Settings2 } from 'lucide-react';
import { appLocale, zoneOptions } from '../../shared/dateFormat';
import { categoryName } from '../../shared/notifications';
import type { groupNotifications } from '../../shared/notificationInbox';
import type { AppNotification } from '../../types';

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

const actionClass = 'inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-xs font-bold text-blue-700 hover:bg-blue-50 focus-visible:outline-2';

export function NotificationDropdown({ inbox, userId, storageFailed, onClose, onMarkAllRead, onMarkRead, onSnooze, pathFor, onNavigate }: NotificationDropdownProps) {
  const list = useRef<HTMLDivElement>(null);
  const hasUnread = inbox.groups.some((group) => group.items.some((notice) => !notice.isRead && notice.userId === userId));
  const snooze = (id: string, value: boolean) => {
    list.current?.focus({ preventScroll: true });
    onSnooze(id, value);
  };

  return (
    <>
      <div className="fixed inset-0 z-40" aria-hidden="true" onClick={onClose} />
      <section id="notification-inbox" aria-labelledby="notification-inbox-title" className="fixed inset-x-2 top-[4.5rem] sm:absolute sm:inset-x-auto sm:left-4 sm:top-16 sm:w-96 bg-white rounded-2xl shadow-xl border border-slate-200 z-50 overflow-hidden text-right">
        <header className="flex flex-wrap items-center justify-between gap-x-2 px-4 py-3 bg-slate-50 border-b border-slate-100">
          <h2 id="notification-inbox-title" className="flex items-center gap-2 text-sm font-bold text-slate-800">
            <Bell className="w-4 h-4 text-blue-600" aria-hidden="true" />
            مركز الإشعارات التحريرية
            {inbox.unreadCount > 0 && <span className="bg-blue-600 text-white text-2xs font-bold px-1.5 py-0.5 rounded-full tabular-nums">{inbox.unreadCount}</span>}
          </h2>
          {hasUnread && (
            <button type="button" onClick={() => { list.current?.focus({ preventScroll: true }); onMarkAllRead(); }} className={`${actionClass} -my-1.5`}>
              <Check className="w-3 h-3" aria-hidden="true" />
              تحديد الكل كمقروء
            </button>
          )}
        </header>

        {storageFailed && <p role="status" className="px-4 py-2 text-xs text-amber-800 bg-amber-50">تعذّر حفظ التأجيل على الجهاز. يسري حتى مغادرة الصفحة.</p>}

        <div ref={list} tabIndex={-1} aria-label="قائمة الإشعارات" className="max-h-[min(24rem,60dvh)] overflow-y-auto divide-y divide-slate-100">
          {inbox.groups.length === 0 && <p className="py-8 text-center text-xs text-slate-500">لا توجد إشعارات معروضة حالياً</p>}
          {inbox.groups.map(({ id, items }) => (
            <div key={id}>
              <h3 className={`px-4 py-2 text-xs font-bold ${id === 'urgent' ? 'bg-rose-50 text-rose-800' : 'bg-slate-50 text-slate-700'}`}>
                {id === 'urgent' ? 'إشعارات عاجلة' : id === 'other' ? 'إشعارات أخرى' : categoryName(id)}
              </h3>
              <ul className="divide-y divide-slate-100">
                {items.map((notice, index) => {
                  const path = pathFor(notice);
                  const markable = !notice.isRead && notice.userId === userId;
                  const titleId = `notification-title-${id}-${index}`;
                  return (
                    <li key={notice.id} className={`px-4 py-2.5 ${notice.isRead ? '' : 'bg-blue-50/40'}`}>
                      <div className="flex items-start justify-between gap-2">
                        {path ? <button type="button" className="flex min-h-9 min-w-0 items-center gap-1 rounded-md text-start text-xs font-bold text-blue-700 hover:underline focus-visible:outline-2" onClick={() => {
                          if (markable) onMarkRead(notice.id);
                          onNavigate(path);
                        }}>
                          <span id={titleId} className="min-w-0 break-words">{notice.title}</span>
                          <ChevronLeft className="w-3 h-3 shrink-0" aria-hidden="true" />
                        </button> : <span id={titleId} className={`min-w-0 break-words text-xs font-bold ${notice.urgent ? 'text-rose-800' : 'text-slate-800'}`}>{notice.title}</span>}
                        {!notice.isRead && <span className="w-2 h-2 rounded-full bg-blue-600 shrink-0 mt-1"><span className="sr-only">غير مقروء</span></span>}
                      </div>
                      <p className="text-xs text-slate-600 mt-1 leading-relaxed break-words">{notice.message}</p>
                      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2">
                        <time className="text-2xs text-slate-500" dateTime={notice.createdAt}>
                          {new Date(notice.createdAt).toLocaleString(appLocale(), { ...zoneOptions(), day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </time>
                        <div className="flex flex-wrap items-center gap-1">
                          {markable && <button type="button" aria-describedby={titleId} className={actionClass} onClick={() => {
                            list.current?.focus({ preventScroll: true });
                            onMarkRead(notice.id);
                          }}>تحديد كمقروء</button>}
                          {!notice.urgent && <button type="button" aria-describedby={titleId} className={actionClass} onClick={() => snooze(notice.id, true)}>
                            <Clock className="w-3 h-3" aria-hidden="true" /> تأجيل لساعة
                          </button>}
                        </div>
                      </div>
                    </li>
                  );
                })}
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
        <button type="button" onClick={() => onNavigate('/alerts')} className="w-full flex min-h-10 items-center justify-center gap-1.5 border-t border-slate-100 text-xs font-bold text-slate-600 hover:bg-slate-50">
          <Settings2 className="w-3.5 h-3.5" aria-hidden="true" />
          ما يصلني على البريد والجوال
        </button>
      </section>
    </>
  );
}
