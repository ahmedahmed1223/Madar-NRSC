import { useState } from 'react';
import type { User } from '../../types';
import { allowsModule, FEATURE_PARENTS, moduleSubject, moduleRestrictions, MODULE_IDS, MODULE_LABELS, moduleForScreen, type ModuleAccessSettings } from '../../shared/moduleAccess';
import { evaluatePermission, findUserRole, type RoleDefinition } from '../../shared/rbac';
import { ASSIGNABLE_SCREENS, canOpenScreen, screenLabel } from '../../shared/screens';
import type { Department } from '../../shared/departments';

export function ModuleAccessPreview({ policy, users, roles, departments }: {
  policy: ModuleAccessSettings;
  users: User[];
  roles: RoleDefinition[];
  departments: readonly Department[];
}) {
  const [userId, setUserId] = useState('');
  const user = users.find(person => person.id === userId);
  const role = user && findUserRole(user, roles);

  return (
    <details className="rounded-lg border border-slate-200 px-3">
      <summary className="min-h-11 cursor-pointer content-center text-sm font-bold text-slate-800">معاينة وصول موظف</summary>
      <div className="space-y-3 pb-3">
        <div>
          <label htmlFor="module-preview-account" className="block text-xs font-semibold text-slate-700">حساب الموظف</label>
          <select id="module-preview-account" value={user?.id || ''} onChange={event => setUserId(event.target.value)} className="mt-1 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm">
            <option value="">اختر حساباً لعرض الصفحات المتاحة</option>
            {users.map(person => <option key={person.id} value={person.id}>{person.fullName} · {person.email}</option>)}
          </select>
        </div>
        {user && <div aria-live="polite">
          <p className="text-xs text-slate-600">تجمع المعاينة بين الإتاحة المختارة هنا وصلاحيات الحساب المحفوظة.</p>
          <dl className="mt-2 divide-y divide-slate-200 text-sm">
            {MODULE_IDS.map(id => {
              const included = allowsModule(policy, id, moduleSubject(user, role?.id, departments));
              const screens = included ? ASSIGNABLE_SCREENS.filter(nav => moduleForScreen(nav) === id &&
                canOpenScreen(nav, role, code => evaluatePermission(user, code, roles, departments), user.role === 'SUPER_ADMIN')) : [];
              const finishing = moduleRestrictions(policy, id, moduleSubject(user, role?.id, departments)).some(rule => rule.mode === 'finishing');
              return <div key={id} className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-2">
                <dt className="font-medium text-slate-800">{MODULE_LABELS[id]}</dt>
                <dd className="text-slate-700">{!included ? 'محجوبة بإعداد إتاحة الوحدة' :
                  finishing ? 'متاحة لإنهاء العمل القائم' :
                  FEATURE_PARENTS[id] ? 'الضبط يتيح الميزة لحساب يملك صلاحية استخدامها' :
                  screens.length ? screens.map(screenLabel).join('، ') : 'لا توجد صفحة متاحة بصلاحيات الحساب ودوره'}</dd>
              </div>;
            })}
          </dl>
        </div>}
      </div>
    </details>
  );
}
