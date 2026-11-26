import type { Episode, RundownSegment } from '../../types';
import { mmss, plainText, storyStatusName, storyTypeOf, type Bulletin, type BulletinStory } from '../../shared/bulletins';
import { arabicDate } from '../../shared/dates';
import { segmentGuests, segmentQuestions } from '../../shared/episodePlan';
import { stamp, type DocContext } from './builders';
import { fileNameOf, type DocBlock, type DocSpec } from './model';

function scriptDocument(label: string, title: string, blocks: DocBlock[], ctx: DocContext, subtitle?: string): DocSpec {
  return {
    title: `${label} — ${title}`, subtitle, fileName: fileNameOf(label, title),
    organization: ctx.organization, footerNote: stamp(ctx), blocks,
  };
}

type ReadingSegment = Pick<RundownSegment, 'title' | 'scriptText' | 'script' | 'presenterName'> & { notApproved?: boolean };

export function episodeIntroDoc(title: string, intro: string, unsaved: boolean, ctx: DocContext): DocSpec {
  return scriptDocument('مقدمة الحلقة', title, [{ t: 'script', text: plainText(intro) }], ctx, unsaved ? 'نسخة العمل الحالية قبل الحفظ' : undefined);
}

/** Use the same playable sequence as the prompter, including approval placeholders and breaks. */
export function autocueDoc(title: string, segments: readonly ReadingSegment[], ctx: DocContext): DocSpec {
  const blocks: DocBlock[] = [];
  segments.forEach((segment, i) => {
    if (i) blocks.push({ t: 'pagebreak' });
    blocks.push({ t: 'heading', text: `${i + 1}. ${segment.title}${segment.presenterName ? ' — ' + segment.presenterName : ''}` });
    const copy = plainText(segment.scriptText || segment.script || '');
    if (segment.notApproved) blocks.push({ t: 'paragraph', text: 'القصة بانتظار اعتماد محرر النشرة.', bold: true });
    else if (copy) blocks.push({ t: 'script', text: copy });
    else blocks.push({ t: 'paragraph', text: 'لا يوجد نص للقراءة في هذه الفقرة.', muted: true });
  });
  if (!blocks.length) blocks.push({ t: 'paragraph', text: 'لا توجد فقرات في الرانداون.' });
  return scriptDocument('نص الأوتوكيو', title, blocks, ctx);
}

export function bulletinPreparationDoc(b: Bulletin, stories: BulletinStory[], ctx: DocContext): DocSpec {
  const blocks: DocBlock[] = [];
  const list = stories.filter(s => !s.killed && !s.deletedAt).sort((a, z) => a.rank - z.rank);
  for (const story of list) {
    blocks.push({ t: 'heading', text: story.slug }, { t: 'paragraph', muted: true, text:
      [story.floated ? 'احتياط' : '', storyStatusName(story.status), storyTypeOf(story.type).code,
        story.writerName && `الإعداد: ${story.writerName}`, story.anchorName && `التقديم: ${story.anchorName}`].filter(Boolean).join(' · ') });
    const copy = plainText(story.script);
    if (copy) blocks.push({ t: 'paragraph', text: copy });
    if (story.directorNotes) blocks.push({ t: 'paragraph', text: `ملاحظات الإخراج: ${story.directorNotes}` });
  }
  if (!blocks.length) blocks.push({ t: 'paragraph', text: 'لا توجد قصص في النشرة بعد.' });
  return scriptDocument('نص إعداد النشرة', b.title, blocks, ctx, [arabicDate(b.date), b.startTime, b.editorName].filter(Boolean).join(' · '));
}

export function episodePreparationDoc(e: Episode, ctx: DocContext): DocSpec {
  const blocks: DocBlock[] = [];
  const section = (heading: string, value?: string) => {
    if (value?.trim()) blocks.push({ t: 'heading', text: heading }, { t: 'paragraph', text: plainText(value) });
  };
  section('وصف الحلقة', e.description);
  section('الفكرة', e.brief?.idea);
  section('الزاوية', e.brief?.angle);
  section('الرسالة', e.brief?.message);
  section('الجمهور', e.brief?.audience);
  section('مصادر البحث', e.brief?.sources);
  section('مقدمة الحلقة', e.introScript);
  for (const topic of e.topics || []) {
    blocks.push({ t: 'heading', text: `المحور: ${topic.title}` });
    const notes = [topic.angle, topic.notes].filter(Boolean).join('\n');
    if (notes) blocks.push({ t: 'paragraph', text: notes });
  }
  const included = new Set<string>();
  for (const s of e.rundown || e.rundownSegments || []) {
    blocks.push({ t: 'heading', text: `${s.title} — ${mmss(s.durationSeconds)}` });
    const guests = segmentGuests(s).map(g => g.guestName).filter(Boolean);
    if (guests.length) blocks.push({ t: 'paragraph', text: `الضيوف: ${guests.join('، ')}` });
    const copy = plainText(s.scriptText || s.script || '');
    if (copy) blocks.push({ t: 'paragraph', text: copy });
    if (s.notes) blocks.push({ t: 'paragraph', text: `ملاحظات الإخراج: ${s.notes}` });
    const questions = segmentQuestions(e, s);
    if (questions.length) {
      blocks.push({ t: 'list', ordered: true, items: questions.map(q => q.questionText) });
      questions.forEach(q => included.add(q.id));
    }
  }
  const other = e.questions?.filter(q => !included.has(q.id));
  if (other?.length) blocks.push({ t: 'heading', text: 'أسئلة إضافية' }, { t: 'list', ordered: true, items: other.map(q => q.questionText) });
  section('ملاحظات المذيع', e.presenterNotes);
  section('ملاحظات المخرج', e.directorNotes);
  if (!blocks.length) blocks.push({ t: 'paragraph', text: 'لم يُكتب نص الإعداد بعد.' });
  return scriptDocument('نص إعداد الحلقة', e.title, blocks, ctx, [e.programName, arabicDate(e.broadcastDate), e.producerName].filter(Boolean).join(' · '));
}
