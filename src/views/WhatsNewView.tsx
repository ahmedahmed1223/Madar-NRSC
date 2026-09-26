import React, { useEffect } from 'react';
import { Sparkles } from 'lucide-react';
import type { User } from '../types';
import { RELEASES } from '../content/whatsNew';
import { markWhatsNewSeen } from '../services/whatsNewSeen';

const KIND = {
  new: { label: 'جديد', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  improved: { label: 'تحسين', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  fixed: { label: 'إصلاح', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
} as const;

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
      {RELEASES.map((r, idx) => (
        <article key={r.version} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
          <header className="flex flex-wrap items-center gap-2">
            <span className="px-2 py-0.5 rounded-md bg-slate-900 text-white text-xs font-bold font-mono" dir="ltr">
              v{r.version}
            </span>
            {idx === 0 && <span className="px-2 py-0.5 rounded-md bg-emerald-600 text-white text-[10px] font-bold">الإصدار الحالي</span>}
            <h2 className="text-sm font-bold text-slate-900">{r.title}</h2>
            <time className="text-[11px] text-slate-400 mr-auto" dateTime={r.date}>
              {new Date(`${r.date}T12:00:00`).toLocaleDateString('ar-EG', { dateStyle: 'long' })}
            </time>
          </header>
          <ul className="space-y-2">
            {r.items.map((it, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-slate-700 leading-relaxed">
                <span className={`shrink-0 mt-0.5 px-1.5 py-0.5 rounded-md border text-[10px] font-bold ${KIND[it.kind].cls}`}>{KIND[it.kind].label}</span>
                <span>{it.text}</span>
              </li>
            ))}
          </ul>
        </article>
      ))}
    </div>
  );
};
