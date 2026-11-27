import { useRef, useState } from 'react';
import { Copy, FileText, Pin, PinOff, Plus, Search, Trash2 } from 'lucide-react';
import { FormPage } from '../components/common/FormPage';
import { ListEmptyState } from '../components/common/ListEmptyState';
import { useLiveData } from '../hooks/useLiveData';
import { apiService } from '../services/api';
import { dataStore } from '../services/dataStore';
import { confirmDialog } from '../services/dialogs';
import { appLocale, zoneOptions } from '../shared/dateFormat';
import { newId } from '../shared/ids';
import { PERSONAL_NOTE_BODY_LIMIT, PERSONAL_NOTE_TITLE_LIMIT, type PersonalNote } from '../shared/personalWorkspace';
import { matchesQuery } from '../shared/search';
import type { User } from '../types';
import { copyTextToClipboard } from '../services/clipboard';

const action = 'inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-xs font-bold';
const secondary = `${action} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50`;
const input = 'block w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm text-slate-900';
const order = (a: PersonalNote, b: PersonalNote) =>
  Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id);

type NoteDraft = Pick<PersonalNote, 'id' | 'title' | 'body' | 'pinned'>;
type Feedback = { kind: 'error' | 'pending' | 'success'; text: string };

export function PersonalNotesView({ currentUser }: { currentUser: User }) {
  return <AccountNotes key={currentUser.id} userId={currentUser.id} />;
}

