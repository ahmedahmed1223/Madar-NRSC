import React, { useMemo, useState } from 'react';
import { BookOpen, Search, Sparkles } from 'lucide-react';
import type { User } from '../types';
import { HELP_ARTICLES } from '../content/help';
import { scoreFields } from '../shared/arabicSearch';
import { departmentIdOf, departmentName } from '../shared/departments';
import { toursFor } from '../components/help/TourHost';
import { navigateTo, setupCommand, tourCommand } from '../services/uiEvents';
import { RbacService } from '../services/rbacService';
import { BookOpenText, PlayCircle, Settings2 } from 'lucide-react';
import { countLabel } from '../shared/arabicPlural';

const STEP_FORMS = { one: 'خطوة واحدة', two: 'خطوتان', few: 'خطوات', many: 'خطوة' };

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

  // Arabic-aware search over the whole guide; with a query the best match comes first.
  const articles = useMemo(() => {
    const mine = (a: (typeof HELP_ARTICLES)[number]) => Number(a.departments.includes(myDept));
    return HELP_ARTICLES.filter((a) => !onlyMine || a.departments.length === 0 || a.departments.includes(myDept))
      .map((a) => ({ a, score: query.trim() ? scoreFields(query, a.title, a.summary, a.keywords, a.sections.flatMap((s) => [s.heading, ...s.steps])) : 0 }))
      .filter((x) => x.score !== null)
      .sort((x, y) => (y.score ?? 0) - (x.score ?? 0) || mine(y.a) - mine(x.a))
      .map((x) => x.a);
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
          <button type="button" onClick={onOpenShortcuts} className="min-h-10 px-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold">
            اختصارات لوحة المفاتيح
          </button>
          <button type="button" onClick={onOpenWhatsNew} className="inline-flex items-center gap-1.5 min-h-10 px-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold">
            <Sparkles className="w-3.5 h-3.5" />
            ما الجديد
          </button>
        </div>
      </div>

      <a
        href="/guide"
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          navigateTo.emit('/guide');
        }}
        className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-lg border border-blue-200 bg-blue-50 hover:border-blue-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
      >
        <BookOpenText className="w-6 h-6 text-blue-700 shrink-0" aria-hidden="true" />
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-bold text-slate-900">دليل الاستخدام</span>
          <span className="block text-xs text-slate-700 mt-0.5">الدليل الكامل للقراءة والطباعة: دليلك حسب دورك، كل شاشة وأزرارها، خطوات العمل، المصطلحات والأسئلة الشائعة.</span>
        </span>
        <span className="inline-flex items-center justify-center min-h-10 px-4 rounded-lg bg-blue-600 text-white text-xs font-bold shrink-0">افتح الدليل</span>
      </a>

      <section aria-labelledby="help-tours-title" className="space-y-2">
        <h2 id="help-tours-title" className="text-sm font-bold text-slate-900">جولات تفاعلية</h2>
        <p className="text-xs text-slate-600">تشير الجولة إلى الأزرار الحقيقية في الشاشة وتشرح كل واحد. الأسهم للتنقل وEsc للإنهاء.</p>
        <ul className="grid sm:grid-cols-2 xl:grid-cols-3 gap-2">
          {toursFor(currentUser).map((tour) => (
            <li key={tour.id}>
              <button type="button" onClick={() => tourCommand.emit(tour.id)} className="w-full h-full text-right flex items-start gap-3 p-3 rounded-lg border border-slate-200 bg-white hover:border-blue-300 hover:bg-blue-50/40">
                <PlayCircle className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block text-sm font-bold text-slate-900">{tour.title}</span>
                  <span className="block text-xs text-slate-600 mt-0.5">{tour.summary} · {countLabel(tour.steps.length, STEP_FORMS)}</span>
                </span>
              </button>
            </li>
          ))}
          {RbacService.hasPermission(currentUser, 'system.settings') && (
            <li>
              <button type="button" onClick={() => setupCommand.emit('open')} className="w-full h-full text-right flex items-start gap-3 p-3 rounded-lg border border-slate-200 bg-white hover:border-blue-300 hover:bg-blue-50/40">
                <Settings2 className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block text-sm font-bold text-slate-900">الإعداد السريع للنظام</span>
                  <span className="block text-xs text-slate-600 mt-0.5">المؤسسة، المحطات، الأقسام، الفريق، الأمان والنسخ الاحتياطي.</span>
                </span>
              </button>
            </li>
          )}
        </ul>
      </section>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-500 absolute right-3 top-1/2 -translate-y-1/2" />
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
                <span className="block text-2xs text-slate-500 mt-0.5 line-clamp-2">{a.summary}</span>
                {a.departments.includes(myDept) && <span className="inline-block mt-1.5 px-1.5 py-px rounded bg-blue-50 text-2xs font-bold text-blue-700">لقسمك</span>}
              </button>
            ))}
          </nav>
          {active && (
            <article className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl p-5 space-y-5">
              <header>
                <h2 className="text-lg font-bold text-slate-900">{active.title}</h2>
                <p className="text-xs text-slate-500 mt-1">{active.summary}</p>
                {active.departments.length > 0 && (
                  <p className="text-2xs text-slate-500 mt-1">الأقسام: {active.departments.map(departmentName).join('، ')}</p>
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
