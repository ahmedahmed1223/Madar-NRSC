import { useCallback, useEffect, useRef } from 'react';
import { confirmDialog } from '../services/dialogs';

export interface UnsavedChangesGuardOptions {
  /** Optional callback invoked right before the browser warns on unload (e.g. flushing an emergency localStorage draft). */
  onBeforeUnload?: () => void;
  /** Custom confirmation prompt for in-app navigation / close guards. */
  message?: string;
  /** Confirmation dialog title. */
  title?: string;
  /** Confirmation button label. */
  confirmLabel?: string;
}

export interface BeforeUnloadTarget {
  addEventListener: (type: 'beforeunload', listener: (event: BeforeUnloadEvent) => void) => void;
  removeEventListener: (type: 'beforeunload', listener: (event: BeforeUnloadEvent) => void) => void;
}

const DEFAULT_TITLE = 'تغييرات غير محفوظة';
const DEFAULT_MESSAGE = 'لديك تعديلات غير محفوظة. هل تريد المغادرة وتجاهل التغييرات؟';
const DEFAULT_CONFIRM_LABEL = 'تجاهل التغييرات';

/**
 * Attaches a `beforeunload` listener to `target` that invokes `onBeforeUnload` (if given),
 * cancels the event, and sets `event.returnValue = ''`. Returns a cleanup function.
 */
export function registerBeforeUnloadGuard(
  target: BeforeUnloadTarget,
  onBeforeUnload?: () => void
): () => void {
  const handleBeforeUnload = (event: BeforeUnloadEvent) => {
    onBeforeUnload?.();
    event.preventDefault();
    event.returnValue = '';
  };
  target.addEventListener('beforeunload', handleBeforeUnload);
  return () => target.removeEventListener('beforeunload', handleBeforeUnload);
}

/**
 * Prompts the user before discarding unsaved changes when `dirty` is true.
 * Resolves `true` immediately when `dirty` is false.
 */
export async function confirmUnsavedDiscard(
  dirty: boolean,
  options: Pick<UnsavedChangesGuardOptions, 'title' | 'message' | 'confirmLabel'> = {}
): Promise<boolean> {
  if (!dirty) return true;
  return confirmDialog({
    title: options.title ?? DEFAULT_TITLE,
    message: options.message ?? DEFAULT_MESSAGE,
    confirmLabel: options.confirmLabel ?? DEFAULT_CONFIRM_LABEL,
    danger: true,
  });
}

/**
 * Registers a `beforeunload` browser warning while `dirty` is true and exposes
 * `confirmDiscard()` for guarding in-app navigation or modal/form dismissal.
 */
export function useUnsavedChangesGuard(dirty: boolean, options: UnsavedChangesGuardOptions = {}) {
  const { onBeforeUnload, message = DEFAULT_MESSAGE, title = DEFAULT_TITLE, confirmLabel = DEFAULT_CONFIRM_LABEL } = options;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const onBeforeUnloadRef = useRef(onBeforeUnload);
  onBeforeUnloadRef.current = onBeforeUnload;

  useEffect(() => {
    if (!dirty || typeof window === 'undefined') return;
    return registerBeforeUnloadGuard(window, () => onBeforeUnloadRef.current?.());
  }, [dirty]);

  const confirmDiscard = useCallback(
    async (overrideMessage?: string): Promise<boolean> =>
      confirmUnsavedDiscard(dirtyRef.current, {
        title,
        message: overrideMessage ?? message,
        confirmLabel,
      }),
    [title, message, confirmLabel]
  );

  return { dirty, confirmDiscard };
}
