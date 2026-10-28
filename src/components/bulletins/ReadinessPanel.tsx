import React from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { BulletinStory } from '../../shared/bulletins';
import type { ReadinessIssue } from '../../shared/bulletinReadiness';
import type { User } from '../../types';

export function ReadinessPanel({ issues, stories, users, onOpen }: { issues: ReadinessIssue[]; stories: BulletinStory[]; users: User[]; onOpen: (story: BulletinStory) => void }) {
  const blockers = issues.filter(i => i.severity === 'blocker');
  const warnings = issues.length - blockers.length;
  // Blockers first: they stop the bulletin going to air, warnings do not.
  const ordered = [...blockers, ...issues.filter(i => i.severity !== 'blocker')];
  return <section aria-label="جاهزية النشرة" className="border-y border-slate-200 py-3 space-y-2">
    <h2 className="font-bold flex gap-2 items-center">{blockers.length ? <AlertTriangle className="w-4 h-4 text-rose-700" /> : <CheckCircle2 className="w-4 h-4 text-emerald-700" />}جاهزية النشرة: {blockers.length ? `${blockers.length} مانع` : 'لا موانع مسجلة'}{warnings > 0 && <span className="text-sm font-semibold text-amber-800"> · {warnings} تنبيه</span>}</h2>
    {issues.length > 0 && <ul className="divide-y divide-slate-200">{ordered.map(i => {
      const story = stories.find(s => s.id === i.storyId);
      return <li key={`${i.storyId}:${i.code}`}><button type="button" onClick={() => story && onOpen(story)} className="min-h-11 w-full text-right flex flex-wrap justify-between gap-2 py-2">
        <span className={`flex items-start gap-2 ${i.severity === 'blocker' ? 'text-rose-700' : 'text-amber-800'}`}>
          <span className={`shrink-0 rounded-md px-1.5 text-[11px] font-bold border ${i.severity === 'blocker' ? 'border-rose-300 bg-rose-50' : 'border-amber-300 bg-amber-50'}`}>{i.severity === 'blocker' ? 'مانع' : 'تنبيه'}</span>
          <span>{story?.slug}: {i.message}</span>
        </span>
        <span className="text-sm text-slate-600">{users.find(u => u.id === i.responsibleId)?.fullName || 'غير مسند'}</span>
      </button></li>;
    })}</ul>}
  </section>;
}
