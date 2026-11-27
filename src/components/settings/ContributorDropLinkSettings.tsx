import { useState } from 'react';
import { Link2 } from 'lucide-react';
import { apiService } from '../../services/api';
import { dataStore } from '../../services/dataStore';
import { SINGLETON_ID } from '../../shared/collections';
import { contributorDropLinkSettings, contributorDropLinkSettingsError, MAX_CONTRIBUTOR_DROP_LINKS_PER_DAY, MAX_CONTRIBUTOR_DROP_LINK_EXPIRY_HOURS } from '../../shared/contributorDropLinkSettings';

const currentPolicy = () => contributorDropLinkSettings(apiService.getSettings());

export function ContributorDropLinkSettings() {
  const [baseline, setBaseline] = useState(currentPolicy);
  const [dailyLimit, setDailyLimit] = useState(String(baseline.dailyLimit));
  const [expiryHours, setExpiryHours] = useState(String(baseline.expiryHours));
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const changed = dailyLimit !== String(baseline.dailyLimit) || expiryHours !== String(baseline.expiryHours);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!changed || busy) return;
    const policy = {
      contributorDropLinkDailyLimit: Number(dailyLimit),
      contributorDropLinkExpiryHours: Number(expiryHours),
    };
    const error = contributorDropLinkSettingsError(policy);
    if (error) {
      setFeedback({ ok: false, text: error });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const latest = currentPolicy();
      if (latest.dailyLimit !== baseline.dailyLimit || latest.expiryHours !== baseline.expiryHours) {
        setBaseline(latest);
        setDailyLimit(String(latest.dailyLimit));
        setExpiryHours(String(latest.expiryHours));
        throw new Error('غيّر زميل إعدادات الروابط. راجع القيم الحالية ثم أعد الحفظ.');
      }
      apiService.saveSettings(policy);
      const result = await dataStore.awaitWrite('settings', SINGLETON_ID);
      if (!result.ok) throw new Error(result.message || 'لم يؤكد الخادم حفظ إعدادات الروابط.');
      const saved = contributorDropLinkSettings(policy);
      setBaseline(saved);
      setDailyLimit(String(saved.dailyLimit));
      setExpiryHours(String(saved.expiryHours));
      setFeedback({ ok: true, text: 'حُفظت إعدادات روابط الرفع.' });
    } catch (reason) {
      setFeedback({ ok: false, text: reason instanceof Error ? reason.message : 'تعذّر حفظ إعدادات روابط الرفع.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} aria-labelledby="drop-link-settings-title" className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
      <h3 id="drop-link-settings-title" className="flex items-center gap-2 text-sm font-bold text-slate-900">
        <Link2 className="size-4 text-blue-600" aria-hidden="true" /> روابط رفع المتعاونين
      </h3>
      <p className="mt-2 text-sm text-slate-600">يقبل كل رابط ملف فيديو أو صوت واحدًا. تسري مدة الصلاحية الجديدة على الروابط التي تُنشأ بعد الحفظ.</p>
      <fieldset disabled={busy} className="mt-4 grid max-w-2xl gap-4 sm:grid-cols-2">
        <label className="space-y-1 text-sm font-medium text-slate-800">
          <span className="block">عدد الروابط لكل مستخدم خلال 24 ساعة</span>
          <input type="number" inputMode="numeric" min={0} max={MAX_CONTRIBUTOR_DROP_LINKS_PER_DAY} step={1} required dir="ltr"
            aria-describedby="drop-link-limit-help" value={dailyLimit} onChange={event => setDailyLimit(event.target.value)}
            className="min-h-11 w-full rounded-lg border border-slate-300 px-3 text-slate-900" />

        </label>
        <label className="space-y-1 text-sm font-medium text-slate-800">
          <span className="block">صلاحية الرابط بالساعات</span>
          <input type="number" inputMode="numeric" min={1} max={MAX_CONTRIBUTOR_DROP_LINK_EXPIRY_HOURS} step={1} required dir="ltr"
            value={expiryHours} onChange={event => setExpiryHours(event.target.value)}
            className="min-h-11 w-full rounded-lg border border-slate-300 px-3 text-slate-900" />
        </label>
      </fieldset>
      <p id="drop-link-limit-help" className="mt-2 text-xs text-slate-600">أدخل 0 لإيقاف إنشاء روابط جديدة.</p>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy || !changed} className="min-h-11 rounded-lg bg-blue-600 px-4 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60">
          {busy ? 'جارٍ الحفظ…' : 'حفظ إعدادات الروابط'}
        </button>
        {feedback && <p role={feedback.ok ? 'status' : 'alert'} className={feedback.ok ? 'text-sm text-emerald-800' : 'text-sm text-rose-800'}>{feedback.text}</p>}
      </div>
    </form>
  );
}
