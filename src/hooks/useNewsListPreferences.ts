import { useState } from 'react';
import { sanitizeNewsListPreferences, type NewsListPreferences } from '../shared/newsListPreferences';
import { notify } from '../services/notify';

export function useNewsListPreferences(userId: string) {
  const key = `nrcs-news-list-preferences:${userId}`;
  const [preferences, setPreferences] = useState(() => {
    try { return sanitizeNewsListPreferences(JSON.parse(localStorage.getItem(key) || 'null')); }
    catch { return sanitizeNewsListPreferences(null); }
  });
  const save = (value: NewsListPreferences) => {
    const next = sanitizeNewsListPreferences(value);
    setPreferences(next);
    try { localStorage.setItem(key, JSON.stringify(next)); }
    catch { notify({ type: 'warning', message: 'تعذر حفظ تفضيلات القائمة على الجهاز. التغييرات لهذه الزيارة فقط.' }); }
  };
  return [preferences, save] as const;
}
