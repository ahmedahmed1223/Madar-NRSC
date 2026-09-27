/**
 * The standard documents a newsroom prints or files: the story sheet, the news list,
 * the bulletin rundown / anchor scripts / graphics list, and for programmes the full
 * episode file, rundown, presenter sheet, guest sheet and broadcast schedule.
 */
import type { Episode, Guest, NewsItem, User } from '../../types';
import { NEWS_STATUS_LABELS } from '../../shared/newsWorkflow';
import { arabicDate } from '../../shared/dates';
import { formatSecondsToTime } from '../../shared/rundown';
import {
  airStories,
  Bulletin,
  bulletinKindName,
  BulletinStory,
  bulletinTiming,
  clockOf,
  GRAPHIC_KINDS,
  mmss,
  plainText,
  readSeconds,
  storyStatusName,
  storyTiming,
  storyTypeOf,
} from '../../shared/bulletins';
import {
  bookingStatusName,
  bookingStatusOf,
  connectionName,
  episodeGuestList,
  groupByTopic,
  guestKey,
  guestRoleName,
  guestSegments,
  questionKindName,
  reportSourceOf,
  segmentGuests,
  segmentQuestions,
  sumSeconds,
} from '../../shared/episodePlan';
import type { DocBlock, DocSpec, TableRow } from './model';
import type { AsRunShow } from '../../shared/asrun';
import { fileNameOf } from './model';

export interface DocContext {
  organization?: string;
  user?: Pick<User, 'fullName'> | null;
  now?: Date;
}

const stamp = (ctx: DocContext) => {
  const when = (ctx.now || new Date()).toLocaleString('ar-EG-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' });
  return ctx.user ? `طُبع بواسطة ${ctx.user.fullName} — ${when}` : when;
};

