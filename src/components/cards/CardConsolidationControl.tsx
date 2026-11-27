import { useState } from 'react';
import { apiFetch } from '../../services/http';
import { INPUT, LABEL } from './cardUi';

type Candidate = { id: string; title: string; version: number };
type MergeOptions = { version: number; candidates: Candidate[] };

export function CardConsolidationControl({ cardId }: { cardId: string }) {
  const [options, setOptions] = useState<MergeOptions>();
  const [selection, setSelection] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string }>();
  const path = `/api/v1/cards/${encodeURIComponent(cardId)}/consolidate`;

  const load = async () => {
    setBusy(true);
    setMessage(undefined);
    try {
      setOptions((await apiFetch<{ data: MergeOptions }>(path)).data);
      setSelection('');
    } catch (error) {
      setMessage({ error: true, text: error instanceof Error ? error.message : 'تعذر فتح خيارات الدمج' });
    } finally { setBusy(false); }
  };

  const merge = async (event: React.FormEvent) => {
    event.preventDefault();
    const source = options?.candidates.find(row => row.id === selection);
    if (busy || !options || !source || !reason.trim()) return;
    setBusy(true);
    setMessage(undefined);
    try {
      await apiFetch(path, { method: 'POST', json: {
        duplicateId: source.id, version: options.version, duplicateVersion: source.version, reason: reason.trim(),
      } });
      setOptions(undefined);
      setReason('');
      setMessage({ error: false, text: 'دُمجت المخرجات وحُفظ التكليف المكرر وسجله في الملغاة.' });
    } catch (error) {
      setMessage({ error: true, text: error instanceof Error ? error.message : 'تعذر دمج التكليفين' });
    } finally { setBusy(false); }
  };

  return (
    <section aria-label="دمج تكليف مكرر" className="space-y-2">
      <button type="button" disabled={busy} className="min-h-11 rounded-lg border border-slate-300 px-3 font-semibold" onClick={() => void load()}>
        {options ? 'تحديث قائمة التكليفات المكررة' : 'دمج تكليف مكرر'}
      </button>
      {options && (options.candidates.length ? (
        <form onSubmit={merge} className="space-y-2 rounded-lg border border-slate-200 p-3">
          <label className={LABEL}>التكليف المكرر
            <select className={INPUT} value={selection} onChange={event => setSelection(event.target.value)} required>
              <option value="">اختر التكليف</option>
              {options.candidates.map(row => <option key={row.id} value={row.id}>{row.title}</option>)}
            </select>
          </label>
          <label className={LABEL}>سبب الدمج
            <input className={INPUT} maxLength={600} value={reason} onChange={event => setReason(event.target.value)} required />
          </label>
          <button type="submit" disabled={busy || !selection || !reason.trim()} className="min-h-11 rounded-lg bg-blue-700 px-3 font-semibold text-white disabled:opacity-60">دمج المخرجات وإلغاء التكليف المكرر</button>
        </form>
      ) : <p className="text-sm text-slate-700">لا توجد تكليفات أخرى متاحة لهذه المادة.</p>)}
      {message && <p role={message.error ? 'alert' : 'status'} className={message.error ? 'text-rose-800' : 'text-emerald-800'}>{message.text}</p>}
    </section>
  );
}
