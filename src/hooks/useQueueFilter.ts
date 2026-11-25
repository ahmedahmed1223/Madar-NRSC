import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { readQueueFilter, sanitizeQueueFilter, writeQueueFilter, queueFilterKey, type QueueFilterScope, type QueueFilterValue } from '../shared/workContext';
import { notify } from '../services/notify';

/** Queue metadata only. Account changes are resolved during render, never after a stale frame. */
export function useQueueFilter(userId: string, scope: QueueFilterScope, field: string, initial: string | (() => string), options?: readonly string[]): [string, Dispatch<SetStateAction<string>>];
export function useQueueFilter(userId: string, scope: QueueFilterScope, field: string, initial: boolean | (() => boolean), options?: readonly string[]): [boolean, Dispatch<SetStateAction<boolean>>];
export function useQueueFilter<T extends QueueFilterValue>(userId: string, scope: QueueFilterScope, field: string, initial: T | (() => T), options?: readonly string[]): [T, Dispatch<SetStateAction<T>>];
export function useQueueFilter<T extends QueueFilterValue>(
  userId: string, scope: QueueFilterScope, field: string, initial: T | (() => T), options?: readonly string[],
): [T, Dispatch<SetStateAction<T>>] {
  const key = queueFilterKey(userId, scope, field);
  const restored = useMemo(() => {
    const fallback = typeof initial === 'function' ? initial() : initial;
    try { return { fallback, value: readQueueFilter(sessionStorage, userId, scope, field, fallback) }; }
    catch { return { fallback, value: fallback }; }
    // Defaults are evaluated once per account/field, just like useState initializers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  // A live default (for example a reassigned department) can change for the same account.
  const fallback = typeof initial === 'function' ? restored.fallback : initial;
  const [state, setState] = useState({ key, value: restored.value });
  const raw = state.key === key ? state.value : restored.value;
  const value = sanitizeQueueFilter(raw, fallback, options);
  const latest = useRef(value);
  latest.current = value;
  const warned = useRef(false);
  const persist = (next: T) => {
    let ok = false;
    try { ok = writeQueueFilter(sessionStorage, userId, scope, field, next); } catch { /* Storage access itself can fail. */ }
    if (!ok && !warned.current) {
      warned.current = true;
      notify({ type: 'warning', message: 'تعذر حفظ فلاتر القائمة على الجهاز؛ يمكنك متابعة العمل في هذه الزيارة.' });
    }
  };
  // Do not invalidate asynchronous options until their authoritative response arrives.
  useEffect(() => {
    if (raw === value) return;
    setState({ key, value });
    persist(value);
  }, [key, raw, value]);
  const setValue: Dispatch<SetStateAction<T>> = action => {
    const next = sanitizeQueueFilter(typeof action === 'function' ? action(latest.current) : action, fallback, options);
    latest.current = next;
    setState({ key, value: next });
    // Write before navigation can unmount the queue, not in a later effect.
    persist(next);
  };
  return [value, setValue];
}
