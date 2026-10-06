import { confirmDialog } from '../../services/dialogs';
import React, { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, CheckSquare, CornerDownLeft, Edit2, Plus, Square, Trash2 } from 'lucide-react';
import type { Episode, EpisodeQuestion } from '../../types';
import { newId } from '../../shared/ids';
import { FormPage } from '../common/FormPage';
import { DropEvent, SortableItem, SortableList, SortableScope } from '../dnd/Sortable';
import { notify } from '../../services/notify';
import { episodeGuestList, guestKey, QUESTION_KINDS, QuestionKind, questionKindName, segmentGuests, segmentQuestions, TALK_SEGMENT_TYPES } from '../../shared/episodePlan';

interface Props {
  episode: Episode;
  canEdit: boolean;
  onSaveEpisode: (data: Partial<Episode>) => void;
  focusSegment?: { id: string; sequence: number };
}

interface Draft {
  id?: string;
  segmentId: string;
  guestId: string;
  kind: QuestionKind;
  parentId: string;
  questionText: string;
  notes: string;
}

const KIND_TONE: Record<string, string> = {
  MAIN: 'bg-blue-50 text-blue-700',
  BACKUP: 'bg-slate-100 text-slate-600',
  FOLLOWUP: 'bg-purple-50 text-purple-700',
};

