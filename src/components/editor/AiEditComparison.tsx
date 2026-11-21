import { copilotTextChanges, type AiEditorPatch } from '../../shared/aiReview';

const FIELD_NAMES = { title: 'العنوان', shortTitle: 'العنوان المختصر', summary: 'الملخص', content: 'المتن' };

export function AiEditComparison({ before, patch }: { before: AiEditorPatch; patch: AiEditorPatch }) {
  const changes = copilotTextChanges(before, patch);
  return <section className="space-y-2 border-s-2 border-blue-200 ps-3 text-sm" aria-label="مقارنة النص قبل وبعد">
    <h4 className="text-xs font-bold text-slate-700">مقارنة النص قبل وبعد</h4>
    {!changes.length && <p className="text-xs text-slate-600">لا تغييرات في الكلمات. راجع أي تغيير في التنسيق قبل التطبيق.</p>}
    {changes.length > 0 && <p className="text-xs text-slate-600"><del>نص محذوف</del> · <ins>نص مضاف</ins></p>}
    {changes.map(({ field, runs }) => <div key={field} className="space-y-1 break-words">
      <p className="text-xs font-bold text-slate-700">{FIELD_NAMES[field]}</p>
      <p>{runs.map(({ kind, text }, index) => <span key={index}>{index > 0 ? ' ' : ''}{kind === 'del'
        ? <del className="rounded bg-rose-50 px-0.5 text-rose-900">{text}</del> : kind === 'add'
          ? <ins className="rounded bg-emerald-50 px-0.5 text-emerald-900">{text}</ins> : text}</span>)}</p>
    </div>)}
  </section>;
}
