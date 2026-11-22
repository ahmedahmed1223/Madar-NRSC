import { useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { SINGLETON_ID } from '../../shared/collections';
import { editorialPublishingError, emptyEditorialPublishing, MAX_STYLEBOOK_TERMS, type StylebookRules } from '../../shared/editorialStylebook';
import { apiService } from '../../services/api';
import { confirmSaved } from '../../services/confirmSave';

const field = 'block w-full min-h-11 mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white';
const read = () => apiService.getSettings().editorialPublishing ?? emptyEditorialPublishing();

export function EditorialPublishingSettings() {
  const [baseline, setBaseline] = useState(read);
  const [stylebook, setStylebook] = useState(baseline.stylebook);
  const [tags, setTags] = useState(() => baseline.preferredTags.join(' '));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const preferredTags = [...new Set(tags.split(/[\s,،]+/).filter(Boolean).map(tag => tag.startsWith('#') ? tag : `#${tag}`))];
  const next = { preferredTags, stylebook };
  const dirty = JSON.stringify(next) !== JSON.stringify(baseline);
  const update = <K extends keyof StylebookRules>(key: K, value: StylebookRules[K]) => {
    setStylebook(previous => ({ ...previous, [key]: value }));
    setError('');
  };

  const save = async () => {
    if (saving || !dirty) return;
    if (JSON.stringify(read()) !== JSON.stringify(baseline)) {
      setError('تغيّر دليل الأسلوب لدى زميل آخر. أعد فتح الإعدادات لمراجعة النسخة الحالية.');
      return;
    }
    const problem = editorialPublishingError(next);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError('');
    try {
      apiService.saveSettings({ editorialPublishing: next });
      if (await confirmSaved('settings', SINGLETON_ID, 'حُفظ دليل الأسلوب والوسوم')) setBaseline(next);
      else setError('بانتظار تأكيد الخادم. أعد المحاولة إذا لم تُحفظ التغييرات.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذّر حفظ دليل الأسلوب');
    } finally {
      setSaving(false);
    }
  };

  return <section className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4" aria-labelledby="editorial-stylebook-settings">
    <h2 id="editorial-stylebook-settings" className="font-bold text-slate-900">دليل الأسلوب والنشر الرقمي</h2>
    <fieldset disabled={saving} className="space-y-4">
      <label className="block text-sm font-medium">
        الوسوم المفضلة لـ X وTelegram
        <input className={field} value={tags} maxLength={1500} onChange={event => setTags(event.target.value)} placeholder="#الأخبار #غرفة_الأخبار" />
      </label>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="block text-sm font-medium">
          كتابة الأرقام
          <select className={field} value={stylebook.numbers} onChange={event => update('numbers', event.target.value as StylebookRules['numbers'])}>
            <option value="keep">دون قاعدة</option><option value="latn">123</option><option value="arab">١٢٣</option>
          </select>
        </label>
        <label className="block text-sm font-medium">
          صيغة التاريخ الرقمي
          <select className={field} value={stylebook.dates} onChange={event => update('dates', event.target.value as StylebookRules['dates'])}>
            <option value="keep">دون قاعدة</option><option value="dmy">22/11/2026</option><option value="iso">2026-11-22</option>
          </select>
        </label>
        <label className="block text-sm font-medium">
          موضع رمز العملة الدولي
          <select className={field} value={stylebook.currencies} onChange={event => update('currencies', event.target.value as StylebookRules['currencies'])}>
            <option value="keep">دون قاعدة</option><option value="code-before">USD 100</option><option value="code-after">100 USD</option>
          </select>
        </label>
      </div>
      <div className="space-y-2">
        <h3 className="font-semibold text-sm">العبارات الممنوعة والبدائل</h3>
        {stylebook.terms.map((rule, index) => <div key={index} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2">
          <label className="text-xs font-medium">العبارة {index + 1}
            <input className={field} value={rule.term} maxLength={80} onChange={event => update('terms', stylebook.terms.map((item, at) => at === index ? { ...item, term: event.target.value } : item))} />
          </label>
          <label className="text-xs font-medium">البديل {index + 1}
            <input className={field} value={rule.replacement} maxLength={120} onChange={event => update('terms', stylebook.terms.map((item, at) => at === index ? { ...item, replacement: event.target.value } : item))} placeholder="اتركه فارغاً للحذف" />
          </label>
          <button type="button" aria-label={`إزالة قاعدة العبارة ${index + 1}`} className="size-11 grid place-items-center rounded-lg text-rose-700 hover:bg-rose-50" onClick={() => update('terms', stylebook.terms.filter((_, at) => at !== index))}>
            <Trash2 className="size-4" aria-hidden="true" />
          </button>
        </div>)}
        <button type="button" disabled={stylebook.terms.length >= MAX_STYLEBOOK_TERMS} onClick={() => update('terms', [...stylebook.terms, { term: '', replacement: '' }])}
          className="inline-flex min-h-11 items-center gap-1.5 px-2 text-sm font-semibold text-blue-700 disabled:opacity-50">
          <Plus className="size-4" aria-hidden="true" /> إضافة قاعدة عبارة
        </button>
      </div>
    </fieldset>
    {error && <p role="alert" className="text-xs text-rose-700">{error}</p>}
    <button type="button" disabled={saving || !dirty} onClick={() => void save()} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-blue-700 px-3 text-sm font-semibold text-white disabled:opacity-50">
      <Save className="size-4" aria-hidden="true" /> {saving ? 'جارٍ الحفظ…' : 'حفظ دليل الأسلوب والوسوم'}
    </button>
  </section>;
}
