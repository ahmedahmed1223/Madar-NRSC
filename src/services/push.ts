import { apiService } from './api';

/** Web Push works on HTTPS (or localhost) in browsers with service workers. */
export function pushSupport(): { ok: boolean; reason?: string } {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return { ok: false, reason: 'متصفحك لا يدعم تنبيهات الجهاز. على آيفون: أضف مدار إلى الشاشة الرئيسية ثم افتحه من هناك.' };
  }
  if (!window.isSecureContext) return { ok: false, reason: 'تنبيهات الجهاز تتطلب فتح مدار عبر HTTPS.' };
  return { ok: true };
}

let registration: Promise<ServiceWorkerRegistration> | null = null;
export function registerServiceWorker(): Promise<ServiceWorkerRegistration> | null {
  if (!pushSupport().ok) return null;
  registration ??= navigator.serviceWorker.register('/sw.js', { scope: '/' });
  return registration;
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function currentPushSubscription(): Promise<PushSubscription | null> {
  const reg = await registerServiceWorker();
  return reg ? reg.pushManager.getSubscription() : null;
}

/** Asks permission, subscribes this browser and registers it on the server. */
export async function enablePush(publicKey: string): Promise<void> {
  const support = pushSupport();
  if (!support.ok) throw new Error(support.reason);
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('رُفض إذن التنبيهات؛ فعّله من إعدادات الموقع في المتصفح ثم أعد المحاولة');
  const reg = await registerServiceWorker()!;
  let sub = await reg.pushManager.getSubscription();
  const key = urlBase64ToUint8Array(publicKey);
  if (sub) {
    // A subscription made with other server keys must be replaced.
    const current = sub.options.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey) : null;
    if (!current || current.length !== key.length || current.some((b, i) => b !== key[i])) {
      await sub.unsubscribe();
      sub = null;
    }
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await apiService.savePushSubscription(sub.toJSON());
}

export async function disablePush(): Promise<void> {
  const sub = await currentPushSubscription();
  if (!sub) return;
  await apiService.removePushSubscription(sub.endpoint).catch(() => undefined);
  await sub.unsubscribe();
}
