/**
 * What the program page shows as «هيكل القالب التحريري المعياري»: the program's saved template
 * when it has one, otherwise the structure of its latest episode that has a rundown.
 */
import type { ProgramTemplate } from '../../shared/episodePlan';

const SEGMENT_TYPE_NAMES: Record<string, string> = {
  INTRO: 'شارة / مقدمة',
  REPORT: 'تقرير مصور',
  LIVE_INTERVIEW: 'حوار مباشر',
  NEWS_ITEM: 'خبر قارئ',
  DISCUSSION: 'طاولة حوار',
  BREAK: 'فاصل',
  OUTRO: 'تتر النهاية',
};

export const segmentTypeName = (type: string | undefined): string => (type ? SEGMENT_TYPE_NAMES[type] || type : '—');

export interface TemplateViewSegment {
  index: number;
  title: string;
  type: string;
  typeName: string;
  durationSeconds: number;
  topic?: string;
  notes: string;
}

export interface TemplateView {
  source: 'TEMPLATE' | 'EPISODE' | 'NONE';
  /** The episode shown when the program has no saved template. */
  episode?: { id: string; title: string; episodeNumber?: number; broadcastDate?: string };
  updatedAt?: string;
  updatedByName?: string;
  topics: string[];
  segments: TemplateViewSegment[];
  totalSeconds: number;
}

interface EpisodeLike {
  id: string;
  title: string;
  episodeNumber?: number;
  broadcastDate?: string;
  topics?: { id: string; title: string }[];
  rundown?: { title: string; segmentType: string; durationSeconds?: number; notes?: string; topicId?: string }[];
  rundownSegments?: EpisodeLike['rundown'];
}

const rundownOf = (e: EpisodeLike) => e.rundown || e.rundownSegments || [];

export function programTemplateView(program: { template?: ProgramTemplate | null }, episodes: EpisodeLike[]): TemplateView {
  const template = program.template;
  if (template && (template.segments || []).length > 0) {
    const topics = (template.topics || []).map((t) => t.title);
    const segments = template.segments.map((s, i) => ({
      index: i + 1,
      title: s.title,
      type: s.segmentType,
      typeName: segmentTypeName(s.segmentType),
      durationSeconds: Number(s.durationSeconds) || 0,
      topic: s.topicIndex !== undefined ? topics[s.topicIndex] : undefined,
      notes: '',
    }));
    return {
      source: 'TEMPLATE',
      updatedAt: template.updatedAt,
      updatedByName: template.updatedByName,
      topics,
      segments,
      totalSeconds: segments.reduce((sum, s) => sum + s.durationSeconds, 0),
    };
  }
  const latest = [...episodes]
    .filter((e) => rundownOf(e).length > 0)
    .sort((a, b) => (b.broadcastDate || '').localeCompare(a.broadcastDate || ''))[0];
  if (!latest) return { source: 'NONE', topics: [], segments: [], totalSeconds: 0 };
  const topicTitles = new Map((latest.topics || []).map((t) => [t.id, t.title]));
  const segments = rundownOf(latest).map((s, i) => ({
    index: i + 1,
    title: s.title,
    type: s.segmentType,
    typeName: segmentTypeName(s.segmentType),
    durationSeconds: Number(s.durationSeconds) || 0,
    topic: s.topicId ? topicTitles.get(s.topicId) : undefined,
    notes: s.notes || '',
  }));
  return {
    source: 'EPISODE',
    episode: { id: latest.id, title: latest.title, episodeNumber: latest.episodeNumber, broadcastDate: latest.broadcastDate },
    topics: (latest.topics || []).map((t) => t.title),
    segments,
    totalSeconds: segments.reduce((sum, s) => sum + s.durationSeconds, 0),
  };
}
