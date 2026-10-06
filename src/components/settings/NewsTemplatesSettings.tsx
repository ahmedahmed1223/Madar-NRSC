import { useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { apiService } from '../../services/api';
import { confirmSaved } from '../../services/confirmSave';
import { confirmDialog } from '../../services/dialogs';
import { newId } from '../../shared/ids';
import { settingsError } from '../../shared/settings';
import { SINGLETON_ID } from '../../shared/collections';
import { useFormDraft } from '../../hooks/useFormDraft';
import { DraftStatus } from '../common/DraftStatus';

export function NewsTemplatesSettings() {
  const [templates, setTemplates] = useState(() => apiService.getSettings().newsTemplates || []);
  const [baseline, setBaseline] = useState(templates);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const draft = useFormDraft(`news-templates:${apiService.getCurrentUser().id}`, true, templates, recovered => {
    if (Array.isArray(recovered) && recovered.every(item => item && typeof item.id === 'string' && typeof item.name === 'string' && typeof item.body === 'string')) setTemplates(recovered);
  });
  const dirty = JSON.stringify(templates) !== JSON.stringify(baseline);
  const save = async () => {
    if (saving) return;
    if (JSON.stringify(apiService.getSettings().newsTemplates || []) !== JSON.stringify(baseline)) {
      setError('تغيرت القوالب لدى زميل آخر. أعد فتح الإعدادات وراجع النسخة الحالية قبل الحفظ؛ مسودتك محفوظة على هذا الجهاز.');
      return;
    }
    const problem = settingsError({ ...apiService.getSettings(), newsTemplates: templates });
    if (problem) { setError(problem); return; }
    if (baseline.some(item => !templates.some(next => next.id === item.id)) && !await confirmDialog({ title: 'حذف قوالب أخبار', message: 'سيختفي القالب من الخيارات لدى الزملاء، دون تغيير الأخبار المكتوبة سابقاً. اعتماد الحذف؟', confirmLabel: 'اعتماد الحذف', danger: true })) return;
    setSaving(true); setError('');
    try {
      apiService.saveSettings({ newsTemplates: templates });
      if (await confirmSaved('settings', SINGLETON_ID, 'تم حفظ قوالب الأخبار')) { setBaseline(templates); draft.clearDraft(); }
      else setError('لم يؤكد الخادم الحفظ. بقيت القوالب المدخلة؛ أعد المحاولة.');
    } catch (err) { setError(err instanceof Error ? err.message : 'تعذر حفظ القوالب'); }
    finally { setSaving(false); }
  };
  return <section className="space-y-4 border-t border-slate-200 pt-5" aria-label="قوالب الأخبار">
    <h2 className="text-lg font-bold">قوالب الأخبار</h2>
    <DraftStatus draft={draft} />
    <fieldset disabled={saving} aria-label="تحرير قوالب الأخبار" className="space-y-4">
      {templates.length === 0 && <p className="text-sm text-slate-600">لا توجد قوالب أخبار مخصصة</p>}
      {templates.map((template, index) => <div key={template.id} className="space-y-2 border-b border-slate-200 pb-4">
        <div className="flex gap-2 items-end">
          <label className="flex-1 min-w-0 text-sm">اسم القالب {index + 1}<input maxLength={80} value={template.name} onChange={e => setTemplates(items => items.map(item => item.id === template.id ? { ...item, name: e.target.value } : item))} className="block w-full min-h-11 px-3 border border-slate-300 rounded-lg mt-1" /></label>
          <button type="button" title={`حذف القالب ${index + 1}`} aria-label={`حذف القالب ${index + 1}`} onClick={() => setTemplates(items => items.filter(item => item.id !== template.id))} className="w-11 h-11 flex items-center justify-center text-rose-700"><Trash2 className="w-4 h-4" /></button>
        </div>
        <label className="block text-sm">نص القالب {index + 1}<textarea rows={6} maxLength={20000} value={template.body} onChange={e => setTemplates(items => items.map(item => item.id === template.id ? { ...item, body: e.target.value } : item))} className="block w-full p-3 border border-slate-300 rounded-lg mt-1" /></label>
      </div>)}
      <button type="button" disabled={templates.length >= 20} onClick={() => setTemplates(items => [...items, { id: newId('template'), name: '', body: '' }])} className="min-h-11 flex items-center gap-2 text-blue-700 disabled:opacity-50"><Plus className="w-4 h-4" />إضافة قالب أخبار</button>
    </fieldset>
    {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
    <div className="flex flex-wrap gap-3">
      <button type="button" disabled={!dirty || saving} onClick={() => void save()} className="min-h-11 px-4 rounded-lg bg-blue-600 text-white inline-flex items-center gap-2 disabled:opacity-50"><Save className="w-4 h-4" />{saving ? 'جارٍ الحفظ...' : 'حفظ قوالب الأخبار'}</button>
      <button type="button" disabled={!dirty || saving} onClick={() => { setTemplates(baseline); setError(''); }} className="min-h-11 px-3 text-slate-700">إلغاء تغييرات القوالب</button>
    </div>
  </section>;
}
