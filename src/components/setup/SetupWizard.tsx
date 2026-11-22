import React, { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Plus, ShieldCheck } from 'lucide-react';
import type { User, UserRole } from '../../types';
import { FormPage } from '../common/FormPage';
import { StationsSettings } from '../settings/StationsSettings';
import { apiService } from '../../services/api';
import { apiFetch } from '../../services/http';
import { authClient } from '../../services/authClient';
import { confirmSaved } from '../../services/confirmSave';
import { dataStore } from '../../services/dataStore';
import { RbacService } from '../../services/rbacService';
import { navigateTo, tourCommand } from '../../services/uiEvents';
import { SINGLETON_ID } from '../../shared/collections';
import { DEPARTMENTS, departmentName } from '../../shared/departments';
import { sanitizeDateSettings, validZone, type HourCycle, type TimeBasis } from '../../shared/dateFormat';
import { SETUP_STEPS, setupDoneCount, setupProgress, setupSkipped, type SetupState, type SetupStepId } from '../../shared/setup';
import { temporaryPassword, validatePasswordStrength, webRandom } from '../../shared/passwords';
import { confirmDialog } from '../../services/dialogs';
import { stationsOf } from '../../shared/stations';
import { AdministratorSetup } from './AdministratorSetup';
import { DatabaseEnginePanel } from '../database/DatabaseEnginePanel';

const INPUT = 'w-full min-h-11 px-3 border border-slate-300 rounded-lg bg-white text-sm text-slate-900';
const LABEL = 'block text-sm font-bold text-slate-700 mb-1';
const ZONES = ['Asia/Gaza', 'Asia/Jerusalem', 'Asia/Beirut', 'Europe/Istanbul', 'Asia/Amman', 'Asia/Riyadh', 'Asia/Dubai', 'Asia/Qatar', 'Africa/Cairo', 'Europe/London', 'UTC'];
const CATEGORY_COLORS = ['#0e7490', '#b91c1c', '#7c3aed', '#047857', '#b45309', '#1d4ed8', '#be185d', '#475569'];

/** A strong first password for a new colleague, without look-alike characters (they change it at first sign-in). */
const suggestPassword = () => temporaryPassword(webRandom);

