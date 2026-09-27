import React, { useEffect, useState } from 'react';
import { BellRing, Mail, Moon, Plus, Radio, Save, Send, Smartphone, Trash2, X, Zap } from 'lucide-react';
import type { User } from '../types';
import { apiService } from '../services/api';
import { notify } from '../services/notify';
import { currentPushSubscription, disablePush, enablePush, pushSupport } from '../services/push';
import { useLiveData } from '../hooks/useLiveData';
import { DEFAULT_CHANNELS, MAX_WATCH_WORDS, NOTIFICATION_CATEGORIES, NotificationCategory, NotificationPrefs, wantsDelivery } from '../shared/notifications';

type Delivery = Awaited<ReturnType<typeof apiService.getDeliveryStatus>>;

const deviceName = (ua?: string) => {
  if (!ua) return 'جهاز';
  const os = /iPhone|iPad/.test(ua) ? 'آيفون/آيباد' : /Android/.test(ua) ? 'أندرويد' : /Mac OS/.test(ua) ? 'ماك' : /Windows/.test(ua) ? 'ويندوز' : /Linux/.test(ua) ? 'لينكس' : 'جهاز';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  return `${os}${browser ? ` — ${browser}` : ''}`;
};

/** Each colleague chooses what reaches them by e-mail and on their devices, and which wires to watch. */
export const NotificationSettingsView: React.FC<{ currentUser: User }> = ({ currentUser }) => {
  useLiveData(['notificationPrefs']);
  const [prefs, setPrefs] = useState<NotificationPrefs>(() => apiService.getMyNotificationPrefs());
  const [dirty, setDirty] = useState(false);
  const [word, setWord] = useState('');
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [deliveryError, setDeliveryError] = useState('');
  const [thisDevice, setThisDevice] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const support = pushSupport();

  const loadDelivery = async () => {
    try {
      setDelivery(await apiService.getDeliveryStatus());
      setDeliveryError('');
    } catch (err: any) {
      setDeliveryError(err?.message || 'تعذر قراءة حالة التنبيهات');
    }
    const sub = await currentPushSubscription().catch(() => null);
    setThisDevice(sub?.endpoint || null);
  };
  useEffect(() => {
    loadDelivery();
  }, []);

  const update = (patch: Partial<NotificationPrefs>) => {
    setPrefs((p) => ({ ...p, ...patch }));
    setDirty(true);
  };
  const setChannel = (cat: NotificationCategory, channel: 'email' | 'push', value: boolean) =>
    update({ channels: { ...prefs.channels, [cat]: { ...DEFAULT_CHANNELS[cat], ...prefs.channels[cat], [channel]: value } } });

  const save = () => {
    try {
      setPrefs(apiService.saveMyNotificationPrefs(prefs));
      setDirty(false);
      notify({ type: 'success', message: 'حُفظت إعدادات تنبيهاتك' });
    } catch (err: any) {
      notify({ type: 'error', title: 'تعذر الحفظ', message: err?.message });
    }
  };

  const addWord = () => {
    const w = word.trim();
    if (!w) return;
    if (prefs.watchWords.includes(w)) return setWord('');
    if (prefs.watchWords.length >= MAX_WATCH_WORDS) return notify({ type: 'warning', message: `الحد الأقصى ${MAX_WATCH_WORDS} كلمة` });
    update({ watchWords: [...prefs.watchWords, w] });
    setWord('');
  };

  const run = async (key: string, fn: () => Promise<void>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      notify({ type: 'success', message: ok });
      await loadDelivery();
    } catch (err: any) {
      notify({ type: 'error', title: 'تعذر التنفيذ', message: err?.message });
    } finally {
      setBusy('');
    }
  };

  const thisRegistered = !!thisDevice && !!delivery?.devices.some((d) => d.endpoint === thisDevice);

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <BellRing className="w-5 h-5 text-blue-600" />
            تنبيهاتي
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            كل التنبيهات تظهر في الجرس دائماً؛ هنا تختار ما يصلك أيضاً على بريدك وعلى هاتفك أو حاسوبك، وأي برقيات تريد أن تُنبَّه لها.
          </p>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={!dirty}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-xs font-bold"
        >
          <Save className="w-4 h-4" />
          حفظ الإعدادات
        </button>
      </div>

      {/* Devices */}
      <section className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3" aria-label="الأجهزة والبريد">
        <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
          <Smartphone className="w-4 h-4 text-blue-600" />
          الأجهزة والبريد
        </h2>
        {deliveryError && <p className="text-xs text-rose-600">{deliveryError}</p>}
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="p-3 rounded-xl border border-slate-200 space-y-2">
            <p className="text-xs font-bold text-slate-700">تنبيهات هذا الجهاز (هاتف / حاسوب)</p>
            {!support.ok ? (
              <p className="text-[11px] text-amber-700 leading-relaxed">{support.reason}</p>
            ) : thisRegistered ? (
              <div className="flex flex-wrap gap-2">
                <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1">مفعّلة على هذا الجهاز</span>
                <button type="button" disabled={!!busy} onClick={() => run('test-push', () => apiService.sendTestNotification('push'), 'أُرسل تنبيه تجريبي')} className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-lg border border-slate-200 hover:bg-slate-50">
                  <Send className="w-3 h-3" /> تجربة
                </button>
                <button type="button" disabled={!!busy} onClick={() => run('off', disablePush, 'أُوقفت التنبيهات على هذا الجهاز')} className="text-[11px] font-bold px-2 py-1 rounded-lg border border-slate-200 hover:bg-slate-50 text-rose-600">
                  إيقاف
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={!delivery || !!busy}
                onClick={() => run('on', () => enablePush(delivery!.publicKey), 'فُعّلت التنبيهات على هذا الجهاز')}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white text-xs font-bold"
              >
                <BellRing className="w-3.5 h-3.5" />
                {busy === 'on' ? 'جارٍ التفعيل...' : 'تفعيل التنبيهات على هذا الجهاز'}
              </button>
            )}
            {delivery && delivery.devices.length > 0 && (
              <ul className="space-y-1 pt-1">
                {delivery.devices.map((d) => (
                  <li key={d.endpoint} className="flex items-center justify-between gap-2 text-[11px] text-slate-600">
                    <span>
                      {deviceName(d.userAgent)}
                      {d.endpoint === thisDevice ? ' (هذا الجهاز)' : ''}
                    </span>
                    <button
                      type="button"
                      aria-label="إزالة الجهاز"
                      onClick={() => run('rm', () => apiService.removePushSubscription(d.endpoint), 'أُزيل الجهاز')}
                      className="p-1 rounded hover:bg-rose-50 text-slate-400 hover:text-rose-600"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="p-3 rounded-xl border border-slate-200 space-y-2">
            <p className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
              <Mail className="w-3.5 h-3.5 text-slate-500" /> البريد الإلكتروني
            </p>
            <p className="text-[11px] text-slate-600" dir="ltr">
              {delivery?.emailAddress || currentUser.email}
            </p>
            {delivery && !delivery.email ? (
              <p className="text-[11px] text-amber-700">البريد غير مهيأ على الخادم بعد؛ اطلب من مدير النظام ضبط SMTP.</p>
            ) : (
              <button type="button" disabled={!delivery || !!busy} onClick={() => run('test-mail', () => apiService.sendTestNotification('email'), 'أُرسلت رسالة تجريبية إلى بريدك')} className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-lg border border-slate-200 hover:bg-slate-50">
                <Send className="w-3 h-3" /> إرسال رسالة تجريبية
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Categories */}
      <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden" aria-label="ما يصلني">
        <div className="p-4 border-b border-slate-100">
          <h2 className="text-sm font-bold text-slate-800">ما يصلني خارج الجرس</h2>
        </div>
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="text-right p-3 font-bold">النوع</th>
              <th className="p-3 font-bold w-24">الجهاز</th>
              <th className="p-3 font-bold w-24">البريد</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {NOTIFICATION_CATEGORIES.map((c) => (
              <tr key={c.id}>
                <td className="p-3">
                  <p className="font-bold text-slate-800">{c.name}</p>
                  <p className="text-[11px] text-slate-500">{c.hint}</p>
                </td>
                {(['push', 'email'] as const).map((ch) => (
                  <td key={ch} className="p-3 text-center">
                    <input
                      type="checkbox"
                      className="w-4 h-4 accent-blue-600"
                      aria-label={`${c.name} — ${ch === 'push' ? 'الجهاز' : 'البريد'}`}
                      checked={wantsDelivery(prefs, c.id, ch)}
                      onChange={(e) => setChannel(c.id, ch, e.target.checked)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Wires */}
      <section className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3" aria-label="تنبيهات البرقيات">
        <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
          <Radio className="w-4 h-4 text-red-600" />
          البرقيات العاجلة وكلمات المتابعة
        </h2>
        <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
          <input type="checkbox" className="w-4 h-4 accent-red-600" checked={prefs.flashAlerts} onChange={(e) => update({ flashAlerts: e.target.checked })} />
          <Zap className="w-3.5 h-3.5 text-red-600" />
          نبّهني فور وصول برقية عاجلة من أي وكالة
        </label>
        <div>
          <p className="text-xs text-slate-600 mb-2">نبّهني عندما تحوي برقية إحدى هذه الكلمات أو الأسماء (تُطابق دون اعتبار للتشكيل والهمزات):</p>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {prefs.watchWords.map((w) => (
              <span key={w} className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-800 border border-blue-200 rounded-lg px-2 py-1">
                {w}
                <button type="button" aria-label={`حذف ${w}`} onClick={() => update({ watchWords: prefs.watchWords.filter((x) => x !== w) })}>
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
            {!prefs.watchWords.length && <span className="text-[11px] text-slate-400">لا كلمات بعد</span>}
          </div>
          <div className="flex gap-2">
            <input
              value={word}
              onChange={(e) => setWord(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addWord();
                }
              }}
              maxLength={60}
              placeholder="مثال: الخرطوم، وزير الطاقة، أوبك"
              aria-label="كلمة متابعة"
              className="flex-1 px-3 py-2 rounded-xl border border-slate-200 text-xs"
            />
            <button type="button" onClick={addWord} className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-bold">
              <Plus className="w-3.5 h-3.5" /> إضافة
            </button>
          </div>
        </div>
      </section>

      {/* Quiet hours */}
      <section className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2" aria-label="ساعات الهدوء">
        <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
          <Moon className="w-4 h-4 text-indigo-600" />
          ساعات الهدوء
        </h2>
        <p className="text-[11px] text-slate-500">لا يصلك بريد أو تنبيه جهاز في هذه الساعات (بتوقيت الخادم) إلا للعاجل؛ يبقى كل شيء في الجرس.</p>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span>من</span>
          <input type="time" aria-label="بداية ساعات الهدوء" value={prefs.quietFrom || ''} onChange={(e) => update({ quietFrom: e.target.value })} className="px-2 py-1.5 rounded-lg border border-slate-200" />
          <span>إلى</span>
          <input type="time" aria-label="نهاية ساعات الهدوء" value={prefs.quietTo || ''} onChange={(e) => update({ quietTo: e.target.value })} className="px-2 py-1.5 rounded-lg border border-slate-200" />
          {(prefs.quietFrom || prefs.quietTo) && (
            <button type="button" onClick={() => update({ quietFrom: '', quietTo: '' })} className="text-[11px] text-slate-500 underline">
              بلا ساعات هدوء
            </button>
          )}
        </div>
      </section>

      {dirty && (
        <div role="region" aria-label="حفظ التغييرات" className="sticky bottom-4 z-30 flex items-center justify-between gap-3 p-3 rounded-2xl bg-slate-900 text-white shadow-xl">
          <span className="text-xs font-bold">لديك تغييرات لم تُحفظ بعد</span>
          <button type="button" onClick={save} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold">
            <Save className="w-4 h-4" /> حفظ
          </button>
        </div>
      )}
    </div>
  );
};

export default NotificationSettingsView;
