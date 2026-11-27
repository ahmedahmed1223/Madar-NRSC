import { useEffect, useState } from 'react';
import { ChevronLeft, Folder, FolderPlus, ListChecks, Move } from 'lucide-react';
import { useLiveData } from '../../hooks/useLiveData';
import { apiService } from '../../services/api';
import { confirmSaved } from '../../services/confirmSave';
import { dataStore } from '../../services/dataStore';
import { promptDialog } from '../../services/dialogs';
import { notify } from '../../services/notify';
import { RbacService } from '../../services/rbacService';
import { COLLECTIONS } from '../../shared/collections';
import { newId } from '../../shared/ids';
import { mediaFolderNameError, type MediaFolder } from '../../shared/mediaFolders';
import { matchesQuery } from '../../shared/search';
import type { MediaAsset, User } from '../../types';
import { Modal } from '../common/Modal';

const button = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50';

export function useMediaFolders(user: User, media: MediaAsset[], canUpload: boolean, query: string) {
  useLiveData(['mediaFolders']);
  const records = dataStore.get<MediaFolder[]>(COLLECTIONS.mediaFolders.storageKey, []);
  const folders = records.filter(folder => !folder.deletedAt).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  const byId = new Map(folders.map(folder => [folder.id, folder]));
  const [folderId, setFolderId] = useState<string | null>(null);
  const [searchEverywhere, setSearchEverywhere] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moving, setMoving] = useState(false);
  const ownStations = new Map(apiService.getUsers().map(person => [person.id, person.stationId]));
  const isManager = RbacService.hasPermission(user, 'media.delete');
  const mayMove = (asset: MediaAsset) => canUpload && !asset.privateMessageMedia &&
    (isManager || asset.ownerId === user.id || asset.uploadedById === user.id);
  const folder = folderId ? byId.get(folderId) : undefined;
  const path = (id: string | null | undefined) => {
    const chain: MediaFolder[] = [];
    const visited = new Set<string>();
    for (let current = id && byId.get(id); current && !visited.has(current.id); current = current.parentId && byId.get(current.parentId)) {
      chain.unshift(current);
      visited.add(current.id);
    }
    return chain;
  };
  const open = (id: string | null) => {
    setFolderId(id);
    setSearchEverywhere(false);
    setSelected(new Set());
  };
  useEffect(() => {
    if (folderId && !folder && records.length) {
      setFolderId(null);
      setSelected(new Set());
    }
  }, [folderId, folder, records.length]);

  const create = async () => {
    const name = (await promptDialog({ title: 'مجلد وسائط جديد', label: 'اسم المجلد', required: true }))?.trim();
    if (!name) return;
    const error = mediaFolderNameError(name);
    if (error) {
      notify({ type: 'error', message: error });
      return;
    }
    const id = newId('media-folder');
    const record: MediaFolder = { id, name, ownerId: user.id, parentId: folder?.id ?? null, stationId: folder?.stationId ?? user.stationId ?? null };
    dataStore.set(COLLECTIONS.mediaFolders.storageKey, [...dataStore.get<MediaFolder[]>(COLLECTIONS.mediaFolders.storageKey, []), record]);
    await confirmSaved('mediaFolders', id, 'أُنشئ المجلد');
  };
  const pickable = media.filter(asset => selected.has(asset.id) && mayMove(asset));
  const targets = folders.filter(target => pickable.every(asset => {
    const ownerStation = ownStations.get(asset.ownerId || asset.uploadedById || '');
    return !target.stationId || !ownerStation || target.stationId === ownerStation;
  }));
  const toggle = (id: string) => setSelected(previous => {
    const result = new Set(previous);
    if (result.has(id)) result.delete(id);
    else result.add(id);
    return result;
  });
  const toggleSelectionMode = () => {
    setSelecting(!selecting);
    setSelected(new Set());
  };

  const move = async (targetId: string | null) => {
    if (moving || !pickable.length) return false;
    setMoving(true);
    try {
      const results = await Promise.all(pickable.map(async asset => {
        if (dataStore.hasPendingWrite('media', asset.id)) return { id: asset.id, ok: false };
        try {
          apiService.updateMedia(asset.id, { folderId: targetId });
          const reply = await dataStore.awaitWrite('media', asset.id);
          return { id: asset.id, ok: reply.ok };
        } catch {
          return { id: asset.id, ok: false };
        }
      }));
      setSelected(new Set(results.filter(result => !result.ok).map(result => result.id)));
      const count = results.filter(result => result.ok).length;
      if (count === results.length) {
        notify({ type: 'success', message: 'نُقلت الملفات المحددة' });
        return true;
      }
      notify({ type: 'warning', message: `تأكد نقل ${count} من ${results.length}. راجع الملفات الباقية قبل إعادة المحاولة.` });
      return false;
    } finally {
      setMoving(false);
    }
  };

  const recursive = searchEverywhere && !!query.trim();
  const visible = folders.filter(row => (recursive || (row.parentId || null) === (folder?.id ?? null)) &&
    (!query.trim() || matchesQuery(query, row.name)));
  return {
    folder, path, visible, targets, open, create, canUpload, searchEverywhere, setSearchEverywhere,
    selecting, toggleSelectionMode, selected, toggle, mayMove, moving, move, selectionCount: pickable.length,
    accepts: (asset: MediaAsset) => recursive || ((asset.folderId && byId.has(asset.folderId) ? asset.folderId : null) === (folder?.id ?? null)),
  };
}