/** Facts the progress is computed from, read from the live data. */
function useFacts(open: boolean, currentUser: User) {
  const [version, setVersion] = useState(0);
  const [backups, setBackups] = useState(false);
  useEffect(
    () =>
      dataStore.subscribe((evt) => {
        if (evt.type === 'data-changed' && evt.collections.some((c) => ['settings', 'categories', 'users'].includes(c))) setVersion((v) => v + 1);
      }),
    []
  );
  // Read for the home reminder too (not only inside the wizard), so both count the same steps.
  const canSeeRuntime = RbacService.hasPermission(currentUser, 'system.settings');
  useEffect(() => {
    if (!open && !canSeeRuntime) return;
    void apiFetch<{ data: { backupIntervalHours: number } }>('/api/v1/admin/runtime')
      .then((r) => setBackups((r.data.backupIntervalHours || 0) > 0))
      .catch(() => setBackups(false));
  }, [open, canSeeRuntime]);
  return useMemo(() => {
    const settings = apiService.getSettings();
    const me = apiService.getUsers().find((u) => u.id === currentUser.id);
    return {
      settings,
      facts: {
        setup: settings.setup,
        stationsConfigured: Array.isArray(settings.stations),
        categories: apiService.getCategories().length,
        teamMembers: apiService.getUsers().filter((u) => u.isActive !== false && !u.deletedAt).length,
        adminTwoFactor: !!(me || currentUser).twoFactorEnabled,
        backups,
      },
    };
    // version: recomputed when shared data changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, backups, currentUser]);
}

/** Saves the setup state (and optionally other settings) and waits for the server. */
async function saveSetup(change: (setup: SetupState) => SetupState, extra: Record<string, unknown> = {}) {
  const current = apiService.getSettings();
  apiService.saveSettings({ ...extra, setup: change(current.setup || {}) });
  const result = await dataStore.awaitWrite('settings', SINGLETON_ID);
  if (!result.ok) throw new Error(result.message || 'لم يؤكد الخادم الحفظ');
}

interface SetupWizardProps {
  isOpen: boolean;
  startAtOrganization?: boolean;
  reviewId?: string;
  onClose: () => void;
  currentUser: User;
}

/**
 * The administrator's quick setup takes a fresh installation to a working newsroom.
 * Every step saves for real; the progress follows what the system shows, so leaving halfway and
 * coming back later resumes where the work stands.
 */
export const SetupWizard: React.FC<SetupWizardProps> = ({ isOpen, startAtOrganization, reviewId, onClose, currentUser }) => {
  const { settings, facts } = useFacts(isOpen, currentUser);
  const progress = setupProgress(facts);
  const skipped = setupSkipped(facts);
  const firstOpen = SETUP_STEPS.find((s) => !progress[s.id])?.id || 'finish';
  const [stepId, setStepId] = useState<SetupStepId>(firstOpen);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (isOpen) {
      setStepId(startAtOrganization ? 'organization' : firstOpen);
      setMessage(null);
      // A lost acknowledgement leaves the review available on the next sign-in.
      if (reviewId) void authClient.setupReviewShown(reviewId).catch(() => undefined);
    }
    // Opens on the first step still to do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, startAtOrganization, reviewId]);

  const index = SETUP_STEPS.findIndex((s) => s.id === stepId);
  const go = (offset: number) => {
    setMessage(null);
    setStepId(SETUP_STEPS[Math.max(0, Math.min(SETUP_STEPS.length - 1, index + offset))].id);
  };
  const run = async (fn: () => Promise<void>, ok: string, next = true) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      // Moving on clears the previous step's message, so the confirmation is set after it.
      if (next) go(1);
      setMessage({ ok: true, text: ok });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : 'تعذر الحفظ' });
    } finally {
      setBusy(false);
    }
  };
  const confirmStep = (id: SetupStepId) => saveSetup((s) => ({ ...s, confirmed: [...new Set([...(s.confirmed || []), id])] }));

  // --- Organization ---
  const readOrg = () => {
    const { hourCycle, timeBasis } = sanitizeDateSettings(settings.dateTime);
    return { organizationName: settings.organizationName || '', organizationNameEn: settings.organizationNameEn || '', primaryChannelName: settings.primaryChannelName || '', defaultTimezone: validZone(settings.defaultTimezone) || 'Asia/Gaza', hourCycle, timeBasis };
  };
  const [org, setOrg] = useState(readOrg);
  const [originalOrg, setOriginalOrg] = useState(readOrg);
  useEffect(() => {
    if (!isOpen) return;
    const initial = readOrg();
    setOrg(initial);
    setOriginalOrg(initial);
    // Filled when the wizard opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // --- Stations ---
  const [stationsDirty, setStationsDirty] = useState(false);

  // --- Categories ---
  const [categoryName, setCategoryName] = useState('');
  const categories = apiService.getCategories();

  // --- Team ---
  const roles = RbacService.getRoleDefinitions().filter((r) => r.roleCode !== 'SUPER_ADMIN' || currentUser.role === 'SUPER_ADMIN');
  const stations = stationsOf(settings);
  const blankMember = () => ({ fullName: '', email: '', roleId: roles.find((r) => r.roleCode === 'JOURNALIST')?.id || roles[0]?.id || '', stationId: '', departmentId: 'newsroom', jobTitle: '', password: suggestPassword() });
  const [member, setMember] = useState(blankMember);
  const [added, setAdded] = useState<{ name: string; email: string; password: string }[]>([]);
  const addMember = () =>
    run(
      async () => {
        if (!member.fullName.trim() || !/^\S+@\S+\.\S+$/.test(member.email.trim())) throw new Error('الاسم والبريد الإلكتروني الصحيح مطلوبان');
        // Same rule as the server, checked before anything is created: a refused password never leaves an account behind.
        const weak = validatePasswordStrength(member.password);
        if (weak) throw new Error(`كلمة المرور الأولى: ${weak}`);
        const email = member.email.trim().toLowerCase();
        if (apiService.getUsers().some((u) => !u.deletedAt && u.email.toLowerCase() === email)) throw new Error('البريد الإلكتروني مستخدم لحساب آخر');
        const role = roles.find((r) => r.id === member.roleId);
        const saved = apiService.saveUser({
          fullName: member.fullName.trim(),
          email,
          role: (role?.isSystemRole ? role.roleCode : 'VIEWER') as UserRole,
          customRoleId: role && !role.isSystemRole ? role.id : undefined,
          jobTitle: member.jobTitle.trim() || role?.nameAr || 'محرر',
          departmentId: member.departmentId,
          department: departmentName(member.departmentId),
          stationId: member.stationId || undefined,
          isActive: true,
        });
        // The account must exist on the server before it gets a password.
        const accepted = await dataStore.awaitWrite('users', saved.id);
        if (!accepted.ok) throw new Error(accepted.message || 'تعذر حفظ الحساب على الخادم، حاول مرة أخرى');
        try {
          await authClient.setUserPassword(saved.id, member.password);
        } catch (err) {
          // No account without a password: withdraw it, so correcting and retrying works.
          apiService.deleteUser(saved.id);
          await dataStore.awaitWrite('users', saved.id).catch(() => undefined);
          throw err;
        }
        setAdded((list) => [...list, { name: saved.fullName, email: saved.email, password: member.password }]);
        setMember(blankMember());
      },
      'أُضيف الحساب؛ سلّم بيانات الدخول بشكل آمن، وتُغيَّر كلمة المرور الأولى عند أول دخول.',
      false
    );

  const done = setupDoneCount(progress);
  const total = SETUP_STEPS.length - 1;

  return (
    <FormPage isOpen={isOpen} onClose={onClose} title="الإعداد السريع للنظام" subtitle={`${done} من ${total} خطوات مكتملة`} maxWidth="6xl">
      <div className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <nav aria-label="خطوات الإعداد">
          <div className="lg:hidden mb-2">
            <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden" role="progressbar" aria-label="تقدم الإعداد" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
              <div className="h-full bg-blue-600" style={{ width: `${(done / total) * 100}%` }} />
            </div>
          </div>
          <ol className="flex lg:flex-col gap-1 overflow-x-auto pb-1">
            {SETUP_STEPS.map((step, i) => {
              const current = step.id === stepId;
              return (
                <li key={step.id} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setMessage(null);
                      setStepId(step.id);
                    }}
                    aria-current={current ? 'step' : undefined}
                    className={`w-full text-right flex items-center gap-3 px-3 min-h-11 rounded-md text-sm ${current ? 'bg-slate-900 text-white font-bold' : 'text-slate-700 hover:bg-slate-100'}`}
                  >
                    <span
                      className={`w-6 h-6 shrink-0 rounded-full text-2xs font-bold flex items-center justify-center tabular-nums ${
                        progress[step.id] ? 'bg-emerald-600 text-white' : skipped[step.id] ? 'bg-amber-400 text-amber-950' : current ? 'bg-blue-500 text-white' : 'bg-slate-200 text-slate-700'
                      }`}
                    >
                      {progress[step.id] ? <Check className="w-3.5 h-3.5" aria-label="مكتملة" /> : skipped[step.id] ? <span aria-label="تُجووزت">!</span> : i + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="block whitespace-nowrap">{step.title}</span>
                      <span className={`hidden lg:block text-2xs ${current ? 'text-slate-300' : 'text-slate-500'}`}>{step.hint}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          <button type="button" disabled={busy} onClick={onClose} className="mt-3 min-h-10 px-3 text-sm text-slate-700 underline underline-offset-4">
            {settings.setup?.completedAt ? 'إغلاق المعالج' : 'إكمال الإعداد لاحقاً'}
          </button>
        </nav>

        <section aria-labelledby="setup-step-title" className="min-w-0 space-y-5">
          <h2 id="setup-step-title" className="strap text-lg">{SETUP_STEPS[index].title}</h2>

          {message && (
            <p role={message.ok ? 'status' : 'alert'} className={`p-3 rounded-lg border text-sm font-bold ${message.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'}`}>
              {message.text}
            </p>
          )}

          {stepId === 'organization' && RbacService.hasPermission(currentUser, 'system.database_manage') && <DatabaseEnginePanel />}

          {stepId === 'organization' && (
            <form
              className="space-y-4 max-w-2xl"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  if (!org.organizationName.trim()) throw new Error('اسم المؤسسة مطلوب');
                  const changes: Record<string, unknown> = {};
                  for (const field of ['organizationName', 'organizationNameEn', 'primaryChannelName', 'defaultTimezone'] as const) {
                    if (org[field] !== originalOrg[field]) changes[field] = org[field].trim();
                  }
                  if (org.hourCycle !== originalOrg.hourCycle || org.timeBasis !== originalOrg.timeBasis) {
                    const dateTime = sanitizeDateSettings(apiService.getSettings().dateTime);
                    if (org.hourCycle !== originalOrg.hourCycle) dateTime.hourCycle = org.hourCycle;
                    if (org.timeBasis !== originalOrg.timeBasis) dateTime.timeBasis = org.timeBasis;
                    changes.dateTime = dateTime;
                  }
                  await saveSetup((s) => ({ ...s, confirmed: [...new Set([...(s.confirmed || []), 'organization' as const])] }), changes);
                  setOriginalOrg(org);
                }, 'حُفظت بيانات المؤسسة.');
              }}
            >
              <p className="text-sm text-slate-600">راجع اسم المؤسسة والقناة كما سيظهران للفريق. يمكنك تعديل القيم المعروضة، ثم اختيار «حفظ والمتابعة». المنطقة الزمنية تضبط ساعة المحطة والمواعيد.</p>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="setup-org" className={LABEL}>اسم المؤسسة *</label>
                  <input id="setup-org" required maxLength={120} value={org.organizationName} onChange={(e) => setOrg({ ...org, organizationName: e.target.value })} className={INPUT} />
                </div>
                <div>
                  <label htmlFor="setup-org-en" className={LABEL}>الاسم بالإنجليزية</label>
                  <input id="setup-org-en" dir="ltr" maxLength={120} value={org.organizationNameEn} onChange={(e) => setOrg({ ...org, organizationNameEn: e.target.value })} className={INPUT} />
                </div>
                <div>
                  <label htmlFor="setup-channel" className={LABEL}>القناة الرئيسية</label>
                  <input id="setup-channel" maxLength={120} value={org.primaryChannelName} onChange={(e) => setOrg({ ...org, primaryChannelName: e.target.value })} className={INPUT} />
                </div>
                <div>
                  <label htmlFor="setup-zone" className={LABEL}>المنطقة الزمنية للمحطة</label>
                  <select id="setup-zone" dir="ltr" value={org.defaultTimezone} onChange={(e) => setOrg({ ...org, defaultTimezone: e.target.value })} className={INPUT}>
                    {[...new Set([org.defaultTimezone, ...ZONES])].map((zone) => (
                      <option key={zone} value={zone}>{zone}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <label className={LABEL}>عرض الساعة<select className={INPUT} value={org.hourCycle} onChange={e => setOrg({ ...org, hourCycle: e.target.value as HourCycle })}><option value="h23">24 ساعة</option><option value="h12">12 ساعة</option></select></label>
                <label className={LABEL}>توقيت المواعيد<select className={INPUT} value={org.timeBasis} onChange={e => setOrg({ ...org, timeBasis: e.target.value as TimeBasis })}><option value="device">توقيت جهاز الموظف</option><option value="station">توقيت المحطة لجميع الموظفين</option></select></label>
              </div>
              <StepActions busy={busy} primary="حفظ والمتابعة" onSkip={() => go(1)} />
            </form>
          )}

          {stepId === 'administrator' && <AdministratorSetup currentUser={currentUser} busy={busy} onBack={() => go(-1)} onSkip={() => go(1)} onContinue={() => void run(() => confirmStep('administrator'), 'سُجّلت مراجعة حساب المسؤول.')} />}

          {stepId === 'stations' && (
            <div className="space-y-2">
              <p className="text-sm text-slate-600">
                {stations.length === 0 ? 'لا محطات بعد؛ أضف محطتك الأولى.' : `${stations.length} ${stations.length === 1 ? 'محطة' : stations.length === 2 ? 'محطتان' : stations.length <= 10 ? 'محطات' : 'محطة'}${facts.stationsConfigured ? '' : ' افتراضية'} جاهزة للتعديل.`} حدّد الرئيسية والفروع، واحفظ قبل المتابعة.
              </p>
              <StationsSettings onDirtyChange={setStationsDirty} />
              <StepActions
                busy={busy}
                onBack={() => go(-1)}
                primary="تمت مراجعة المحطات، متابعة"
                onPrimary={() =>
                  void (async () => {
                    // Unsaved station edits are never dropped silently.
                    if (stationsDirty && !(await confirmDialog({ title: 'تعديلات المحطات لم تُحفظ', message: 'المتابعة الآن تتجاهل ما عدّلته في المحطات. اضغط «حفظ» أسفل المحطات أولاً، أو تابع دون حفظ.', confirmLabel: 'المتابعة دون حفظ', cancelLabel: 'العودة للحفظ', danger: true }))) return;
                    await run(() => confirmStep('stations'), 'سُجّلت مراجعة المحطات.');
                  })()
                }
              />
            </div>
          )}

          {stepId === 'categories' && (
            <div className="space-y-4 max-w-2xl">
              <p className="text-sm text-slate-600">تصنيفات الأخبار (سياسة، اقتصاد، رياضة…) ترتّب المواد في القوائم والتقارير، وهي غير «الأقسام الإدارية» التي ينتمي إليها الزملاء. يمكنك إعادة تسميتها وترتيبها لاحقاً من الإعدادات.</p>
              {categories.length > 0 && (
                <ul className="flex flex-wrap gap-2" aria-label="التصنيفات الحالية">
                  {categories.map((c) => (
                    <li key={c.id} className="inline-flex items-center gap-2 px-3 min-h-9 rounded-md border border-slate-200 bg-white text-sm">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: c.colorCode || c.color }} aria-hidden="true" />
                      {c.nameAr}
                    </li>
                  ))}
                </ul>
              )}
              <form
                className="flex flex-wrap items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const name = categoryName.trim();
                  if (!name) return;
                  void run(
                    async () => {
                      if (categories.some((c) => c.nameAr === name)) throw new Error('التصنيف موجود');
                      const saved = apiService.saveCategory({ nameAr: name, colorCode: CATEGORY_COLORS[categories.length % CATEGORY_COLORS.length] });
                      if (!(await confirmSaved('categories', saved.id, `أُضيف تصنيف ${name}`))) throw new Error('لم يؤكد الخادم الحفظ');
                      setCategoryName('');
                    },
                    `أُضيف تصنيف ${name}.`,
                    false
                  );
                }}
              >
                <div className="flex-1 min-w-48">
                  <label htmlFor="setup-category" className={LABEL}>تصنيف جديد</label>
                  <input id="setup-category" maxLength={60} value={categoryName} onChange={(e) => setCategoryName(e.target.value)} placeholder="مثال: سياسة، اقتصاد، رياضة" className={INPUT} />
                </div>
                <button type="submit" disabled={busy || !categoryName.trim()} className="min-h-11 px-4 rounded-lg border border-slate-300 bg-white text-sm font-bold text-slate-800 hover:bg-slate-50 inline-flex items-center gap-1.5 disabled:opacity-50">
                  <Plus className="w-4 h-4" aria-hidden="true" />
                  إضافة
                </button>
              </form>
              <StepActions busy={busy} onBack={() => go(-1)} primary="متابعة" onPrimary={() => go(1)} />
            </div>
          )}

          {stepId === 'team' && (
            <div className="space-y-4">
              <p className="text-sm text-slate-600">أضف الزملاء بدورهم ومحطتهم وقسمهم؛ الدور يحدد ما يفعلونه والصفحات التي تظهر لهم. للصلاحيات التفصيلية والأدوار المخصصة: «المستخدمون والصلاحيات».</p>
              <form
                className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 p-4 rounded-lg border border-slate-200 bg-white"
                onSubmit={(e) => {
                  e.preventDefault();
                  void addMember();
                }}
              >
                <div>
                  <label htmlFor="setup-member-name" className={LABEL}>الاسم الكامل *</label>
                  <input id="setup-member-name" required value={member.fullName} onChange={(e) => setMember({ ...member, fullName: e.target.value })} className={INPUT} />
                </div>
                <div>
                  <label htmlFor="setup-member-email" className={LABEL}>البريد الإلكتروني *</label>
                  <input id="setup-member-email" required type="email" dir="ltr" value={member.email} onChange={(e) => setMember({ ...member, email: e.target.value })} className={INPUT} />
                </div>
                <div>
                  <label htmlFor="setup-member-role" className={LABEL}>الدور</label>
                  <select id="setup-member-role" value={member.roleId} onChange={(e) => setMember({ ...member, roleId: e.target.value })} className={INPUT}>
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>{r.nameAr}{r.isSystemRole ? '' : ' (دور مخصص)'}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="setup-member-station" className={LABEL}>المحطة</label>
                  <select id="setup-member-station" value={member.stationId} onChange={(e) => setMember({ ...member, stationId: e.target.value })} className={INPUT}>
                    <option value="">بدون محطة (إدارة مركزية)</option>
                    {stations.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="setup-member-dept" className={LABEL}>القسم</label>
                  <select id="setup-member-dept" value={member.departmentId} onChange={(e) => setMember({ ...member, departmentId: e.target.value })} className={INPUT}>
                    {DEPARTMENTS.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="setup-member-password" className={LABEL}>كلمة المرور الأولى</label>
                  <input id="setup-member-password" dir="ltr" required minLength={10} value={member.password} onChange={(e) => setMember({ ...member, password: e.target.value })} aria-describedby="setup-member-password-hint" className={`${INPUT} font-mono`} />
                  <p id="setup-member-password-hint" className="text-xs text-slate-500 mt-1">10 أحرف على الأقل بحروف وأرقام.</p>
                </div>
                <div className="sm:col-span-2 lg:col-span-3">
                  <button type="submit" disabled={busy} className="min-h-11 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold inline-flex items-center gap-1.5 disabled:opacity-50">
                    <Plus className="w-4 h-4" aria-hidden="true" />
                    {busy ? 'جارٍ الحفظ…' : 'إضافة الزميل'}
                  </button>
                </div>
              </form>
              {added.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-bold text-slate-900">أُضيف في هذه الجلسة</h3>
                  <ul className="divide-y divide-slate-200 border border-slate-200 rounded-lg bg-white">
                    {added.map((a) => (
                      <li key={a.email} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm">
                        <span className="font-bold text-slate-900">{a.name}</span>
                        <span dir="ltr" className="text-slate-600">{a.email}</span>
                        <span dir="ltr" className="font-mono text-slate-800">{a.password}</span>
                        <button
                          type="button"
                          onClick={() => void navigator.clipboard?.writeText(`${a.email}\n${a.password}`)}
                          className="ms-auto min-h-9 px-3 rounded-md border border-slate-200 text-xs font-bold text-slate-700 inline-flex items-center gap-1"
                        >
                          <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                          نسخ بيانات الدخول
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-sm text-slate-600">حسابات فعالة الآن: <b className="tabular-nums">{facts.teamMembers}</b>.</p>
              <StepActions busy={busy} onBack={() => go(-1)} primary="متابعة" onPrimary={() => void run(() => confirmStep('team'), 'سُجّلت خطوة الفريق.')} />
            </div>
          )}

          {stepId === 'security' && (
            <div className="space-y-4 max-w-2xl">
              <ul className="divide-y divide-slate-200 border border-slate-200 rounded-lg bg-white">
                <CheckRow ok={facts.adminTwoFactor} title="التحقق بخطوتين لحسابك" hint="من قائمة حسابك أعلى الشاشة ← «التحقق بخطوتين». يُنصح به لكل من يملك صلاحيات إدارية." />
                <CheckRow ok={facts.backups} title="النسخ الاحتياطي الدوري" hint="يُضبط على الخادم بالمتغير BACKUP_INTERVAL_HOURS، ويُستحسن ضبط وجهة خارجية. الحالة الكاملة في «قاعدة البيانات»." />
              </ul>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => { onClose(); navigateTo.emit('/settings'); }} className="min-h-11 px-4 rounded-lg border border-slate-300 bg-white text-sm font-bold text-slate-800 hover:bg-slate-50 inline-flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4" aria-hidden="true" />
                  فتح الإعدادات ← مراقبة النظام
                </button>
              </div>
              {!(facts.adminTwoFactor && facts.backups) && (
                <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  الخطوة لا تكتمل إلا بتفعيل التحقق بخطوتين لحسابك وضبط النسخ الدوري. يمكنك المتابعة الآن، وتبقى الخطوة «تُجووزت» حتى يتحقق الشرطان.
                </p>
              )}
              <StepActions
                busy={busy}
                onBack={() => go(-1)}
                primary={facts.adminTwoFactor && facts.backups ? 'متابعة' : 'المتابعة دون إكمالها'}
                onPrimary={() => void run(() => confirmStep('security'), facts.adminTwoFactor && facts.backups ? 'اكتملت خطوة الأمان والنسخ.' : 'تُجووزت خطوة الأمان والنسخ؛ أكملها لاحقاً من هنا.')}
              />
            </div>
          )}

          {stepId === 'finish' && (
            <div className="space-y-4 max-w-2xl">
              <p className="text-sm text-slate-700">المؤسسة <b>{settings.organizationName}</b> · القناة <b>{settings.primaryChannelName || 'غير محددة'}</b> · المنطقة الزمنية <bdi>{settings.defaultTimezone}</bdi></p>
              <ul className="divide-y divide-slate-200 border border-slate-200 rounded-lg bg-white">
                {SETUP_STEPS.filter((s) => s.id !== 'finish').map((s) => (
                  <CheckRow key={s.id} ok={progress[s.id]} skipped={skipped[s.id]} title={s.title} hint={s.hint} onOpen={() => setStepId(s.id)} />
                ))}
              </ul>
              {settings.setup?.completedAt ? (
                <p className="text-sm text-slate-700">أُكمل الإعداد {settings.setup.completedByName ? `بواسطة ${settings.setup.completedByName} ` : ''}في {new Date(settings.setup.completedAt).toLocaleDateString('ar')}. يمكنك العودة إلى أي خطوة متى شئت.</p>
              ) : (
                <p className="text-sm text-slate-700">يمكنك الإنهاء الآن وإكمال ما بقي لاحقاً؛ يبقى المعالج في «المساعدة».</p>
              )}
              <div className="flex flex-wrap gap-2">
                {!settings.setup?.completedAt && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => saveSetup((s) => ({ ...s, completedAt: new Date().toISOString(), completedByName: currentUser.fullName })),
                        'اكتمل الإعداد. أهلاً بفريقك في «مدار».',
                        false
                      )
                    }
                    className="min-h-11 px-5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold disabled:opacity-50"
                  >
                    إنهاء الإعداد
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    tourCommand.emit('admin');
                  }}
                  className="min-h-11 px-4 rounded-lg border border-slate-300 bg-white text-sm font-bold text-slate-800 hover:bg-slate-50"
                >
                  جولة إدارة النظام
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </FormPage>
  );
};

const StepActions: React.FC<{ busy: boolean; primary: string; onPrimary?: () => void; onBack?: () => void; onSkip?: () => void }> = ({ busy, primary, onPrimary, onBack, onSkip }) => (
  <div className="flex flex-wrap items-center gap-2 pt-4 border-t border-slate-200">
    <button type={onPrimary ? 'button' : 'submit'} onClick={onPrimary} disabled={busy} className="min-h-11 px-5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold disabled:opacity-50">
      {busy ? 'جارٍ الحفظ…' : primary}
    </button>
    {onBack && (
      <button type="button" onClick={onBack} className="min-h-11 px-4 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50">
        السابق
      </button>
    )}
    {onSkip && (
      <button type="button" onClick={onSkip} className="min-h-11 px-3 text-sm font-semibold text-slate-600 hover:text-slate-900 ms-auto">
        تخطي الآن
      </button>
    )}
  </div>
);

const CheckRow: React.FC<{ ok: boolean; skipped?: boolean; title: string; hint: string; onOpen?: () => void }> = ({ ok, skipped, title, hint, onOpen }) => (
  <li className="flex items-start gap-3 px-4 py-3">
    <span className={`mt-0.5 w-6 h-6 shrink-0 rounded-full flex items-center justify-center ${ok ? 'bg-emerald-600 text-white' : 'bg-amber-100 text-amber-800'}`}>
      {ok ? <Check className="w-3.5 h-3.5" aria-hidden="true" /> : <span className="text-xs font-bold" aria-hidden="true">!</span>}
    </span>
    <span className="flex-1 min-w-0">
      <span className="block text-sm font-bold text-slate-900">
        {title} <span className={`text-xs font-semibold ${ok ? 'text-emerald-700' : 'text-amber-800'}`}>{ok ? 'مكتملة' : skipped ? 'تُجووزت' : 'لم تكتمل'}</span>
      </span>
      <span className="block text-xs text-slate-600 mt-0.5">{hint}</span>
    </span>
    {onOpen && !ok && (
      <button type="button" onClick={onOpen} className="min-h-9 px-3 rounded-md border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50 shrink-0">
        فتح الخطوة
      </button>
    )}
  </li>
);

/** Whether the administrator still has setup steps to do (for the reminder on the home screen). */
export function useSetupReminder(currentUser: User) {
  const { facts } = useFacts(false, currentUser);
  const progress = setupProgress(facts);
  return { pending: !facts.setup?.completedAt, done: setupDoneCount(progress), total: SETUP_STEPS.length - 1 };
}
