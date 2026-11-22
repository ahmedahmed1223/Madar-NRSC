import { useEffect, useState } from 'react';
import { useLiveData } from '../../hooks/useLiveData';
import { apiService } from '../../services/api';
import { navigateTo } from '../../services/uiEvents';
import { overlappingNews } from '../../shared/coverageOverlap';
import { stationName, stationsOf } from '../../shared/stations';

export function CoverageOverlap({ title, stationId, newsId }: { title: string; stationId?: string; newsId?: string }) {
  useLiveData(['news', 'users', 'settings'], 30_000);
  const [checkedTitle, setCheckedTitle] = useState(title);
  useEffect(() => {
    const timer = window.setTimeout(() => setCheckedTitle(title), 350);
    return () => window.clearTimeout(timer);
  }, [title]);
  const matches = overlappingNews(checkedTitle, apiService.getNews(), apiService.getUsers(), stationId, newsId);
  if (!matches.length) return null;
  const stations = stationsOf(apiService.getSettings());
  return (
    <aside aria-label="تغطية مشابهة" className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
      <p>مواد مشابهة بدأت في محطات أخرى خلال آخر 24 ساعة</p>
      <ul>{matches.map(({ item, stationId: other }) => (
        <li key={item.id}><button type="button" className="min-h-11 text-start font-semibold underline underline-offset-2" onClick={() => navigateTo.emit(`/news/${encodeURIComponent(item.id)}`)}>
          {item.title} · {stationName(stations, other)}
        </button></li>
      ))}</ul>
    </aside>
  );
}
