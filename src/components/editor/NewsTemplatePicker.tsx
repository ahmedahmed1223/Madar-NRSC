import { useState } from 'react';
import { FileText, RotateCcw } from 'lucide-react';
import { apiService } from '../../services/api';
import { confirmDialog } from '../../services/dialogs';

export function NewsTemplatePicker({ content, onChange, disabled }: { content: string; onChange: (value: string) => void; disabled: boolean }) {
  const templates = apiService.getSettings().newsTemplates || [];
  const [selected, setSelected] = useState('');
  const [undo, setUndo] = useState<{ before: string; applied: string } | null>(null);
  const apply = async () => {
    const template = templates.find(item => item.id === selected);
    if (!template || disabled) return;
    if (new DOMParser().parseFromString(content, 'text/html').body.textContent?.trim() && !await confirmDialog({ title: 'استبدال النص بالقالب', message: 'سيُستبدل نص الخبر فقط، دون تغيير العنوان أو حالة الخبر. تطبيق القالب؟', confirmLabel: 'تطبيق القالب' })) return;
    const container = document.createElement('div');
    for (const line of template.body.split('\n')) { const paragraph = document.createElement('p'); paragraph.textContent = line; container.append(paragraph); }
    const applied = container.innerHTML;
    setUndo({ before: content, applied }); onChange(applied);
  };
  if (!templates.length) return null;
  return <div className="flex flex-wrap gap-2 items-center w-full">
    <label htmlFor="news-template-picker" className="text-sm">قالب الخبر</label>
    <select id="news-template-picker" disabled={disabled} value={selected} onChange={e => setSelected(e.target.value)} className="min-h-11 min-w-0 max-w-full px-3 border border-slate-300 rounded-lg"><option value="">اختر قالباً</option>{templates.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
    <button type="button" disabled={disabled || !templates.some(item => item.id === selected)} onClick={() => void apply()} className="min-h-11 px-3 inline-flex items-center gap-2 text-blue-700 disabled:opacity-50"><FileText className="w-4 h-4" />تطبيق القالب</button>
    {undo && <button type="button" disabled={disabled} title="تراجع عن تطبيق القالب" aria-label="تراجع عن تطبيق القالب" onClick={async () => {
      if (content !== undo.applied && !await confirmDialog({ title: 'التراجع عن القالب', message: 'أُجريت تعديلات بعد تطبيق القالب. الرجوع للنص السابق سيزيل هذه التعديلات. متابعة؟', confirmLabel: 'استعادة النص السابق' })) return;
      onChange(undo.before); setUndo(null);
    }} className="w-11 h-11 flex items-center justify-center text-slate-700"><RotateCcw className="w-4 h-4" /></button>}
  </div>;
}
