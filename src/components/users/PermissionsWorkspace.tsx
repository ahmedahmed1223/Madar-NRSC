import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, LockKeyhole, Minus, RotateCcw, Save, Search, ShieldCheck, Users } from 'lucide-react';
import { confirmDialog } from '../../services/dialogs';
import { dataStore } from '../../services/dataStore';
import { apiFetch } from '../../services/http';
import { ALL_PERMISSIONS, departmentGrantAllowed, findUserRole, isRestrictionPermission, PERMISSION_CATEGORIES, permissionDepartments, resolvePermission, type RoleDefinition } from '../../shared/rbac';
import { departmentOptionLabel, findDepartmentId } from '../../shared/departments';
import { stationsOf } from '../../shared/stations';
import { apiService } from '../../services/api';
import type { PermissionTarget, PermissionWrite, PermissionsSnapshot } from '../../shared/permissionsWorkspace';
import type { User } from '../../types';

type EditorState = 'inherit' | 'grant' | 'deny';
type SnapshotResponse = { success: boolean; data: PermissionsSnapshot };
type PermissionDecision = ReturnType<typeof resolvePermission>;
type UserDelta = { user: User; permission: string; before: PermissionDecision; after: PermissionDecision };
type PermissionDelta = { code: string; before: EditorState; after: EditorState; users: UserDelta[] };

interface PermissionsWorkspaceProps {
  currentUser: User;
  canManage: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onAddNewRole: () => void;
  onEditRole: (role: RoleDefinition) => void;
  onDeleteRole: (roleId: string) => void;
  onResetDefaults: () => void;
}

const labels: Record<PermissionTarget, string> = { role: 'دور', department: 'قسم', user: 'مستخدم' };
const stateLabels: Record<EditorState, string> = { inherit: 'موروثة', grant: 'منح', deny: 'منع' };
const riskLabels = { LOW: 'منخفضة', MEDIUM: 'متوسطة', HIGH: 'مرتفعة', CRITICAL: 'حرجة' } as const;
const riskMeaning = {
  LOW: 'أثر محدود على الوصول',
  MEDIUM: 'يؤثر في سير العمل',
  HIGH: 'قدرة تشغيلية عالية التأثير',
  CRITICAL: 'قدرة حساسة؛ راجع الأثر بعناية',
} as const;
const permissionState = (permissions: string[], code: string): EditorState =>
  permissions.includes(`!${code}`) ? 'deny' : permissions.includes(code) ? 'grant' : 'inherit';

function permissionList(snapshot: PermissionsSnapshot, kind: PermissionTarget, id: string): string[] {
  if (kind === 'role') return snapshot.roles.find((item) => item.id === id)?.permissions ?? [];
  if (kind === 'department') return snapshot.departments.find((item) => item.id === id)?.permissionOverrides ?? [];
  return snapshot.users.find((item) => item.id === id)?.customPermissions ?? [];
}

function changedSnapshot(snapshot: PermissionsSnapshot, kind: PermissionTarget, id: string, code: string, state: EditorState): PermissionsSnapshot {
  const current = permissionList(snapshot, kind, id).filter((entry) => entry !== code && entry !== `!${code}`);
  if (state === 'grant') current.push(code);
  if (state === 'deny') current.push(`!${code}`);
  if (kind === 'role') return { ...snapshot, roles: snapshot.roles.map((item) => item.id === id ? { ...item, permissions: current } : item) };
  if (kind === 'department') return { ...snapshot, departments: snapshot.departments.map((item) => item.id === id ? { ...item, permissionOverrides: current } : item) };
  return { ...snapshot, users: snapshot.users.map((item) => item.id === id ? { ...item, customPermissions: current } : item) };
}

function sameList(a: string[], b: string[]) {
  return a.length === b.length && [...a].sort().every((value, index) => value === [...b].sort()[index]);
}

function userLabel(user: User, roles: RoleDefinition[]) {
  const role = findUserRole(user, roles);
  return `${user.fullName} · ${role?.nameAr || user.role}`;
}

function scopedUsers(snapshot: PermissionsSnapshot, kind: PermissionTarget, id: string) {
  return snapshot.users.filter((user) => {
    if (kind === 'user') return user.id === id;
    if (kind === 'role') return findUserRole(user, snapshot.roles)?.id === id;
    return permissionDepartments(user, snapshot.departments).chain.some((department) => department.id === id);
  });
}

function decisionChanged(before: PermissionDecision, after: PermissionDecision) {
  return before.allowed !== after.allowed || before.source !== after.source || before.label !== after.label;
}

function draftStateLabel(kind: PermissionTarget, state: EditorState) {
  if (kind === 'role') return state === 'grant' ? 'نعم، يمنح' : 'لا، لا يمنح';
  if (state === 'grant') return 'منح';
  if (state === 'deny') return 'منع';
  return 'موروثة';
}

