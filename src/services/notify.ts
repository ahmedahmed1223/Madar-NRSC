/**
 * App-wide toasts from anywhere (views, hooks, services) without prop drilling.
 * An optional action (e.g. «تراجع») lets people undo a move or a delete.
 */
export interface NotifyInput {
  type: 'success' | 'error' | 'warning' | 'info';
  title?: string;
  message: string;
  action?: { label: string; run: () => void };
  /** Milliseconds before it disappears (longer by default when it offers an action). */
  duration?: number;
}

type Listener = (n: NotifyInput) => void;
const listeners = new Set<Listener>();

export function notify(n: NotifyInput) {
  listeners.forEach((l) => l(n));
}

export function onNotify(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Runs an action; a refused action becomes an error toast instead of breaking the screen. */
export function tryAction(title: string, fn: () => void, success?: string): boolean {
  try {
    fn();
    if (success) notify({ type: 'success', message: success });
    return true;
  } catch (err: any) {
    notify({ type: 'error', title, message: err?.message || 'تعذر تنفيذ العملية' });
    return false;
  }
}
