import { useState } from 'react';
import { sanitizeWorkSections, type WorkSectionPreferences } from '../shared/workContext';
import { notify } from '../services/notify';

export function useWorkSections(userId: string) {
  const key = `madar-work-sections:${userId}`;
  const [preferences, setPreferences] = useState(() => {
    try { return sanitizeWorkSections(JSON.parse(localStorage.getItem(key) || 'null')); }
    catch { return sanitizeWorkSections(null); }
  });
  const [warned, setWarned] = useState(false);
  const save = (value: WorkSectionPreferences) => {
    const next = sanitizeWorkSections(value);
    setPreferences(next);
    try { localStorage.setItem(key, JSON.stringify(next)); }
    catch {
      if (!warned) { setWarned(true); notify({ type: 'warning', message: 'تعذر حفظ ترتيب عملي على الجهاز؛ التغيير لهذه الزيارة فقط.' }); }
    }
  };
  return [preferences, save] as const;
}
