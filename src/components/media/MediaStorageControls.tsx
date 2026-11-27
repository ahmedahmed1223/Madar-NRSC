import { useEffect, useMemo, useState } from 'react';
import { PRIMARY_STORAGE_NAMES, TARGET_NAMES, type CloudProviderId, type CopyTarget, type StorageLocations, type StorageStatus } from '../../shared/storage';
import type { MediaAsset } from '../../types';
import { storageClient } from '../../services/storageClient';

type SourceFilter = CopyTarget | 'all' | 'local' | 'link';
export type UploadDestination = CloudProviderId | 'default' | 'local';

export function mediaUploadId(asset: Pick<MediaAsset, 'fileUrl' | 'url'>): string | undefined {
  const value = asset.fileUrl || asset.url;
  if (!value) return;
  try {
    const { origin, pathname } = new URL(value, window.location.origin);
    if (origin === window.location.origin) return /^\/api\/v1\/media\/files\/([A-Za-z0-9_-]+)$/.exec(pathname)?.[1];
  } catch {
    return;
  }
}

export function useMediaStorageFilter(assets: MediaAsset[]) {
  const [source, setSource] = useState<SourceFilter>('all');
  const [inventory, setInventory] = useState<{ records: Record<string, StorageLocations>; forIds: string[] }>();
  const [error, setError] = useState('');
  const [request, setRequest] = useState(0);
  const ids = useMemo(() => [...new Set(assets.map(mediaUploadId).filter((id): id is string => !!id))], [assets]);
  const needsInventory = source !== 'all' && source !== 'link';
  const ready = inventory?.forIds === ids;
  useEffect(() => {
    setError('');
    if (!needsInventory) return;
    const controller = new AbortController();
    const fetchInventory = async () => {
      const records: Record<string, StorageLocations> = {};
      for (let start = 0; start < ids.length; start += 250) {
        Object.assign(records, await storageClient.inventory(ids.slice(start, start + 250), controller.signal));
      }
      if (!controller.signal.aborted) setInventory({ records, forIds: ids });
    };
    void fetchInventory().catch(err => {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'تعذّر فحص مصادر التخزين');
    });
    return () => controller.abort();
  }, [ids, needsInventory, request]);

  const accepts = (asset: MediaAsset) => {
    if (source === 'all') return true;
    const id = mediaUploadId(asset);
    if (source === 'link') return !id && /^https?:\/\//i.test(asset.fileUrl || asset.url || '');
    if (!id || !ready) return false;
    const location = inventory?.records[id];
    return source === 'local' ? !!location?.local : !!location?.copies.some(copy => copy.state === 'DONE' && copy.target === source);
  };
  return { source, setSource, accepts, loading: needsInventory && !ready && !error, error, retry: () => setRequest(n => n + 1) };
}

export function MediaSourceFilter({ value, onChange }: { value: SourceFilter; onChange: (value: SourceFilter) => void }) {
  return (
    <label className="inline-flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-700">
      مصدر التخزين
      <select value={value} onChange={e => onChange(e.target.value as SourceFilter)}
        className="min-h-11 max-w-full rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-900">
        <option value="all">كل المصادر</option>
        <option value="local">خادم مدار</option>
        <option value="dropbox">Dropbox</option>
        <option value="gdrive">Google Drive</option>
        <option value="share">{TARGET_NAMES.share}</option>
        <option value="link">رابط خارجي</option>
      </select>
    </label>
  );
}

export function MediaUploadDestination({ value, onChange, status, disabled, share, onShare }: {
  value: UploadDestination;
  onChange: (value: UploadDestination) => void;
  status: StorageStatus | null;
  disabled: boolean;
  share: boolean;
  onShare: (next: boolean) => void;
}) {
  const clouds = (['dropbox', 'gdrive'] as const).filter(id => status?.[id].enabled && status[id].connected);
  const shared = status?.share.enabled && status.share.mode !== 'none' && status.isLocal;
  if (status?.primaryMedia && status.primaryMedia !== 'local') return (
    <p className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-slate-800">مكان الحفظ الدائم · <strong>{PRIMARY_STORAGE_NAMES[status.primaryMedia]}</strong></p>
  );
  if (!clouds.length && !shared) return null;
  return (
    <fieldset disabled={disabled} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 px-3 py-2">
      <legend className="px-1 text-sm font-bold text-slate-800">وجهة حفظ الملف المرفوع</legend>
      {clouds.length > 0 && (
        <select aria-label="وجهة حفظ الملف" className="min-h-11 max-w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
          value={value} onChange={event => onChange(event.target.value as UploadDestination)}>
          <option value="default">حسب إعدادات المكتبة</option>
          <option value="local">خادم مدار فقط</option>
          {clouds.map(id => <option key={id} value={id}>{TARGET_NAMES[id]}</option>)}
        </select>
      )}
      {shared && value !== 'local' && <label className="inline-flex min-h-11 items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={share} onChange={event => onShare(event.target.checked)} /> نسخة في {TARGET_NAMES.share}
      </label>}
      <p className="w-full text-xs leading-relaxed text-slate-600">يمكن التحقق من النسخ الفعلية من «أماكن حفظ الملف» في معاينة المادة.</p>
    </fieldset>
  );
}
