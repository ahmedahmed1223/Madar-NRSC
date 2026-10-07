import React, { useRef, useState } from 'react';
import { ClipboardPlus } from 'lucide-react';
import { apiService } from '../../services/api';
import { dataStore } from '../../services/dataStore';
import { RbacService } from '../../services/rbacService';
import { fromLocalInputValue, toLocalInputValue } from '../../shared/dates';
import { FormPage } from '../common/FormPage';
import type { Bulletin, BulletinStory } from '../../shared/bulletins';
import { notify } from '../../services/notify';
import { useFormDraft } from '../../hooks/useFormDraft';

export function AssignmentForm({ bulletin, stories }: { bulletin: Bulletin; stories: BulletinStory[] }) {
  const [open, setOpen] = useState(false);
  const [storyId, setStoryId] = useState('');
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState('');
  const [due, setDue] = useState(toLocalInputValue());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const pendingId = useRef<string | undefined>(undefined);
  const recovery = useFormDraft(`bulletin-assignment:${apiService.getCurrentUser().id}:${bulletin.id}`, open,
    { storyId, title, assignee, due }, value => { setStoryId(value.storyId); setTitle(value.title); setAssignee(value.assignee); setDue(value.due); });
  if (!RbacService.hasPermission(apiService.getCurrentUser(), 'tasks.create_assign')) return null;
  return <>
    <button type="button" className="min-h-11 border rounded-lg px-3 flex items-center gap-2" onClick={() => { pendingId.current = undefined; setError(''); setOpen(true); }}><ClipboardPlus className="w-4 h-4" />تكليف إعداد النشرة</button>
    <FormPage isOpen={open} draft={recovery} onClose={() => { if (saving) return false; setOpen(false); }} title="تكليف إعداد النشرة">
      <form aria-keyshortcuts="Control+S Meta+S Control+Enter Meta+Enter" onKeyDown={e => {
        if (e.defaultPrevented || e.repeat || e.nativeEvent.isComposing || !(e.ctrlKey || e.metaKey) || e.altKey || document.querySelector('[role=dialog], [role=alertdialog]')) return;
        if (e.key.toLowerCase() === 's' || e.code === 'KeyS' || e.key === 'Enter') { e.preventDefault(); if (!saving) e.currentTarget.requestSubmit(); }
      }} onSubmit={async e => {
        e.preventDefault(); if (saving) return; setSaving(true); setError('');
        try {
          const at = fromLocalInputValue(due); if (!at) throw new Error('موعد التسليم غير صالح');
          const saved = apiService.saveTask({ id: pendingId.current, title, assigneeId: assignee, assigneeName: apiService.getUsers().find(u => u.id === assignee)?.fullName, dueDate: at, relatedEntityType: storyId ? 'BULLETIN_STORY' : 'BULLETIN', relatedEntityId: storyId || bulletin.id, relatedEntityTitle: stories.find(s => s.id === storyId)?.slug || bulletin.title });
          pendingId.current = saved.id;
          const result = await dataStore.awaitWrite('tasks', saved.id);
          if (!result.ok) throw new Error(result.message || 'لم يؤكد الخادم حفظ التكليف');
          recovery.clearDraft(); setOpen(false); setTitle(''); notify({ type: 'success', message: 'حُفظ التكليف وأُرسل للمسؤول' });
        } catch (err: any) { setError(err.message); } finally { setSaving(false); }
      }} className="space-y-3">
        {error && <p role="alert" className="text-rose-700">{error}</p>}
        <fieldset disabled={saving} className="space-y-3">
          <label className="block">عنوان التكليف<input required maxLength={200} value={title} onChange={e => setTitle(e.target.value)} className="block w-full min-h-11 border rounded-lg px-3" /></label>
          <label className="block">قصة التكليف<select value={storyId} onChange={e => setStoryId(e.target.value)} className="block w-full min-h-11 border rounded-lg px-3"><option value="">النشرة كاملة</option>{stories.filter(s => !s.deletedAt).map(s => <option key={s.id} value={s.id}>{s.slug}</option>)}</select></label>
          <label className="block">المسؤول عن التكليف<select aria-label="المسؤول عن التكليف" required value={assignee} onChange={e => setAssignee(e.target.value)} className="block w-full min-h-11 border rounded-lg px-3"><option value="">اختر المسؤول</option>{apiService.getUsers().filter(u => u.isActive !== false && !u.deletedAt).map(u => <option key={u.id} value={u.id}>{u.fullName}</option>)}</select></label>
          <label className="block">موعد التسليم<input required type="datetime-local" value={due} onChange={e => setDue(e.target.value)} className="block w-full min-h-11 border rounded-lg px-3" /></label>
          <button type="submit" className="min-h-11 px-4 bg-blue-600 text-white rounded-lg">{saving ? 'جارٍ تأكيد الحفظ...' : 'حفظ التكليف'}</button>
        </fieldset>
      </form>
    </FormPage>
  </>;
}
