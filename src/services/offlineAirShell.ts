export async function ensureOfflineShell(): Promise<{ version: string }> {
  if (!window.isSecureContext || !('serviceWorker' in navigator)) throw new Error('الأوفلاين يحتاج HTTPS أو localhost ومتصفحاً يدعم التخزين المحلي');
  if (typeof BroadcastChannel === 'undefined') throw new Error('المتصفح لا يدعم قفل نوافذ الأوفلاين الأخرى عند تسجيل الخروج');
  await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  const registration = await navigator.serviceWorker.ready;
  if (!registration.active) throw new Error('عامل الأوفلاين غير جاهز');
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = setTimeout(() => { channel.port1.close(); reject(new Error('انتهت مهلة تجهيز شاشة الأوفلاين')); }, 60000);
    channel.port1.onmessage = event => {
      clearTimeout(timeout); channel.port1.close();
      if (event.data?.ok && typeof event.data.version === 'string') resolve({ version: event.data.version });
      else reject(new Error(event.data?.error || 'تعذر تجهيز شاشة الأوفلاين'));
    };
    registration.active!.postMessage({ type: 'prepare-offline-air' }, [channel.port2]);
  });
}