export function MediaFolderBar({ model, clearSearch }: { model: ReturnType<typeof useMediaFolders>; clearSearch: () => void }) {
  const [dialog, setDialog] = useState(false);
  const [destination, setDestination] = useState('');
  const breadcrumbs = model.path(model.folder?.id);
  const open = (id: string | null) => { model.open(id); clearSearch(); };
  return (
    <section aria-label="مجلدات الوسائط" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav aria-label="مسار المجلد" className="flex min-w-0 flex-wrap items-center gap-1 text-sm">
          <button type="button" onClick={() => open(null)} aria-current={!breadcrumbs.length ? 'page' : undefined} className="min-h-11 rounded-lg px-2 font-bold text-blue-800 hover:bg-blue-50">المكتبة</button>
          {breadcrumbs.map((folder, index) => (
            <span key={folder.id} className="inline-flex min-w-0 items-center gap-1">
              <ChevronLeft className="size-4 shrink-0 text-slate-500" aria-hidden="true" />
              <button type="button" onClick={() => open(folder.id)} aria-current={index === breadcrumbs.length - 1 ? 'page' : undefined}
                className="min-h-11 min-w-0 rounded-lg px-2 text-start font-semibold text-slate-800 [overflow-wrap:anywhere] hover:bg-slate-100">{folder.name}</button>
            </span>
          ))}
        </nav>
        {model.canUpload && <div className="flex flex-wrap gap-2">
          <button type="button" className={button} onClick={() => void model.create()}><FolderPlus className="size-4" aria-hidden="true" />مجلد جديد</button>
          <button type="button" aria-pressed={model.selecting} className={button} onClick={model.toggleSelectionMode}><ListChecks className="size-4" aria-hidden="true" />{model.selecting ? 'إنهاء التحديد' : 'تحديد الملفات'}</button>
        </div>}
      </div>
      {!!model.visible.length && <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" aria-label="المجلدات">
        {model.visible.map(folder => <li key={folder.id}>
          <button type="button" onClick={() => open(folder.id)} className={button + ' w-full justify-start text-start'}>
            <Folder className="size-4 shrink-0 text-amber-700" aria-hidden="true" />
            <span className="min-w-0 [overflow-wrap:anywhere]">{folder.name}</span>
          </button>
        </li>)}
      </ul>}
      {model.selecting && <div className="flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
        <span role="status" className="text-sm font-semibold text-slate-800">{model.selectionCount} محدد</span>
        <button type="button" className={button} disabled={!model.selectionCount} onClick={() => { setDestination(''); setDialog(true); }}><Move className="size-4" aria-hidden="true" />نقل المحدد</button>
      </div>}
      <Modal isOpen={dialog} onClose={() => { if (!model.moving) setDialog(false); }} title="نقل ملفات الوسائط">
        <label className="block space-y-1 text-sm font-semibold text-slate-800">
          المجلد الوجهة
          <select value={destination} onChange={event => setDestination(event.target.value)} disabled={model.moving} className="block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3">
            <option value="">جذر المكتبة</option>
            {model.targets.map(folder => <option key={folder.id} value={folder.id}>{model.path(folder.id).map(row => row.name).join(' / ')}</option>)}
          </select>
        </label>
        <button type="button" disabled={model.moving || !model.selectionCount} className={button + ' mt-3'}
          onClick={async () => { if (await model.move(destination || null)) setDialog(false); }}>{model.moving ? 'جارٍ النقل…' : 'تأكيد النقل'}</button>
      </Modal>
    </section>
  );
}
