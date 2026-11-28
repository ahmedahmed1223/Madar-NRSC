import { appLocale, zoneOptions } from '../shared/dateFormat';
import React, { useEffect } from 'react';
import { Sparkles } from 'lucide-react';
import type { User } from '../types';
import { RELEASES, type ReleaseItem } from '../content/whatsNew';
import { markWhatsNewSeen } from '../services/whatsNewSeen';
import { AppUpdatesPanel } from '../components/settings/AppUpdatesPanel';
import { RbacService } from '../services/rbacService';

const KIND = {
  new: { label: 'جديد', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  improved: { label: 'تحسين', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  fixed: { label: 'إصلاح', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
} as const;

function ReleaseNotesList({ items }: { items: ReleaseItem[] }) {
  return (
    <ul className="space-y-2">
      {items.map((item, index) => (
        <li key={index} className="flex items-start gap-2 text-sm text-slate-700 leading-relaxed">
          <span className={`shrink-0 mt-0.5 px-1.5 py-0.5 rounded-md border text-2xs font-bold ${KIND[item.kind].cls}`}>{KIND[item.kind].label}</span>
          <span>{item.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** Release notes; opening the page clears the «new» badge for this user. */
export const WhatsNewView: React.FC<{ currentUser: User }> = ({ currentUser }) => {
  useEffect(() => markWhatsNewSeen(currentUser.id), [currentUser.id]);

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-amber-500" />
          ما الجديد
        </h1>
        <p className="text-xs text-slate-500 mt-1">آخر التحديثات والتحسينات في النظام.</p>
      </div>
      <AppUpdatesPanel canManage={RbacService.hasPermission(currentUser, 'system.settings')} />
      {RELEASES.map((r, idx) => (
        <article key={r.version} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
          <header className="flex flex-wrap items-center gap-2">
            <span className="px-2 py-0.5 rounded-md bg-slate-900 text-white text-xs font-bold font-mono" dir="ltr">
              v{r.version}
            </span>
            {idx === 0 && <span className="px-2 py-0.5 rounded-md bg-emerald-700 text-white text-2xs font-bold">الإصدار الحالي</span>}
            <h2 className="text-sm font-bold text-slate-900">{r.title}</h2>
            <time className="text-2xs text-slate-500 mr-auto" dateTime={r.date}>
              {new Date(`${r.date}T12:00:00`).toLocaleDateString(appLocale(), { ...zoneOptions(), dateStyle: 'long' })}
            </time>
          </header>
          {r.sections ? (
            <div className="space-y-4">
              {r.sections.map(section => (
                <section key={section.title} className="space-y-2">
                  <h3 className="text-sm font-bold text-slate-900">{section.title}</h3>
                  <ReleaseNotesList items={section.items} />
                </section>
              ))}
            </div>
          ) : <ReleaseNotesList items={r.items} />}
        </article>
      ))}
    </div>
  );
};
