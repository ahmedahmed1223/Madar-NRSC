import { appLocale, zoneOptions } from '../../shared/dateFormat';
import React from 'react';
import { AppNotification } from '../../types';
import { Bell, Check, Clock, ExternalLink, Settings2, Zap } from 'lucide-react';
import { categoryName } from '../../shared/notifications';

interface NotificationDropdownProps {
  isOpen: boolean;
  onClose: () => void;
  notifications: AppNotification[];
  onMarkAllRead: () => void;
  onMarkRead?: (id: string) => void;
  onNavigate?: (url?: string) => void;
}

export const NotificationDropdown: React.FC<NotificationDropdownProps> = ({
  isOpen,
  onClose,
  notifications = [],
  onMarkAllRead,
  onMarkRead,
  onNavigate,
}) => {
  if (!isOpen) return null;

  const unreadCount = (notifications || []).filter((n) => !n.isRead).length;

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute left-4 top-16 w-80 sm:w-96 bg-white rounded-2xl shadow-xl border border-slate-200 z-50 overflow-hidden text-right">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-blue-600" />
            <span className="text-sm font-bold text-slate-800">مركز الإشعارات التحريرية</span>
            {unreadCount > 0 && (
              <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                {unreadCount}
              </span>
            )}
          </div>
          {unreadCount > 0 && (
            <button
              onClick={onMarkAllRead}
              className="text-xs text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1"
            >
              <Check className="w-3 h-3" />
              تحديد الكل كمقروء
            </button>
          )}
        </div>

        {/* List */}
        <div className="max-h-96 overflow-y-auto divide-y divide-slate-100">
          {notifications.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400">
              لا توجد إشعارات جديدة حالياً
            </div>
          ) : (
            notifications.map((notif) => (
              <div
                key={notif.id}
                onClick={() => {
                  if (!notif.isRead) onMarkRead?.(notif.id);
                  if (notif.linkUrl) onNavigate?.(notif.linkUrl);
                  onClose();
                }}
                className={`p-3.5 hover:bg-slate-50 transition-colors cursor-pointer ${
                  !notif.isRead ? 'bg-blue-50/40' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <h4 className={`text-xs font-bold ${notif.urgent ? 'text-red-700' : 'text-slate-800'}`}>
                    {notif.urgent && <Zap className="w-3 h-3 inline ms-0.5" />} {notif.title}
                  </h4>
                  {!notif.isRead && (
                    <span className="w-2 h-2 rounded-full bg-blue-600 shrink-0 mt-1" />
                  )}
                </div>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">{notif.message}</p>
                <div className="flex items-center justify-between text-[10px] text-slate-400 mt-2">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {new Date(notif.createdAt).toLocaleTimeString(appLocale(), { ...zoneOptions(),
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {notif.category && <span className="ms-1 px-1 rounded bg-slate-100 text-slate-500">{categoryName(notif.category)}</span>}
                  </span>
                  {notif.linkUrl && (
                    <span className="text-blue-600 flex items-center gap-0.5">
                      الانتقال <ExternalLink className="w-2.5 h-2.5" />
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            onNavigate?.('/alerts');
            onClose();
          }}
          className="w-full flex items-center justify-center gap-1.5 py-2.5 border-t border-slate-100 text-xs font-bold text-slate-600 hover:bg-slate-50"
        >
          <Settings2 className="w-3.5 h-3.5" />
          ما يصلني على البريد والجوال
        </button>
      </div>
    </>
  );
};
