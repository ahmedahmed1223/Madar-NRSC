import { Component, ComponentProps, ComponentType, ReactNode, createElement, lazy, useState } from 'react';

const RELOAD_FLAG = 'nrcs_chunk_reload';
/** While a screen waits for the connection, try again this often in case navigator.onLine is wrong. */
const OFFLINE_RETRY_MS = 30_000;

/** A screen's file could not be downloaded because there is no connection. */
export class ChunkOfflineError extends Error {
  constructor() {
    super('هذه الشاشة لم تُحمَّل بعد وتحتاج اتصالاً');
    this.name = 'ChunkOfflineError';
  }
}

export function isChunkLoadError(err: unknown): boolean {
  return /dynamically imported module|Loading chunk|Importing a module script failed|Failed to fetch|error loading dynamically/i.test(String((err as any)?.message || err));
}

/** navigator.onLine can say "online" on a dead link: ask the server before reloading. */
async function connectionLost(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  try {
    await fetch('/', { method: 'HEAD', cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(5000) });
    return false;
  } catch {
    return true;
  }
}

interface BoundaryProps {
  onRetry: () => void;
  children?: ReactNode;
}

/** Catches only "no connection" chunk failures; anything else goes on to the screen's error boundary. */
class OfflineChunkBoundary extends Component<BoundaryProps, { error: Error | null }> {
  state = { error: null as Error | null };
  private timer: ReturnType<typeof setInterval> | null = null;

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate() {
    this.watch();
  }

  componentDidMount() {
    this.watch();
  }

  componentWillUnmount() {
    this.unwatch();
  }

  private retry = () => this.props.onRetry();

  private watch() {
    if (!(this.state.error instanceof ChunkOfflineError) || this.timer) return;
    window.addEventListener('online', this.retry);
    this.timer = setInterval(() => {
      if (navigator.onLine !== false) this.retry();
    }, OFFLINE_RETRY_MS);
  }

  private unwatch() {
    window.removeEventListener('online', this.retry);
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (!(error instanceof ChunkOfflineError)) throw error;
    return createElement(
      'div',
      { role: 'status', className: 'max-w-md mx-auto mt-10 bg-white border border-amber-200 rounded-2xl p-6 text-center space-y-3' },
      createElement('p', { className: 'text-sm font-bold text-slate-800' }, 'هذه الشاشة لم تُحمَّل بعد وتحتاج اتصالاً. ستفتح تلقائياً عند عودة الاتصال.'),
      createElement('p', { className: 'text-xs text-slate-600' }, 'ما حفظته باقٍ على جهازك.'),
      createElement(
        'button',
        { type: 'button', onClick: this.retry, className: 'min-h-11 px-5 rounded-xl border border-slate-300 text-sm font-bold text-slate-700' },
        'أعد المحاولة',
      ),
    );
  }
}

/**
 * Lazy screen loading that survives a new deployment: if an old page asks for a file that no
 * longer exists (a "chunk" from the previous version), reload once to pick up the new version
 * instead of showing a broken screen. A second failure is reported normally.
 *
 * Without a connection it never reloads (that would leave the browser's "no internet" page):
 * the screen says it needs a connection and opens by itself once the connection is back.
 */
export function lazyWithRetry<T extends ComponentType<any>>(factory: () => Promise<{ default: T }>): ComponentType<ComponentProps<T>> {
  const load = () =>
    lazy(async () => {
      try {
        const mod = await factory();
        try {
          sessionStorage.removeItem(RELOAD_FLAG);
        } catch {
          // storage unavailable
        }
        return mod;
      } catch (err: any) {
        const chunkError = isChunkLoadError(err);
        if (chunkError && (await connectionLost())) throw new ChunkOfflineError();
        let reloaded = false;
        try {
          reloaded = sessionStorage.getItem(RELOAD_FLAG) === '1';
          if (chunkError && !reloaded) sessionStorage.setItem(RELOAD_FLAG, '1');
        } catch {
          reloaded = true;
        }
        if (chunkError && !reloaded) {
          window.location.reload();
          return new Promise<{ default: T }>(() => undefined);
        }
        throw err;
      }
    });
  let Screen = load();
  const LazyScreen = (props: ComponentProps<T>) => {
    const [attempt, setAttempt] = useState(0);
    const retry = () => {
      // React keeps a failed lazy component failed: start a fresh download.
      Screen = load();
      setAttempt((a) => a + 1);
    };
    return createElement(OfflineChunkBoundary, { key: attempt, onRetry: retry }, createElement(Screen as ComponentType<any>, props));
  };
  return LazyScreen;
}
