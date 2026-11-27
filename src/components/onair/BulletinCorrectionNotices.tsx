import { apiService } from '../../services/api';
import { BULLETIN_SOURCE_CORRECTION } from '../../shared/newsCorrections';

export function BulletinCorrectionNotices({ showId, operatorId }: { showId: string; operatorId: string }) {
  const state = apiService.getOnAirStates().find(item => item.episodeId === showId && item.status === 'LIVE');
  if (!state || state.operatorId !== operatorId) return null;
  const link = `/bulletins/${encodeURIComponent(showId)}`;
  const notices = apiService.getMyNotifications().filter(item =>
    item.type === BULLETIN_SOURCE_CORRECTION && item.linkUrl === link && !item.isRead && item.createdAt >= state.startedAt,
  );
  if (!notices.length) return null;
  return (
    <section aria-label="تصحيحات مصادر النشرة الحالية" className="space-y-2">
      {notices.slice(0, 3).map(item => (
        <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-400 bg-amber-50 p-3 text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
          <div role="alert" className="min-w-0 break-words">
            <p className="text-sm font-bold">{item.title}</p>
            <p className="mt-1 text-sm">{item.message}</p>
          </div>
          <button type="button" className="min-h-11 shrink-0 rounded-md border border-current px-3 text-xs font-semibold" onClick={() => apiService.markNotificationRead(item.id)}>اطّلعت</button>
        </div>
      ))}
    </section>
  );
}
