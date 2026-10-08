import { useState } from 'react';
import { Save } from 'lucide-react';
import { apiService } from '../../services/api';
import { dataStore } from '../../services/dataStore';
import { SINGLETON_ID } from '../../shared/collections';
import { airDisplayDefault, type AirDisplayMode } from '../../shared/airDisplay';
import { useFormDraft } from '../../hooks/useFormDraft';
import { DraftStatus } from '../common/DraftStatus';

export function AirDisplaySettings() {
  const [values, setValues] = useState(() => ({ onAirDisplayMode: airDisplayDefault(apiService.getSettings(), 'onAir'), studioDisplayMode: airDisplayDefault(apiService.getSettings(), 'studio'), allowOfflineScriptEdits: !!apiService.getSettings().allowOfflineScriptEdits }));
  const [baseline, setBaseline] = useState(values);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const draft = useFormDraft(`air-display:${apiService.getCurrentUser().id}`, true, values, setValues);
  const dirty = JSON.stringify(values) !== JSON.stringify(baseline);
  return <section className="py-4 space-y-4" aria-label="إعدادات عرض الهواء">
    <h2 className="text-lg font-bold">عرض الهواء</h2>
    <DraftStatus draft={draft} />
    <form onSubmit={async e => {
      e.preventDefault(); if (saving) return;
      const latest = apiService.getSettings();
      if (!!latest.allowOfflineScriptEdits !== baseline.allowOfflineScriptEdits) { setError('تغير خيار التعديل المحلي؛ أعد فتح الإعدادات'); return; }
      if (airDisplayDefault(latest, 'onAir') !== baseline.onAirDisplayMode || airDisplayDefault(latest, 'studio') !== baseline.studioDisplayMode) { setError('تغيرت خيارات العرض لدى زميل آخر؛ أعد فتح الإعدادات لمراجعتها.'); return; }
      setSaving(true); setSaved(false); setError('');
      try {
        apiService.saveSettings(values);
        const result = await dataStore.awaitWrite('settings', SINGLETON_ID);
        if (!result.ok) throw new Error(result.message || 'لم يؤكد الخادم الحفظ');
        setBaseline(values); draft.clearDraft(); setSaved(true);
      } catch (err) { setError(err instanceof Error ? err.message : 'تعذر حفظ الإعدادات'); }
      finally { setSaving(false); }
    }} className="space-y-4">
      <fieldset disabled={saving} className="grid sm:grid-cols-2 gap-4">
        {([{ key: 'onAirDisplayMode', label: 'عرض الكنترول الافتراضي' }, { key: 'studioDisplayMode', label: 'عرض الاستديو الافتراضي' }] as const).map(item => <label key={item.key} className="block text-sm">{item.label}<select aria-label={item.label} value={values[item.key]} onChange={e => { setValues(old => ({ ...old, [item.key]: e.target.value as AirDisplayMode })); setSaved(false); }} className="mt-1 w-full min-h-11 px-3 border border-slate-300 rounded-lg bg-white"><option value="OPERATIONAL">تشغيلي</option><option value="TEXT">نص المذيع</option></select></label>)}
      </fieldset>
      <label className="flex items-center gap-2 min-h-11 text-sm"><input type="checkbox" disabled={saving} checked={!!values.allowOfflineScriptEdits} onChange={e => { setValues(old => ({ ...old, allowOfflineScriptEdits: e.target.checked })); setSaved(false); }}/>السماح بتعديل نسخة النص محلياً دون اتصال</label>
      {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      {saved && <p role="status" className="text-sm text-emerald-700">حُفظت إعدادات العرض</p>}
      <div className="flex flex-wrap gap-3"><button type="submit" disabled={!dirty || saving} className="min-h-11 px-4 rounded-lg bg-blue-600 text-white inline-flex items-center gap-2 disabled:opacity-50"><Save className="w-4 h-4" />{saving ? 'جارٍ الحفظ...' : 'حفظ إعدادات العرض'}</button><button type="button" disabled={saving} onClick={() => { setValues({ onAirDisplayMode: 'OPERATIONAL', studioDisplayMode: 'TEXT', allowOfflineScriptEdits: false }); setError(''); setSaved(false); }} className="min-h-11 px-3 text-blue-700">استعادة العرض الافتراضي</button></div>
    </form>
  </section>;
}
