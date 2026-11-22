import { useRef, useState } from 'react';
import { ClipboardPlus } from 'lucide-react';
import { apiService } from '../../services/api';
import { dataStore } from '../../services/dataStore';
import { RbacService } from '../../services/rbacService';
import { fromLocalInputValue, toLocalInputValue } from '../../shared/dates';
import { FormPage } from '../common/FormPage';
import type { Bulletin, BulletinStory } from '../../shared/bulletins';
import { notify } from '../../services/notify';
import { useFormDraft } from '../../hooks/useFormDraft';
import { assignmentScope } from '../../shared/assignmentScope';
import type { WorkReminderOptions } from '../../shared/workReminders';
import { WorkReminderFields } from '../common/WorkReminderFields';

type Target = { kind: 'BULLETIN'; id: string; title: string; stories: BulletinStory[] } | { kind: 'EPISODE'; id: string; title: string };

export function AssignmentForm({ bulletin, stories }: { bulletin: Bulletin; stories: BulletinStory[] }) {
  return <ProductionAssignmentForm target={{ kind: 'BULLETIN', id: bulletin.id, title: bulletin.title, stories }} />;
}

export function ProductionAssignmentForm({ target }: { target: Target }) {
  const stories = target.kind === 'BULLETIN' ? target.stories : undefined;
  const label = target.kind === 'BULLETIN' ? 'تكليف إعداد النشرة' : 'تكليف متابعة الحلقة';
  const [open, setOpen] = useState(false);
  const [storyId, setStoryId] = useState('');
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState('');
  const [due, setDue] = useState(toLocalInputValue());
  const [reminderOptions, setReminderOptions] = useState<WorkReminderOptions>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const pendingId = useRef<string | undefined>(undefined);
  const draftScope = target.kind === 'BULLETIN' ? 'bulletin-assignment' : 'episode-assignment';
  const recovery = useFormDraft(`${draftScope}:${apiService.getCurrentUser().id}:${target.id}`, open,
    { storyId, title, assignee, due, reminderOptions }, value => { setStoryId(value.storyId); setTitle(value.title); setAssignee(value.assignee); setDue(value.due); setReminderOptions(value.reminderOptions); });
  const currentUser = apiService.getCurrentUser();
  if (!RbacService.hasPermission(currentUser, 'tasks.create_assign')) return null;
  const scope = assignmentScope(currentUser, apiService.getSettings());
  const eligibleUsers = apiService.getUsers().filter(user => !scope.errorFor(user));
  return <>
    <button type="button" className="flex items-center gap-1 min-h-11 sm:min-h-9 px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50" onClick={() => { pendingId.current = undefined; setError(''); setOpen(true); }}><ClipboardPlus className="w-4 h-4" /> {label}</button>
    <FormPage isOpen={open} draft={recovery} onClose={() => { if (saving) return false; setOpen(false); }} title={label}>
      <form aria-keyshortcuts="Control+S Meta+S Control+Enter Meta+Enter" onKeyDown={e => {
        if (e.defaultPrevented || e.repeat || e.nativeEvent.isComposing || !(e.ctrlKey || e.metaKey) || e.altKey || document.querySelector('[role=dialog], [role=alertdialog]')) return;
        if (e.key.toLowerCase() === 's' || e.code === 'KeyS' || e.key === 'Enter') { e.preventDefault(); if (!saving) e.currentTarget.requestSubmit(); }
      }} onSubmit={async e => {
        e.preventDefault(); if (saving) return; setSaving(true); setError('');
        try {
          const at = fromLocalInputValue(due); if (!at) throw new Error('موعد التسليم غير صالح');
          const story = stories?.find(item => item.id === storyId && !item.deletedAt);
          const member = eligibleUsers.find(user => user.id === assignee);
          if (!member) throw new Error('اختر مكلفًا من قائمة فريق العمل المتاح');
          const saved = apiService.saveTask({ id: pendingId.current, title, assigneeId: member.id, assigneeName: member.fullName, dueDate: at, reminderOptions, relatedEntityType: story ? 'BULLETIN_STORY' : target.kind, relatedEntityId: story?.id || target.id, relatedEntityTitle: story?.slug || target.title });
          pendingId.current = saved.id;
          const result = await dataStore.awaitWrite('tasks', saved.id);
          if (!result.ok) throw new Error(result.message || 'لم يؤكد الخادم حفظ التكليف');
          recovery.clearDraft(); setOpen(false); setTitle(''); setReminderOptions(undefined); notify({ type: 'success', message: 'حُفظ التكليف وأُرسل للمسؤول' });
        } catch (err: any) { setError(err.message); } finally { setSaving(false); }
      }} className="space-y-3">
        {error && <p role="alert" className="text-rose-700">{error}</p>}
        <fieldset disabled={saving} className="space-y-3">
          <label className="block">عنوان التكليف<input required maxLength={200} value={title} onChange={e => setTitle(e.target.value)} className="block w-full min-h-11 border rounded-lg px-3" /></label>
          {stories && <label className="block">قصة التكليف<select value={storyId} onChange={e => setStoryId(e.target.value)} className="block w-full min-h-11 border rounded-lg px-3"><option value="">النشرة كاملة</option>{stories.filter(s => !s.deletedAt).map(s => <option key={s.id} value={s.id}>{s.slug}</option>)}</select></label>}
          <label className="block">المسؤول عن التكليف<select aria-label="المسؤول عن التكليف" required value={assignee} onChange={e => setAssignee(e.target.value)} className="block w-full min-h-11 border rounded-lg px-3"><option value="">اختر المسؤول</option>{eligibleUsers.map(u => <option key={u.id} value={u.id}>{u.fullName}</option>)}</select></label>
          <label className="block">موعد التسليم<input required type="datetime-local" value={due} onChange={e => setDue(e.target.value)} className="block w-full min-h-11 border rounded-lg px-3" /></label>
          <WorkReminderFields value={reminderOptions} onChange={setReminderOptions} />
          <button type="submit" className="min-h-11 px-4 bg-blue-600 text-white rounded-lg">{saving ? 'جارٍ تأكيد الحفظ...' : 'حفظ التكليف'}</button>
        </fieldset>
      </form>
    </FormPage>
  </>;
}