function AccountNotes({ userId }: { userId: string }) {
  useLiveData(['personalNotes']);
  const [query, setQuery] = useState('');
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [draft, setDraft] = useState<NoteDraft | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const running = useRef(false);
  const search = useRef<HTMLInputElement>(null);
  const records = apiService.getPersonalNotes().filter(note => note.ownerId === userId).sort(order);
  const notes = records.filter(note => (!pinnedOnly || note.pinned) && matchesQuery(query, note.title, note.body));
  const pending = (id: string) => dataStore.hasPendingWrite('personalNotes', id);
  const currentAccount = () => apiService.getCurrentUser().id === userId;

  const run = async (id: string, write: () => void, success: string, onConfirmed?: () => void) => {
    if (!currentAccount() || running.current || pending(id)) return;
    running.current = true;
    setBusy(true);
    setFeedback(null);
    try {
      write();
      const result = await dataStore.awaitWrite('personalNotes', id);
      if (!currentAccount()) return;
      if (result.ok) {
        setFeedback({ kind: 'success', text: success });
        onConfirmed?.();
      } else if (result.pending) {
        setFeedback({ kind: 'pending', text: 'التغيير محفوظ على هذا الجهاز بانتظار تأكيد الخادم.' });
      } else {
        setFeedback({ kind: 'error', text: result.message || 'تعذّر حفظ التغيير. أعد المحاولة.' });
      }
    } catch (error) {
      if (currentAccount()) setFeedback({ kind: 'error', text: error instanceof Error ? error.message : 'تعذّر حفظ التغيير. أعد المحاولة.' });
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  const begin = (note?: PersonalNote) => {
    setFeedback(null);
    setEditing(!!note);
    setDraft(note ? { ...note } : { id: newId('note'), title: '', body: '', pinned: false });
  };

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft || !draft.title.trim()) return;
    void run(draft.id, () => apiService.savePersonalNote(draft), 'حُفظت الملاحظة.', () => setDraft(null));
  };

  const remove = async (note: PersonalNote) => {
    const confirmed = await confirmDialog({ title: 'حذف الملاحظة', message: `حذف «${note.title}»؟`, confirmLabel: 'حذف', danger: true });
    if (confirmed) void run(note.id, () => apiService.deletePersonalNote(note.id), 'حُذفت الملاحظة.');
  };
  const copyNote = async (note: PersonalNote, trigger: HTMLButtonElement) => {
    const copied = await copyTextToClipboard([note.title, note.body].filter(Boolean).join('\n\n'), trigger);
    setFeedback({ kind: copied ? 'success' : 'error', text: copied ? 'نُسخ محتوى الملاحظة.' : 'تعذّر النسخ إلى الحافظة.' });
  };

  const status = feedback && <p role={feedback.kind === 'error' ? 'alert' : 'status'} className={`rounded-lg border px-3 py-2 text-sm ${feedback.kind === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>{feedback.text}</p>;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1>ملاحظاتي</h1>
          <p className="mt-2 text-sm text-slate-600">ملاحظات خاصة بحسابك.</p>
        </div>
        <button type="button" onClick={() => begin()} className={`${action} bg-blue-600 text-white hover:bg-blue-700`}><Plus className="size-4" aria-hidden="true" /> ملاحظة جديدة</button>
      </header>
      {records.length > 0 && <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-md">
          <Search className="pointer-events-none absolute start-3 top-3.5 size-4 text-slate-600" aria-hidden="true" />
          <input ref={search} type="search" aria-label="بحث في ملاحظاتي" value={query} onChange={event => setQuery(event.target.value)} className={`${input} min-h-11 ps-9`} placeholder="ابحث بالعنوان أو النص" />
        </div>
        <label className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700">
          <input type="checkbox" checked={pinnedOnly} onChange={event => setPinnedOnly(event.target.checked)} className="size-4 accent-blue-600" />
          المثبتة فقط
        </label>
      </div>}
      {!draft && status}
      {notes.length === 0 ? <ListEmptyState
        message={records.length ? 'لا توجد ملاحظات مطابقة.' : 'لا توجد ملاحظات محفوظة.'}
        action={records.length ? { label: 'مسح الفلاتر', run: () => {
          setQuery('');
          setPinnedOnly(false);
          search.current?.focus();
        } } : undefined}
      /> : (
        <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
          {notes.map(note => (
            <li key={note.id} className="flex flex-col gap-1 p-3 sm:flex-row sm:items-start sm:gap-3">
              <div className="min-w-0 flex-1">
                <button type="button" onClick={() => begin(note)} className="flex min-h-11 max-w-full items-center gap-2 text-start text-sm font-bold text-blue-700 hover:underline">
                  {note.pinned && <Pin className="size-4 shrink-0" aria-label="مثبتة" />}
                  <span className="[overflow-wrap:anywhere]">{note.title}</span>
                </button>
                {note.body && <p className="line-clamp-2 whitespace-pre-wrap text-sm text-slate-700 [overflow-wrap:anywhere]">{note.body}</p>}
                <p className="mt-1 text-xs text-slate-600">
                  <time dateTime={note.updatedAt}>{new Date(note.updatedAt).toLocaleString(appLocale(), { ...zoneOptions(), dateStyle: 'short', timeStyle: 'short' })}</time>
                  {pending(note.id) && ' · بانتظار المزامنة'}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <button type="button" disabled={busy || pending(note.id)} onClick={() => void run(note.id, () => apiService.savePersonalNote({ ...note, pinned: !note.pinned }), note.pinned ? 'أُلغي تثبيت الملاحظة.' : 'ثُبّتت الملاحظة.')} className={secondary}>
                  {note.pinned ? <PinOff className="size-4" aria-hidden="true" /> : <Pin className="size-4" aria-hidden="true" />}
                  {note.pinned ? 'إلغاء التثبيت' : 'تثبيت'}
                </button>
                <button type="button" disabled={busy || pending(note.id)} onClick={(event) => void copyNote(note, event.currentTarget)} aria-label={`نسخ ${note.title}`} className={`${secondary} min-w-11 justify-center`}>
                  <Copy className="size-4" aria-hidden="true" />
                </button>
                <button type="button" disabled={busy || pending(note.id)} onClick={() => void remove(note)} aria-label={`حذف ${note.title}`} className={`${secondary} min-w-11 justify-center`}>
                  <Trash2 className="size-4" aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <FormPage isOpen={!!draft} onClose={() => { if (running.current) return false; setDraft(null); }} title={editing ? 'تحرير الملاحظة' : 'ملاحظة جديدة'}>
        {draft && <form onSubmit={save} className="max-w-2xl space-y-3">
          {status}
          <fieldset disabled={busy} className="min-w-0 space-y-3">
          <label className="block space-y-1 text-sm font-semibold">العنوان
            <input className={`${input} min-h-11`} autoFocus value={draft.title} maxLength={PERSONAL_NOTE_TITLE_LIMIT} required onChange={event => setDraft({ ...draft, title: event.target.value })} />
          </label>
          <label className="block space-y-1 text-sm font-semibold">نص الملاحظة
            <textarea className={input} rows={7} value={draft.body} maxLength={PERSONAL_NOTE_BODY_LIMIT} onChange={event => setDraft({ ...draft, body: event.target.value })} />
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" checked={draft.pinned} onChange={event => setDraft({ ...draft, pinned: event.target.checked })} /> تثبيت في أعلى القائمة
          </label>
          <button type="submit" disabled={busy || pending(draft.id) || !draft.title.trim()} className={`${action} bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50`}>
            <FileText className="size-4" aria-hidden="true" /> {busy || pending(draft.id) ? 'بانتظار التأكيد' : 'حفظ الملاحظة'}
          </button>
          </fieldset>
        </form>}
      </FormPage>
    </div>
  );
}