const dt = (iso?: string) => (iso ? new Date(iso).toLocaleString('ar-EG-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const d = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('ar-EG-u-nu-latn', { dateStyle: 'medium' }) : '—');
const mmssOf = (secs: number) => formatSecondsToTime(secs || 0).slice(3);

const PRIORITY: Record<string, string> = { CRITICAL: 'حرجة', URGENT: 'عاجلة', HIGH: 'عالية', MEDIUM: 'متوسطة', NORMAL: 'عادية', LOW: 'منخفضة' };
const SEGMENT_TYPE: Record<string, string> = { INTRO: 'مقدمة', REPORT: 'تقرير', NEWS_ITEM: 'خبر', LIVE_INTERVIEW: 'مقابلة', DISCUSSION: 'نقاش', BREAK: 'فاصل', OUTRO: 'ختام' };
const EPISODE_STATUS: Record<string, string> = {
  PLANNING: 'تخطيط',
  IN_PREPARATION: 'قيد الإعداد',
  PREPARING: 'تجهيز',
  READY: 'جاهزة للتسجيل',
  RECORDING: 'تسجيل',
  RECORDED: 'مسجلة',
  EDITING: 'مونتاج',
  READY_FOR_BROADCAST: 'جاهزة للبث',
  ON_AIR: 'على الهواء',
  BROADCASTED: 'أُذيعت',
  ARCHIVED: 'مؤرشفة',
  CANCELLED: 'ملغاة',
};

const paragraphs = (text: string): DocBlock[] =>
  plainText(text)
    .split(/\n\s*\n|\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => ({ t: 'paragraph', text: p }));

// ---------------------------------------------------------------------------
// News
// ---------------------------------------------------------------------------

/** The story sheet: metadata box, lead, body, keywords and its approval trail. */
export function newsStoryDoc(n: NewsItem, ctx: DocContext): DocSpec {
  const body = plainText(n.content || '');
  const words = (body.match(/\S+/g) || []).length;
  const blocks: DocBlock[] = [
    {
      t: 'meta',
      rows: [
        ['التصنيف', n.categoryName || '—'],
        ['الحالة', NEWS_STATUS_LABELS[n.status] || n.status],
        ['المصدر', n.sourceName || '—'],
        ['الأولوية', `${PRIORITY[n.priority] || n.priority}${n.isBreaking ? ' — عاجل' : ''}`],
        ['الكاتب', n.authorName || '—'],
        ['المراجع', n.editorName || '—'],
        ['المعتمِد', n.approvedByName ? `${n.approvedByName} (${dt(n.approvedAt)})` : '—'],
        ['الموقع', n.locationName || '—'],
        ['تاريخ الحدث', d(n.eventDate)],
        ['النشر', n.publishDate ? dt(n.publishDate) : n.scheduledDate ? `مجدول: ${dt(n.scheduledDate)}` : '—'],
        ['الكلمات', `${words} كلمة — قراءة تقريبية ${mmss(readSeconds(body))}`],
        ['آخر تعديل', dt(n.updatedAt)],
      ],
    },
  ];
  if (n.shortTitle && n.shortTitle !== n.title) blocks.push({ t: 'heading', text: 'العنوان المختصر' }, { t: 'paragraph', text: n.shortTitle, bold: true });
  if (n.summary) blocks.push({ t: 'heading', text: 'الموجز' }, { t: 'paragraph', text: n.summary, bold: true });
  blocks.push({ t: 'heading', text: 'نص الخبر' }, ...paragraphs(n.content || ''));
  if (n.keywords?.length) blocks.push({ t: 'heading', text: 'الكلمات المفتاحية' }, { t: 'paragraph', text: n.keywords.join('، ') });
  if (n.internalNotes) blocks.push({ t: 'heading', text: 'ملاحظات داخلية' }, { t: 'paragraph', text: n.internalNotes, muted: true });
  if (n.workflowLogs?.length) {
    blocks.push(
      { t: 'heading', text: 'مسار المراجعة والاعتماد' },
      {
        t: 'table',
        head: ['التاريخ', 'من', 'إلى', 'بواسطة', 'ملاحظة'],
        widths: [20, 13, 13, 20, 34],
        rows: n.workflowLogs.map((l) => ({
          cells: [dt(l.timestamp), NEWS_STATUS_LABELS[l.fromStatus as keyof typeof NEWS_STATUS_LABELS] || l.fromStatus || '—', NEWS_STATUS_LABELS[l.toStatus as keyof typeof NEWS_STATUS_LABELS] || l.toStatus, l.changedBy?.name || '—', l.comment || ''],
        })),
      }
    );
  }
  return {
    title: n.title,
    subtitle: [n.categoryName, NEWS_STATUS_LABELS[n.status]].filter(Boolean).join(' · '),
    fileName: fileNameOf('خبر', n.shortTitle || n.title),
    organization: ctx.organization,
    footerNote: stamp(ctx),
    blocks,
  };
}

/** A list of news items as a table (e.g. the filtered newsroom list). */
export function newsListDoc(items: NewsItem[], label: string, ctx: DocContext): DocSpec {
  return {
    title: 'قائمة الأخبار',
    subtitle: `${label} — ${items.length} خبر`,
    fileName: fileNameOf('قائمة الأخبار', label),
    orientation: 'landscape',
    organization: ctx.organization,
    footerNote: stamp(ctx),
    blocks: [
      {
        t: 'table',
        head: ['#', 'العنوان', 'التصنيف', 'الكاتب', 'الحالة', 'الأولوية', 'آخر تعديل'],
        widths: [4, 44, 11, 13, 10, 8, 10],
        mono: [0],
        rows: items.map((n, i) => ({
          cells: [String(i + 1), n.title, n.categoryName || '—', n.authorName || '—', NEWS_STATUS_LABELS[n.status] || n.status, `${PRIORITY[n.priority] || n.priority}${n.isBreaking ? ' ⚡' : ''}`, d(n.updatedAt)],
          kind: n.isBreaking ? 'strong' : undefined,
        })),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Bulletins
// ---------------------------------------------------------------------------

const bulletinSubtitle = (b: Bulletin) =>
  `${bulletinKindName(b.kind)} · ${arabicDate(b.date)} · ${b.startTime} · المحرر: ${b.editorName || '—'} · التقديم: ${b.anchors.join('، ') || '—'}${b.studioName ? ` · ${b.studioName}` : ''}`;

/** The rundown sheet for the director and control room. */
export function bulletinRundownDoc(b: Bulletin, stories: BulletinStory[], ctx: DocContext): DocSpec {
  const t = bulletinTiming(b, stories);
  const list = stories.filter((s) => !s.killed && !s.deletedAt).sort((a, c) => a.rank - c.rank);
  let n = 0;
  const rows: TableRow[] = list.map((s) => {
    const r = t.rows.get(s.id);
    const st = storyTiming(s);
    const notes = [s.directorNotes, ...(s.graphics || []).map((g) => `CG: ${g.lines.join(' / ')}`)].filter(Boolean).join('\n');
    return {
      kind: s.floated ? 'muted' : undefined,
      cells: [
        s.floated ? '—' : String(++n),
        `${s.slug}${s.floated ? ' (احتياط)' : ''}`,
        storyTypeOf(s.type).code,
        s.anchorName || b.anchors[0] || '',
        storyStatusName(s.status),
        mmss(st.read),
        st.clip || st.manual ? mmss(st.clip + st.manual) : '—',
        mmss(st.total),
        r ? clockOf(r.front) : '—',
        r ? clockOf(r.back) : '—',
        notes,
      ],
    };
  });
  return {
    title: b.title,
    subtitle: bulletinSubtitle(b),
    fileName: fileNameOf('رانداون', b.title),
    orientation: 'landscape',
    organization: ctx.organization,
    footerNote: stamp(ctx),
    blocks: [
      {
        t: 'meta',
        rows: [
          ['البداية', clockOf(t.start)],
          ['النهاية المحددة', clockOf(t.hardOut)],
          ['المدة المخططة', mmss(t.planned)],
          ['المجموع', mmss(t.total)],
          [t.overUnder > 0 ? 'زيادة' : 'نقص', `${t.overUnder > 0 ? '+' : ''}${mmss(t.overUnder)}`],
          ['القصص', `${airStories(stories).length} على الهواء`],
        ],
      },
      {
        t: 'table',
        head: ['#', 'القصة', 'النوع', 'المذيع', 'الحالة', 'قراءة', 'لقطة', 'المدة', 'البداية', 'Back', 'ملاحظات وشارات'],
        widths: [3, 22, 6, 10, 8, 6, 6, 6, 8, 8, 17],
        mono: [0, 2, 5, 6, 7, 8, 9],
        rows,
      },
    ],
  };
}

/** Anchor copy: one story per page in large type, as read on air. */
export function anchorScriptsDoc(b: Bulletin, stories: BulletinStory[], ctx: DocContext): DocSpec {
  const list = airStories(stories).filter((s) => storyTypeOf(s.type).read && s.script.trim());
  const blocks: DocBlock[] = [];
  list.forEach((s, i) => {
    if (i > 0) blocks.push({ t: 'pagebreak' });
    const type = storyTypeOf(s.type);
    blocks.push(
      { t: 'heading', text: `${i + 1}. ${s.slug} [${type.code}] — ${s.anchorName || b.anchors[0] || ''}` },
      ...(s.status !== 'APPROVED' ? [{ t: 'paragraph' as const, text: `⚠ ${storyStatusName(s.status)} — لم تُعتمد بعد`, bold: true }] : []),
      { t: 'script', text: s.script },
      ...(type.clip ? [{ t: 'paragraph' as const, text: `▶ ${type.code} — ${mmss(storyTiming(s).clip)}`, bold: true }] : []),
      ...(s.directorNotes ? [{ t: 'paragraph' as const, text: `[${s.directorNotes}]`, muted: true }] : [])
    );
  });
  return {
    title: `نصوص المذيع — ${b.title}`,
    subtitle: bulletinSubtitle(b),
    fileName: fileNameOf('نصوص المذيع', b.title),
    organization: ctx.organization,
    footerNote: stamp(ctx),
    blocks: blocks.length ? blocks : [{ t: 'paragraph', text: 'لا نصوص في النشرة بعد.', muted: true }],
  };
}

/** Lower thirds and full screens in running order, for the graphics operator. */
export function bulletinGraphicsDoc(b: Bulletin, stories: BulletinStory[], ctx: DocContext): DocSpec {
  const rows: TableRow[] = [];
  airStories(stories).forEach((s, i) =>
    (s.graphics || []).forEach((g) => rows.push({ cells: [String(i + 1), s.slug, GRAPHIC_KINDS.find((k) => k.id === g.kind)?.name || g.kind, g.lines.join('\n')] }))
  );
  return {
    title: `قائمة الشارات — ${b.title}`,
    subtitle: bulletinSubtitle(b),
    fileName: fileNameOf('شارات', b.title),
    organization: ctx.organization,
    footerNote: stamp(ctx),
    blocks: [{ t: 'table', head: ['#', 'القصة', 'النوع', 'النص'], widths: [5, 30, 15, 50], mono: [0], rows }],
  };
}

// ---------------------------------------------------------------------------
// Programmes
// ---------------------------------------------------------------------------

const episodeSubtitle = (e: Episode) =>
  `${e.programName || ''} · حلقة ${e.episodeNumber} · ${arabicDate(e.broadcastDate)} · من ${e.startTime} إلى ${e.endTime}${e.studioName ? ` · ${e.studioName}` : ''} · التقديم: ${e.presenterName || '—'} · الإعداد: ${e.producerName || '—'}`;

function rundownRows(e: Episode): TableRow[] {
  const rows: TableRow[] = [];
  groupByTopic(e).forEach(({ topic, segments }, gi) => {
    if ((e.topics || []).length) rows.push({ kind: 'group', cells: [topic ? `المحور ${gi + 1}: ${topic.title}${topic.angle ? ` — ${topic.angle}` : ''}` : 'خارج المحاور'] });
    segments.forEach((s: any) => {
      const guests = segmentGuests(s).map((g) => `${g.guestName} (${guestRoleName(g.role)})`).join('\n');
      const report = s.report ? `${reportSourceOf(s.report.source)?.name || ''}${s.report.reporterName ? `: ${s.report.reporterName}` : ''}` : '';
      rows.push({
        cells: [s.startTimeOffset || '', mmssOf(s.durationSeconds), SEGMENT_TYPE[s.segmentType] || s.segmentType, s.title + (report ? `\n${report}` : ''), s.presenterName || '', guests, s.notes || ''],
      });
    });
  });
  return rows;
}

const RUNDOWN_HEAD = ['البداية', 'المدة', 'النوع', 'الفقرة', 'التقديم', 'الضيوف', 'ملاحظات الإخراج'];
const RUNDOWN_WIDTHS = [8, 7, 8, 30, 12, 17, 18];

function rundownBlock(e: Episode): DocBlock {
  return { t: 'table', head: RUNDOWN_HEAD, widths: RUNDOWN_WIDTHS, mono: [0, 1], rows: rundownRows(e) };
}

function guestRows(e: Episode, guests: Guest[]): TableRow[] {
  return episodeGuestList(e).map((g) => {
    const key = guestKey(g);
    const bank = guests.find((x) => x.id === key);
    const segs = guestSegments(e, key).map((s: any) => `${s.title} (${guestRoleName(segmentGuests(s).find((x) => x.guestId === key)?.role)})`).join('\n');
    const cg = [g.cgName || g.guestName, g.cgTitle || [bank?.jobTitle || g.jobTitle, bank?.organization || g.organization].filter(Boolean).join(' — ')].filter(Boolean).join('\n');
    return {
      kind: bookingStatusOf(g) === 'DECLINED' ? 'muted' : undefined,
      cells: [g.guestName, bookingStatusName(bookingStatusOf(g)), connectionName(g.connectionType), bank?.phone || g.phone || '', segs || '—', cg, g.briefPoints || ''],
    };
  });
}

const GUEST_HEAD = ['الضيف', 'الحجز', 'المشاركة', 'الهاتف', 'الفقرات', 'الشارة', 'نقاط التحضير'];
const GUEST_WIDTHS = [14, 9, 11, 12, 20, 18, 16];

function questionBlocks(e: Episode): DocBlock[] {
  const blocks: DocBlock[] = [];
  (e.rundown || [])
    .filter((s) => s.segmentType !== 'BREAK')
    .forEach((s) => {
      const qs = segmentQuestions(e, s);
      if (!qs.length) return;
      blocks.push(
        { t: 'heading', text: `${s.title}${segmentGuests(s).length ? ` — ${segmentGuests(s).map((g) => g.guestName).join('، ')}` : ''}` },
        {
          t: 'list',
          ordered: true,
          items: qs.map((q: any) => `${q.parentId ? '↳ ' : ''}[${questionKindName(q.kind)}] ${q.questionText}${q.assignedToName ? ` — إلى: ${q.assignedToName}` : ''}${q.notes ? `\n    معلومة: ${q.notes}` : ''}`),
        }
      );
    });
  return blocks;
}

/** Everything about the episode: brief, rundown by topic, guests and questions. */
export function episodeFileDoc(e: Episode, guests: Guest[], ctx: DocContext): DocSpec {
  const brief = e.brief || {};
  const blocks: DocBlock[] = [];
  const briefRows: [string, string][] = [
    ['الفكرة', brief.idea || ''],
    ['الزاوية', brief.angle || ''],
    ['الرسالة', brief.message || ''],
    ['الجمهور', brief.audience || ''],
  ].filter(([, v]) => v) as [string, string][];
  blocks.push({
    t: 'meta',
    rows: [
      ['الحالة', EPISODE_STATUS[e.status] || e.status],
      ['المدة', `${e.durationMinutes} دقيقة — الرانداون ${mmssOf(sumSeconds(e.rundown || []))}`],
      ['المخرج', e.directorName || '—'],
      ['المحاور', String((e.topics || []).length)],
      ...briefRows,
    ],
  });
  if (brief.sources) blocks.push({ t: 'heading', text: 'مصادر البحث' }, { t: 'paragraph', text: brief.sources });
  if (e.introScript) blocks.push({ t: 'heading', text: 'مقدمة الحلقة' }, { t: 'script', text: e.introScript });
  blocks.push({ t: 'heading', text: 'الرانداون' }, rundownBlock(e));
  blocks.push({ t: 'heading', text: 'الضيوف والشارات' }, { t: 'table', head: GUEST_HEAD, widths: GUEST_WIDTHS, mono: [3], rows: guestRows(e, guests) });
  const qs = questionBlocks(e);
  if (qs.length) blocks.push({ t: 'pagebreak' }, { t: 'heading', text: 'أسئلة الحوارات' }, ...qs);
  return {
    title: e.title,
    subtitle: episodeSubtitle(e),
    fileName: fileNameOf('ملف الحلقة', e.programName, `${e.episodeNumber}`, e.title),
    orientation: 'landscape',
    organization: ctx.organization,
    footerNote: stamp(ctx),
    blocks,
  };
}

export function episodeRundownDoc(e: Episode, ctx: DocContext): DocSpec {
  return {
    title: `رانداون: ${e.title}`,
    subtitle: episodeSubtitle(e),
    fileName: fileNameOf('رانداون', e.programName, `${e.episodeNumber}`),
    orientation: 'landscape',
    organization: ctx.organization,
    footerNote: stamp(ctx),
    blocks: [rundownBlock(e)],
  };
}

/** The presenter's sheet: intro copy, then each segment's guests, script and questions. */
export function presenterSheetDoc(e: Episode, ctx: DocContext): DocSpec {
  const blocks: DocBlock[] = [];
  if (e.introScript) blocks.push({ t: 'heading', text: 'المقدمة' }, { t: 'script', text: e.introScript });
  (e.rundown || [])
    .filter((s) => s.segmentType !== 'BREAK')
    .forEach((s) => {
      const guests = segmentGuests(s);
      const qs = segmentQuestions(e, s);
      blocks.push({ t: 'heading', text: `${s.startTimeOffset || ''} — ${s.title} (${mmssOf(s.durationSeconds)})` });
      if (guests.length) blocks.push({ t: 'paragraph', text: `الضيوف: ${guests.map((g) => `${g.guestName} (${guestRoleName(g.role)})`).join('، ')}`, bold: true });
      if ((s.scriptText || '').trim()) blocks.push({ t: 'script', text: plainText(s.scriptText) });
      if (qs.length) blocks.push({ t: 'list', ordered: true, items: qs.map((q: any) => `${q.parentId ? '↳ ' : ''}[${questionKindName(q.kind)}] ${q.questionText}${q.notes ? `\n    معلومة: ${q.notes}` : ''}`) });
    });
  return {
    title: `ورقة المذيع: ${e.title}`,
    subtitle: episodeSubtitle(e),
    fileName: fileNameOf('ورقة المذيع', e.programName, `${e.episodeNumber}`),
    organization: ctx.organization,
    footerNote: stamp(ctx),
    blocks,
  };
}

export function guestSheetDoc(e: Episode, guests: Guest[], ctx: DocContext): DocSpec {
  return {
    title: `ضيوف الحلقة: ${e.title}`,
    subtitle: episodeSubtitle(e),
    fileName: fileNameOf('الضيوف', e.programName, `${e.episodeNumber}`),
    orientation: 'landscape',
    organization: ctx.organization,
    footerNote: stamp(ctx),
    blocks: [{ t: 'table', head: GUEST_HEAD, widths: GUEST_WIDTHS, mono: [3], rows: guestRows(e, guests) }],
  };
}

/** Broadcast schedule for a list of episodes. */
export function episodesScheduleDoc(episodes: Episode[], label: string, ctx: DocContext): DocSpec {
  const list = [...episodes].sort((a, b) => `${a.broadcastDate} ${a.startTime}`.localeCompare(`${b.broadcastDate} ${b.startTime}`));
  return {
    title: 'جدول بث الحلقات',
    subtitle: `${label} — ${list.length} حلقة`,
    fileName: fileNameOf('جدول البث', label),
    orientation: 'landscape',
    organization: ctx.organization,
    footerNote: stamp(ctx),
    blocks: [
      {
        t: 'table',
        head: ['التاريخ', 'الوقت', 'البرنامج', 'رقم', 'عنوان الحلقة', 'الاستوديو', 'التقديم', 'الفقرات', 'الحالة'],
        widths: [11, 12, 12, 5, 24, 12, 10, 6, 8],
        mono: [1, 3, 7],
        rows: list.map((e) => ({
          cells: [arabicDate(e.broadcastDate), `${e.startTime}–${e.endTime}`, e.programName || '', String(e.episodeNumber), e.title, e.studioName || '', e.presenterName || '', String((e.rundown || []).length), EPISODE_STATUS[e.status] || e.status],
        })),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// As-Run
// ---------------------------------------------------------------------------

const clock = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '—');
const signed = (n: number | null) => (n === null ? '—' : `${n > 0 ? '+' : n < 0 ? '-' : ''}${mmss(Math.abs(n))}`);

/** The day's As-Run log: every show that aired, with real start/end and per-segment timings. */
export function asRunDoc(shows: AsRunShow[], day: string, ctx: DocContext): DocSpec {
  const rows: TableRow[] = [];
  shows.forEach((s) => {
    rows.push({
      kind: 'group',
      cells: [`${clock(s.startedAt)} — ${s.programName ? `${s.programName}: ` : ''}${s.title} · الفعلي ${s.actualSeconds === null ? '—' : mmss(s.actualSeconds)} مقابل ${mmss(s.plannedSeconds)}${s.startDelaySeconds !== null ? ` · بدأ ${signed(s.startDelaySeconds)} عن موعده` : ''}${s.operatorName ? ` · التشغيل: ${s.operatorName}` : ''}`],
    });
    s.rows.forEach((r) =>
      rows.push({
        kind: r.diffSeconds !== null && Math.abs(r.diffSeconds) >= 30 ? 'strong' : undefined,
        cells: [clock(r.startedAt), clock(r.endedAt), r.title, r.plannedSeconds === null ? '—' : mmss(r.plannedSeconds), r.actualSeconds === null ? '—' : mmss(r.actualSeconds), signed(r.diffSeconds)],
      })
    );
  });
  return {
    title: 'سجل البث الفعلي (As-Run)',
    subtitle: `${arabicDate(day)} — ${shows.length} بث`,
    fileName: fileNameOf('As-Run', day),
    orientation: 'landscape',
    organization: ctx.organization,
    footerNote: stamp(ctx),
    blocks: [
      {
        t: 'table',
        head: ['البداية', 'النهاية', 'الفقرة / القصة', 'المخطط', 'الفعلي', 'الفرق'],
        widths: [11, 11, 48, 10, 10, 10],
        mono: [0, 1, 3, 4, 5],
        rows,
      },
    ],
  };
}
