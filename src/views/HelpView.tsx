import React, { useMemo, useState } from 'react';
import { BookOpen, Search, Sparkles } from 'lucide-react';
import type { User } from '../types';
import { HELP_ARTICLES } from '../content/help';
import { departmentIdOf, departmentName } from '../shared/departments';

interface HelpViewProps {
  currentUser: User;
  onOpenWhatsNew: () => void;
  onOpenShortcuts: () => void;
}

/** Task-based guides, with the ones for the user's department first. */
export const HelpView: React.FC<HelpViewProps> = ({ currentUser, onOpenWhatsNew, onOpenShortcuts }) => {
  const myDept = departmentIdOf(currentUser);
  const [query, setQuery] = useState('');
  const [onlyMine, setOnlyMine] = useState(false);
  const [activeId, setActiveId] = useState<string>(HELP_ARTICLES[0].id);

  const articles = useMemo(() => {
    const q = query.trim().toLowerCase();
    return HELP_ARTICLES.filter((a) => !onlyMine || a.departments.length === 0 || a.departments.includes(myDept))
      .filter((a) => {
        if (!q) return true;
        const text = [a.title, a.summary, ...a.keywords, ...a.sections.flatMap((s) => [s.heading, ...s.steps])].join(' ').toLowerCase();
        return text.includes(q);
      })
      .sort((a, b) => Number(b.departments.includes(myDept)) - Number(a.departments.includes(myDept)));
  }, [query, onlyMine, myDept]);

  const active = articles.find((a) => a.id === activeId) || articles[0];

  return (
    <div className="space-y-5">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-blue-600" />
            المساعدة
          </h1>
          <p className="text-xs text-slate-500 mt-1">أدلة مختصرة لكل مهمة يومية. قسمك: {departmentName(myDept)}.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onOpenShortcuts} className="px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold">
            اختصارات لوحة المفاتيح
          </button>
          <button type="button" onClick={onOpenWhatsNew} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold">
            <Sparkles className="w-3.5 h-3.5" />
            ما الجديد
          </button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث: كيف أرسل طلب مونتاج؟ كيف أجدول خبراً؟..."
            aria-label="بحث في المساعدة"
            className="w-full pr-9 pl-3 py-2.5 border border-slate-300 rounded-xl text-xs bg-white"
          />
        </div>
        <label className="flex items-center gap-2 text-xs font-bold text-slate-700 px-2">
          <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} />
          ما يخص قسمي فقط
        </label>
      </div>

      {articles.length === 0 ? (
        <p className="text-center text-xs text-slate-500 py-10 bg-white border border-dashed border-slate-300 rounded-2xl">لا توجد نتائج. جرّب كلمات أخرى.</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <nav aria-label="موضوعات المساعدة" className="bg-white border border-slate-200 rounded-2xl p-2 h-fit space-y-1">
            {articles.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setActiveId(a.id)}
                aria-current={active?.id === a.id ? 'page' : undefined}
                className={`w-full text-right p-3 rounded-xl transition-colors ${active?.id === a.id ? 'bg-blue-50 border border-blue-200' : 'hover:bg-slate-50 border border-transparent'}`}
              >
                <span className="block text-xs font-bold text-slate-800">{a.title}</span>
                <span className="block text-[11px] text-slate-500 mt-0.5 line-clamp-2">{a.summary}</span>
                {a.departments.includes(myDept) && <span className="inline-block mt-1 text-[10px] font-bold text-blue-700">لقسمك</span>}
              </button>
            ))}
          </nav>
          {active && (
            <article className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl p-5 space-y-5">
              <header>
                <h2 className="text-lg font-bold text-slate-900">{active.title}</h2>
                <p className="text-xs text-slate-500 mt-1">{active.summary}</p>
                {active.departments.length > 0 && (
                  <p className="text-[11px] text-slate-400 mt-1">الأقسام: {active.departments.map(departmentName).join('، ')}</p>
                )}
              </header>
              {active.sections.map((s) => (
                <section key={s.heading} className="space-y-2">
                  <h3 className="text-sm font-bold text-slate-800">{s.heading}</h3>
                  <ol className="space-y-2">
                    {s.steps.map((step, i) => (
                      <li key={i} className="flex gap-2.5 text-sm text-slate-700 leading-relaxed">
                        <span className="w-6 h-6 rounded-full bg-blue-50 text-blue-700 text-xs font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>
                </section>
              ))}
            </article>
          )}
        </div>
      )}
    </div>
  );
};
