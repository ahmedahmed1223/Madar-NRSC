import React from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { BulletinStory } from '../../shared/bulletins';
import type { ReadinessIssue } from '../../shared/bulletinReadiness';
import type { User } from '../../types';

const KIND = {
  blocker: { label: 'مانع', text: 'text-rose-700', chip: 'border-rose-300 bg-rose-50' },
  warning: { label: 'تنبيه', text: 'text-amber-800', chip: 'border-amber-300 bg-amber-50' },
} as const;

/**
 * One row per story: what blocks it or needs attention, with the person responsible beside it
 * (not at the far edge of the screen). Stories with blockers come first, because only blockers
 * stop the bulletin going to air.
 */
export function ReadinessPanel({ issues, stories, users, onOpen }: { issues: ReadinessIssue[]; stories: BulletinStory[]; users: User[]; onOpen: (story: BulletinStory) => void }) {
  const blockers = issues.filter(i => i.severity === 'blocker');
  const warnings = issues.length - blockers.length;
  const byStory = new Map<string, ReadinessIssue[]>();
  for (const issue of issues) byStory.set(issue.storyId, [...(byStory.get(issue.storyId) || []), issue]);
  const groups = [...byStory.entries()]
    .map(([storyId, list]) => ({
      storyId,
      story: stories.find(s => s.id === storyId),
      // Blockers before warnings inside a story.
      list: [...list.filter(i => i.severity === 'blocker'), ...list.filter(i => i.severity !== 'blocker')],
    }))
    .sort((a, b) => Number(b.list.some(i => i.severity === 'blocker')) - Number(a.list.some(i => i.severity === 'blocker')));
  const name = (id?: string) => users.find(u => u.id === id)?.fullName;

  return <section aria-label="جاهزية النشرة" className="border-y border-slate-200 py-3 space-y-2">
    <h2 className="font-bold flex gap-2 items-center">{blockers.length ? <AlertTriangle className="w-4 h-4 text-rose-700" /> : <CheckCircle2 className="w-4 h-4 text-emerald-700" />}جاهزية النشرة: {blockers.length ? `${blockers.length} مانع` : 'لا موانع مسجلة'}{warnings > 0 && <span className="text-sm font-semibold text-amber-800"> · {warnings} تنبيه</span>}{groups.length > 0 && <span className="text-sm font-semibold text-slate-600"> · في {groups.length} {groups.length === 1 ? 'قصة' : 'قصص'}</span>}</h2>
    {groups.length > 0 && <ul className="divide-y divide-slate-200">{groups.map(({ storyId, story, list }) => {
      const owners = [...new Set(list.map(i => name(i.responsibleId) || 'غير مسند'))];
      return <li key={storyId}><button type="button" onClick={() => story && onOpen(story)} className="min-h-11 w-full text-right py-2 flex flex-wrap items-start gap-x-4 gap-y-1">
        <span className="font-semibold text-slate-900 w-44 shrink-0">{story?.slug || 'قصة محذوفة'}</span>
        <span className="min-w-[16rem] flex flex-wrap gap-1.5">{list.map(i => <span key={i.code} className={`rounded-md border px-1.5 text-xs font-semibold ${KIND[i.severity === 'blocker' ? 'blocker' : 'warning'].chip} ${KIND[i.severity === 'blocker' ? 'blocker' : 'warning'].text}`}><span className="font-bold">{KIND[i.severity === 'blocker' ? 'blocker' : 'warning'].label}:</span> {i.message}</span>)}</span>
        <span className="text-sm text-slate-600 py-0.5">← {owners.join('، ')}</span>
      </button></li>;
    })}</ul>}
  </section>;
}
