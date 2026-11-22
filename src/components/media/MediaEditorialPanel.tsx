import { useEffect, useState, type RefObject } from 'react';
import type { MediaAsset } from '../../types';
import { confirmDialog } from '../../services/dialogs';
import { apiFetch } from '../../services/http';
import { newId } from '../../shared/ids';
import { fromLocalInputValue, toLocalInputValue } from '../../shared/dates';
import { basisZone } from '../../shared/dateFormat';
import { mediaEditorialError, mediaRightsIssue, mediaTimecode, type MediaEditRange, type MediaRights, type MediaTranscript, type MediaTranscriptSegment } from '../../shared/mediaEditorial';

type Props = {
  asset: MediaAsset;
  player: RefObject<HTMLMediaElement | null>;
  canEdit: boolean;
  canManageRights: boolean;
  onSave: (patch: Partial<MediaAsset>) => Promise<boolean>;
  onQuote?: (segment: MediaTranscriptSegment) => void;
};

const field = 'w-full min-h-10 mt-1 px-2 py-1 rounded-lg border border-slate-300 bg-white text-slate-900';
const button = 'min-h-10 px-3 rounded-lg border border-slate-300 text-blue-700 font-bold disabled:opacity-50';

const rightsLabels = {
  CLEARED: 'مصرّح بالبث',
  RESTRICTED: 'مقيّدة',
  UNKNOWN: 'غير موثّقة',
};

const originLabels = { STATION: 'ملك المحطة', AGENCY: 'وكالة', ONE_TIME: 'تصريح بث لمرة واحدة' };

