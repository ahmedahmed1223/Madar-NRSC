import { LongTextField } from '../common/TextSizeControls';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { dataStore } from '../../services/dataStore';
import { ReviewThreads } from '../editor/ReviewThreads';
import { useFormDraft } from '../../hooks/useFormDraft';
import { confirmDialog } from '../../services/dialogs';
import { AlertTriangle, CheckCircle2, Film, Lock, Plus, RefreshCw, Send, Undo2, X } from 'lucide-react';
import type { User } from '../../types';
import { apiService } from '../../services/api';
import { ProductionNameField } from '../common/ProductionNameField';
import { RbacService } from '../../services/rbacService';
import { useEditLock } from '../../hooks/useNewsEditLock';
import { FormPage } from '../common/FormPage';
import { MediaPicker } from '../media/MediaPicker';
import {
  Bulletin,
  BulletinStory,
  GRAPHIC_KINDS,
  GraphicKind,
  isApprover,
  mmss,
  plainText,
  readSeconds,
  STORY_TYPES,
  StoryGraphic,
  storyStatusName,
  storyTiming,
  storyTypeOf,
  StoryType,
  approvalProgress,
} from '../../shared/bulletins';

interface Props {
  bulletin: Bulletin;
  /** Story to edit, or a new-story draft (no id yet). */
  story: Partial<BulletinStory> | null;
  currentUser: User;
  onClose: () => void;
  onSaved?: (text: string) => void;
}

const STATUS_TONE: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-600',
  READY: 'bg-amber-100 text-amber-800',
  APPROVED: 'bg-emerald-100 text-emerald-800',
};

/** Newsroom text for the anchor: the lead (summary) or the first paragraph of the story. */
export const anchorCopyFromNews = (n: { summary?: string; content?: string }) => {
  const lead = (n.summary || '').trim();
  if (lead) return lead;
  return plainText(n.content || '').split('\n').find((l) => l.trim()) || '';
};

