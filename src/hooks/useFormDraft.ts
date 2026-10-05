import { useLayoutEffect, useRef, useState } from 'react';
import { confirmDialog } from '../services/dialogs';

interface DraftSession<T> {
  key: string;
  baseline: string;
  snapshot: string;
  value: T;
  restoring?: string;
}

/** A per-user, per-record recovery copy, never a replacement for a server save. */
export function useFormDraft<T>(key: string, active: boolean, value: T, restore: (value: T) => void) {
  const session = useRef<DraftSession<T> | null>(null);
  const [recovered, setRecovered] = useState(false);
  const [error, setError] = useState(false);
  const [dirty, setDirty] = useState(false);
  const serialized = JSON.stringify(value);
  const storageKey = `madar-form-draft:v1:${key}`;

  useLayoutEffect(() => {
    if (!active) {
      session.current = null;
      return;
    }
    let current = session.current;
    if (!current || current.key !== storageKey) {
      current = { key: storageKey, baseline: serialized, snapshot: serialized, value };
      session.current = current;
      setRecovered(false);
      setError(false);
      setDirty(false);
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) {
          const draft = JSON.parse(raw);
          const valid = draft.version === 1 && draft.value != null &&
            typeof draft.value === typeof value &&
            (typeof value !== 'object' || Object.keys(value as object).every(k =>
              k in draft.value && typeof draft.value[k] === typeof (value as any)[k]));
          if (valid && JSON.stringify(draft.value) !== serialized) {
            current.restoring = serialized;
            restore(draft.value);
            setRecovered(true);
            return;
          }
          localStorage.removeItem(storageKey);
        }
      } catch {
        setError(true);
      }
    }
    // Do not overwrite the recovery copy with the initial render during restoration.
    if (current.restoring === serialized) return;
    current.restoring = undefined;
    current.value = value;
    current.snapshot = serialized;
    const changed = serialized !== current.baseline;
    setDirty(changed);
    try {
      if (changed) localStorage.setItem(storageKey, JSON.stringify({ version: 1, value, savedAt: new Date().toISOString() }));
      else localStorage.removeItem(storageKey);
      setError(false);
    } catch {
      setError(true);
    }
  }, [active, storageKey, serialized]);

  useLayoutEffect(() => {
    if (!active || !dirty || !error) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [active, dirty, error]);

  const clearDraft = () => {
    const current = session.current;
    if (current) current.baseline = serialized;
    const stillDirty = !!current && current.snapshot !== serialized;
    try {
      if (stillDirty) localStorage.setItem(storageKey, JSON.stringify({ version: 1, value: current!.value, savedAt: new Date().toISOString() }));
      else localStorage.removeItem(storageKey);
      setError(false);
    } catch {
      setError(true);
    }
    setDirty(stillDirty);
    setRecovered(false);
  };
  const discardDraft = () => {
    if (!session.current) return;
    restore(JSON.parse(session.current.baseline));
    setRecovered(false);
  };
  const close = async (leave: () => void) => {
    if (dirty && error && !(await confirmDialog({
      title: 'تغييرات غير محفوظة', message: 'تعذر حفظ نسخة الاستعادة. المغادرة ستفقد التغييرات.',
      confirmLabel: 'مغادرة دون حفظ', cancelLabel: 'البقاء', danger: true,
    }))) return;
    leave();
  };
  return { dirty, recovered, error, clearDraft, discardDraft, close };
}

export type FormDraftStatus = Pick<ReturnType<typeof useFormDraft>, 'dirty' | 'recovered' | 'error' | 'discardDraft'>;
