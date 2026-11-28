import { useMemo, useState } from 'react';
import { useLiveData } from '../../hooks/useLiveData';
import { apiService } from '../../services/api';
import { RbacService } from '../../services/rbacService';
import { navigateTo } from '../../services/uiEvents';
import { groupNotifications, notificationInboxPath } from '../../shared/notificationInbox';
import type { User } from '../../types';
import { NotificationInbox } from './NotificationInbox';

const PAGE_SIZE = 25;
const FILTERS = [{ id: 'all', label: 'الكل' }, { id: 'unread', label: 'غير المقروءة' }] as const;
type Filter = typeof FILTERS[number]['id'];

export function NotificationHistory({ currentUser }: { currentUser: User }) {
  const revision = useLiveData(['notifications', 'roles', 'settings']);
  const [filter, setFilter] = useState<Filter>('all');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const userId = currentUser.id;
  const notices = useMemo(() => apiService.getCurrentUser().id === userId
    ? apiService.getMyNotifications().sort((a, b) =>
      (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0) || a.id.localeCompare(b.id))
    : [], [userId, revision]);
  const selected = filter === 'unread' ? notices.filter(notice => !notice.isRead) : notices;
  const inbox = {
    ...groupNotifications(selected.slice(0, limit), userId, {}, Date.now()),
    unreadCount: notices.filter(notice => !notice.isRead).length,
  };

  return <NotificationInbox
    inbox={inbox}
    userId={userId}
    onMarkAllRead={() => { if (apiService.getCurrentUser().id === userId) apiService.markAllNotificationsRead(); }}
    onMarkRead={id => { if (apiService.getCurrentUser().id === userId) apiService.markNotificationRead(id); }}
    pathFor={notice => notificationInboxPath(notice.linkUrl, screen => RbacService.canOpenScreen(currentUser, screen))}
    onNavigate={path => { if (apiService.getCurrentUser().id === userId) navigateTo.emit(path); }}
    filters={<div role="group" aria-label="تصفية الإشعارات" className="flex flex-wrap gap-1 py-1">
      {FILTERS.map(item => <button
        key={item.id}
        type="button"
        aria-pressed={item.id === filter}
        onClick={() => {
          if (filter === item.id) return;
          setFilter(item.id);
          setLimit(PAGE_SIZE);
        }}
        className={`min-h-11 rounded-lg px-3 text-xs font-bold focus-visible:outline-2 ${item.id === filter ? 'bg-blue-100 text-blue-900' : 'text-slate-700 hover:bg-slate-200'}`}
      >{item.label}</button>)}
    </div>}
    footer={selected.length > limit && <button
      type="button"
      className="flex min-h-11 w-full items-center justify-center border-t border-slate-200 px-3 text-xs font-bold text-blue-700 hover:bg-blue-50 focus-visible:outline-2"
      onClick={() => setLimit(previous => previous + PAGE_SIZE)}
    >عرض المزيد من الإشعارات</button>}
  />;
}
