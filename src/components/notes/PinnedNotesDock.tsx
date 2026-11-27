import { useId, useState } from 'react';
import { ChevronDown, Pin, PinOff } from 'lucide-react';
import { useLiveData } from '../../hooks/useLiveData';
import { apiService } from '../../services/api';
import { confirmSaved } from '../../services/confirmSave';
import { dataStore } from '../../services/dataStore';
import { notify } from '../../services/notify';
import { navigateTo } from '../../services/uiEvents';

export function PinnedNotesDock() {
  useLiveData(['personalNotes']);
  const panelId = useId();
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const pinned = apiService.getPersonalNotes().filter(note => note.pinned)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  if (pinned.length === 0) return null;

  const unpin = async (id: string) => {
    const latest = apiService.getPersonalNotes().find(note => note.id === id);
    if (!latest?.pinned || saving) return;
    setSaving(id);
    try {
      apiService.savePersonalNote({ ...latest, pinned: false });
      await confirmSaved('personalNotes', id, 'أُلغي تثبيت الملاحظة');
    } catch {
      notify({ type: 'error', message: 'تعذّر إلغاء تثبيت الملاحظة' });
    } finally {
      setSaving(null);
    }
  };

  return (
    <aside aria-label="ملصقاتي" className="pinned-notes-dock fixed bottom-16 end-3 z-20 flex w-[min(22rem,calc(100vw-1.5rem))] flex-col items-end gap-2 lg:bottom-4 lg:end-4">
      {expanded && <section id={panelId} aria-label="الملاحظات المثبتة" className="w-full overflow-hidden rounded-xl border border-amber-300 bg-white text-slate-900 shadow-lg">
        <div className="flex items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-3">
          <h2 className="text-sm font-bold">ملصقاتي</h2>
          <button type="button" className="min-h-11 text-sm font-bold text-blue-800 hover:underline" onClick={() => { setExpanded(false); navigateTo.emit('/personal-notes'); }}>فتح ملاحظاتي</button>
        </div>
        <ul className="max-h-[min(42dvh,20rem)] divide-y divide-slate-200 overflow-y-auto">
          {pinned.map(note => (
            <li key={note.id} className="px-3 py-2.5">
              <div className="flex items-start justify-between gap-2">
                <h3 dir="auto" className="min-w-0 text-sm font-bold [overflow-wrap:anywhere]">{note.title}</h3>
                <button type="button" aria-label={`إلغاء تثبيت ${note.title}`} title="إلغاء التثبيت"
                  disabled={!!saving || !!dataStore.hasPendingWrite('personalNotes', note.id)}
                  className="-my-1 grid size-11 shrink-0 place-items-center rounded-lg text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                  onClick={() => void unpin(note.id)}><PinOff className="size-4" aria-hidden="true" /></button>
              </div>
              {note.body && <p dir="auto" className="mt-1 whitespace-pre-wrap text-sm text-slate-700 [overflow-wrap:anywhere]">{note.body}</p>}
            </li>
          ))}
        </ul>
      </section>}
      <button type="button" aria-expanded={expanded} aria-controls={expanded ? panelId : undefined} onClick={() => setExpanded(!expanded)}
        className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-3 text-sm font-bold text-amber-950 shadow-sm hover:bg-amber-100">
        <Pin className="size-4 shrink-0" aria-hidden="true" />
        <span>الملصقات</span>
        <span className="min-w-5 rounded-full bg-amber-200 px-1 text-center text-xs">{pinned.length}</span>
        <ChevronDown className={`size-4 shrink-0 ${expanded ? '' : 'rotate-180'}`} aria-hidden="true" />
      </button>
    </aside>
  );
}