export const StoryEditor: React.FC<Props> = ({ bulletin, story, currentUser, onClose, onSaved }) => {
  const isOpen = !!story;
  const isNew = !story?.id;
  const actor = { id: currentUser.id, canApprove: RbacService.hasPermission(currentUser, 'bulletins.approve'), canEdit: RbacService.hasPermission(currentUser, 'bulletins.edit'), role: currentUser.role };
  const approver = isApprover(bulletin, actor);
  /** May give the story's next sign-off now. */
  const approverNow = isApprover(bulletin, actor, story?.id ? story : { approvals: [] });
  const progress = story?.id ? approvalProgress(bulletin, story as BulletinStory) : null;
  const mayEdit = actor.canEdit || approver;
  const lock = useEditLock('bulletinStories', story?.id, isOpen && !isNew && mayEdit);
  const lockedByOther = lock.status === 'locked';
  const canEdit = mayEdit && !lockedByOther;

  const [slug, setSlug] = useState('');
  const [type, setType] = useState<StoryType>('READER');
  const [anchorName, setAnchorName] = useState('');
  const [script, setScript] = useState('');
  const [clipMediaId, setClipMediaId] = useState<string | undefined>();
  const [clipSeconds, setClipSeconds] = useState('');
  const [manualSeconds, setManualSeconds] = useState('');
  const [graphics, setGraphics] = useState<StoryGraphic[]>([]);
  const [directorNotes, setDirectorNotes] = useState('');
  const [returnNote, setReturnNote] = useState('');
  const [newsStamp, setNewsStamp] = useState<string | undefined>();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [initialized, setInitialized] = useState('');
  const pendingId = useRef<string | undefined>(undefined);
  const graphicsRequestId = useRef<string | undefined>(undefined);
  const [sourceSnapshot, setSourceSnapshot] = useState<string | undefined>();
  const [comparison, setComparison] = useState<{ script: string; stamp: string } | null>(null);
  const [sourceUndo, setSourceUndo] = useState<{ script: string; stamp?: string; snapshot?: string; applied: string } | null>(null);

  useEffect(() => {
    if (!story) { setInitialized(''); return; }
    setSlug(story.slug || '');
    setType((story.type as StoryType) || 'READER');
    setAnchorName(story.anchorName || '');
    setScript(story.script || '');
    setClipMediaId(story.clipMediaId);
    setClipSeconds(story.clipSeconds ? String(story.clipSeconds) : '');
    setManualSeconds(story.manualSeconds ? String(story.manualSeconds) : '');
    setGraphics(story.graphics || []);
    setDirectorNotes(story.directorNotes || '');
    setReturnNote('');
    setNewsStamp(story.newsUpdatedAt);
    setSourceSnapshot(story.newsSourceSnapshot);
    setComparison(null); setSourceUndo(null); pendingId.current = undefined; graphicsRequestId.current = undefined;
    setError(null);
    setInitialized(story.id || `new:${bulletin.id}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story?.id, isOpen]);

  const meta = storyTypeOf(type);
  const timing = storyTiming({ type, script, clipSeconds: Number(clipSeconds) || 0, manualSeconds: Number(manualSeconds) || 0 });
  const clip = useMemo(() => (clipMediaId ? apiService.getMedia().find((m) => m.id === clipMediaId) : undefined), [clipMediaId]);
  const news = story?.newsId ? apiService.getNews().find((n) => n.id === story.newsId) : undefined;
  const newsChanged = !!news && !!newsStamp && news.updatedAt > newsStamp;
  const status = story?.status || 'DRAFT';

  const payload = (): Partial<BulletinStory> & { bulletinId: string } => ({
    id: story?.id || pendingId.current,
    bulletinId: bulletin.id,
    ...(story?.rank !== undefined ? { rank: story.rank } : {}),
    ...(story?.newsId ? { newsId: story.newsId, newsUpdatedAt: newsStamp, newsSourceSnapshot: sourceSnapshot } : {}),
    ...(story?.wireId ? { wireId: story.wireId } : {}),
    slug: slug.trim(),
    type,
    anchorName: anchorName.trim() || undefined,
    script,
    clipMediaId: meta.clip ? clipMediaId : undefined,
    clipSeconds: meta.clip && clipSeconds ? Number(clipSeconds) : undefined,
    manualSeconds: meta.manual && manualSeconds ? Number(manualSeconds) : undefined,
    graphics: graphics.map((g) => ({ ...g, lines: g.lines.map((l) => l.trim()).filter(Boolean) })).filter((g) => g.lines.length),
    directorNotes: directorNotes.trim() || undefined,
  });

  const recovery = useFormDraft(`bulletin-story:${currentUser.id}:${story?.id || bulletin.id}`, isOpen && canEdit && initialized === (story?.id || `new:${bulletin.id}`),
    { slug, type, script, anchorName, clipMediaId: clipMediaId || '', clipSeconds, manualSeconds, graphics, directorNotes, newsStamp: newsStamp || '', sourceSnapshot: sourceSnapshot ?? '' },
    value => {
      setSlug(value.slug); setType(value.type); setScript(value.script); setAnchorName(value.anchorName);
      setClipMediaId(value.clipMediaId || undefined); setClipSeconds(value.clipSeconds); setManualSeconds(value.manualSeconds);
      setGraphics(value.graphics); setDirectorNotes(value.directorNotes); setNewsStamp(value.newsStamp || undefined); setSourceSnapshot(value.sourceSnapshot || undefined);
    });
  const save = async (statusChange?: BulletinStory['status'], extra: Partial<BulletinStory> = {}) => {
    if (saving || !canEdit) return;
    setSaving(true); setError(null);
    try {
      const saved = apiService.saveBulletinStory({ ...payload(), ...(statusChange ? { status: statusChange } : {}), ...extra });
      pendingId.current = saved.id;
      const outcome = await dataStore.awaitWrite('bulletinStories', saved.id);
      if (!outcome.ok) throw new Error(outcome.message || 'لم يؤكد الخادم حفظ القصة بعد؛ بقيت الحقول لإعادة المحاولة');
      const accepted = apiService.getBulletinStories(bulletin.id).find(s => s.id === saved.id);
      const text =
        statusChange === 'APPROVED'
          ? accepted?.status === 'APPROVED' ? 'اعتُمدت القصة للهواء' : 'سُجل اعتمادك؛ القصة بانتظار الخطوة التالية'
          : statusChange === 'READY'
          ? 'أُرسلت القصة لمحرر النشرة للاعتماد'
          : statusChange === 'DRAFT' && status !== 'DRAFT'
          ? 'أُعيدت القصة للتعديل'
          : status === 'APPROVED' && saved.status !== 'APPROVED'
          ? 'حُفظت التعديلات وأُعيدت القصة للاعتماد'
          : 'حُفظت القصة';
      onSaved?.(text);
      recovery.clearDraft();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'تعذر حفظ القصة');
    } finally { setSaving(false); }
  };

  const refreshFromNews = () => {
    if (!news) return;
    setComparison({ script: anchorCopyFromNews(news), stamp: news.updatedAt });
  };

  const setGraphic = (i: number, patch: Partial<StoryGraphic>) => setGraphics(graphics.map((g, j) => (j === i ? { ...g, ...patch } : g)));

  const sendGraphics = async () => {
    const lines = graphics.flatMap((g) => g.lines.map((l) => l.trim()).filter(Boolean));
    if (!lines.length || !story?.id || saving) return;
    setSaving(true); setError(null);
    try {
      const request = apiService.createRequest({
        id: graphicsRequestId.current,
        type: 'GRAPHICS',
        title: `شارات: ${slug} — ${bulletin.title}`,
        lines,
        dueAt: new Date(`${bulletin.date}T${bulletin.startTime}:00`).toISOString(),
        link: { kind: 'episode', episodeId: bulletin.id, segmentId: story.id, title: `${bulletin.title} — ${slug}` },
      });
      graphicsRequestId.current = request.id;
      const result = await dataStore.awaitWrite('requests', request.id);
      if (!result.ok) throw new Error(result.message || 'لم يؤكد الخادم إرسال الشارات');
      graphicsRequestId.current = undefined;
      onSaved?.('أُرسلت الشارات لقسم الجرافيك');
    } catch (err: any) {
      setError(err?.message || 'تعذر إرسال الطلب');
    } finally { setSaving(false); }
  };

  const words = (script.replace(/\[[^\]]*\]/g, ' ').match(/\S+/g) || []).length;

  return (
    <FormPage isOpen={isOpen} onClose={() => { if (saving) return false; onClose(); }} draft={recovery} title={isNew ? 'قصة جديدة في النشرة' : `قصة: ${story?.slug || ''}`} subtitle={bulletin.title} maxWidth="4xl">
      {story && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          onKeyDown={(e) => {
            // Ctrl+S saves; Ctrl+Enter saves and sends a draft for approval.
            if (e.defaultPrevented || e.repeat || e.nativeEvent.isComposing || !(e.ctrlKey || e.metaKey) || e.altKey || lockedByOther || document.querySelector('[role=dialog], [role=alertdialog]')) return;
            if (e.key === 's' || e.key === 'S' || e.code === 'KeyS') {
              e.preventDefault();
              save();
            } else if (e.key === 'Enter') {
              e.preventDefault();
              save(canEdit && status === 'DRAFT' && script.trim() ? 'READY' : undefined);
            }
          }}
          aria-keyshortcuts="Control+S Meta+S Control+Enter Meta+Enter"
          className="space-y-4"
          data-testid="story-editor"
        >
          <fieldset disabled={saving} className="space-y-4 [&_button]:min-h-11">
          {lockedByOther && lock.holder && (
            <p role="alert" className="flex items-center gap-2 text-xs font-bold text-amber-900 bg-amber-50 border border-amber-300 rounded-xl p-3">
              <Lock className="w-4 h-4" /> القصة قيد التحرير الآن لدى {lock.holder.userName}؛ يمكنك القراءة فقط.
            </p>
          )}
          {!isNew && (
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className={`font-bold px-2 py-0.5 rounded-full ${STATUS_TONE[status]}`}>{storyStatusName(status)}</span>
              {story.writerName && <span className="text-slate-500">كتبها: {story.writerName}</span>}
              {story.approvedByName && <span className="text-emerald-700">اعتمدها: {story.approvedByName}</span>}
              {status === 'APPROVED' && !approver && canEdit && <span className="text-amber-700 font-bold">أي تعديل على النص سيعيدها للاعتماد</span>}
            </div>
          )}

          {newsChanged && (
            <div role="status" className="flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-blue-900 bg-blue-50 border border-blue-200 rounded-xl p-3">
              <span className="flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4" /> تحدّث الخبر في غرفة الأخبار بعد إضافته للنشرة.
              </span>
              {canEdit && (
                <button type="button" onClick={refreshFromNews} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600 text-white">
                  <RefreshCw className="w-3.5 h-3.5" /> تحديث النص من الخبر
                </button>
              )}
            </div>
          )}
          {comparison && <section aria-label="مقارنة نص الخبر" className="border-y border-slate-200 py-3 space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <div><h3 className="font-bold">نص النشرة الحالي</h3><p className="whitespace-pre-wrap break-words">{script}</p></div>
              <div><h3 className="font-bold">آخر نص من غرفة الأخبار</h3><p className="whitespace-pre-wrap break-words">{comparison.script}</p></div>
            </div>
            {sourceSnapshot === undefined ? <p>النسخة المستوردة الأصلية غير متاحة لهذه القصة القديمة.</p> : <details><summary>النص المستورد سابقاً</summary><p className="whitespace-pre-wrap break-words">{sourceSnapshot}</p></details>}
            <div className="flex flex-wrap gap-2">
              <button type="button" className="min-h-11 px-3 border rounded-lg" onClick={() => setComparison(null)}>إلغاء المقارنة</button>
              <button type="button" className="min-h-11 px-3 bg-blue-600 text-white rounded-lg" onClick={async () => {
                const latest = apiService.getNews().find(n => n.id === story.newsId);
                if (!latest) { setError('الخبر الأصلي غير متاح'); return; }
                if (latest.updatedAt !== comparison.stamp) { setComparison({ script: anchorCopyFromNews(latest), stamp: latest.updatedAt }); setError('تغير الخبر مرة أخرى؛ راجع المقارنة الجديدة'); return; }
                if (!await confirmDialog({ title: 'استبدال نص النشرة', message: 'سيُستبدل نص النشرة بالنص المعروض. يبقى التغيير غير محفوظ حتى تأكيد الحفظ.', confirmLabel: 'استبدال النص' })) return;
                if (apiService.getNews().find(n => n.id === story.newsId)?.updatedAt !== comparison.stamp) { setError('تغير الخبر أثناء التأكيد؛ افتح المقارنة مجدداً'); setComparison(null); return; }
                setSourceUndo({ script, stamp: newsStamp, snapshot: sourceSnapshot, applied: comparison.script });
                setScript(comparison.script); setSourceSnapshot(comparison.script); setNewsStamp(comparison.stamp); setComparison(null);
              }}>استبدال النص من الخبر</button>
            </div>
          </section>}
          {sourceUndo && <button type="button" className="min-h-11 text-blue-700 flex items-center gap-2" onClick={async () => {
            if (script !== sourceUndo.applied && !await confirmDialog({ title: 'استعادة النص السابق', message: 'الاستعادة ستستبدل تعديلات النص اللاحقة. متابعة؟', confirmLabel: 'استعادة النص' })) return;
            setScript(sourceUndo.script); setNewsStamp(sourceUndo.stamp); setSourceSnapshot(sourceUndo.snapshot); setSourceUndo(null);
          }}><Undo2 className="w-4 h-4" />تراجع عن تحديث النص</button>}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="sm:col-span-2 block text-xs font-bold text-slate-700">
              عنوان القصة (Slug) *
              <input id="story-slug" data-autofocus required readOnly={!canEdit} value={slug} onChange={(e) => setSlug(e.target.value)} className="mt-1 w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm font-bold" />
            </label>
            <label className="block text-xs font-bold text-slate-700">
              المذيع
              <ProductionNameField kind="PRESENTER" label="المذيع" fallbackNames={bulletin.anchors} readOnly={!canEdit} value={anchorName} placeholder={bulletin.anchors[0] || ''} onChange={setAnchorName} className="mt-1 w-full px-3 py-2.5 border border-slate-300 rounded-xl text-xs" />
            </label>
          </div>

          <div>
            <span className="block text-xs font-bold text-slate-700 mb-1">نوع القصة</span>
            <div role="radiogroup" aria-label="نوع القصة" className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-1.5">
              {STORY_TYPES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={type === t.id}
                  disabled={!canEdit}
                  onClick={() => setType(t.id)}
                  title={t.hint}
                  className={`p-2 rounded-lg border text-right ${type === t.id ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'}`}
                >
                  <span className="block text-[11px] font-black font-mono">{t.code}</span>
                  <span className="block text-[10px]">{t.name}</span>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-500 mt-1">{meta.hint}</p>
          </div>

          {meta.read && (
            <LongTextField
              id="story-script"
              name="نص المذيع"
              sizeKey="anchor-script"
              label={`نص المذيع ${meta.clip ? '(المقدمة / الربط)' : ''}`}
              aside={
                <span className="text-[11px] font-mono text-purple-700 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded-md">
                  {words} كلمة · قراءة {mmss(readSeconds(script))}
                </span>
              }
              rows={8}
              readOnly={!canEdit}
              value={script}
              onChange={(e) => setScript(e.target.value)}
              placeholder="النص كما سيقرؤه المذيع على الملقن. ضع التوجيهات بين أقواس مربعة [كاميرا 2] ولن تُحسب في زمن القراءة."
              className="px-3.5 py-3 border border-slate-300 rounded-xl bg-white"
            />
          )}

          {meta.clip && (
            <div className="p-3 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <Film className="w-4 h-4 text-blue-600" /> اللقطة / الفيديو
                </span>
                {canEdit && (
                  <button type="button" onClick={() => setPickerOpen(true)} className="text-xs font-bold text-blue-700 hover:underline">
                    {clip ? 'تغيير' : 'اختيار من مكتبة الوسائط'}
                  </button>
                )}
              </div>
              {clip ? (
                <p className="text-xs text-slate-700 flex items-center gap-2">
                  <strong>{(clip as any).title || clip.originalName || clip.fileName}</strong>
                  {canEdit && (
                    <button type="button" onClick={() => setClipMediaId(undefined)} aria-label="إزالة اللقطة" className="text-slate-500 hover:text-rose-600">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </p>
              ) : (
                <p className="text-[11px] text-slate-500">لم تُختر لقطة بعد.</p>
              )}
              <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
                مدة اللقطة (ثوانٍ)
                <input id="story-clip-seconds" type="number" min={0} readOnly={!canEdit} value={clipSeconds} onChange={(e) => setClipSeconds(e.target.value)} className="w-24 px-2 py-1.5 border border-slate-300 rounded-lg text-xs" />
              </label>
            </div>
          )}

          {meta.manual && (
            <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
              المدة المقدرة {type === 'BREAK' ? 'للفاصل' : 'للمداخلة'} (ثوانٍ)
              <input id="story-manual-seconds" type="number" min={0} readOnly={!canEdit} value={manualSeconds} onChange={(e) => setManualSeconds(e.target.value)} className="w-24 px-2 py-1.5 border border-slate-300 rounded-lg text-xs" />
            </label>
          )}

          <div className="flex flex-wrap items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-700 text-xs font-mono" dir="ltr" aria-label="توقيت القصة">
            <span>READ {mmss(timing.read)}</span>
            {meta.clip && <span>CLIP {mmss(timing.clip)}</span>}
            {meta.manual && <span>EST {mmss(timing.manual)}</span>}
            <span className="font-black text-emerald-700">TOTAL {mmss(timing.total)}</span>
          </div>

          <fieldset className="p-3 rounded-xl border border-slate-200 space-y-2">
            <legend className="px-1 text-xs font-bold text-slate-700">الشارات والجرافيك ({graphics.length})</legend>
            {graphics.map((g, i) => (
              <div key={i} className="flex flex-wrap items-start gap-2">
                <select
                  aria-label={`نوع الشارة ${i + 1}`}
                  disabled={!canEdit}
                  value={g.kind}
                  onChange={(e) => setGraphic(i, { kind: e.target.value as GraphicKind })}
                  className="px-2 py-1.5 border border-slate-300 rounded-lg text-xs bg-white"
                >
                  {GRAPHIC_KINDS.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.name}
                    </option>
                  ))}
                </select>
                <textarea
                  aria-label={`نص الشارة ${i + 1}`}
                  rows={2}
                  readOnly={!canEdit}
                  value={g.lines.join('\n')}
                  onChange={(e) => setGraphic(i, { lines: e.target.value.split('\n') })}
                  placeholder="سطر لكل سطر في الشارة"
                  className="flex-1 min-w-[12rem] px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs"
                />
                {canEdit && (
                  <button type="button" onClick={() => setGraphics(graphics.filter((_, j) => j !== i))} aria-label="حذف الشارة" className="p-1 text-rose-500">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
            <div className="flex flex-wrap gap-3">
              {canEdit && (
                <button type="button" onClick={() => setGraphics([...graphics, { kind: 'STRAP', lines: [''] }])} className="flex items-center gap-1 text-xs font-bold text-blue-700 hover:underline">
                  <Plus className="w-3.5 h-3.5" /> شارة
                </button>
              )}
              {!isNew && graphics.some((g) => g.lines.some((l) => l.trim())) && RbacService.hasPermission(currentUser, 'requests.create') && (
                <button type="button" onClick={sendGraphics} className="flex items-center gap-1 text-xs font-bold text-purple-700 hover:underline">
                  <Send className="w-3.5 h-3.5" /> إرسال لقسم الجرافيك
                </button>
              )}
            </div>
          </fieldset>

          <label className="block text-xs font-bold text-slate-700">
            ملاحظات للمخرج والكنترول
            <input readOnly={!canEdit} value={directorNotes} onChange={(e) => setDirectorNotes(e.target.value)} placeholder="مثال: كاميرا 2، خط SNG-1" className="mt-1 w-full px-3 py-2.5 border border-slate-300 rounded-xl text-xs" />
          </label>

          {story.returnNote && status === 'DRAFT' && (
            <p className="text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-2.5">ملاحظة المحرر: {story.returnNote}</p>
          )}

          {error && (
            <p role="alert" className="text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2">
              {error}
            </p>
          )}

          {story.id && <ReviewThreads collection="bulletinStories" entityId={story.id} text={script} version={story.updatedAt || 'legacy'} canPost={canEdit && !saving} />}
          <div className="sticky bottom-0 bg-white flex flex-wrap items-center justify-between gap-2 py-3 border-t border-slate-100">
            <div className="flex flex-wrap items-center gap-2">
              {canEdit && status === 'DRAFT' && (
                <button type="button" onClick={() => save('READY')} className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-700 hover:bg-amber-800 text-white text-xs font-bold">
                  <Send className="w-4 h-4" /> حفظ وإرسال للاعتماد
                </button>
              )}
              {approverNow && !lockedByOther && (status !== 'APPROVED' || progress?.next) && (
                <button type="button" onClick={() => save('APPROVED')} className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold">
                  <CheckCircle2 className="w-4 h-4" />
                  {progress && progress.total - progress.done > 1 ? `اعتمادي (${progress.nextName})` : 'حفظ واعتماد للهواء'}
                </button>
              )}
              {progress && progress.total > 1 && status !== 'DRAFT' && (
                <span className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1" aria-label="تقدم الاعتماد">
                  الاعتماد {progress.done}/{progress.total}
                  {progress.next ? ` — بانتظار: ${progress.nextName}` : ''}
                  {(story?.approvals || []).length > 0 && ` (${(story!.approvals || []).map((a) => a.byName).join('، ')})`}
                </span>
              )}
              {approver && !lockedByOther && !isNew && status !== 'DRAFT' && (
                <span className="flex items-center gap-1.5">
                  <input aria-label="ملاحظة الإعادة" value={returnNote} onChange={(e) => setReturnNote(e.target.value)} placeholder="ملاحظة للكاتب" className="px-2.5 py-2 border border-slate-300 rounded-xl text-xs w-40" />
                  <button type="button" onClick={() => save('DRAFT', { returnNote: returnNote.trim() || undefined })} className="flex items-center gap-1 px-3 py-2 rounded-xl border border-rose-200 text-rose-700 text-xs font-bold hover:bg-rose-50">
                    <Undo2 className="w-4 h-4" /> إعادة للتعديل
                  </button>
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl">
                إغلاق
              </button>
              {canEdit && (
                <button type="submit" className="px-5 py-2 text-xs font-bold bg-blue-600 text-white rounded-xl">
                  حفظ
                </button>
              )}
            </div>
          </div>

          </fieldset>
          <MediaPicker
            isOpen={pickerOpen}
            onClose={() => setPickerOpen(false)}
            selectedIds={clipMediaId ? [clipMediaId] : []}
            canUpload={RbacService.hasPermission(currentUser, 'media.upload')}
            onPick={(ids) => {
              const id = ids.find((x) => x !== clipMediaId) || ids[0];
              setClipMediaId(id);
              const m = apiService.getMedia().find((x) => x.id === id);
              if (m?.durationSeconds) setClipSeconds(String(Math.round(m.durationSeconds)));
              setPickerOpen(false);
            }}
          />
        </form>
      )}
    </FormPage>
  );
};