export const EpisodeQuestionsPanel: React.FC<Props> = ({ episode, canEdit, onSaveEpisode, focusSegment }) => {
  const questions = episode.questions || [];
  const segments = (episode.rundown || []).filter((s) => s.segmentType !== 'BREAK');
  const guests = episodeGuestList(episode);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [onlyTalk, setOnlyTalk] = useState(true);

  const save = (next: EpisodeQuestion[]) => onSaveEpisode({ id: episode.id, questions: next.map((q, i) => ({ ...q, orderIndex: i + 1 })) });

  const open = (segmentId: string, q?: EpisodeQuestion) =>
    setDraft(
      q
        ? { id: q.id, segmentId: q.segmentId || segmentId, guestId: q.guestId || '', kind: q.kind || 'MAIN', parentId: q.parentId || '', questionText: q.questionText, notes: q.notes || '' }
        : { segmentId, guestId: segmentGuests(segments.find((s) => s.id === segmentId))[0]?.guestId || '', kind: 'MAIN', parentId: '', questionText: '', notes: '' }
    );

  useEffect(() => {
    if (!focusSegment) return;
    setOnlyTalk(false);
    if (canEdit) open(focusSegment.id);
    else requestAnimationFrame(() => document.getElementById(`episode-questions-${focusSegment.id}`)?.scrollIntoView({ block: 'center' }));
  }, [focusSegment]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft || !draft.questionText.trim()) return;
    const seg = segments.find((s) => s.id === draft.segmentId);
    const topic = (episode.topics || []).find((t) => t.id === seg?.topicId);
    const guest = guests.find((g) => guestKey(g) === draft.guestId);
    const fields = {
      segmentId: draft.segmentId || undefined,
      guestId: draft.guestId || undefined,
      kind: draft.kind,
      parentId: draft.kind === 'FOLLOWUP' && draft.parentId ? draft.parentId : undefined,
      questionText: draft.questionText.trim(),
      notes: draft.notes.trim(),
      // Older screens (prompter, print) read these.
      topicName: topic?.title || seg?.title || 'محور عام',
      assignedToName: guest?.guestName || '',
    };
    if (draft.id) {
      save(questions.map((q) => (q.id === draft.id ? { ...q, ...fields } : q)));
    } else {
      const q: EpisodeQuestion = { id: newId('q'), episodeId: episode.id, orderIndex: 0, isAsked: false, ...fields };
      // A follow-up sits right after the question it follows.
      const at = q.parentId ? questions.findIndex((x) => x.id === q.parentId) : -1;
      save(at >= 0 ? [...questions.slice(0, at + 1), q, ...questions.slice(at + 1)] : [...questions, q]);
    }
    setDraft(null);
  };

  const move = (list: EpisodeQuestion[], q: EpisodeQuestion, dir: -1 | 1) => {
    const i = list.findIndex((x) => x.id === q.id);
    const other = list[i + dir];
    if (!other) return;
    const a = questions.findIndex((x) => x.id === q.id);
    const b = questions.findIndex((x) => x.id === other.id);
    const next = [...questions];
    [next[a], next[b]] = [next[b], next[a]];
    save(next);
  };

  /** Drag a question within its segment or to another segment's list; the move can be undone. */
  const dropQuestion = ({ id, to, index }: DropEvent) => {
    const q = questions.find((x) => x.id === id);
    if (!q) return;
    const targetSeg = to === 'q:none' ? undefined : to.slice(2);
    const seg = segments.find((x) => x.id === targetSeg);
    const group = (seg ? (segmentQuestions(episode, seg) as EpisodeQuestion[]) : loose).filter((x) => x.id !== id);
    const rest = questions.filter((x) => x.id !== id);
    const segGuestIds = seg ? segmentGuests(seg).map((g) => g.guestId) : [];
    const topic = (episode.topics || []).find((t) => t.id === seg?.topicId);
    const moved: EpisodeQuestion = {
      ...q,
      segmentId: targetSeg,
      // A question aimed at a guest who is not in the new segment is re-aimed at all its guests.
      guestId: q.guestId && (!seg || segGuestIds.includes(q.guestId)) ? q.guestId : undefined,
      topicName: topic?.title || seg?.title || q.topicName,
      parentId: q.segmentId === targetSeg ? q.parentId : undefined,
    };
    let at = rest.length;
    if (group[index]) at = rest.findIndex((x) => x.id === group[index].id);
    else if (group[index - 1]) at = rest.findIndex((x) => x.id === group[index - 1].id) + 1;
    const previous = questions;
    save([...rest.slice(0, at), moved, ...rest.slice(at)]);
    notify({
      type: 'success',
      message: q.segmentId === targetSeg ? 'أُعيد ترتيب السؤال' : `نُقل السؤال إلى «${seg?.title || 'أسئلة غير مرتبطة'}»`,
      action: { label: 'تراجع', run: () => save(previous) },
    });
  };

  const toggle = (id: string) => save(questions.map((q) => (q.id === id ? { ...q, isAsked: !q.isAsked } : q)));
  const remove = async (id: string) => {
    if (!(await confirmDialog('حذف السؤال؟'))) return;
    save(questions.filter((q) => q.id !== id && q.parentId !== id));
  };

  const linkedIds = new Set(segments.flatMap((s) => segmentQuestions(episode, s).map((q) => q.id)));
  const loose = questions.filter((q) => !linkedIds.has(q.id));
  const shown = segments.filter((s) => !onlyTalk || TALK_SEGMENT_TYPES.has(s.segmentType) || segmentQuestions(episode, s).length);

  const renderList = (list: EpisodeQuestion[], segmentId: string) => (
    <SortableList as="ol" id={`q:${segmentId || 'none'}`} className="space-y-1.5 min-h-[2.25rem] rounded-xl">
      {list.length === 0 && <li className="text-[11px] text-rose-600 p-2 border border-dashed border-rose-200 rounded-xl">لا أسئلة محضّرة لهذه الفقرة — أضف سؤالاً أو اسحب سؤالاً إلى هنا.</li>}
      {list.map((q, i) => {
        const guest = guests.find((g) => guestKey(g) === q.guestId);
        return (
          <SortableItem
            as="li"
            key={q.id}
            id={q.id}
            container={`q:${segmentId || 'none'}`}
            label={q.questionText.slice(0, 60)}
            disabled={!canEdit}
            className={`p-2.5 rounded-xl border flex items-start gap-2 ${q.parentId ? 'mr-6' : ''} ${q.isAsked ? 'bg-emerald-50/40 border-emerald-200' : 'bg-white border-slate-200'}`}
          >
            {({ handle }) => (
            <>
            {canEdit && handle}
            <button type="button" onClick={() => canEdit && toggle(q.id)} disabled={!canEdit} aria-label={q.isAsked ? 'إلغاء «طُرح»' : 'تعليم كمطروح'} className={q.isAsked ? 'text-emerald-700' : 'text-slate-300 hover:text-slate-500'}>
              {q.isAsked ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5" />}
            </button>
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-bold">
                {q.parentId && <CornerDownLeft className="w-3 h-3 text-purple-500" />}
                <span className={`px-1.5 py-0.5 rounded ${KIND_TONE[q.kind || 'MAIN']}`}>{questionKindName(q.kind)}</span>
                {(guest || q.assignedToName) && <span className="text-purple-700">إلى: {guest?.guestName || q.assignedToName}</span>}
              </div>
              <p className={`text-sm font-bold leading-relaxed ${q.isAsked ? 'line-through text-slate-500' : 'text-slate-800'}`}>{q.questionText}</p>
              {q.notes && <p className="text-[11px] text-slate-500">للمذيع: {q.notes}</p>}
            </div>
            {canEdit && (
              <div className="flex items-center shrink-0">
                <button type="button" onClick={() => open(segmentId, q)} aria-label="تعديل السؤال" className="p-1 text-blue-600">
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
                <button type="button" onClick={() => remove(q.id)} aria-label="حذف السؤال" className="p-1 text-rose-500">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            </>
            )}
          </SortableItem>
        );
      })}
    </SortableList>
  );

  const draftSeg = segments.find((s) => s.id === draft?.segmentId);
  const draftGuests = draftSeg && segmentGuests(draftSeg).length ? segmentGuests(draftSeg).map((g) => ({ id: g.guestId, name: g.guestName })) : guests.map((g) => ({ id: guestKey(g), name: g.guestName }));
  const parents = draftSeg ? segmentQuestions(episode, draftSeg).filter((q) => !q.parentId && q.id !== draft?.id) : [];

  return (
    <SortableScope onDrop={dropQuestion} disabled={!canEdit}>
    <div className="space-y-4" data-testid="episode-questions">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200">
        <div>
          <h3 className="text-sm font-bold text-slate-800">أسئلة الحوارات حسب الفقرة</h3>
          <p className="text-xs text-slate-500">لكل حوار أسئلة أساسية واحتياطية وأسئلة متابعة، موجهة لضيف محدد.</p>
        </div>
        <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
          <input type="checkbox" checked={onlyTalk} onChange={(e) => setOnlyTalk(e.target.checked)} /> الحوارات فقط
        </label>
      </div>

      {shown.length === 0 && loose.length === 0 && (
        <div className="bg-white p-10 text-center rounded-2xl border border-dashed border-slate-300 text-xs text-slate-500">
          لا فقرات حوارية بعد. أضف مقابلة أو نقاشاً من «تحضير الحلقة» ثم حضّر أسئلتها هنا.
        </div>
      )}

      {shown.map((seg) => {
        const list = segmentQuestions(episode, seg) as EpisodeQuestion[];
        const sg = segmentGuests(seg);
        return (
          <section key={seg.id} id={`episode-questions-${seg.id}`} aria-label={`أسئلة ${seg.title}`} className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="text-sm font-bold text-slate-800">{seg.title}</h4>
                <p className="text-[11px] text-slate-500">{sg.length ? sg.map((g) => g.guestName).join('، ') : 'بلا ضيوف'}</p>
              </div>
              {canEdit && (
                <button type="button" onClick={() => open(seg.id)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-bold">
                  <Plus className="w-3.5 h-3.5" /> سؤال
                </button>
              )}
            </div>
            {renderList(list, seg.id)}
          </section>
        );
      })}

      {loose.length > 0 && (
        <section aria-label="أسئلة غير مرتبطة بفقرة" className="bg-white border border-dashed border-slate-300 rounded-2xl p-4 space-y-2">
          <h4 className="text-sm font-bold text-slate-700">أسئلة غير مرتبطة بفقرة ({loose.length})</h4>
          <p className="text-[11px] text-slate-500">عدّل السؤال واختر فقرته ليظهر للمذيع في مكانه.</p>
          {renderList(loose, '')}
        </section>
      )}

      <FormPage isOpen={!!draft} onClose={() => setDraft(null)} title={draft?.id ? 'تعديل السؤال' : 'سؤال جديد'} maxWidth="md">
        {draft && (
          <form onSubmit={submit} className="space-y-3">
            <label className="block text-xs font-bold text-slate-700">
              الفقرة
              <select value={draft.segmentId} onChange={(e) => setDraft({ ...draft, segmentId: e.target.value, parentId: '' })} className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-xl text-xs bg-white">
                <option value="">— بدون فقرة —</option>
                {segments.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs font-bold text-slate-700">
                موجه إلى
                <select value={draft.guestId} onChange={(e) => setDraft({ ...draft, guestId: e.target.value })} className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-xl text-xs bg-white">
                  <option value="">— كل الضيوف —</option>
                  {draftGuests.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-bold text-slate-700">
                النوع
                <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as QuestionKind })} className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-xl text-xs bg-white">
                  {QUESTION_KINDS.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {draft.kind === 'FOLLOWUP' && (
              <label className="block text-xs font-bold text-slate-700">
                يتابع السؤال
                <select value={draft.parentId} onChange={(e) => setDraft({ ...draft, parentId: e.target.value })} className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-xl text-xs bg-white">
                  <option value="">—</option>
                  {parents.map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.questionText.slice(0, 70)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="block text-xs font-bold text-slate-700">
              نص السؤال *
              <textarea data-autofocus required rows={3} value={draft.questionText} onChange={(e) => setDraft({ ...draft, questionText: e.target.value })} className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-xl text-sm leading-relaxed" />
            </label>
            <label className="block text-xs font-bold text-slate-700">
              معلومة للمذيع (أرقام، سياق)
              <input value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-xl text-xs" />
            </label>
            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <button type="button" onClick={() => setDraft(null)} className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl">
                إلغاء
              </button>
              <button type="submit" className="px-4 py-2 text-xs font-bold bg-blue-600 text-white rounded-xl">
                حفظ السؤال
              </button>
            </div>
          </form>
        )}
      </FormPage>
    </div>
    </SortableScope>
  );
};
