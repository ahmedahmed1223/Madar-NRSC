/**
 * Registers the service worker that keeps the app on this device (page shell and built files),
 * so screens still open when a reporter loses the connection. Production builds only: the
 * development server serves source modules that must never be cached.
 */
export function registerAppServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !window.isSecureContext) return;
  const register = async () => {
    try {
      await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      const registration = await navigator.serviceWorker.ready;
      // Download every screen of this build in the background (skipped when already stored).
      registration.active?.postMessage({ type: 'precache-app' });
    } catch {
      // Without a service worker the app still works online.
    }
  };
  // After the page has loaded, so the first screen is not slowed down.
  if (document.readyState === 'complete') void register();
  else window.addEventListener('load', () => void register(), { once: true });
}
