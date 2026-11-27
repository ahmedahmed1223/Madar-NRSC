import { AIR_OUTCOME_LABELS, broadcastOutcomes, type BroadcastArchiveItem, type BroadcastWithArchive } from '../shared/broadcastArchive';
import { toCsv } from './csvExport';

export interface BroadcastCorrection {
  newsId: string;
  summary?: string;
  reason?: string;
  createdAt?: string;
}

export function broadcastArchiveFiles(state: BroadcastWithArchive, fallback: BroadcastArchiveItem[], corrections: BroadcastCorrection[]) {
  const rows = broadcastOutcomes(state, fallback);
  const plan = state.archivedPlan || fallback;
  const newsIds = new Set(plan.flatMap(item => item.newsId ? [item.newsId] : []));
  const requests = (state.correctionRequests || []).filter(item => item.startedAt === state.startedAt);
  const sections = plan.map(item => `${item.title}\n${item.script || 'لا نص محفوظ'}`);
  return {
    'manifest.json': JSON.stringify({
      showId: state.episodeId, title: state.episodeTitle, program: state.programName,
      startedAt: state.startedAt, endedAt: state.endedAt, operator: state.operatorName,
      scriptSource: state.archivedPlan ? 'rundown-at-close' : 'current-rundown',
    }, null, 2),
    'as-run.csv': toCsv([
      ['الفقرة', 'الحالة', 'البداية الفعلية', 'النهاية الفعلية', 'المخطط (ث)', 'الفعلي (ث)', 'الفرق (ث)'],
      ...rows.map(row => [row.title, AIR_OUTCOME_LABELS[row.status], row.actual?.startedAt, row.actual?.endedAt, row.item?.plannedSeconds, row.actual?.actualSeconds, row.actual?.diffSeconds]),
    ]),
    'scripts.txt': sections.join('\n\n'),
    'guests.csv': toCsv([['الفقرة', 'الضيف'], ...plan.flatMap(item => item.guestNames.map(guest => [item.title, guest]))]),
    ...(requests.length ? { 'correction-requests.csv': toCsv([
      ['الفقرة', 'وقت البث', 'سبب الطلب', 'صاحب الطلب', 'وقت التسجيل', 'التصحيح المرتبط'],
      ...requests.map(item => [item.segmentTitle, item.airedAt, item.reason, item.actorName, item.createdAt, item.correctionId]),
    ]) } : {}),
    'corrections.csv': toCsv([
      ['الخبر', 'التصحيح', 'السبب', 'التاريخ'],
      ...corrections.filter(entry => newsIds.has(entry.newsId)).map(entry => [entry.newsId, entry.summary, entry.reason, entry.createdAt]),
    ]),
  };
}

export async function downloadBroadcastArchive(state: BroadcastWithArchive, fallback: BroadcastArchiveItem[], corrections: BroadcastCorrection[]) {
  const { default: JSZip } = await import('jszip');
  const archive = new JSZip();
  for (const [name, content] of Object.entries(broadcastArchiveFiles(state, fallback, corrections))) archive.file(name, content);
  const url = URL.createObjectURL(await archive.generateAsync({ type: 'blob', compression: 'DEFLATE' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `as-run-${state.episodeId.replace(/[^\w.-]/g, '-')}-${state.startedAt.slice(0, 10)}.zip`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
