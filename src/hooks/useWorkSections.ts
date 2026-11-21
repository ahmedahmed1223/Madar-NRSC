import { useRef, useState } from 'react';
import { sanitizeWorkSections, type WorkSectionPreferences } from '../shared/workContext';
import { apiService } from '../services/api';
import { dataStore } from '../services/dataStore';
import { useLiveData } from './useLiveData';

type SaveState = { pending: boolean; error?: string };

export function useWorkSections(userId: string) {
  useLiveData(['workspacePrefs']);
  const [legacy] = useState(() => {
    try { return sanitizeWorkSections(JSON.parse(localStorage.getItem(`madar-work-sections:${userId}`) || 'null')); }
    catch { return sanitizeWorkSections(null); }
  });
  const [status, setStatus] = useState<SaveState>({ pending: false });
  const sequence = useRef(0);
  const preferences = apiService.getWorkspaceWorkSections() ?? legacy;
  const pending = status.pending || dataStore.hasPendingWrite('workspacePrefs', userId);

  const save = async (value: WorkSectionPreferences) => {
    if (apiService.getCurrentUser().id !== userId) return;
    const version = ++sequence.current;
    setStatus({ pending: true });
    try {
      apiService.saveWorkspaceWorkSections(sanitizeWorkSections(value));
      const outcome = await dataStore.awaitWrite('workspacePrefs', userId);
      if (version !== sequence.current) return;
      setStatus({ pending: false, error: outcome.ok || outcome.pending ? undefined : outcome.message || 'تعذّر حفظ تخصيص عملي.' });
    } catch (error) {
      if (version !== sequence.current) return;
      setStatus({ pending: false, error: error instanceof Error ? error.message : 'تعذّر حفظ تخصيص عملي.' });
    }
  };
  return [preferences, save, { pending, error: status.error }] as const;
}