export function MediaEditRanges({ ranges = [], onSeek }: { ranges?: MediaEditRange[]; onSeek?: (seconds: number) => void }) {
  if (!ranges.length) return null;
  return <ul aria-label="علامات المونتاج" className="space-y-1 text-xs">
    {ranges.map(range => <li key={range.id} className="flex flex-wrap items-baseline gap-x-2 text-slate-700">
      {onSeek ? <button type="button" onClick={() => onSeek(range.inSeconds)} dir="ltr" className="min-h-10 text-blue-700 font-mono hover:underline">{mediaTimecode(range.inSeconds)} – {mediaTimecode(range.outSeconds)}</button>
        : <span dir="ltr" className="font-mono">{mediaTimecode(range.inSeconds)} – {mediaTimecode(range.outSeconds)}</span>}
      {range.note && <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">{range.note}</span>}
    </li>)}
  </ul>;
}

export function MediaEditorialPanel({ asset, player, canEdit, canManageRights, onSave, onQuote }: Props) {
  const playable = asset.mediaType === 'VIDEO' || asset.mediaType === 'AUDIO';
  const [status, setStatus] = useState<MediaRights['status']>(asset.rights?.status || 'UNKNOWN');
  const [origin, setOrigin] = useState<NonNullable<MediaRights['origin']> | ''>(asset.rights?.origin || '');
  const [expiry, setExpiry] = useState(asset.rights?.expiresAt ? toLocalInputValue(asset.rights.expiresAt) : '');
  const [rightsNote, setRightsNote] = useState(asset.rights?.note || '');
  const [inPoint, setInPoint] = useState('');
  const [outPoint, setOutPoint] = useState('');
  const [editNote, setEditNote] = useState('');
  const [rangeId, setRangeId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [provider, setProvider] = useState<{ enabled: boolean; video: boolean }>();
  const [transcribing, setTranscribing] = useState(false);
  const [generated, setGenerated] = useState<MediaTranscript>();
  const [transcriptError, setTranscriptError] = useState('');
  const source = asset.fileUrl || asset.url;
  const transcript = [generated, asset.transcript].find(result => result?.sourceUrl === source);
  const rightsIssue = mediaRightsIssue(asset);

  useEffect(() => {
    if (!playable || !canEdit || !source?.startsWith('/api/v1/media/files/')) return;
    const controller = new AbortController();
    void apiFetch<{ data: { enabled: boolean; video: boolean } }>('/api/v1/media/transcription', { signal: controller.signal })
      .then(response => setProvider(response.data)).catch(() => undefined);
    return () => controller.abort();
  }, [canEdit, playable, source]);

  function seek(seconds: number) {
    if (player.current) player.current.currentTime = seconds;
  }

  async function save(patch: Partial<MediaAsset>) {
    if (saving) return false;
    setError('');
    const invalid = mediaEditorialError({ ...asset, ...patch });
    if (invalid) {
      setError(invalid);
      return false;
    }
    setSaving(true);
    try {
      const confirmed = await onSave(patch);
      if (!confirmed) setError('لم يؤكد الخادم حفظ التغييرات.');
      return confirmed;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'تعذر الحفظ');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function saveRange() {
    if (inPoint === '' || outPoint === '') {
      setError('حدد نقطتي الدخول والخروج أولًا.');
      return;
    }
    const range = { id: rangeId || newId('mark'), inSeconds: Number(inPoint), outSeconds: Number(outPoint), note: editNote.trim() };
    const duration = player.current?.duration;
    if (Number.isFinite(duration) && range.outSeconds > duration! + 0.011) {
      setError('نقطة الخروج تتجاوز مدة المادة.');
      return;
    }
    const ranges = asset.editRanges || [];
    const editRanges = rangeId && ranges.some(item => item.id === rangeId) ? ranges.map(item => item.id === rangeId ? range : item) : [...ranges, range];
    setRangeId(range.id);
    if (await save({ editRanges })) resetRange();
  }

  function resetRange() {
    setRangeId(null);
    setInPoint('');
    setOutPoint('');
    setEditNote('');
  }

  async function transcribe() {
    if (transcribing || !(await confirmDialog('إرسال صوت هذه المادة إلى خدمة Azure Speech لتفريغه بالعربية؟'))) return;
    setTranscribing(true);
    setTranscriptError('');
    try {
      const response = await apiFetch<{ data: MediaTranscript }>(`/api/v1/media/${encodeURIComponent(asset.id)}/transcription`, { method: 'POST', json: {} });
      setGenerated(response.data);
    } catch (reason) {
      setTranscriptError(reason instanceof Error ? reason.message : 'تعذر تفريغ المادة');
    } finally {
      setTranscribing(false);
    }
  }

  return <div className="space-y-4 text-xs">
    <section className="space-y-2" aria-label="حقوق البث">
      <h3 className="font-bold text-slate-900">حقوق البث</h3>
      {asset.rights?.origin && <p className="font-semibold text-slate-700">{originLabels[asset.rights.origin]}</p>}
      {rightsIssue && <p role="status" className="rounded-lg bg-amber-50 px-2 py-1.5 font-bold text-amber-900">{rightsIssue}، المادة محظورة في الرانداون.</p>}
      {asset.rights && !rightsIssue && <p className="text-emerald-700 font-semibold">{rightsLabels[asset.rights.status]}{asset.rights.expiresAt ? ` حتى ${toLocalInputValue(asset.rights.expiresAt).replace('T', ' ')}` : ''}</p>}
      {!asset.rights && <p className="text-slate-600">لم تُسجَّل بيانات الحقوق لهذه المادة.</p>}
      {canEdit && canManageRights ? <details>
        <summary className="min-h-9 cursor-pointer font-bold text-blue-700">تعديل حقوق البث</summary>
        <div className="grid gap-2 sm:grid-cols-2">
          <label>الحالة<select value={status} onChange={event => setStatus(event.target.value as MediaRights['status'])} className={field}>
            {Object.entries(rightsLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select></label>
          <label>مصدر حق الاستخدام<select value={origin} onChange={event => setOrigin(event.target.value as typeof origin)} className={field}>
            <option value="">غير محدد</option>
            {Object.entries(originLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select></label>
          <label>انتهاء الصلاحية <span className="text-slate-500" dir="ltr">{basisZone()}</span><input type="datetime-local" value={expiry} onChange={event => setExpiry(event.target.value)} className={field} /></label>
          <label className="sm:col-span-2">مرجع الترخيص أو شروط الاستخدام<textarea rows={2} maxLength={1000} value={rightsNote} onChange={event => setRightsNote(event.target.value)} className={field} /></label>
        </div>
        <button type="button" disabled={saving} onClick={() => void save({ rights: { status, origin: origin || undefined, expiresAt: expiry ? fromLocalInputValue(expiry) : undefined, note: rightsNote.trim() } })} className={`${button} mt-2`}>حفظ حقوق البث</button>
      </details> : asset.rights?.note && <p className="whitespace-pre-wrap [overflow-wrap:anywhere] text-slate-700">{asset.rights.note}</p>}
    </section>

    {playable && <section className="space-y-2 border-t border-slate-200 pt-3" aria-label="علامات المونتاج">
      <h3 className="font-bold text-slate-900">علامات المونتاج</h3>
      <MediaEditRanges ranges={asset.editRanges} onSeek={seek} />
      {canEdit && <>
        {!!asset.editRanges?.length && <label className="block">اختيار علامة لتعديلها<select value={rangeId || ''} onChange={event => {
          const range = asset.editRanges?.find(item => item.id === event.target.value);
          if (!range) return resetRange();
          setRangeId(range.id);
          setInPoint(String(range.inSeconds));
          setOutPoint(String(range.outSeconds));
          setEditNote(range.note);
        }} className={field}><option value="">علامة جديدة</option>{asset.editRanges.map(range => <option key={range.id} value={range.id}>{mediaTimecode(range.inSeconds)} – {mediaTimecode(range.outSeconds)} {range.note.slice(0, 45)}</option>)}</select></label>}
        <div className="grid gap-2 sm:grid-cols-2">
          {([{ label: 'الدخول', value: inPoint, set: setInPoint }, { label: 'الخروج', value: outPoint, set: setOutPoint }]).map(point => <div key={point.label}>
            <label>نقطة {point.label} (بالثواني)<input type="number" min={0} step="0.01" value={point.value} onChange={event => point.set(event.target.value)} dir="ltr" className={field} /></label>
            <button type="button" onClick={() => { if (player.current) point.set((Math.round(player.current.currentTime * 100) / 100).toString()); }} className="min-h-10 px-1 font-bold text-blue-700">اعتماد موضع التشغيل {point.label === 'الدخول' ? 'للدخول' : 'للخروج'}</button>
          </div>)}
        </div>
        <label className="block">ملاحظة للمونتاج<textarea value={editNote} onChange={event => setEditNote(event.target.value)} maxLength={1000} rows={2} className={field} /></label>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={saving} onClick={() => void saveRange()} className={button}>{rangeId ? 'حفظ العلامة' : 'إضافة العلامة'}</button>
          {rangeId && <button type="button" disabled={saving} onClick={async () => {
            if (await save({ editRanges: (asset.editRanges || []).filter(range => range.id !== rangeId) })) resetRange();
          }} className={`${button} text-rose-700`}>إزالة العلامة</button>}
        </div>
      </>}
    </section>}

    {error && <p role="alert" className="text-rose-700 font-bold">{error}</p>}
    {playable && (transcript || provider?.enabled) && <section className="space-y-2 border-t border-slate-200 pt-3" aria-label="تفريغ عربي بالتوقيت">
      <h3 className="font-bold text-slate-900">تفريغ عربي بالتوقيت</h3>
      {transcript ? <ol className="max-h-56 space-y-2 overflow-auto">
        {transcript.segments.map((segment, index) => <li key={index} className="flex flex-wrap gap-x-2 items-baseline">
          <button type="button" onClick={() => seek(segment.start)} dir="ltr" className="min-h-9 shrink-0 font-mono text-blue-700 hover:underline">{mediaTimecode(segment.start)}</button>
          <span className="min-w-0 flex-1 text-slate-700 [overflow-wrap:anywhere]">{segment.text}</span>
          {onQuote && <button type="button" className="min-h-9 font-semibold text-blue-700 hover:underline" onClick={() => onQuote(segment)}>نقل المقتطف</button>}
        </li>)}
      </ol> : asset.mediaType === 'VIDEO' && !provider?.video ? <p className="text-slate-600">يتطلب تفريغ الفيديو تهيئة FFmpeg على الخادم.</p>
        : <button type="button" disabled={transcribing} onClick={() => void transcribe()} className={button}>{transcribing ? 'جارٍ التفريغ…' : 'بدء التفريغ بالعربية'}</button>}
      {transcriptError && <p role="alert" className="text-rose-700 font-bold">{transcriptError}</p>}
      {!transcript && asset.autoTranscriptionJob && <p role="status" className="text-slate-700">{asset.autoTranscriptionJob.failed ? 'توقف التفريغ التلقائي. يمكنك المحاولة يدويًا.' : 'المادة في قائمة التفريغ التلقائي.'}</p>}
    </section>}
  </div>;
}
