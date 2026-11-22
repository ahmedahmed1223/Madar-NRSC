import { useId, useMemo, useState } from 'react';
import { Check, ClipboardCopy, Download, FileCheck, Save } from 'lucide-react';
import { DIGITAL_FIELDS, digitalLength, hasDigitalCopy, type DigitalCopy } from '../../shared/digitalPublishing';
import { lintStylebook, lintStylebookHtml, replaceStylebookFinding, type EditorialPublishingSettings, type StylebookRules } from '../../shared/editorialStylebook';
import { plainText } from '../../shared/newsWorkflow';
import { notify } from '../../services/notify';

type EditorialField = { label: string; text: string; html?: boolean; change: (text: string) => void };

function StylebookReview({ fields, rules, readOnly }: { fields: EditorialField[]; rules: StylebookRules; readOnly: boolean }) {
  const findings = useMemo(() => fields.flatMap(field => {
    if (field.html) return lintStylebookHtml(field.text, rules).map(issue => ({ ...issue, field: field.label, fix: () => field.change(issue.apply()) }));
    return lintStylebook(field.text, rules).map(issue => ({ ...issue, field: field.label, fix: () => field.change(replaceStylebookFinding(field.text, issue)) }));
  }), [fields, rules]);
  return <div className="space-y-3">
    {findings.length === 0 && <p className="text-sm text-slate-600">لا ملاحظات وفق دليل الأسلوب الحالي.</p>}
    <ul className="divide-y divide-slate-100">
      {findings.map((issue, index) => (
        <li key={`${issue.field}-${index}-${issue.start}`} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
          <div className="min-w-0">
            <p className="text-xs text-slate-600">{issue.field} · {issue.label}</p>
            <u className="break-words font-semibold decoration-wavy decoration-amber-700 underline-offset-4">{issue.original}</u>
            <span className="ms-2 text-slate-700">{issue.replacement ? `← ${issue.replacement}` : '← حذف العبارة'}</span>
          </div>
          {!readOnly && <button type="button" onClick={issue.fix} className="min-h-11 rounded-lg border border-blue-200 px-3 text-xs font-semibold text-blue-700 hover:bg-blue-50">
            {issue.replacement ? 'استبدال' : 'حذف العبارة'}<span className="sr-only"> «{issue.original}»</span>
          </button>}
        </li>
      ))}
    </ul>
  </div>;
}

function shorter(text: string, limit: number) {
  const characters = Array.from(text);
  if (characters.length <= limit) return text;
  const trimmed = characters.slice(0, limit - 1).join('');
  return `${trimmed.replace(/\s+\S*$/, '') || trimmed}…`;
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    notify({ type: 'success', message: 'نُسخ النص' });
  } catch {
    notify({ type: 'error', message: 'تعذّر الوصول إلى الحافظة' });
  }
}

