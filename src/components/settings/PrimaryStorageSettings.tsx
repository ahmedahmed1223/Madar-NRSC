import { HardDrive } from 'lucide-react';
import { PRIMARY_STORAGE_NAMES, type PrimaryStorageTarget, type ResolvedStorageSettings, type StorageStatus } from '../../shared/storage';

const fields = [
  { id: 'primaryMedia', name: 'التخزين الأساسي للوسائط' },
  { id: 'primaryBackups', name: 'التخزين الأساسي للنسخ الاحتياطية' },
] as const;
type PrimaryField = typeof fields[number]['id'];
export type BackupPrimaryReadiness = Record<Exclude<PrimaryStorageTarget, 'local'>, boolean>;
const targets = Object.keys(PRIMARY_STORAGE_NAMES) as PrimaryStorageTarget[];

function available(field: PrimaryField, target: PrimaryStorageTarget, status: StorageStatus | null, backups: BackupPrimaryReadiness | null) {
  if (target === 'local') return true;
  if (field === 'primaryBackups') return !!backups?.[target];
  if (target === 'nas') return status?.share.mode === 'direct';
  return !!status?.[target].connected;
}

export function PrimaryStorageSettings({ settings, status, backups, disabled, onChange }: {
  settings: ResolvedStorageSettings;
  status: StorageStatus | null;
  backups: BackupPrimaryReadiness | null;
  disabled: boolean;
  onChange: (field: PrimaryField, target: PrimaryStorageTarget) => void;
}) {
  const remote = settings.primaryMedia !== 'local' || settings.primaryBackups !== 'local';
  return (
    <fieldset disabled={disabled} className="space-y-3 rounded-xl border border-slate-300 bg-white p-3 sm:p-4">
      <legend className="flex items-center gap-2 px-2 text-sm font-bold text-slate-900"><HardDrive className="size-4 text-blue-700" aria-hidden="true" />وجهات التخزين الأساسية</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map(field => (
          <label key={field.id} className="min-w-0 space-y-1 text-sm font-semibold text-slate-800">
            <span>{field.name}</span>
            <select value={settings[field.id]} onChange={event => onChange(field.id, event.target.value as PrimaryStorageTarget)}
              className="block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900">
              {targets.map(target => <option key={target} value={target} disabled={!available(field.id, target, status, backups) && settings[field.id] !== target}>
                {PRIMARY_STORAGE_NAMES[target]}{available(field.id, target, status, backups) ? '' : ' · يلزم التهيئة'}
              </option>)}
            </select>
          </label>
        ))}
      </div>
      {remote && <p className="text-sm leading-relaxed text-slate-700">تحتفظ الوجهة البعيدة المختارة وحدها بالملفات الدائمة لهذا النوع. يحتاج اكتمال الحفظ إلى اتصال بالوجهة وتُستخدم مساحة مرحلية مؤقتة أثناء النقل.</p>}
      <p className="text-xs leading-relaxed text-slate-600">للوسائط، اربط خدمة التخزين أدناه أو صِل NAS بخادم مدار. تحتاج النسخ الاحتياطية السحابية إلى وجهة rclone مهيأة على الخادم.</p>
    </fieldset>
  );
}
