import React, { useState } from 'react';
import { Archive, ArchiveRestore, Copy, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { apiService } from '../../services/api';
import { confirmDialog } from '../../services/dialogs';
import { confirmSaved } from '../../services/confirmSave';
import { notify } from '../../services/notify';
import { cardKindName, stepTypeName, stepTypesOf, type ProductionCard } from '../../shared/productionCards';
import { duplicateTemplate, RULE_KINDS, type WorkflowTemplate } from '../../shared/workflowTemplates';
import { assignmentTemplate, mayManageTemplate, publishedWorkflow, templateScope } from '../../shared/workflowPublication';
import { AR, countLabel } from '../../shared/arabicPlural';

interface TemplatesPanelProps {
  templates: WorkflowTemplate[];
  cards: ProductionCard[];
  canManage: boolean;
  onUse: (template: WorkflowTemplate) => void;
  onEdit: (template: WorkflowTemplate) => void;
  onNew: () => void;
}

const BTN = 'inline-flex items-center gap-1.5 min-h-11 px-3 py-2 rounded-lg text-xs font-bold';

/** «القوالب»: the workflows assignments are created from; supervisors create, copy, edit and archive them. */
export const TemplatesPanel: React.FC<TemplatesPanelProps> = ({ templates, cards, canManage, onUse, onEdit, onNew }) => {
  const stepTypes = stepTypesOf(apiService.getSettings());
  const currentUser = apiService.getCurrentUser();
  const [showArchived, setShowArchived] = useState(false);
  const shown = templates.filter((t) => !!t.archived === showArchived);
  const used = (id: string) => cards.filter((c) => c.templateId === id).length;

  const run = (fn: () => WorkflowTemplate | void, ok: string, id?: string) => {
    try {
      const saved = fn();
      const target = id || (saved && saved.id);
      if (target) void confirmSaved('workflowTemplates', target, ok);
    } catch (err: any) {
      notify({ type: 'error', message: err?.message || 'تعذر حفظ القالب' });
    }
  };

  return (
    <section className="space-y-3" aria-label="قوالب سير العمل">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-slate-600 flex-1 min-w-48">القالب سلسلة مهام جاهزة: تختاره، تحدد العنوان والموعد ومن ينفّذ، فيُنشأ التكليف بكل مهامه.</p>
        <label className="inline-flex items-center gap-2 min-h-11 text-xs text-slate-700">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="w-4 h-4 accent-blue-600" />
          عرض المؤرشفة
        </label>
        {canManage && (
          <button type="button" onClick={onNew} className={`${BTN} bg-blue-600 text-white`}>
            <Plus className="w-4 h-4" />
            قالب جديد
          </button>
        )}
      </div>
      {shown.length === 0 && <p className="text-center text-xs text-slate-500 py-10 bg-white border border-dashed border-slate-300 rounded-2xl">{showArchived ? 'لا قوالب مؤرشفة.' : 'لا قوالب بعد.'}</p>}
      <ul className="grid gap-3 md:grid-cols-2">
        {shown.map((t) => {
          const scope = templateScope(t);
          const published = publishedWorkflow(t);
          const editable = !!currentUser && mayManageTemplate(currentUser, t, canManage);
          const usable = assignmentTemplate(t);
          return (
          <li key={t.id} className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-bold text-slate-900">{t.name}</h3>
              <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-bold">{cardKindName(t.kind)}</span>
              <span className="text-slate-700">{scope === 'shared' ? 'مشترك' : scope === 'news' ? 'مسار الأخبار' : 'مسار البرامج'} · {published ? `الإصدار المنشور ${published.version}` : 'مسودة غير منشورة'}</span>
              {t.priority === 'URGENT' && <span className="px-2 py-0.5 rounded-md bg-red-600 text-white font-bold">عاجل</span>}
              {t.builtIn && <span className="px-2 py-0.5 rounded-md border border-slate-200 text-slate-600">جاهز</span>}
            </div>
            {t.description && <p className="text-slate-600">{t.description}</p>}
            <ol className="flex flex-wrap gap-1.5" aria-label="مهام القالب">
              {t.steps.map((s, i) => (
                <li key={s.id} className="px-2 py-1 rounded-lg bg-slate-50 border border-slate-200 text-slate-700" title={RULE_KINDS.find((r) => r.id === s.rule.kind)?.name}>
                  {i + 1}. {stepTypeName(stepTypes, s.type)}
                </li>
              ))}
            </ol>
            <p className="text-2xs text-slate-500">{countLabel(t.steps.length, AR.task)} · {used(t.id) ? `استُخدم في ${countLabel(used(t.id), { one: 'تكليف واحد', two: 'تكليفين', few: 'تكليفات', many: 'تكليفاً' })}` : 'لم يُستخدم بعد'}</p>
            {canManage && (
              <div className="flex flex-wrap gap-2 pt-1">
                {usable && (
                  <button type="button" onClick={() => onUse(usable)} className={`${BTN} bg-blue-600 text-white`}>
                    <Play className="w-3.5 h-3.5" />
                    إنشاء تكليف
                  </button>
                )}
                {editable && <>
                <button type="button" onClick={() => onEdit(t)} className={`${BTN} border border-slate-200 text-slate-700`}>
                  <Pencil className="w-3.5 h-3.5" />
                  تعديل
                </button>
                <button type="button" onClick={() => run(() => apiService.saveWorkflowTemplate(duplicateTemplate(t)), 'نُسخ القالب')} className={`${BTN} border border-slate-200 text-slate-700`}>
                  <Copy className="w-3.5 h-3.5" />
                  نسخ
                </button>
                <button type="button" onClick={() => run(() => apiService.saveWorkflowTemplate({ ...t, archived: !t.archived }), t.archived ? 'أُعيد القالب إلى القائمة' : 'أُرشف القالب')} className={`${BTN} border border-slate-200 text-slate-700`}>
                  {t.archived ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
                  {t.archived ? 'استعادة' : 'أرشفة'}
                </button>
                {!t.builtIn && used(t.id) === 0 && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (!(await confirmDialog({ title: 'حذف القالب', message: `حذف «${t.name}»؟ التكليفات المنشأة منه لا تتأثر.`, confirmLabel: 'حذف', cancelLabel: 'تراجع', danger: true }))) return;
                      run(() => apiService.deleteWorkflowTemplate(t.id), 'حُذف القالب', t.id);
                    }}
                    className={`${BTN} border border-rose-200 text-rose-700 mr-auto`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    حذف
                  </button>
                )}
                </>}
              </div>
            )}
          </li>
          );
        })}
      </ul>
    </section>
  );
};