function downloadPackage(draft: DigitalCopy) {
  const text = DIGITAL_FIELDS.filter(({ key }) => draft[key].trim()).map(({ key, label }) => `${label}\n${draft[key].trim()}`).join('\n\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'حزمة-النشر.txt';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

type Props = {
  fields: EditorialField[];
  copy: DigitalCopy;
  settings: EditorialPublishingSettings;
  readOnly: boolean;
  saving: boolean;
  approved: boolean;
  canCopy: boolean;
  canApprove: boolean;
  canSave: boolean;
  onChange: (value: DigitalCopy) => void;
  onSave: () => void;
  onApprove: () => void;
};

export function EditorialPublishingPanel(props: Props) {
  const { fields, copy: draft, settings, readOnly, saving, approved, canCopy, canApprove, canSave, onChange, onSave, onApprove } = props;
  const [tab, setTab] = useState<'digital' | 'stylebook'>('digital');
  const id = useId();
  const fill = () => {
    const [headline, strap, summary, body] = fields.map(field => field.html ? plainText(field.text) : field.text.trim());
    const title = strap || headline;
    const brief = summary || body || headline;
    const next = { ...draft };
    for (const { key, limit } of DIGITAL_FIELDS) {
      if (key !== 'youtubeChapters' && !next[key]) next[key] = shorter(key === 'x' || key === 'youtubeTitle' ? title : brief, limit);
    }
    onChange(next);
  };
  return <details className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
    <summary className="min-h-10 cursor-pointer font-bold text-sm text-slate-800">النشر الرقمي ودليل الأسلوب</summary>
    <div className="flex flex-wrap gap-1 border-b border-slate-200" role="tablist" aria-label="أدوات التحرير الرقمي">
      {(['digital', 'stylebook'] as const).map(item => <button key={item} type="button" role="tab" id={`${id}-tab-${item}`} aria-selected={tab === item} aria-controls={`${id}-panel-${item}`} tabIndex={tab === item ? 0 : -1}
        onClick={() => setTab(item)}
        onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === 'Home' ? 'digital' : event.key === 'End' ? 'stylebook' : item === 'digital' ? 'stylebook' : 'digital';
          setTab(next);
          document.getElementById(`${id}-tab-${next}`)?.focus();
        }}
        className={`min-h-11 px-3 text-sm font-semibold border-b-2 ${item === tab ? 'border-blue-600 text-blue-800' : 'border-transparent text-slate-600 hover:bg-slate-50'}`}>
        {item === 'digital' ? 'حزمة النشر' : 'دليل الأسلوب'}
      </button>)}
    </div>
    <div role="tabpanel" id={`${id}-panel-stylebook`} aria-labelledby={`${id}-tab-stylebook`} hidden={tab !== 'stylebook'}>
      {tab === 'stylebook' && <StylebookReview fields={fields} rules={settings.stylebook} readOnly={readOnly || saving} />}
    </div>
    <div role="tabpanel" id={`${id}-panel-digital`} aria-labelledby={`${id}-tab-digital`} hidden={tab !== 'digital'} className="space-y-4">
      {tab === 'digital' && <>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p role="status" className={`text-sm font-medium ${approved ? 'text-emerald-700' : 'text-slate-600'}`}>
            {approved ? 'حزمة معتمدة للنشر الرقمي' : 'تُعتمد الحزمة بعد اعتماد الخبر تحريرياً'}
          </p>
          {approved && canCopy && hasDigitalCopy(draft) && <button type="button" onClick={() => downloadPackage(draft)} className="inline-flex min-h-11 items-center gap-1.5 px-3 rounded-lg border border-blue-200 text-xs font-semibold text-blue-700">
            <Download className="size-4" aria-hidden="true" /> تنزيل حزمة النشر
          </button>}
          {!readOnly && <button type="button" disabled={saving} onClick={fill} className="min-h-11 px-3 rounded-lg border border-slate-300 text-xs font-semibold disabled:opacity-50">تعبئة الحقول الفارغة من الخبر</button>}
        </div>
        <div className="grid gap-3 xl:grid-cols-2">
          {DIGITAL_FIELDS.map(({ key, label, limit }) => {
            const fieldId = `${id}-${key}`;
            const value = draft[key];
            const count = digitalLength(value);
            const copyReady = approved && canCopy && !!value.trim();
            const tags = (key === 'x' || key === 'telegram') && !readOnly ? settings.preferredTags : [];
            return <div key={key} className="space-y-1.5 min-w-0 rounded-xl border border-slate-200 p-3">
              <div className="flex items-center justify-between gap-3">
                <label htmlFor={fieldId} className="text-sm font-semibold text-slate-800">{label}</label>
                <span id={`${fieldId}-count`} dir="ltr" className={`text-xs tabular-nums ${count > limit ? 'font-bold text-rose-700' : 'text-slate-600'}`}>{count} / {limit}</span>
              </div>
              <textarea id={fieldId} value={value} readOnly={readOnly || saving} rows={key === 'youtubeTitle' ? 2 : 3} maxLength={limit * 2}
                aria-describedby={`${fieldId}-count`} aria-invalid={count > limit || undefined}
                placeholder={key === 'youtubeChapters' ? '00:00 المقدمة' : undefined}
                onChange={event => onChange({ ...draft, [key]: event.target.value })}
                className="block w-full rounded-lg border border-slate-300 p-2.5 text-sm" />
              {tags.length > 0 && <div className="flex flex-wrap gap-1" aria-label={`وسوم مقترحة لـ${label}`}>
                {tags.map(tag => {
                  const updated = [value.trimEnd(), tag].filter(Boolean).join(' ');
                  return <button key={tag} type="button" disabled={saving || digitalLength(updated) > limit || value.split(/\s+/).includes(tag)} onClick={() => onChange({ ...draft, [key]: updated })}
                    className="min-h-10 max-w-full break-words px-2 rounded-lg bg-blue-50 text-blue-800 text-xs font-medium disabled:opacity-50">{tag}</button>;
                })}
              </div>}
              {copyReady && <button type="button" onClick={() => void copy(value)} className="inline-flex min-h-10 items-center gap-1.5 text-xs font-semibold text-blue-700">
                <ClipboardCopy className="size-3.5" aria-hidden="true" /> نسخ {label}
              </button>}
            </div>;
          })}
        </div>
        {!readOnly && <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={saving || !canSave} onClick={onSave} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 px-3 text-xs font-semibold disabled:opacity-50">
            <Save className="size-4" aria-hidden="true" /> حفظ الحزمة
          </button>
          <button type="button" disabled={saving || !canApprove || !hasDigitalCopy(draft) || approved} onClick={onApprove} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-blue-700 px-3 text-xs font-semibold text-white disabled:opacity-50">
            {approved ? <Check className="size-4" aria-hidden="true" /> : <FileCheck className="size-4" aria-hidden="true" />} اعتماد الحزمة
          </button>
        </div>}
      </>}
    </div>
  </details>;
}
