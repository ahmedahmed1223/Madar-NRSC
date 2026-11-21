import React, { useEffect, useState } from 'react';
import { BellRing, Mail, Moon, Plus, Radio, Save, Send, Smartphone, Trash2, X, Zap } from 'lucide-react';
import type { User } from '../types';
import { apiService } from '../services/api';
import { notify } from '../services/notify';
import { confirmSaved } from '../services/confirmSave';
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
export const NotificationSettingsView: React.FC<{ currentUser: User }> = ({ currentUser }) => <AccountNotificationSettings key={currentUser.id} currentUser={currentUser} />;

function AccountNotificationSettings({ currentUser }: { currentUser: User }) {
  const revision = useLiveData(['notificationPrefs']);
  const [prefs, setPrefs] = useState<NotificationPrefs>(() => apiService.getMyNotificationPrefs());
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [word, setWord] = useState('');
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [deliveryError, setDeliveryError] = useState('');
  const [thisDevice, setThisDevice] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [testStatus, setTestStatus] = useState<{ key: string; ok: boolean; message: string } | null>(null);
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
  useEffect(() => {
    if (!dirty && !saving) setPrefs(apiService.getMyNotificationPrefs());
  }, [revision, dirty, saving]);

  const update = (patch: Partial<NotificationPrefs>) => {
    setPrefs((p) => ({ ...p, ...patch }));
    setDirty(true);
  };
  const setChannel = (cat: NotificationCategory, channel: 'email' | 'push', value: boolean) =>
    update({ channels: { ...prefs.channels, [cat]: { ...DEFAULT_CHANNELS[cat], ...prefs.channels[cat], [channel]: value } } });

  const save = async () => {
    if (saving || !dirty) return;
    setSaving(true);
    try {
      const next = apiService.saveMyNotificationPrefs(prefs);
      if (await confirmSaved('notificationPrefs', next.id, 'حُفظت إعدادات تنبيهاتك')) {
        setPrefs(next);
        setDirty(false);
      }
    } catch (err: any) {
      notify({ type: 'error', title: 'تعذر الحفظ', message: err?.message });
    } finally {
      setSaving(false);
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
    const testing = key === 'test-push' || key === 'test-mail';
    if (testing) setTestStatus(null);
    try {
      await fn();
      if (testing) setTestStatus({ key, ok: true, message: ok });
      notify({ type: 'success', message: ok });
      await loadDelivery();
    } catch (err: any) {
      if (testing) setTestStatus({ key, ok: false, message: err?.message || 'تعذر إرسال التجربة.' });
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
            قنوات البريد والدفع تخص حسابك. تفعيل الدفع أو إيقافه على هذا المتصفح يغيّر اشتراك هذا الجهاز.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!dirty || saving}
          className="inline-flex min-h-11 items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-xs font-bold"
        >
          <Save className="w-4 h-4" />
          {saving ? 'بانتظار تأكيد الخادم…' : 'حفظ الإعدادات'}
        </button>
      </div>

      {/* Devices */}
      <section className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3" aria-label="الأجهزة والبريد">
        <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
          <Smartphone className="w-4 h-4 text-blue-600" />
          الأجهزة والبريد
        </h2>
        {deliveryError && <p role="alert" className="text-xs text-rose-700">{deliveryError}</p>}
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="p-3 rounded-xl border border-slate-200 space-y-2">
            <p className="text-xs font-bold text-slate-700">تنبيهات هذا الجهاز (هاتف / حاسوب)</p>
            {testStatus?.key === 'test-push' && <p role={testStatus.ok ? 'status' : 'alert'} className={`text-xs ${testStatus.ok ? 'text-emerald-800' : 'text-rose-800'}`}>{testStatus.message}</p>}
            {!support.ok ? (
              <p className="text-2xs text-amber-700 leading-relaxed">{support.reason}</p>
            ) : thisRegistered ? (
              <div className="flex flex-wrap gap-2">
                <span className="text-2xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1">مفعّلة على هذا الجهاز</span>
                <button type="button" disabled={!!busy} onClick={() => run('test-push', () => apiService.sendTestNotification('push'), 'قبلت خدمة الدفع إرسال التجربة إلى جهاز مسجل واحد على الأقل.')} className="inline-flex min-h-11 items-center gap-1 text-xs font-bold px-2 rounded-lg border border-slate-200 hover:bg-slate-50">
                  <Send className="w-3 h-3" aria-hidden="true" /> تجربة الدفع لأجهزتي
                </button>
                <button type="button" disabled={!!busy} onClick={() => run('off', disablePush, 'أُوقفت التنبيهات على هذا الجهاز')} className="min-h-11 text-xs font-bold px-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-rose-600">
                  إيقاف
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={!delivery || !!busy}
                onClick={() => run('on', () => enablePush(delivery!.publicKey), 'فُعّلت التنبيهات على هذا الجهاز')}
                className="inline-flex items-center gap-1.5 min-h-10 px-3 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-xs font-bold"
              >
                <BellRing className="w-3.5 h-3.5" />
                {busy === 'on' ? 'جارٍ التفعيل...' : 'تفعيل التنبيهات على هذا الجهاز'}
              </button>
            )}
            {delivery && delivery.devices.length > 0 && (
              <ul className="space-y-1 pt-1">
                {delivery.devices.map((d) => (
                  <li key={d.endpoint} className="flex items-center justify-between gap-2 text-2xs text-slate-600">
                    <span>
                      {deviceName(d.userAgent)}
                      {d.endpoint === thisDevice ? ' (هذا الجهاز)' : ''}
                    </span>
                    <button
                      type="button"
                      aria-label={`إزالة الجهاز ${deviceName(d.userAgent)}`}
                      disabled={!!busy}
                      onClick={() => run('rm', () => apiService.removePushSubscription(d.endpoint), 'أُزيل الجهاز')}
                      className="grid size-11 place-items-center rounded hover:bg-rose-50 text-slate-600 hover:text-rose-700"
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
            <p className="text-2xs text-slate-600" dir="ltr">
              {delivery?.emailAddress || currentUser.email}
            </p>
            {testStatus?.key === 'test-mail' && <p role={testStatus.ok ? 'status' : 'alert'} className={`text-xs ${testStatus.ok ? 'text-emerald-800' : 'text-rose-800'}`}>{testStatus.message}</p>}
            {delivery && !delivery.email ? (
              <p className="text-2xs text-amber-700">البريد غير مهيأ على الخادم بعد؛ اطلب من مدير النظام ضبط SMTP.</p>
            ) : (
              <button type="button" disabled={!delivery || !!busy} onClick={() => run('test-mail', () => apiService.sendTestNotification('email'), 'قبل خادم البريد الرسالة التجريبية.')} className="inline-flex min-h-11 items-center gap-1 text-xs font-bold px-2 rounded-lg border border-slate-200 hover:bg-slate-50">
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
                  <p className="text-2xs text-slate-500">{c.hint}</p>
                </td>
                {(['push', 'email'] as const).map((ch) => (
                  <td key={ch} className="p-3 text-center">
                    <label className="inline-grid size-11 place-items-center cursor-pointer"><input
                      type="checkbox"
                      className="w-4 h-4 accent-blue-600"
                      aria-label={`${c.name} — ${ch === 'push' ? 'الجهاز' : 'البريد'}`}
                      disabled={saving}
                      checked={wantsDelivery(prefs, c.id, ch)}
                      onChange={(e) => setChannel(c.id, ch, e.target.checked)}
                    /></label>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Wires */}
      <section className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3" aria-label="تنبيهات المصادر">
        <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
          <Radio className="w-4 h-4 text-red-600" />
          المواد العاجلة وكلمات المتابعة
        </h2>
        <label className="flex min-h-11 items-center gap-2 text-xs font-bold text-slate-700">
          <input type="checkbox" className="w-4 h-4 accent-red-600" disabled={saving} checked={prefs.flashAlerts} onChange={(e) => update({ flashAlerts: e.target.checked })} />
          <Zap className="w-3.5 h-3.5 text-red-600" />
          نبّهني فور وصول مادة عاجلة من أي وكالة
        </label>
        <div>
          <p className="text-xs text-slate-600 mb-2">نبّهني عندما تحوي مادة إحدى هذه الكلمات أو الأسماء (تُطابق دون اعتبار للتشكيل والهمزات):</p>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {prefs.watchWords.map((w) => (
              <span key={w} className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-800 border border-blue-200 rounded-lg px-2 py-1">
                {w}
                <button type="button" disabled={saving} className="grid size-11 place-items-center rounded" aria-label={`حذف ${w}`} onClick={() => update({ watchWords: prefs.watchWords.filter((x) => x !== w) })}>
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
            {!prefs.watchWords.length && <span className="text-2xs text-slate-500">لا كلمات بعد</span>}
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
              disabled={saving}
              placeholder="مثال: الخرطوم، وزير الطاقة، أوبك"
              aria-label="كلمة متابعة"
              className="min-h-11 min-w-0 flex-1 px-3 py-2 rounded-xl border border-slate-200 text-xs"
            />
            <button type="button" disabled={saving} onClick={addWord} className="inline-flex min-h-11 items-center gap-1 px-3 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-bold">
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
        <p className="text-2xs text-slate-500">لا يصلك بريد أو تنبيه جهاز في هذه الساعات (بتوقيت المحطة المضبوط في الإعدادات) إلا للعاجل؛ يبقى كل شيء في الجرس.</p>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span>من</span>
          <input type="time" disabled={saving} aria-label="بداية ساعات الهدوء" value={prefs.quietFrom || ''} onChange={(e) => update({ quietFrom: e.target.value })} className="min-h-11 px-2 py-1.5 rounded-lg border border-slate-200" />
          <span>إلى</span>
          <input type="time" disabled={saving} aria-label="نهاية ساعات الهدوء" value={prefs.quietTo || ''} onChange={(e) => update({ quietTo: e.target.value })} className="min-h-11 px-2 py-1.5 rounded-lg border border-slate-200" />
          {(prefs.quietFrom || prefs.quietTo) && (
            <button type="button" disabled={saving} onClick={() => update({ quietFrom: '', quietTo: '' })} className="min-h-11 px-2 text-xs text-slate-600 underline">
              بلا ساعات هدوء
            </button>
          )}
        </div>
      </section>

      {dirty && (
        <div role="region" aria-label="حفظ التغييرات" className="sticky bottom-4 z-30 flex items-center justify-between gap-3 p-3 rounded-2xl bg-slate-900 text-white shadow-xl">
          <span role="status" className="text-xs font-bold">{saving ? 'بانتظار تأكيد الخادم' : 'لديك تغييرات لم تُحفظ بعد'}</span>
          <button type="button" disabled={saving} onClick={() => void save()} className="inline-flex min-h-11 items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold">
            <Save className="w-4 h-4" /> حفظ
          </button>
        </div>
      )}
    </div>
  );
};

export default NotificationSettingsView;
