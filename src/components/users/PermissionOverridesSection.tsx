import React, { useId, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { ALL_PERMISSIONS, PERMISSION_CATEGORIES } from '../../services/rbacService';
import { OVERRIDE_STATE_LABELS, OverrideState, overrideStateOf, setOverride } from '../../services/permissionOverrides';
import { matchesQuery } from '../../shared/search';
import { isRestrictionPermission, type PermissionDecision } from '../../shared/rbac';

const STATES: OverrideState[] = ['role', 'grant', 'deny'];

/**
 * «استثناءات الصلاحيات لهذا المستخدم»: per permission, follow the role, grant it, or deny it.
 * Collapsed by default; the header says how many exceptions are set.
 */
export const PermissionOverridesSection: React.FC<{
  value: string[];
  onChange: (next: string[]) => void;
  /** Permissions the selected role gives (shown next to «حسب الدور»). */
  rolePermissions: string[];
  /** The role grants everything (super admin): exceptions have no effect. */
  allByRole?: boolean;
  decisionFor?: (code: string) => PermissionDecision;
}> = ({ value, onChange, rolePermissions, allByRole = false, decisionFor }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const uid = useId();
  const count = value.length;
  const roleHas = (code: string) => allByRole || rolePermissions.includes(code);
  const visible = ALL_PERMISSIONS.filter((p) => !query.trim() || matchesQuery(query, p.nameAr, p.code, p.description));

  return (
    <section className="rounded-lg border border-slate-200">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={`${uid}-panel`}
        className="w-full min-h-11 flex items-center justify-between gap-2 px-3 rounded-lg text-xs font-bold text-slate-700 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        <span className="flex items-center gap-2">
          <ChevronDown className={`w-4 h-4 transition-transform ${open ? '' : 'rotate-90'}`} aria-hidden="true" />
          استثناءات الصلاحيات لهذا المستخدم
        </span>
        <span className={`px-2 py-0.5 rounded-md text-2xs ${count ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
          {count ? `${count} استثناء` : 'لا استثناءات'}
        </span>
      </button>

      {open && (
        <div id={`${uid}-panel`} className="p-3 pt-0 space-y-3">
          <p className="text-2xs text-slate-500 leading-relaxed">
            «موروثة» تتبع الدور والأقسام. «منح» يضيف الصلاحية لهذا المستخدم لكنه لا يتجاوز منع القسم. «منع» يسحبها منه.
          </p>
          {allByRole && (
            <p className="text-2xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">
              هذا الدور يملك كل الصلاحيات؛ الاستثناءات لا تؤثر عليه.
            </p>
          )}
          <div className="relative">
            <label htmlFor={`${uid}-search`} className="sr-only">بحث في الصلاحيات</label>
            <Search className="w-4 h-4 text-slate-500 absolute right-3 top-3.5 pointer-events-none" aria-hidden="true" />
            <input
              id={`${uid}-search`}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="بحث في الصلاحيات..."
              className="w-full min-h-11 text-xs pr-9 pl-3 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
            />
          </div>

          {PERMISSION_CATEGORIES.map((cat) => {
            const perms = visible.filter((p) => p.category === cat.key);
            if (perms.length === 0) return null;
            return (
              <div key={cat.key} className="space-y-1">
                <h4 className="text-2xs font-bold text-slate-500 pt-2">{cat.labelAr}</h4>
                <ul className="divide-y divide-slate-100 border border-slate-100 rounded-lg">
                  {perms.map((p) => {
                    const state = overrideStateOf(value, p.code);
                    return (
                      <li key={p.code}>
                        <fieldset className="flex flex-wrap items-center justify-between gap-2 px-2 py-1.5">
                          <legend className="sr-only">{p.nameAr}</legend>
                          <div className="min-w-0 flex-1">
                            <span className="block text-xs font-semibold text-slate-800">{p.nameAr}</span>
                            <span className="block text-2xs text-slate-600">
                              {decisionFor ? `${decisionFor(p.code).allowed ? 'مسموح' : 'غير مسموح'} · ${decisionFor(p.code).label}` : `الدور: ${roleHas(p.code) ? 'يمنحها' : 'لا يمنحها'}`}
                            </span>
                          </div>
                          <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden">
                            {STATES.filter((s) => !(s === 'deny' && isRestrictionPermission(p.code))).map((s) => (
                              <label
                                key={s}
                                className={`min-h-11 px-3 inline-flex items-center text-2xs font-semibold cursor-pointer border-s border-slate-200 first:border-s-0 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-inset has-[:focus-visible]:ring-blue-500 ${
                                  state === s
                                    ? s === 'deny'
                                      ? 'bg-red-50 text-red-700'
                                      : s === 'grant'
                                        ? 'bg-blue-50 text-blue-700'
                                        : 'bg-slate-100 text-slate-800'
                                    : 'bg-white text-slate-600 hover:bg-slate-50'
                                }`}
                              >
                                <input
                                  type="radio"
                                  name={`${uid}-${p.code}`}
                                  value={s}
                                  checked={state === s}
                                  disabled={allByRole}
                                  onChange={() => onChange(setOverride(value, p.code, s))}
                                  className="sr-only"
                                />
                                {OVERRIDE_STATE_LABELS[s]}
                              </label>
                            ))}
                          </div>
                        </fieldset>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
          {visible.length === 0 && <p className="text-2xs text-slate-500">لا توجد صلاحيات مطابقة.</p>}
        </div>
      )}
    </section>
  );
};