function departmentSource(snapshot: PermissionsSnapshot, id: string, code: string) {
  const { chain, valid } = permissionDepartments({ departmentId: id }, snapshot.departments);
  if (!valid) return 'تعذر التحقق من تسلسل الأقسام؛ راجع بنية القسم قبل الاعتماد.';
  // Mirrors the resolver: any denial in the chain wins, even above a nearer grant.
  const denied = !isRestrictionPermission(code) && chain.find((department) => department.permissionOverrides?.includes(`!${code}`));
  if (denied) return denied.id === id ? 'منع محدد في هذا القسم' : `منع موروث من قسم ${denied.name} — يتقدم على أي منح أقرب`;
  const granted = departmentGrantAllowed(code) && chain.find((department) => department.permissionOverrides?.includes(code));
  if (!granted) return 'لا يوجد استثناء نافذ في هذا القسم أو أقسامه الأعلى؛ يُحسم بالدور.';
  return granted.id === id ? 'منح محدد في هذا القسم' : `منح موروث من قسم ${granted.name}`;
}

export const PermissionsWorkspace: React.FC<PermissionsWorkspaceProps> = ({
  currentUser, canManage, onDirtyChange, onAddNewRole, onEditRole, onDeleteRole, onResetDefaults,
}) => {
  const [snapshot, setSnapshot] = useState<PermissionsSnapshot | null>(null);
  const [draft, setDraft] = useState<PermissionsSnapshot | null>(null);
  const [kind, setKind] = useState<PermissionTarget>('role');
  const [targetId, setTargetId] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('ALL');
  const [selectedCode, setSelectedCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [savedMessage, setSavedMessage] = useState('');
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const onDirtyRef = useRef(onDirtyChange);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const loadingRef = useRef(false);
  const refreshingRef = useRef(false);
  const snapshotRequest = useRef(0);
  const refreshRequested = useRef(false);
  const loadSnapshotRef = useRef<(background?: boolean) => Promise<boolean>>(async () => false);
  onDirtyRef.current = onDirtyChange;

  const dirty = useMemo(() => {
    if (!snapshot || !draft || !targetId) return false;
    return !sameList(permissionList(snapshot, kind, targetId), permissionList(draft, kind, targetId));
  }, [snapshot, draft, kind, targetId]);

  useEffect(() => {
    dirtyRef.current = dirty;
    onDirtyRef.current?.(dirty);
  }, [dirty]);

  const loadSnapshot = async (background = false) => {
    if (!canManage || loadingRef.current || savingRef.current ||
        (background && (dirtyRef.current || refreshingRef.current))) return false;
    const request = background ? snapshotRequest.current : ++snapshotRequest.current;
    if (background) refreshingRef.current = true;
    else {
      loadingRef.current = true;
      setLoading(true);
      setError('');
      setConflict(false);
    }
    try {
      const response = await apiFetch<SnapshotResponse>('/api/v1/admin/permissions', { method: 'GET' });
      // A draft or newer operation owns the workspace once it starts.
      if (request !== snapshotRequest.current) return false;
      if (background && dirtyRef.current) {
        refreshRequested.current = true;
        return false;
      }
      if (!response?.success || !response.data) throw new Error('لم تُرجع الخدمة بيانات الصلاحيات.');
      if (background && response.data.version === snapshot?.version) return true;
      setSnapshot(response.data);
      setDraft(response.data);
      dirtyRef.current = false;
      return true;
    } catch (cause) {
      if (background) refreshRequested.current = true;
      else setError(cause instanceof Error ? cause.message : 'تعذر تحميل بيانات الصلاحيات.');
      return false;
    } finally {
      if (background) refreshingRef.current = false;
      else {
        loadingRef.current = false;
        setLoading(false);
      }
    }
  };
  loadSnapshotRef.current = loadSnapshot;

  useEffect(() => { void loadSnapshot(); }, [canManage]);
  useEffect(() => {
    if (!canManage) return;
    return dataStore.subscribe((event) => {
      if (event.type === 'data-changed') {
        if (!event.collections.some((collection) => ['roles', 'users', 'settings'].includes(collection))) return;
        refreshRequested.current = true;
        // Local changes are optimistic. Read the authoritative workspace only
        // after their sync acknowledgement, not before the write reaches it.
        if (!event.remote) return;
      } else if (event.type !== 'sync-status' || event.pending !== 0) return;
      if (refreshRequested.current && !dirtyRef.current && !savingRef.current && !loadingRef.current && !refreshingRef.current) {
        refreshRequested.current = false;
        void loadSnapshotRef.current(true);
      }
    });
  }, [canManage]);
  useEffect(() => () => { onDirtyRef.current?.(false); }, []);

  const reloadSnapshot = async () => {
    if (dirty && !(await confirmDialog({ title: 'إعادة تحميل الصلاحيات', message: 'سيؤدي التحميل إلى استبدال مسودتك الحالية بآخر نسخة من الخادم.', confirmLabel: 'استبدال المسودة', cancelLabel: 'الاحتفاظ بالمسودة', danger: true }))) return;
    if (savingRef.current || loadingRef.current) return;
    const loaded = await loadSnapshot();
    if (loaded) {
      dirtyRef.current = false;
      onDirtyRef.current?.(false);
      setReviewOpen(false);
      setSavedMessage('');
    }
  };

  const departmentLabels = useMemo(() => {
    const labels = new Map<string, string>();
    if (!draft) return labels;
    const stations = stationsOf(apiService.getSettings());
    for (const item of draft.departments) {
      const label = departmentOptionLabel(item, draft.departments, stations, draft.users);
      labels.set(item.id, item.archived ? `${label} (مؤرشف)` : label);
    }
    return labels;
  }, [draft]);
  const targetOptions = useMemo(() => {
    if (!draft) return [];
    if (kind === 'role') return draft.roles.map((item) => ({ id: item.id, label: item.nameAr }));
    if (kind === 'department') return Array.from(departmentLabels, ([id, label]) => ({ id, label }));
    return draft.users.map((item) => ({ id: item.id, label: userLabel(item, draft.roles) }));
  }, [draft, kind, departmentLabels]);
  const departmentLabelFor = (user: User) => {
    const departmentId = findDepartmentId(user, draft?.departments);
    return departmentLabels.get(departmentId || '') || 'غير محدد';
  };

  useEffect(() => {
    if (!targetOptions.some((option) => option.id === targetId)) {
      const first = targetOptions[0]?.id ?? '';
      if (first !== targetId) setTargetId(first);
    }
  }, [targetOptions, targetId]);

  const visiblePermissions = useMemo(() => ALL_PERMISSIONS.filter((item) => {
    const text = `${item.nameAr} ${item.nameEn} ${item.code} ${item.description}`.toLocaleLowerCase();
    return (!query.trim() || text.includes(query.trim().toLocaleLowerCase())) && (category === 'ALL' || item.category === category);
  }), [query, category]);

  const selectedPermission = visiblePermissions.find((item) => item.code === selectedCode) ?? visiblePermissions[0];
  useEffect(() => {
    if (selectedPermission && selectedCode !== selectedPermission.code) setSelectedCode(selectedPermission.code);
  }, [selectedPermission, selectedCode]);

  const selectedUser = draft?.users.find((item) => item.id === targetId);
  const selectedRole = draft?.roles.find((item) => item.id === targetId);
  const targetPermissions = draft ? permissionList(draft, kind, targetId) : [];
  const roleProtected = kind === 'role' && selectedRole?.roleCode === 'SUPER_ADMIN';
  const blockedDepartmentGrant = kind === 'department' && selectedPermission && !departmentGrantAllowed(selectedPermission.code);
  // Scope restrictions are enforced by every source; a denial would only widen access.
  const blockedRestrictionDeny = kind !== 'role' && !!selectedPermission && isRestrictionPermission(selectedPermission.code);
  const selectedUserDecision = selectedUser && selectedPermission && draft
    ? resolvePermission(selectedUser, selectedPermission.code, draft.roles, draft.departments)
    : null;
  const selectedDepartmentSource = kind === 'department' && draft && selectedPermission
    ? departmentSource(draft, targetId, selectedPermission.code)
    : '';
  const previewUsers = useMemo(() => {
    if (!snapshot || !draft || !targetId || !selectedPermission) return [];
    const beforeUser = scopedUsers(snapshot, kind, targetId);
    const after = changedSnapshot(snapshot, kind, targetId, selectedPermission.code, permissionState(permissionList(draft, kind, targetId), selectedPermission.code));
    return beforeUser.map((user) => {
      const before = resolvePermission(user, selectedPermission.code, snapshot.roles, snapshot.departments);
      const nextUser = after.users.find((candidate) => candidate.id === user.id) ?? user;
      const afterDecision = resolvePermission(nextUser, selectedPermission.code, after.roles, after.departments);
      return { user, before, after: afterDecision };
    }).filter((item) => decisionChanged(item.before, item.after)).sort((a, b) => Number(b.after.allowed) - Number(a.after.allowed) || a.user.fullName.localeCompare(b.user.fullName, 'ar'));
  }, [snapshot, draft, kind, targetId, selectedPermission]);

  const permissionDeltas = useMemo<PermissionDelta[]>(() => {
    if (!snapshot || !draft || !targetId) return [];
    return ALL_PERMISSIONS.flatMap((permission) => {
      const beforeState = permissionState(permissionList(snapshot, kind, targetId), permission.code);
      const afterState = permissionState(permissionList(draft, kind, targetId), permission.code);
      if (beforeState === afterState) return [];
      const afterSnapshot = changedSnapshot(snapshot, kind, targetId, permission.code, afterState);
      const affected = scopedUsers(snapshot, kind, targetId).flatMap((user) => {
        const before = resolvePermission(user, permission.code, snapshot.roles, snapshot.departments);
        const afterUser = afterSnapshot.users.find((candidate) => candidate.id === user.id) ?? user;
        const after = resolvePermission(afterUser, permission.code, afterSnapshot.roles, afterSnapshot.departments);
        return decisionChanged(before, after) ? [{ user, permission: permission.code, before, after }] : [];
      });
      return [{ code: permission.code, before: beforeState, after: afterState, users: affected }];
    });
  }, [snapshot, draft, kind, targetId]);

  const uniqueAffectedUsers = useMemo(() => {
    const affected = new Map<string, { user: User; changes: UserDelta[] }>();
    for (const delta of permissionDeltas) {
      for (const userDelta of delta.users) {
        const entry = affected.get(userDelta.user.id) ?? { user: userDelta.user, changes: [] };
        entry.changes.push(userDelta);
        affected.set(userDelta.user.id, entry);
      }
    }
    return [...affected.values()].sort((a, b) => a.user.fullName.localeCompare(b.user.fullName, 'ar'));
  }, [permissionDeltas]);
  const uniqueAffectedIds = new Set(uniqueAffectedUsers.map((entry) => entry.user.id));

  const changeState = (code: string, nextState: EditorState) => {
    if (!draft || !snapshot || !targetId || roleProtected || savingRef.current || loadingRef.current) return;
    if (kind === 'department' && nextState === 'grant' && !departmentGrantAllowed(code)) return;
    if (kind !== 'role' && code !== undefined && nextState === 'deny' && isRestrictionPermission(code)) return;
    const updated = changedSnapshot(draft, kind, targetId, code, nextState);
    setDraft(updated);
    setReviewOpen(false);
    setSavedMessage('');
    // Inform route-level guards before control returns to the browser event loop.
    const nextDirty = !sameList(permissionList(snapshot, kind, targetId), permissionList(updated, kind, targetId));
    if (nextDirty && refreshingRef.current) {
      snapshotRequest.current += 1;
      refreshRequested.current = true;
    }
    dirtyRef.current = nextDirty;
    onDirtyRef.current?.(nextDirty);
  };

  const handleKindChange = async (nextKind: PermissionTarget) => {
    if (savingRef.current || loadingRef.current) return;
    if (dirty && !(await confirmDialog({ title: 'تغييرات غير محفوظة', message: 'سيؤدي تغيير نوع التحديد إلى ترك المسودة الحالية. هل تريد المتابعة؟', confirmLabel: 'ترك التغييرات', cancelLabel: 'البقاء هنا', danger: true }))) return;
    if (dirty && snapshot) setDraft(snapshot);
    setKind(nextKind);
    setTargetId(snapshot ? getFirstTarget(snapshot, nextKind) : '');
    dirtyRef.current = false;
    onDirtyRef.current?.(false);
    setReviewOpen(false);
  };

  const handleTargetChange = async (nextId: string) => {
    if (savingRef.current || loadingRef.current) return;
    if (nextId === targetId) return;
    if (dirty && !(await confirmDialog({ title: 'تغييرات غير محفوظة', message: 'سيؤدي اختيار هدف آخر إلى إلغاء مسودة الهدف الحالي. هل تريد المتابعة؟', confirmLabel: 'إلغاء المسودة', cancelLabel: 'البقاء هنا', danger: true }))) return;
    if (dirty && snapshot) setDraft(snapshot);
    setTargetId(nextId);
    dirtyRef.current = false;
    onDirtyRef.current?.(false);
    setReviewOpen(false);
  };

  const discard = async () => {
    if (savingRef.current || loadingRef.current) return;
    if (dirty && !(await confirmDialog({ title: 'إلغاء التعديلات', message: 'ستُلغى كل تغييرات الصلاحيات غير المحفوظة.', confirmLabel: 'إلغاء التغييرات', cancelLabel: 'متابعة التحرير', danger: true }))) return;
    if (snapshot) setDraft(snapshot);
    dirtyRef.current = false;
    onDirtyRef.current?.(false);
    setError('');
    setConflict(false);
    setReviewOpen(false);
    if (conflict || refreshRequested.current) {
      refreshRequested.current = false;
      await loadSnapshot();
    }
  };

  const runMetadataAction = async (action: () => void | Promise<void>) => {
    if (savingRef.current || loadingRef.current) return;
    if (dirty) {
      const accepted = await confirmDialog({ title: 'تغييرات غير محفوظة', message: 'يجب ترك مسودة الصلاحيات قبل تنفيذ إدارة الدور. هل تريد إلغاء المسودة والمتابعة؟', confirmLabel: 'إلغاء المسودة والمتابعة', cancelLabel: 'العودة للتحرير', danger: true });
      if (!accepted) return;
      if (snapshot) setDraft(snapshot);
      dirtyRef.current = false;
      onDirtyRef.current?.(false);
      setReviewOpen(false);
      setSavedMessage('');
    }
    await action();
  };

  const confirmDeleteRole = async () => {
    if (!selectedRole) return;
    await runMetadataAction(async () => {
      const accepted = await confirmDialog({
        title: 'حذف الدور',
        message: `حذف الدور «${selectedRole.nameAr}»؟ سيمنع الخادم الحذف إذا كان الدور مستخدماً.`,
        confirmLabel: 'حذف الدور',
        cancelLabel: 'تراجع',
        danger: true,
      });
      if (accepted) onDeleteRole(selectedRole.id);
    });
  };

  const save = async () => {
    if (!snapshot || !draft || !dirty || savingRef.current || loadingRef.current) return;
    snapshotRequest.current += 1;
    savingRef.current = true;
    setSaving(true);
    setReviewOpen(false);
    setError('');
    try {
      const write: PermissionWrite = { version: snapshot.version, kind, id: targetId, permissions: permissionList(draft, kind, targetId) };
      const response = await apiFetch<SnapshotResponse>('/api/v1/admin/permissions', { method: 'PUT', json: write });
      if (!response?.success || !response.data) throw new Error('لم تُرجع الخدمة نسخة الصلاحيات المحدّثة.');
      setSnapshot(response.data);
      setDraft(response.data);
      setConflict(false);
      dirtyRef.current = false;
      onDirtyRef.current?.(false);
      setSavedMessage('تم حفظ الصلاحيات بنجاح.');
    } catch (cause: any) {
      setError(cause?.message || 'تعذر حفظ الصلاحيات. بقيت المسودة كما هي.');
      setConflict(cause?.status === 409 || cause?.code === 'VERSION_CONFLICT' || cause?.code === 'CONFLICT');
      setReviewOpen(true);
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  };

  if (!canManage) {
    return <section dir="rtl" className="rounded-xl border border-slate-300 bg-slate-100 p-5 text-right">
      <div className="flex items-start gap-3"><LockKeyhole className="mt-0.5 h-5 w-5 shrink-0 text-slate-600" /><div><h2 className="text-sm font-bold text-slate-900">إدارة الصلاحيات غير متاحة</h2><p className="mt-1 text-xs leading-6 text-slate-600">يتطلب عرض هذه المساحة صلاحية إدارة الأدوار والصلاحيات. لم يتم طلب بيانات الصلاحيات.</p></div></div>
    </section>;
  }

  const editorState = selectedPermission ? permissionState(targetPermissions, selectedPermission.code) : 'inherit';
  const grouped = PERMISSION_CATEGORIES.map((group) => ({ group, items: visiblePermissions.filter((permission) => permission.category === group.key) })).filter((item) => item.items.length);

  return (
    <section dir="rtl" className="space-y-4 text-right">
      <header className="flex flex-col gap-3 rounded-xl border border-slate-300 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-800"><ShieldCheck className="h-5 w-5" /></span>
          <div><h2 className="text-sm font-bold text-slate-900">مساحة الصلاحيات</h2><p className="mt-1 text-xs leading-5 text-slate-600">عدّل مصدر الإذن، ثم راجع الأثر الفعلي قبل الحفظ.</p></div>
        </div>
        {currentUser.role === 'SUPER_ADMIN' && <span className="self-start rounded-md border border-slate-300 bg-slate-100 px-2.5 py-1 text-2xs font-semibold text-slate-700">قراءة وحفظ بصلاحية مدير النظام</span>}
      </header>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="نوع الهدف">
          {(['role', 'department', 'user'] as PermissionTarget[]).map((target) => <button key={target} type="button" onClick={() => void handleKindChange(target)} disabled={saving || loading} aria-pressed={kind === target} className={`min-h-11 rounded-lg border px-4 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${kind === target ? 'border-blue-700 bg-blue-50 text-blue-800' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}>{labels[target]}</button>)}
        <div className="relative min-w-[13rem] flex-1 sm:flex-none">
          <label className="sr-only" htmlFor="permission-target">اختر {labels[kind]}</label>
          <select id="permission-target" value={targetId} onChange={(event) => void handleTargetChange(event.target.value)} disabled={!targetOptions.length || loading || saving} className="min-h-11 w-full appearance-none rounded-lg border border-slate-300 bg-white py-2 pe-3 ps-9 text-xs font-semibold text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
            {targetOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select><ChevronDown className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-500" aria-hidden="true" />
        </div>
        {kind === 'role' && <div className="flex flex-wrap gap-1.5 sm:ms-auto">
          <button type="button" disabled={saving || loading} onClick={() => void runMetadataAction(onAddNewRole)} className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">إضافة دور</button>
          {selectedRole && <button type="button" disabled={saving || loading} onClick={() => void runMetadataAction(() => onEditRole(selectedRole))} className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">تعديل بيانات الدور</button>}
          {selectedRole && !selectedRole.isSystemRole && <button type="button" disabled={saving || loading} onClick={() => void confirmDeleteRole()} className="min-h-11 rounded-lg border border-rose-200 bg-white px-3 text-xs font-semibold text-rose-800 hover:bg-rose-50 disabled:opacity-50">حذف الدور</button>}
          <button type="button" disabled={saving || loading} onClick={() => void runMetadataAction(onResetDefaults)} className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">استعادة الافتراضي</button>
        </div>}
      </div>

      {error && <div role="alert" className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-xs text-rose-900">
        <div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><div className="min-w-0 flex-1"><p className="font-bold">{conflict ? 'تعارض في نسخة الصلاحيات' : 'تعذر إتمام العملية'}</p><p className="mt-1 leading-5">{error}{dirty ? ' بقيت تغييراتك المحلية محفوظة.' : ''}</p></div><button type="button" disabled={saving || loading} onClick={() => void reloadSnapshot()} className="min-h-10 rounded-md border border-rose-300 bg-white px-3 font-semibold disabled:opacity-50">إعادة التحميل</button></div>
      </div>}
      {savedMessage && <p role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-900">{savedMessage}</p>}

      {loading && !snapshot ? <div className="space-y-3 rounded-xl border border-slate-300 bg-white p-4" aria-label="جار تحميل الصلاحيات"><div className="h-4 w-1/3 animate-pulse rounded bg-slate-200" /><div className="h-10 animate-pulse rounded bg-slate-100" /><div className="h-24 animate-pulse rounded bg-slate-100" /></div> : !snapshot ? <div className="rounded-xl border border-slate-300 bg-white p-5 text-xs text-slate-600">تعذر تحميل مساحة الصلاحيات. استخدم إعادة التحميل للمحاولة مجدداً.</div> : (
        <>
          {dirty && reviewOpen && <section aria-label="مراجعة التغييرات قبل الحفظ" className="rounded-xl border border-slate-400 bg-slate-100 p-4">
            <div className="flex flex-col gap-2 border-b border-slate-300 pb-3 sm:flex-row sm:items-center sm:justify-between">
              <div><h3 className="text-sm font-bold text-slate-900">مراجعة كاملة قبل الحفظ</h3><p className="mt-1 text-xs text-slate-700">تغييرات مباشرة: <strong className="font-mono tabular-nums">{permissionDeltas.length}</strong> · حسابات تأثر قرارها الفعلي أو مصدره: <strong className="font-mono tabular-nums">{uniqueAffectedIds.size}</strong></p></div>
              <span className="text-2xs font-semibold text-slate-700">لن يُرسل أي تعديل قبل التأكيد.</span>
            </div>
            <section className="mt-3">
              <h4 className="text-xs font-bold text-slate-800">كل الصلاحيات التي تغيّرت</h4>
              <ul className="mt-2 divide-y divide-slate-300 rounded-lg border border-slate-300 bg-white">
                {permissionDeltas.map((delta) => {
                  const permission = ALL_PERMISSIONS.find((item) => item.code === delta.code)!;
                  return <li key={delta.code} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                    <div className="min-w-0"><p className="text-xs font-semibold text-slate-900">{permission.nameAr}</p><code dir="ltr" className="text-2xs text-slate-500">{delta.code}</code></div>
                    <span className="text-2xs font-semibold text-slate-700"><span>{draftStateLabel(kind, delta.before)}</span><span className="mx-2 text-slate-400">←</span><span className="text-blue-800">{draftStateLabel(kind, delta.after)}</span><span className="ms-2 text-slate-500">· {delta.users.length} متأثر</span></span>
                  </li>;
                })}
              </ul>
            </section>
            <section className="mt-4">
              <h4 className="text-xs font-bold text-slate-800">كل الحسابات المتأثرة ومصادر القرار قبل/بعد</h4>
              {uniqueAffectedUsers.length ? <ul className="mt-2 max-h-[40vh] divide-y divide-slate-200 overflow-y-auto rounded-lg border border-slate-300 bg-white">
                {uniqueAffectedUsers.map(({ user, changes }) => <li key={user.id} className="p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"><p className="text-xs font-bold text-slate-900">{user.fullName}</p><p className="text-2xs text-slate-600">{userLabel(user, draft.roles)} · {departmentLabelFor(user)} · <bdi dir="ltr">{user.staffId || user.id}</bdi></p></div>
                  <ul className="mt-2 space-y-2">
                    {changes.map((change) => {
                      const permission = ALL_PERMISSIONS.find((item) => item.code === change.permission);
                      return <li key={change.permission} className="rounded-md bg-slate-50 p-2">
                        <p className="text-2xs font-semibold text-slate-800">{permission?.nameAr || change.permission} <code dir="ltr" className="ms-1 font-normal text-slate-500">{change.permission}</code></p>
                        <p className="mt-1 break-words text-2xs leading-5 text-slate-700">قبل: {change.before.allowed ? 'مسموح' : 'غير مسموح'} · {change.before.label}</p>
                        <p className="break-words text-2xs leading-5 text-slate-700">بعد: {change.after.allowed ? 'مسموح' : 'غير مسموح'} · {change.after.label}</p>
                      </li>;
                    })}
                  </ul>
                </li>)}
              </ul> : <p className="mt-2 rounded-lg border border-slate-300 bg-white p-3 text-xs leading-5 text-slate-700">لا تتغير نتيجة السماح أو مصدر القرار لأي مستخدم ضمن هذا النطاق، رغم وجود تغيير مباشر في الإعداد.</p>}
            </section>
          </section>}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(19rem,.8fr)]">
            <div className="min-w-0 rounded-xl border border-slate-300 bg-white">
              <div className="flex flex-col gap-2 border-b border-slate-200 p-3 sm:flex-row">
                <div className="relative min-w-0 flex-1"><Search className="absolute right-3 top-3 h-4 w-4 text-slate-500" /><input type="search" aria-label="بحث في الصلاحيات" value={query} onChange={(event) => setQuery(event.target.value)} disabled={saving || loading} placeholder="ابحث بالاسم أو الرمز..." className="min-h-11 w-full rounded-lg border border-slate-300 bg-slate-50 pe-9 ps-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-50" /></div>
                <select aria-label="تصفية حسب المجال" value={category} onChange={(event) => setCategory(event.target.value)} disabled={saving || loading} className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold disabled:opacity-50"><option value="ALL">كل المجالات</option>{PERMISSION_CATEGORIES.map((item) => <option key={item.key} value={item.key}>{item.labelAr}</option>)}</select>
              </div>
              <div className="max-h-[40vh] overflow-y-auto sm:max-h-[68vh]">
                {grouped.map(({ group, items }) => <section key={group.key} aria-label={group.labelAr}>
                  <h3 className="sticky top-0 z-10 border-y border-slate-200 bg-slate-100 px-3 py-2 text-2xs font-bold text-slate-700">{group.labelAr}<span className="ms-2 font-mono tabular-nums text-slate-500">{items.length}</span></h3>
                  <ul className="divide-y divide-slate-100">
                    {items.map((permission) => {
                      const state = permissionState(targetPermissions, permission.code);
                      const decision = kind === 'user' && selectedUser ? resolvePermission(selectedUser, permission.code, draft.roles, draft.departments) : null;
                      const blockedGrant = !!decision && (state === 'grant' && !decision.allowed);
                      return <li key={permission.code}>
                        <button type="button" disabled={saving || loading} onClick={() => { if (!savingRef.current && !loadingRef.current) setSelectedCode(permission.code); }} aria-pressed={selectedCode === permission.code} className={`flex min-h-[4.2rem] w-full items-center gap-3 px-3 py-2 text-start transition-colors disabled:cursor-wait ${selectedCode === permission.code ? 'bg-blue-50/80' : 'bg-white hover:bg-slate-50'}`}>
                          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md border ${state === 'grant' ? 'border-blue-700 bg-blue-600 text-white' : state === 'deny' ? 'border-rose-300 bg-rose-50 text-rose-800' : 'border-slate-300 bg-white text-transparent'}`}>{state === 'deny' ? <Minus className="h-4 w-4" aria-hidden="true" /> : <Check className="h-4 w-4" />}</span>
                          <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-x-2 gap-y-0.5"><span className="text-xs font-bold text-slate-900">{permission.nameAr}</span><code dir="ltr" className="text-2xs text-slate-500">{permission.code}</code></span><span className="mt-1 block whitespace-normal break-words text-2xs text-slate-600">{decision?.label || (kind === 'role' ? state === 'grant' ? 'ممنوحة لهذا الدور' : 'لا يمنحها هذا الدور' : kind === 'department' ? departmentSource(draft, targetId, permission.code) : state === 'inherit' ? 'موروثة: يُحسم الإذن من الدور وتسلسل الأقسام' : state === 'grant' ? 'استثناء مباشر: منح' : 'استثناء مباشر: منع')}</span></span>
                          {blockedGrant && <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700" aria-label="المنح غير نافذ" />}
                        </button>
                      </li>;
                    })}
                  </ul>
                </section>)}
                {!visiblePermissions.length && <p className="p-8 text-center text-xs text-slate-500">لا توجد صلاحيات مطابقة للبحث.</p>}
              </div>
            </div>

            <aside className="space-y-3">
              <section className="rounded-xl border border-slate-300 bg-white p-4">
                <div className="flex items-start justify-between gap-3"><div><h3 className="text-xs font-bold text-slate-900">{selectedPermission?.nameAr || 'اختر صلاحية'}</h3><p className="mt-1 text-2xs text-slate-500" dir="ltr">{selectedPermission?.code}</p></div>{selectedPermission && <span className="shrink-0 rounded-md bg-slate-100 px-2 py-1 text-2xs font-semibold text-slate-600">{kind === 'role' ? 'قرار الدور' : 'استثناء'}</span>}</div>
                {selectedPermission && <div className="mt-3 space-y-3">
                  <p className="text-xs leading-5 text-slate-700">{selectedPermission.description}</p>
                  <div className="flex flex-wrap items-center gap-2"><span className="text-2xs font-semibold text-slate-600">مستوى الحساسية</span><span className={`rounded-md px-2 py-1 text-2xs font-bold ${selectedPermission.riskLevel === 'CRITICAL' || selectedPermission.riskLevel === 'HIGH' ? 'border border-amber-300 bg-amber-50 text-amber-900' : 'border border-slate-300 bg-slate-100 text-slate-700'}`}>{riskLabels[selectedPermission.riskLevel]}</span><span className="text-2xs text-slate-600">{riskMeaning[selectedPermission.riskLevel]}</span></div>
                  {kind === 'role' ? <fieldset disabled={roleProtected || saving} className="space-y-2"><legend className="mb-2 text-2xs font-semibold text-slate-600">هل يمنح هذا الدور الصلاحية؟</legend><div className="grid grid-cols-2 gap-2">{(['grant', 'inherit'] as EditorState[]).map((state) => <button key={state} type="button" aria-pressed={editorState === state} onClick={() => changeState(selectedPermission.code, state)} className={`min-h-11 rounded-lg border px-3 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-50 ${editorState === state ? 'border-blue-700 bg-blue-50 text-blue-800' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}>{state === 'grant' ? 'نعم، يمنح' : 'لا، لا يمنح'}</button>)}</div></fieldset> : <fieldset disabled={saving} className="space-y-2"><legend className="mb-2 text-2xs font-semibold text-slate-600">{kind === 'user' ? 'تجاوز المستخدم' : 'تجاوز القسم'}</legend><div className="grid grid-cols-3 gap-1.5">{(['inherit', 'grant', 'deny'] as EditorState[]).filter((state) => !(blockedDepartmentGrant && state === 'grant') && !(blockedRestrictionDeny && state === 'deny')).map((state) => <button key={state} type="button" aria-pressed={editorState === state} onClick={() => changeState(selectedPermission.code, state)} className={`min-h-11 rounded-lg border px-2 text-2xs font-bold disabled:cursor-not-allowed disabled:opacity-50 ${editorState === state ? state === 'deny' ? 'border-rose-300 bg-rose-50 text-rose-800' : 'border-blue-700 bg-blue-50 text-blue-800' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}>{stateLabels[state]}</button>)}</div></fieldset>}
                  {roleProtected && <p className="rounded-lg border border-slate-300 bg-slate-100 p-2.5 text-2xs leading-5 text-slate-700">دور مدير النظام العام محمي ويملك الصلاحيات كاملة؛ لا يمكن تعديل اختياراته هنا.</p>}
                  {blockedDepartmentGrant && <p className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-2xs leading-5 text-amber-900">لا يُعرض خيار المنح لهذه الصلاحية على مستوى القسم. يمكن توريثها أو منعها صراحةً فقط.</p>}
                  {blockedRestrictionDeny && <p className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-2xs leading-5 text-amber-900">«{selectedPermission?.nameAr}» قيد يضيّق نطاق العمل ولا يمنح صلاحية؛ لذلك لا يُعرض خيار المنع. يكفي منحه من القسم أو المستخدم ليصبح ساريًا.</p>}
                  {kind === 'department' && <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><p className="text-2xs font-bold text-slate-700">مصدر إعداد القسم</p><p className="mt-1 break-words text-2xs leading-5 text-slate-700">{selectedDepartmentSource}</p></div>}
                  {kind === 'user' && selectedUser && selectedUserDecision && <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><p className="text-2xs font-bold text-slate-700">النتيجة الفعلية ومصدرها الآن</p><p className="mt-1 break-words text-xs font-semibold text-slate-900">{selectedUserDecision.allowed ? 'مسموح' : 'غير مسموح'} <span className="font-normal text-slate-600">· {selectedUserDecision.label}</span></p>{editorState === 'grant' && !selectedUserDecision.allowed && <p className="mt-2 flex items-start gap-1.5 text-2xs leading-5 text-amber-900"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />المنح المسجل لا يغيّر النتيجة الفعلية بسبب مصدر أعلى أولوية أو حالة الحساب. راجع المصدر قبل الحفظ.</p>}</div>}
                </div>}
              </section>

              <section className="rounded-xl border border-slate-300 bg-white">
                <header className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3"><div className="flex items-center gap-2"><Users className="h-4 w-4 text-slate-600" /><div><h3 className="text-xs font-bold text-slate-900">معاينة الصلاحية المحددة فقط</h3><p className="text-2xs text-slate-500">تأثير «{selectedPermission?.nameAr || '—'}»</p></div></div><span className="rounded-md bg-slate-100 px-2 py-1 font-mono text-2xs tabular-nums text-slate-700">{previewUsers.length}</span></header>
                {previewUsers.length ? <ul className="max-h-[40vh] divide-y divide-slate-100 overflow-y-auto">
                  {previewUsers.map(({ user, before, after }) => <li key={user.id} className="px-4 py-3">
                    <p className="break-words text-xs font-semibold text-slate-900">{user.fullName}</p>
                    <p className="mt-0.5 break-words text-2xs text-slate-600">{userLabel(user, draft.roles)} · {departmentLabelFor(user)} · <bdi dir="ltr">{user.staffId || user.id}</bdi></p>
                    <p className="mt-2 break-words text-2xs leading-5 text-slate-700">قبل: {before.allowed ? 'مسموح' : 'غير مسموح'} · {before.label}</p>
                    <p className="break-words text-2xs leading-5 text-slate-700">بعد: {after.allowed ? 'مسموح' : 'غير مسموح'} · {after.label}</p>
                  </li>)}
                </ul> : <p className="p-4 text-2xs leading-5 text-slate-600">لا يتغير السماح أو مصدر القرار لهذه الصلاحية وحدها ضمن الهدف المحدد. راجع ملخص المسودة الكامل عند وجود تغييرات أخرى.</p>}
                <p className="border-t border-slate-200 px-4 py-2 text-2xs leading-5 text-slate-500">هذه معاينة للصلاحية المحددة وحدها؛ مراجعة الحفظ تعرض جميع التغييرات والحسابات المتأثرة دون إخفاء.</p>
              </section>
            </aside>
          </div>
          <footer className="sticky bottom-2 z-20 flex flex-col gap-2 rounded-xl border border-slate-700 bg-slate-900 p-3 text-white shadow-lg sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2 text-xs"><span className={`h-2 w-2 rounded-full ${dirty ? 'bg-amber-400' : 'bg-emerald-400'}`} /><span>{dirty ? 'تغييرات غير محفوظة' : 'كل التغييرات محفوظة'}</span>{dirty && <span className="text-2xs text-slate-300">تغيير مباشر: {permissionDeltas.length} · مستخدمون متأثرون: {uniqueAffectedIds.size}</span>}</div>
            <div className="flex flex-wrap gap-2">
              {reviewOpen && dirty && <button type="button" disabled={saving} onClick={() => setReviewOpen(false)} className="min-h-11 rounded-lg border border-slate-500 px-3 text-xs font-semibold text-slate-100 hover:bg-slate-800 disabled:opacity-45">عودة للتحرير</button>}
              <button type="button" disabled={!dirty || saving} onClick={() => void discard()} className="min-h-11 rounded-lg border border-slate-500 px-3 text-xs font-semibold text-slate-100 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-45"><RotateCcw className="me-1 inline h-3.5 w-3.5" />إلغاء</button>
              <button type="button" disabled={!dirty || saving || !permissionDeltas.length} onClick={() => reviewOpen ? void save() : setReviewOpen(true)} className="min-h-11 rounded-lg bg-blue-600 px-4 text-xs font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-45">{saving ? 'جار الحفظ…' : reviewOpen ? <><Save className="me-1 inline h-4 w-4" />تأكيد الحفظ</> : <><Save className="me-1 inline h-4 w-4" />مراجعة ثم حفظ</>}</button>
            </div>
          </footer>
        </>
      )}
    </section>
  );
};

function getFirstTarget(snapshot: PermissionsSnapshot, kind: PermissionTarget) {
  if (kind === 'role') return snapshot.roles[0]?.id ?? '';
  if (kind === 'department') return snapshot.departments[0]?.id ?? '';
  return snapshot.users[0]?.id ?? '';
}
