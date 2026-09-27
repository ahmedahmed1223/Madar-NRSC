import { appLocale, zoneOptions } from '../shared/dateFormat';
import { confirmDialog, promptDialog } from '../services/dialogs';
import { ApprovalChainEditor } from '../components/bulletins/ApprovalChainEditor';
import { embargoLabel, isUnderEmbargo } from '../shared/newsWorkflow';
import { matchesQuery } from '../shared/search';
import React, { useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CheckCircle2,
  CircleSlash,
  Download,
  Edit2,
  EyeOff,
  FileInput,
  Film,
  ListChecks,
  Plus,
  Radio,
  Rss,
  Save,
  Settings2,
  Sparkles,
  Trash2,
  Type,
  Copy,
} from 'lucide-react';
import type { NewsItem, RundownSegment, User } from '../types';
import { apiService } from '../services/api';
import { RbacService } from '../services/rbacService';
import { useLiveData } from '../hooks/useLiveData';
import { FormPage } from '../components/common/FormPage';
import { TeleprompterModal } from '../components/rundown/TeleprompterModal';
import { StoryEditor, anchorCopyFromNews } from '../components/bulletins/StoryEditor';
import { ExportMenu, docContext } from '../components/common/ExportMenu';
import { DropEvent, SortableItem, SortableList, SortableScope } from '../components/dnd/Sortable';
import { notify } from '../services/notify';
import { anchorScriptsDoc, bulletinGraphicsDoc, bulletinRundownDoc } from '../services/documents/builders';
import { canControlOnAir } from '../shared/onair';
import { departmentIdOf } from '../shared/departments';
import {
  Bulletin,
  BULLETIN_KINDS,
  BulletinKind,
  bulletinAsShow,
  bulletinKindName,
  BulletinStory,
  bulletinTiming,
  byRank,
  clockOf,
  headlinesFrom,
  isApprover,
  mmss,
  rankBetween,
  STORY_TYPES,
  storyStatusName,
  STORY_STATUSES,
  storyStatusError,
  storyTiming,
  storyTypeOf,
  StoryType,
  approvalProgress,
  approvalStepName,
  approvalStepsOf,
} from '../shared/bulletins';

interface Props {
  bulletinId: string;
  currentUser: User;
  onBack: () => void;
  onOpenOnAir: (id: string) => void;
  onOpenNews?: (id: string) => void;
}

const STATUS_TONE: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-600',
  READY: 'bg-amber-100 text-amber-800',
  APPROVED: 'bg-emerald-100 text-emerald-800',
};

const PULLABLE = ['APPROVED', 'SCHEDULED', 'PUBLISHED', 'UNDER_REVIEW'];
const NEWS_STATUS: Record<string, string> = { APPROVED: 'معتمد', SCHEDULED: 'مجدول', PUBLISHED: 'منشور', UNDER_REVIEW: 'قيد المراجعة' };

