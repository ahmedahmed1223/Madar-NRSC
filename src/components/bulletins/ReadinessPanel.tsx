import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { AR, countLabel } from '../../shared/arabicPlural';
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
export function ReadinessPanel({ issues, stories, users, onOpen, airStoryCount, timingText }: { issues: ReadinessIssue[]; stories: BulletinStory[]; users: User[]; onOpen?: (story: BulletinStory) => void; airStoryCount: number; timingText?: string }) {
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

  const ready = airStoryCount > 0 && blockers.length === 0;
  const renderGroup = ({ storyId, story, list }: typeof groups[number]) => {
      const owners = [...new Set(list.map(i => name(i.responsibleId) || 'غير مسند'))];
      return <li key={storyId} className="py-2 flex flex-wrap items-center justify-between gap-x-4">
        <div className="min-w-0 grow space-y-1 text-sm">
          <p className="font-bold text-slate-900 break-words">{story?.slug || 'قصة غير متاحة'}</p>
          <ul className="flex flex-wrap gap-1.5">{list.map(issue => <li key={issue.code} className={`rounded-md border px-1.5 text-xs font-semibold ${KIND[issue.severity].chip} ${KIND[issue.severity].text}`}>{KIND[issue.severity].label} {'·'} {issue.message}</li>)}</ul>
          <p className="text-xs text-slate-700">المسؤول {owners.join('، ')}</p>
        </div>
        {story && onOpen && <button type="button" onClick={() => onOpen(story)} aria-label={`فتح قصة النشرة: ${story.slug}`} className="min-h-11 px-2 text-sm font-bold text-blue-700 hover:underline">فتح القصة</button>}
      </li>;
  };

  return <section aria-label="جاهزية النشرة" className="border-y border-slate-200 py-2 space-y-1">
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
      <h2 className="font-bold flex gap-2 items-center">{ready ? <CheckCircle2 aria-hidden className="w-4 h-4 shrink-0 text-emerald-700" /> : <AlertTriangle aria-hidden className="w-4 h-4 shrink-0 text-rose-700" />}جاهزية النشرة</h2>
      <span className="text-xs font-semibold text-slate-700">{timingText}</span>
    </div>
    <p className={`text-sm font-semibold ${ready ? 'text-emerald-700' : 'text-rose-700'}`}>{!airStoryCount ? 'لا توجد قصص مدرجة للبث' : ready ? 'لا موانع مسجلة' : countLabel(blockers.length, AR.blocker)}{warnings > 0 && <span className="text-amber-800"> · {countLabel(warnings, AR.warning)}</span>}</p>
    {groups[0] && <ul>{renderGroup(groups[0])}</ul>}
    {groups.length > 1 && <details>
      <summary className="min-h-11 py-2.5 cursor-pointer text-sm font-semibold text-blue-700">عرض بقية القصص التي تحتاج متابعة</summary>
      <ul className="divide-y divide-slate-200">{groups.slice(1).map(renderGroup)}</ul>
    </details>}
  </section>;
}