export const BulletinRundownView: React.FC<Props> = ({ bulletinId, currentUser, onBack, onOpenOnAir, onOpenNews }) => {
  useLiveData(['bulletins', 'bulletinStories', 'onAir', 'news', 'editLocks', 'media'], 1000);
  const bulletin = apiService.getBulletins().find((b) => b.id === bulletinId);
  const all = apiService.getBulletinStories(bulletinId);
  const [showKilled, setShowKilled] = useState(false);
  const [rowQuery, setRowQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'DRAFT' | 'READY' | 'APPROVED'>('ALL');
  const [editing, setEditing] = useState<Partial<BulletinStory> | null>(null);
  const [addMenu, setAddMenu] = useState(false);
  const [source, setSource] = useState<'NEWS' | 'WIRES' | 'COPY' | null>(null);
  /** Sending copies of this bulletin's stories to another bulletin. */
  const [sendTo, setSendTo] = useState<{ target: string; ids: string[] } | null>(null);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [copyFrom, setCopyFrom] = useState('');
  const [meta, setMeta] = useState<(Omit<Bulletin, 'plannedSeconds' | 'anchors'> & { minutes: string; anchorsText: string }) | null>(null);
  const [prompter, setPrompter] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const flash = (ok: boolean, text: string) => {
    setMessage({ ok, text });
    window.setTimeout(() => setMessage(null), 4500);
  };
  const attempt = (fn: () => void, ok?: string) => {
    try {
      fn();
      if (ok) flash(true, ok);
    } catch (err: any) {
      flash(false, err?.message || 'تعذر تنفيذ العملية');
    }
  };

  const can = (p: string) => RbacService.hasPermission(currentUser, p);
  const actor = { id: currentUser.id, canApprove: can('bulletins.approve'), canEdit: can('bulletins.edit'), role: currentUser.role };
  const approver = isApprover(bulletin, actor);
  const canEdit = actor.canEdit || approver;
  const canManage = can('bulletins.manage') || (!!bulletin?.editorId && bulletin.editorId === currentUser.id);
  const canRunAir = canControlOnAir(currentUser, can);

  const timing = useMemo(() => (bulletin ? bulletinTiming(bulletin, all) : null), [bulletin, all]);
  if (!bulletin || !timing) {
    return (
      <div className="bg-white p-10 rounded-2xl border border-slate-200 text-center text-sm text-slate-500">
        النشرة غير موجودة أو حُذفت.{' '}
        <button type="button" onClick={onBack} className="text-blue-700 font-bold">
          العودة للنشرات
        </button>
      </div>
    );
  }

  const visible = all.filter(
    (s) => (showKilled || !s.killed) && (statusFilter === 'ALL' || s.status === statusFilter) && matchesQuery(rowQuery, s.slug, s.script, s.anchorName, s.writerName)
  );
  const air = all.filter((s) => !s.floated && !s.killed);
  const approvedCount = air.filter((s) => s.status === 'APPROVED').length;
  const readyCount = air.filter((s) => s.status === 'READY').length;
  const myApprovals = air.filter((s) => s.status === 'READY' && isApprover(bulletin, actor, s)).length;
  const onAir = apiService.getOnAir(bulletin.id);
  const liveId = onAir?.status === 'LIVE' ? onAir.currentSegmentId : null;
  const now = new Date();
  const secondsNow = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  const isToday = bulletin.date === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const toAir = isToday ? timing.start - secondsNow : null;
  const locks = apiService.getEditLocks();
  const lockOf = (id: string) => locks.find((l) => l.id === `bulletinStories:${id}` && l.userId !== currentUser.id && new Date(l.expiresAt || 0).getTime() > Date.now());

  const addStory = (type: StoryType) => {
    setAddMenu(false);
    setEditing({ bulletinId: bulletin.id, type, slug: '', script: '', status: 'DRAFT', anchorName: '' });
  };

  /** Dropping a story rewrites only its rank (between its new neighbours); the move can be undone. */
  const dropStory = ({ id, index }: DropEvent) => {
    const story = all.find((x) => x.id === id);
    if (!story) return;
    const others = visible.filter((x) => x.id !== id);
    const before = others[index - 1];
    const after = others[index];
    const rank = rankBetween(before?.rank, after?.rank);
    const previous = story.rank;
    attempt(() => apiService.saveBulletinStory({ id, bulletinId: story.bulletinId, rank }));
    notify({
      type: 'success',
      message: `نُقلت «${story.slug}» إلى الموضع ${index + 1}`,
      action: { label: 'تراجع', run: () => attempt(() => apiService.saveBulletinStory({ id, bulletinId: story.bulletinId, rank: previous })) },
    });
  };

  const toggle = (s: BulletinStory, patch: Partial<BulletinStory>, text: string) => attempt(() => apiService.saveBulletinStory({ id: s.id, bulletinId: s.bulletinId, ...patch }), text);

  const makeHeadlines = () =>
    attempt(() => {
      const text = headlinesFrom(all);
      if (!text) throw new Error('لا قصص كافية لتوليد العناوين');
      const existing = all.find((s) => s.type === 'HEADLINES' && !s.killed);
      if (existing) apiService.saveBulletinStory({ id: existing.id, bulletinId: bulletin.id, script: text });
      else apiService.saveBulletinStory({ bulletinId: bulletin.id, type: 'HEADLINES', slug: 'العناوين', script: text, rank: rankBetween(undefined, all[0]?.rank) });
    }, 'وُلّدت العناوين من أولى قصص النشرة');

  // --- Pull from sources -------------------------------------------------------
  const news = apiService
    .getNews()
    .filter((n) => PULLABLE.includes(n.status) && !(n as any).deletedAt)
    .filter((n) => matchesQuery(query, n.title, n.shortTitle, n.summary, n.keywords || []))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 40);
  const wires = apiService
    .getWires()
    .filter((w) => matchesQuery(query, w.title, w.summary, w.sourceName))
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, 40);
  const others = apiService
    .getBulletins()
    .filter((b) => b.id !== bulletin.id)
    .sort((a, b) => `${b.date}${b.startTime}`.localeCompare(`${a.date}${a.startTime}`))
    .slice(0, 20);
  const copyStories = copyFrom ? apiService.getBulletinStories(copyFrom).filter((s) => !s.killed) : [];
  const inBulletin = new Set(all.map((s) => s.newsId).filter(Boolean));

  const pullNews = (n: NewsItem) => {
    const video = (n.mediaIds || []).map((id) => apiService.getMedia().find((m) => m.id === id)).find((m) => m?.mediaType === 'VIDEO');
    apiService.saveBulletinStory({
      bulletinId: bulletin.id,
      slug: n.shortTitle || n.title,
      type: video ? 'VO' : 'READER',
      script: anchorCopyFromNews(n as any),
      newsId: n.id,
      newsUpdatedAt: n.updatedAt,
      clipMediaId: video?.id,
      clipSeconds: video?.durationSeconds ? Math.round(video.durationSeconds) : undefined,
      status: 'DRAFT',
    });
  };

  const addPicked = () =>
    attempt(() => {
      if (source === 'NEWS') picked.forEach((id) => pullNews(apiService.getNews().find((n) => n.id === id)!));
      if (source === 'WIRES')
        picked.forEach((id) => {
          const w = apiService.getWires().find((x) => x.id === id)!;
          apiService.saveBulletinStory({ bulletinId: bulletin.id, slug: w.title, type: 'READER', script: w.summary || '', wireId: w.id, status: 'DRAFT' });
        });
      if (source === 'COPY') apiService.copyStoriesToBulletin(picked, bulletin.id);
      const n = picked.length;
      setSource(null);
      setPicked([]);
      setQuery('');
      if (!n) throw new Error('لم تُختر أي مادة');
    }, `أُضيفت ${picked.length} قصة كمسودات في آخر النشرة`);

  const saveMeta = (e: React.FormEvent) => {
    e.preventDefault();
    if (!meta) return;
    const { minutes, anchorsText, ...rest } = meta;
    attempt(() => {
      apiService.saveBulletin({ ...rest, plannedSeconds: Math.round(Number(minutes) * 60), anchors: anchorsText.split(/[،,]/).map((x) => x.trim()).filter(Boolean) });
      setMeta(null);
    }, 'حُفظت بيانات النشرة');
  };

  const saveAsFormat = async () => {
    const name = (await promptDialog({ title: 'حفظ النشرة قالباً', label: 'اسم القالب', defaultValue: bulletin.title.split(' — ')[0], required: true }))?.trim();
    if (!name) return;
    attempt(() => {
      apiService.saveBulletinFormat({
        name,
        kind: bulletin.kind,
        startTime: bulletin.startTime,
        plannedSeconds: bulletin.plannedSeconds,
        editorId: bulletin.editorId,
        anchors: bulletin.anchors,
        studioName: bulletin.studioName,
        days: [],
        autoCreate: false,
        stories: air.sort(byRank).map((s) => ({ slug: s.slug, type: s.type, manualSeconds: storyTypeOf(s.type).manual ? s.manualSeconds : undefined })),
      });
    }, 'حُفظت بنية النشرة كقالب؛ حدد أيام جدولته من «القوالب والجدولة»');
  };

  const users = apiService.getUsers().filter((u) => u.isActive !== false);
  const show = bulletinAsShow(bulletin, all);
  const off = timing.overUnder;

  return (
    <div className="space-y-4" data-testid="bulletin-rundown">
      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <button type="button" onClick={onBack} aria-label="العودة للنشرات" className="p-2 text-slate-500 hover:bg-slate-100 rounded-xl">
              <ArrowRight className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className="font-bold px-2 py-0.5 rounded bg-blue-50 text-blue-700">{bulletinKindName(bulletin.kind)}</span>
                {onAir?.status === 'LIVE' && <span className="font-bold px-2 py-0.5 rounded bg-red-600 text-white">على الهواء</span>}
                {bulletin.status === 'DONE' && <span className="font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700">أُذيعت</span>}
              </div>
              <h1 className="text-lg sm:text-xl font-black text-slate-800 mt-1">{bulletin.title}</h1>
              <p className="text-[11px] text-slate-500">
                المحرر: <strong className="text-slate-700">{bulletin.editorName || '—'}</strong> · التقديم: <strong className="text-slate-700">{bulletin.anchors.join('، ') || '—'}</strong>
                {bulletin.studioName ? ` · ${bulletin.studioName}` : ''}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {canManage && (
              <button
                type="button"
                onClick={() => setMeta({ ...bulletin, minutes: String(Math.round(bulletin.plannedSeconds / 60)), anchorsText: bulletin.anchors.join('، ') })}
                className="flex items-center gap-1 px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50"
              >
                <Settings2 className="w-4 h-4" /> بيانات النشرة
              </button>
            )}
            <button type="button" onClick={() => setPrompter(true)} className="flex items-center gap-1 px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50">
              <Type className="w-4 h-4" /> الملقن
            </button>
            <ExportMenu
              items={[
                { id: 'rundown', label: 'رانداون النشرة', hint: 'البداية وBack والمدد والشارات — للمخرج والكنترول', build: () => bulletinRundownDoc(bulletin, all, docContext()) },
                { id: 'scripts', label: 'نصوص المذيع', hint: 'قصة في كل صفحة بخط كبير', build: () => anchorScriptsDoc(bulletin, all, docContext()) },
                { id: 'cg', label: 'قائمة الشارات', hint: 'لقسم الجرافيك بترتيب البث', build: () => bulletinGraphicsDoc(bulletin, all, docContext()) },
              ]}
            />
            <a href={`/api/v1/bulletins/${encodeURIComponent(bulletin.id)}/mos`} download className="flex items-center gap-1 px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50">
              <Download className="w-4 h-4" /> MOS
            </a>
            {can('bulletins.manage') && (
              <button type="button" onClick={saveAsFormat} className="flex items-center gap-1 px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50">
                <Save className="w-4 h-4" /> حفظ كقالب
              </button>
            )}
            {canRunAir && (
              <button type="button" onClick={() => onOpenOnAir(bulletin.id)} className="flex items-center gap-1 px-3 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold">
                <Radio className="w-4 h-4" /> وضع الهواء
              </button>
            )}
          </div>
        </div>

        {/* Timing strip */}
        <div className="grid grid-cols-3 lg:grid-cols-6 gap-2 bg-white border border-slate-200 text-slate-900 rounded-xl p-3 font-mono text-center" aria-label="توقيت النشرة">
          {[
            { label: 'البداية', value: clockOf(timing.start) },
            { label: 'النهاية المحددة', value: clockOf(timing.hardOut) },
            { label: 'المخطط', value: mmss(timing.planned) },
            { label: 'المجموع', value: mmss(timing.total) },
            { label: off > 0 ? 'زيادة' : 'نقص', value: `${off > 0 ? '+' : ''}${mmss(off)}`, tone: Math.abs(off) <= 10 ? 'text-emerald-700' : off > 0 ? 'text-rose-600' : 'text-amber-700' },
            { label: 'حتى الهواء', value: toAir === null ? '—' : toAir > 0 ? clockOf(toAir) : onAir?.status === 'LIVE' ? 'ON AIR' : '—', tone: toAir !== null && toAir > 0 && toAir < 900 ? 'text-amber-700' : '' },
          ].map((c) => (
            <div key={c.label}>
              <div className="text-[10px] text-slate-500 font-sans">{c.label}</div>
              <div className={`text-sm sm:text-lg font-black ${c.tone || ''}`} dir="ltr">
                {c.value}
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3 text-[11px]">
          <span className="font-bold text-slate-700">{air.length} قصة على الهواء</span>
          <span className="text-emerald-700 font-bold">{approvedCount} معتمدة</span>
          {readyCount > 0 && <span className="text-amber-700 font-bold">{readyCount} بانتظار الاعتماد{myApprovals > 0 ? ` (${myApprovals} بانتظارك)` : ''}</span>}
          <span className="text-slate-500">مسار الاعتماد: {approvalStepsOf(bulletin).map((st) => approvalStepName(st, bulletin)).join(' ← ')}</span>
          <span className="text-slate-500">{air.length - approvedCount - readyCount} مسودة</span>
          <input
            type="search"
            aria-label="بحث في قصص النشرة"
            value={rowQuery}
            onChange={(e) => setRowQuery(e.target.value)}
            placeholder="بحث في القصص…"
            className="px-2.5 py-1 border border-slate-200 rounded-lg text-[11px] bg-white w-40"
          />
          <div role="group" aria-label="تصفية حسب الحالة" className="flex gap-1">
            {([
              ['ALL', 'الكل'],
              ['READY', 'بانتظار الاعتماد'],
              ['DRAFT', 'مسودات'],
              ['APPROVED', 'معتمدة'],
            ] as const).map(([id, name]) => (
              <button
                key={id}
                type="button"
                aria-pressed={statusFilter === id}
                onClick={() => setStatusFilter(id)}
                className={`px-2 py-1 rounded-lg text-[11px] font-bold border ${statusFilter === id ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-slate-200 text-slate-600'}`}
              >
                {name}
              </button>
            ))}
          </div>
          {(() => {
            // One click for the routine moves: approve everything ready, or send my drafts for approval.
            const free = all.filter((s) => !s.killed && !lockOf(s.id));
            const approvable = free.filter((s) => s.status === 'READY' && !storyStatusError(s, { ...s, status: 'APPROVED' }, bulletin, actor));
            const mine = free.filter(
              (s) => s.status === 'DRAFT' && (s.writerId === currentUser.id || !s.writerId) && (s.script || '').trim() && !storyStatusError(s, { ...s, status: 'READY' }, bulletin, actor)
            );
            const bulk = (list: BulletinStory[], to: BulletinStory['status'], done: string) =>
              attempt(() => list.forEach((s) => apiService.saveBulletinStory({ id: s.id, bulletinId: s.bulletinId, status: to })), done);
            return (
              <>
                {approvable.length > 0 && (
                  <button
                    type="button"
                    onClick={async () =>
                      (await confirmDialog({ title: 'اعتماد القصص الجاهزة', message: `اعتماد ${approvable.length} قصة جاهزة: ${approvable.map((s) => s.slug).slice(0, 6).join('، ')}${approvable.length > 6 ? '…' : ''}`, confirmLabel: 'اعتماد' })) &&
                      bulk(approvable, 'APPROVED', `سُجّل اعتمادك لـ${approvable.length} قصة`)
                    }
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" /> اعتماد الجاهزة ({approvable.length})
                  </button>
                )}
                {mine.length > 0 && (
                  <button
                    type="button"
                    onClick={() => bulk(mine, 'READY', `أُرسلت ${mine.length} قصة للاعتماد`)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-bold"
                  >
                    إرسال مسوداتي للاعتماد ({mine.length})
                  </button>
                )}
              </>
            );
          })()}
          <label className="flex items-center gap-1 text-slate-600 mr-auto">
            <input type="checkbox" checked={showKilled} onChange={(e) => setShowKilled(e.target.checked)} /> إظهار المستبعدة ({all.filter((s) => s.killed).length})
          </label>
        </div>
      </div>

      {message && (
        <p role="status" className={`text-xs font-bold rounded-xl p-2.5 border ${message.ok ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200'}`}>
          {message.text}
        </p>
      )}

      {/* Toolbar */}
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2 relative">
          <button type="button" onClick={() => setAddMenu((v) => !v)} aria-expanded={addMenu} className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold">
            <Plus className="w-4 h-4" /> قصة جديدة
          </button>
          {addMenu && (
            <div role="menu" className="absolute top-full mt-1 right-0 z-20 bg-white border border-slate-200 rounded-xl shadow-lg p-2 grid grid-cols-2 sm:grid-cols-3 gap-1 w-80">
              {STORY_TYPES.map((t) => (
                <button key={t.id} type="button" role="menuitem" onClick={() => addStory(t.id)} className="text-right px-2 py-1.5 rounded-lg hover:bg-blue-50 text-xs">
                  <span className="font-mono font-black text-blue-700">{t.code}</span> {t.name}
                </button>
              ))}
            </div>
          )}
          <button type="button" onClick={() => setSource('NEWS')} className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50">
            <FileInput className="w-4 h-4" /> من غرفة الأخبار
          </button>
          <button type="button" onClick={() => setSource('WIRES')} className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50">
            <Rss className="w-4 h-4" /> من البرقيات
          </button>
          <button type="button" onClick={() => setSource('COPY')} className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50">
            <ListChecks className="w-4 h-4" /> من نشرة أخرى
          </button>
          <button
            type="button"
            onClick={() => setSendTo({ target: '', ids: all.filter((x) => !x.killed).map((x) => x.id) })}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50"
          >
            <Copy className="w-4 h-4" /> نسخ إلى نشرة أخرى
          </button>
          <button type="button" onClick={makeHeadlines} className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50">
            <Sparkles className="w-4 h-4" /> توليد العناوين
          </button>
        </div>
      )}

      {/* Rundown */}
      <SortableScope onDrop={dropStory} disabled={!canEdit}>
      <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
        <table className="w-full text-xs md:min-w-[900px]" aria-label="رانداون النشرة">
          <thead className="bg-slate-50 text-slate-500 text-[11px]">
            <tr>
              <th className="p-2 text-right w-8">#</th>
              <th className="p-2 text-right">القصة</th>
              <th className="p-2 text-center">النوع</th>
              <th className="p-2 text-right hidden lg:table-cell">المذيع</th>
              <th className="p-2 text-center">الحالة</th>
              <th className="p-2 text-center hidden md:table-cell">قراءة</th>
              <th className="p-2 text-center hidden md:table-cell">لقطة</th>
              <th className="p-2 text-center">المدة</th>
              <th className="p-2 text-center hidden sm:table-cell">البداية</th>
              <th className="p-2 text-center hidden md:table-cell">Back</th>
              <th className="p-2 text-center">إجراءات</th>
            </tr>
          </thead>
          <SortableList id="bulletin" as="tbody">
            {visible.length === 0 && (
              <tr>
                <td colSpan={11} className="p-8 text-center text-slate-400">
                  النشرة فارغة. أضف قصة أو اسحب أخباراً معتمدة من غرفة الأخبار.
                </td>
              </tr>
            )}
            {visible.map((s) => {
              const st = storyTiming(s);
              const row = timing.rows.get(s.id);
              const n = air.findIndex((x) => x.id === s.id);
              const t = storyTypeOf(s.type);
              const news = s.newsId ? apiService.getNews().find((x) => x.id === s.newsId) : undefined;
              const changed = !!news && !!s.newsUpdatedAt && news.updatedAt > s.newsUpdatedAt;
              const lock = lockOf(s.id);
              const isLive = liveId === s.id;
              const idx = all.findIndex((x) => x.id === s.id);
              return (
                <SortableItem
                  as="tr"
                  id={s.id}
                  container="bulletin"
                  label={s.slug}
                  disabled={!!lock}
                  key={s.id}
                  className={`border-t border-slate-100 ${isLive ? 'bg-red-50' : s.killed ? 'bg-slate-50 line-through text-slate-400' : s.floated ? 'bg-slate-50/70 text-slate-400' : 'hover:bg-blue-50/30'}`}
                >
                  {({ handle }) => (
                  <>
                  <td className="p-1 font-mono text-slate-400">
                    <span className="flex items-center gap-0.5">
                      {canEdit && handle}
                      {s.floated || s.killed ? '—' : n + 1}
                    </span>
                  </td>
                  <td className="p-2">
                    <button type="button" onClick={() => setEditing(s)} className="text-right font-bold text-slate-800 hover:text-blue-700">
                      {isLive && <span className="text-red-600 ml-1">●</span>}
                      {s.slug}
                    </button>
                    <div className="flex flex-wrap gap-1 mt-0.5">
                      {s.floated && <span className="text-[10px] font-bold text-slate-500">عائمة (خارج التوقيت)</span>}
                      {s.killed && <span className="text-[10px] font-bold text-rose-500">مستبعدة</span>}
                      {changed && <span className="text-[10px] font-bold text-blue-700">تحدّث الخبر</span>}
                      {isUnderEmbargo(news) && <span className="text-[10px] font-bold text-rose-700">⚠ الخبر محظور حتى {embargoLabel(news!.embargoUntil)}</span>}
                      {lock && <span className="text-[10px] font-bold text-amber-700">يحررها {lock.userName}</span>}
                      {s.clipMediaId && <Film className="w-3 h-3 text-blue-500" aria-label="لقطة" />}
                      {(s.graphics || []).length > 0 && <span className="text-[10px] text-purple-700">CG×{s.graphics!.length}</span>}
                      {s.newsId && onOpenNews && (
                        <button type="button" onClick={() => onOpenNews(s.newsId!)} className="text-[10px] text-indigo-700 hover:underline">
                          الخبر
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="p-2 text-center font-mono font-black text-blue-700" title={t.name}>
                    {t.code}
                  </td>
                  <td className="p-2 hidden lg:table-cell">{s.anchorName || bulletin.anchors[0] || ''}</td>
                  <td className="p-2 text-center">
                    {(() => {
                      // Change the status straight from the rundown: only moves this colleague may make.
                      const options = STORY_STATUSES.filter(
                        (o) => o.id === s.status || (!lock && !s.killed && !storyStatusError(s, { ...s, status: o.id }, bulletin, actor))
                      );
                      if (options.length < 2) {
                        return <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${STATUS_TONE[s.status]}`}>{storyStatusName(s.status)}</span>;
                      }
                      return (
                        <select
                          value={s.status}
                          aria-label={`حالة «${s.slug}»`}
                          title="تغيير حالة القصة"
                          data-compact
                          onChange={(e) => {
                            const to = e.target.value as BulletinStory['status'];
                            const pr = approvalProgress(bulletin, s);
                            toggle(
                              s,
                              { status: to },
                              to === 'APPROVED'
                                ? pr.total - pr.done > 1
                                  ? `سُجّل اعتمادك لـ«${s.slug}»؛ بانتظار الخطوة التالية`
                                  : `اعتُمدت «${s.slug}» للهواء`
                                : to === 'READY'
                                  ? `«${s.slug}» جاهزة للاعتماد`
                                  : `أُعيدت «${s.slug}» مسودة`
                            );
                          }}
                          className={`text-[10px] font-bold ps-1.5 pe-5 py-0.5 rounded border-0 cursor-pointer ${STATUS_TONE[s.status]}`}
                        >
                          {options.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.name}
                            </option>
                          ))}
                        </select>
                      );
                    })()}
                    {(() => {
                      const pr = approvalProgress(bulletin, s);
                      return pr.total > 1 && s.status !== 'DRAFT' ? (
                        <span className="block text-[9px] text-slate-500 mt-0.5" title={pr.next ? `بانتظار: ${pr.nextName}` : 'اكتمل الاعتماد'}>
                          {pr.done}/{pr.total}
                          {pr.next && s.status === 'READY' ? ` · ${pr.nextName}` : ''}
                        </span>
                      ) : null;
                    })()}
                  </td>
                  <td className="p-2 text-center font-mono hidden md:table-cell" dir="ltr">{mmss(st.read)}</td>
                  <td className="p-2 text-center font-mono hidden md:table-cell" dir="ltr">{st.clip || st.manual ? mmss(st.clip + st.manual) : '—'}</td>
                  <td className="p-2 text-center font-mono font-bold" dir="ltr">{mmss(st.total)}</td>
                  <td className="p-2 text-center font-mono text-slate-600 hidden sm:table-cell" dir="ltr">{row ? clockOf(row.front) : '—'}</td>
                  <td className="p-2 text-center font-mono text-slate-600 hidden md:table-cell" dir="ltr">{row ? clockOf(row.back) : '—'}</td>
                  <td className="p-2">
                    <div className="flex items-center justify-center gap-0.5">
                      {canEdit && (
                        <span className="hidden sm:contents">
                          <button type="button" disabled={idx === 0} onClick={() => attempt(() => apiService.moveBulletinStory(s.id, -1))} aria-label={`تقديم ${s.slug}`} className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30">
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button type="button" disabled={idx === all.length - 1} onClick={() => attempt(() => apiService.moveBulletinStory(s.id, 1))} aria-label={`تأخير ${s.slug}`} className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30">
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                          <button type="button" onClick={() => toggle(s, { floated: !s.floated }, s.floated ? 'عادت القصة للتوقيت' : 'أصبحت القصة عائمة خارج التوقيت')} aria-label={s.floated ? `إرجاع ${s.slug}` : `تعويم ${s.slug}`} title={s.floated ? 'إرجاع للتوقيت' : 'تعويم (احتياط)'} className={`p-1 ${s.floated ? 'text-blue-600' : 'text-slate-400 hover:text-slate-700'}`}>
                            <EyeOff className="w-3.5 h-3.5" />
                          </button>
                          <button type="button" onClick={() => toggle(s, { killed: !s.killed }, s.killed ? 'أُعيدت القصة' : 'استُبعدت القصة')} aria-label={s.killed ? `إعادة ${s.slug}` : `استبعاد ${s.slug}`} title={s.killed ? 'إعادة' : 'استبعاد (Kill)'} className={`p-1 ${s.killed ? 'text-rose-600' : 'text-slate-400 hover:text-rose-600'}`}>
                            <CircleSlash className="w-3.5 h-3.5" />
                          </button>
                        </span>
                      )}
                      {isApprover(bulletin, actor, s) && s.status !== 'APPROVED' && !s.killed && !lock && (
                        <button
                          type="button"
                          onClick={() => toggle(s, { status: 'APPROVED' }, approvalProgress(bulletin, s).total - approvalProgress(bulletin, s).done > 1 ? `سُجّل اعتمادك لـ«${s.slug}»؛ بانتظار الخطوة التالية` : `اعتُمدت «${s.slug}» للهواء`)}
                          aria-label={`اعتماد ${s.slug} (${approvalProgress(bulletin, s).nextName})`}
                          title={`اعتماد: ${approvalProgress(bulletin, s).nextName}`}
                          className="p-1 text-emerald-600 hover:text-emerald-800"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                        </button>
                      )}
                      <button type="button" onClick={() => setEditing(s)} aria-label={`فتح ${s.slug}`} className="p-1 text-blue-600">
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      {canEdit && (approver || s.writerId === currentUser.id || can('bulletins.manage')) && (
                        <button type="button" onClick={async () => (await confirmDialog(`حذف «${s.slug}» نهائياً من النشرة؟`)) && attempt(() => apiService.deleteBulletinStory(s.id), 'حُذفت القصة')} aria-label={`حذف ${s.slug}`} className="p-1 text-slate-300 hover:text-rose-600">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                  </>
                  )}
                </SortableItem>
              );
            })}
          </SortableList>
        </table>
      </div>
      </SortableScope>

      <StoryEditor bulletin={bulletin} story={editing} currentUser={currentUser} onClose={() => setEditing(null)} onSaved={(t) => flash(true, t)} />

      {/* Source picker */}
      <FormPage isOpen={!!sendTo} onClose={() => setSendTo(null)} title="نسخ قصص إلى نشرة أخرى" subtitle="تصل كمسودات في آخر النشرة الهدف، ويُعاد اعتمادها هناك" maxWidth="2xl">
        {sendTo && (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              const target = others.find((b) => b.id === sendTo.target);
              if (!target || !sendTo.ids.length) return;
              attempt(() => {
                const n = apiService.copyStoriesToBulletin(sendTo.ids, target.id);
                setSendTo(null);
                notify({ type: 'success', message: `نُسخت ${n} قصة إلى «${target.title}»` });
              });
            }}
          >
            <label className="block text-xs font-bold text-slate-700">
              النشرة الهدف
              <select required value={sendTo.target} onChange={(e) => setSendTo({ ...sendTo, target: e.target.value })} className="mt-1 w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm bg-white">
                <option value="">اختر النشرة…</option>
                {others
                  .filter((b) => b.status !== 'DONE')
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.title} — {b.startTime}
                    </option>
                  ))}
              </select>
            </label>
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-700">القصص ({sendTo.ids.length} من {all.length})</span>
              <span className="flex gap-2">
                <button type="button" onClick={() => setSendTo({ ...sendTo, ids: all.map((x) => x.id) })} className="text-blue-700 font-bold">
                  تحديد الكل
                </button>
                <button type="button" onClick={() => setSendTo({ ...sendTo, ids: [] })} className="text-slate-500 font-bold">
                  إلغاء التحديد
                </button>
              </span>
            </div>
            <ul className="max-h-80 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-xl">
              {all.map((x) => (
                <li key={x.id}>
                  <label className="flex items-center gap-2 p-2 text-xs cursor-pointer hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={sendTo.ids.includes(x.id)}
                      onChange={(e) => setSendTo({ ...sendTo, ids: e.target.checked ? [...sendTo.ids, x.id] : sendTo.ids.filter((i) => i !== x.id) })}
                    />
                    <span className="font-bold text-slate-800">{x.slug}</span>
                    <span className="text-slate-500">{storyStatusName(x.status)}</span>
                    {x.killed && <span className="text-rose-600">مستبعدة</span>}
                  </label>
                </li>
              ))}
            </ul>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setSendTo(null)} className="px-4 py-2 rounded-xl border border-slate-300 text-xs font-bold">
                إلغاء
              </button>
              <button type="submit" disabled={!sendTo.target || !sendTo.ids.length} className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-xs font-bold">
                نسخ {sendTo.ids.length} قصة
              </button>
            </div>
          </form>
        )}
      </FormPage>
      <FormPage
        isOpen={!!source}
        onClose={() => {
          setSource(null);
          setPicked([]);
        }}
        title={source === 'NEWS' ? 'إضافة من غرفة الأخبار' : source === 'WIRES' ? 'إضافة من برقيات الوكالات' : 'نسخ قصص من نشرة أخرى'}
        subtitle="تُضاف كمسودات في آخر النشرة، ثم رتّبها وعدّلها"
        maxWidth="3xl"
      >
        <div className="space-y-3">
          {source === 'COPY' ? (
            <select aria-label="النشرة المصدر" value={copyFrom} onChange={(e) => { setCopyFrom(e.target.value); setPicked([]); }} className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-xs bg-white">
              <option value="">— اختر النشرة —</option>
              {others.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.date} {b.startTime} — {b.title}
                </option>
              ))}
            </select>
          ) : (
            <input aria-label="بحث" data-autofocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث بالعنوان…" className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-xs" />
          )}
          <ul className="max-h-[55vh] overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-xl">
            {(source === 'NEWS' ? news : source === 'WIRES' ? wires : copyStories).map((item: any) => {
              const on = picked.includes(item.id);
              const already = source === 'NEWS' && inBulletin.has(item.id);
              return (
                <li key={item.id}>
                  <label className={`flex items-start gap-2 p-2.5 text-xs cursor-pointer ${on ? 'bg-blue-50' : 'hover:bg-slate-50'}`}>
                    <input type="checkbox" checked={on} onChange={() => setPicked(on ? picked.filter((x) => x !== item.id) : [...picked, item.id])} className="mt-0.5" />
                    <span className="flex-1 min-w-0">
                      <span className="font-bold text-slate-800 block">{source === 'COPY' ? item.slug : item.title}</span>
                      <span className="text-[10px] text-slate-500">
                        {source === 'NEWS' && `${NEWS_STATUS[item.status] || item.status} · ${item.authorName || ''}`}
                        {source === 'WIRES' && `${item.sourceName} · ${new Date(item.publishedAt).toLocaleString(appLocale(), { ...zoneOptions(), dateStyle: 'short', timeStyle: 'short' })}`}
                        {source === 'COPY' && `${storyTypeOf(item.type).code} · ${mmss(storyTiming(item).total)}`}
                      </span>
                      {already && <span className="text-[10px] font-bold text-amber-700 mr-2">موجود في النشرة</span>}
                      {source === 'NEWS' && isUnderEmbargo(item) && <span className="text-[10px] font-bold text-rose-700 mr-2">محظور حتى {embargoLabel(item.embargoUntil)}</span>}
                    </span>
                  </label>
                </li>
              );
            })}
            {source === 'WIRES' && wires.length === 0 && <li className="p-6 text-center text-xs text-slate-400">لا برقيات متاحة.</li>}
            {source === 'NEWS' && news.length === 0 && <li className="p-6 text-center text-xs text-slate-400">لا أخبار معتمدة أو منشورة مطابقة.</li>}
          </ul>
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <button type="button" onClick={() => setSource(null)} className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl">
              إلغاء
            </button>
            <button type="button" disabled={!picked.length} onClick={addPicked} className="px-5 py-2 text-xs font-bold bg-blue-600 text-white rounded-xl disabled:opacity-50">
              إضافة {picked.length ? `(${picked.length})` : ''} للنشرة
            </button>
          </div>
        </div>
      </FormPage>

      {/* Bulletin details */}
      <FormPage isOpen={!!meta} onClose={() => setMeta(null)} title="بيانات النشرة" maxWidth="xl">
        {meta && (
          <form onSubmit={saveMeta} className="space-y-3">
            <label className="block text-xs font-bold text-slate-700">
              العنوان
              <input required value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} className="mt-1 w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm font-bold" />
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <label className="block text-xs font-bold text-slate-700">
                النوع
                <select value={meta.kind} onChange={(e) => setMeta({ ...meta, kind: e.target.value as BulletinKind })} className="mt-1 w-full px-2 py-2.5 border border-slate-300 rounded-xl text-xs bg-white">
                  {BULLETIN_KINDS.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-bold text-slate-700">
                التاريخ
                <input type="date" required value={meta.date} onChange={(e) => setMeta({ ...meta, date: e.target.value })} className="mt-1 w-full px-2 py-2.5 border border-slate-300 rounded-xl text-xs" />
              </label>
              <label className="block text-xs font-bold text-slate-700">
                الموعد
                <input type="time" required value={meta.startTime} onChange={(e) => setMeta({ ...meta, startTime: e.target.value })} className="mt-1 w-full px-2 py-2.5 border border-slate-300 rounded-xl text-xs" />
              </label>
              <label className="block text-xs font-bold text-slate-700">
                المدة (دقائق)
                <input type="number" min={1} required value={meta.minutes} onChange={(e) => setMeta({ ...meta, minutes: e.target.value })} className="mt-1 w-full px-2 py-2.5 border border-slate-300 rounded-xl text-xs" />
              </label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block text-xs font-bold text-slate-700">
                محرر النشرة
                <select
                  value={meta.editorId || ''}
                  disabled={!can('bulletins.manage')}
                  onChange={(e) => setMeta({ ...meta, editorId: e.target.value || undefined })}
                  className="mt-1 w-full px-3 py-2.5 border border-slate-300 rounded-xl text-xs bg-white"
                >
                  <option value="">— بدون —</option>
                  {users
                    .filter((u) => RbacService.hasPermission(u, 'bulletins.edit') || RbacService.hasPermission(u, 'bulletins.approve'))
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.fullName}
                      </option>
                    ))}
                </select>
              </label>
              <label className="block text-xs font-bold text-slate-700">
                المذيعون
                <input list="meta-presenters" value={meta.anchorsText} onChange={(e) => setMeta({ ...meta, anchorsText: e.target.value })} className="mt-1 w-full px-3 py-2.5 border border-slate-300 rounded-xl text-xs" />
                <datalist id="meta-presenters">
                  {users
                    .filter((u) => departmentIdOf(u) === 'presenters')
                    .map((u) => (
                      <option key={u.id} value={u.fullName} />
                    ))}
                </datalist>
              </label>
            </div>
            <label className="block text-xs font-bold text-slate-700">
              الاستوديو
              <input value={meta.studioName || ''} onChange={(e) => setMeta({ ...meta, studioName: e.target.value })} className="mt-1 w-full px-3 py-2.5 border border-slate-300 rounded-xl text-xs" />
            </label>
            <ApprovalChainEditor
              value={meta.approvalSteps}
              onChange={(approvalSteps) => setMeta({ ...meta, approvalSteps })}
              disabled={!can('bulletins.manage')}
              editorName={users.find((u) => u.id === meta.editorId)?.fullName}
            />
            {!can('bulletins.manage') && <p className="text-[11px] text-slate-500">تغيير مسار الاعتماد لمسؤولي النشرات.</p>}
            <div className="flex flex-wrap justify-between gap-2 pt-3 border-t border-slate-100">
              {can('bulletins.manage') ? (
                <button
                  type="button"
                  onClick={async () => {
                    if (!(await confirmDialog(`حذف «${bulletin.title}»؟`))) return;
                    attempt(() => apiService.deleteBulletin(bulletin.id));
                    setMeta(null);
                    onBack();
                  }}
                  className="px-4 py-2 text-xs font-bold text-rose-700 hover:bg-rose-50 rounded-xl"
                >
                  حذف النشرة
                </button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <button type="button" onClick={() => setMeta(null)} className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl">
                  إلغاء
                </button>
                <button type="submit" className="px-5 py-2 text-xs font-bold bg-blue-600 text-white rounded-xl">
                  حفظ
                </button>
              </div>
            </div>
          </form>
        )}
      </FormPage>

      <TeleprompterModal isOpen={prompter} onClose={() => setPrompter(false)} segments={show.rundown as unknown as RundownSegment[]} episodeTitle={bulletin.title} episodeId={bulletin.id} />
    </div>
  );
};
