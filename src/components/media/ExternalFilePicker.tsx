import { useEffect, useRef, useState } from 'react';
import { ChevronRight, Cloud, FileText, Folder, FolderTree, Loader2, Search } from 'lucide-react';
import { storageClient, type ExternalFile, type ExternalSource, type ImportedFile } from '../../services/storageClient';
import type { StorageStatus } from '../../shared/storage';
import { appLocale, zoneOptions } from '../../shared/dateFormat';

const SOURCE_NAMES: Record<ExternalSource, string> = { dropbox: 'Dropbox', gdrive: 'Google Drive', share: 'المجلد المشترك' };

export function availableSources(status: StorageStatus | null): ExternalSource[] {
  if (!status) return [];
  const out: ExternalSource[] = [];
  if (status.dropbox.enabled && status.dropbox.connected) out.push('dropbox');
  if (status.gdrive.enabled && status.gdrive.connected) out.push('gdrive');
  if (status.share.enabled && status.share.mode !== 'none' && status.share.indexedFiles > 0) out.push('share');
  return out;
}

function size(bytes: number) {
  if (!bytes) return '';
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} غ.ب`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} م.ب`;
  return `${Math.max(1, Math.round(bytes / 1024))} ك.ب`;
}

/**
 * Finds a file already in Dropbox, Google Drive or the station's shared folder and makes it part
 * of the library without copying it to the server (it is read from where it is when opened).
 */
export function ExternalFilePicker({ sources, onPicked }: { sources: ExternalSource[]; onPicked: (file: ImportedFile, source: ExternalSource) => void }) {
  const [source, setSource] = useState<ExternalSource>(sources[0]);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<ExternalFile[] | null>(null);
  const [folder, setFolder] = useState<{ at: string; trail: { at: string; name: string }[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState('');
  const seq = useRef(0);

  const browse = async (at = '', name?: string) => {
    if (source === 'share') return;
    const mine = ++seq.current;
    setLoading(true);
    setError('');
    try {
      const result = await storageClient.list(source, at);
      if (mine !== seq.current) return;
      setItems(result.items);
      setFolder((prev) => {
        if (!at) return { at: result.at, trail: [] };
        const trail = prev?.trail || [];
        const existing = trail.findIndex((t) => t.at === at);
        return { at: result.at, trail: existing >= 0 ? trail.slice(0, existing + 1) : [...trail, { at, name: name || at }] };
      });
    } catch (err) {
      if (mine === seq.current) setError(err instanceof Error ? err.message : 'تعذر فتح المجلد');
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  };

  // A new source starts at its station folder (the shared folder is searched, not browsed).
  useEffect(() => {
    setItems(null);
    setFolder(null);
    setQuery('');
    setError('');
    if (source !== 'share') void browse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (q.length < 2) return setError('اكتب حرفين على الأقل');
    const mine = ++seq.current;
    setLoading(true);
    setError('');
    setFolder(null);
    try {
      const found = await storageClient.search(source, q);
      if (mine === seq.current) setItems(found);
    } catch (err) {
      if (mine === seq.current) setError(err instanceof Error ? err.message : 'تعذر البحث');
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  };

  const add = async (file: ExternalFile) => {
    if (adding) return;
    setAdding(file.ref);
    setError('');
    try {
      onPicked(await storageClient.importFile(source, file.ref), source);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذرت إضافة الملف');
    } finally {
      setAdding('');
    }
  };

  return (
    <section aria-label="إضافة ملف من التخزين" className="space-y-3">
      {sources.length > 1 && (
        <div role="tablist" aria-label="مكان الملف" className="flex flex-wrap gap-1.5">
          {sources.map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={s === source}
              onClick={() => setSource(s)}
              className={`min-h-10 px-3 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 ${s === source ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
            >
              {s === 'share' ? <FolderTree className="w-4 h-4" aria-hidden="true" /> : <Cloud className="w-4 h-4" aria-hidden="true" />}
              {SOURCE_NAMES[s]}
            </button>
          ))}
        </div>
      )}
      <form onSubmit={search} className="flex gap-2" role="search">
        <label className="relative flex-1">
          <span className="sr-only">ابحث في {SOURCE_NAMES[source]}</span>
          <Search className="w-4 h-4 text-slate-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`ابحث في ${SOURCE_NAMES[source]} باسم الملف…`}
            className="w-full min-h-11 pr-9 pl-3 border border-slate-300 rounded-lg bg-white text-sm"
          />
        </label>
        <button type="submit" className="min-h-11 px-4 rounded-lg bg-slate-900 text-white text-sm font-bold" disabled={loading}>بحث</button>
      </form>
      {folder && (
        <nav aria-label="المجلد الحالي" className="flex flex-wrap items-center gap-1 text-xs text-slate-600">
          <button type="button" className="min-h-9 px-2 rounded hover:bg-slate-100 font-semibold" onClick={() => browse()}>المجلد الرئيسي</button>
          {folder.trail.map((t) => (
            <span key={t.at} className="inline-flex items-center gap-1">
              <ChevronRight className="w-3 h-3 rotate-180" aria-hidden="true" />
              <button type="button" className="min-h-9 px-2 rounded hover:bg-slate-100" onClick={() => browse(t.at, t.name)} dir="auto">{t.name}</button>
            </span>
          ))}
        </nav>
      )}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="max-h-80 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100" aria-busy={loading}>
        {loading && (
          <p className="p-4 text-sm text-slate-500 inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> جارٍ التحميل…</p>
        )}
        {!loading && items?.length === 0 && <p className="p-4 text-sm text-slate-500">{folder ? 'المجلد فارغ.' : 'لا ملفات مطابقة.'}</p>}
        {!loading && items === null && source === 'share' && <p className="p-4 text-sm text-slate-500">ابحث باسم الملف أو جزء من مساره في المجلد المشترك.</p>}
        {!loading &&
          items?.map((f) =>
            f.isFolder ? (
              <button key={f.ref} type="button" onClick={() => browse(f.ref, f.name)} className="w-full min-h-11 px-3 py-2 flex items-center gap-2 text-sm text-right hover:bg-slate-50">
                <Folder className="w-4 h-4 text-amber-600 shrink-0" aria-hidden="true" />
                <span className="font-semibold text-slate-800 truncate" dir="auto">{f.name}</span>
              </button>
            ) : (
              <div key={f.ref} className="px-3 py-2 flex items-center gap-3 text-sm">
                <FileText className="w-4 h-4 text-slate-500 shrink-0" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-800 truncate" dir="auto">{f.name}</p>
                  <p className="text-2xs text-slate-500 truncate" dir="auto">
                    {[f.path !== f.name ? f.path : '', size(f.size), f.modifiedAt ? new Date(f.modifiedAt).toLocaleDateString(appLocale(), zoneOptions()) : ''].filter(Boolean).join(' · ')}
                  </p>
                </div>
                {f.supported ? (
                  <button type="button" onClick={() => add(f)} disabled={!!adding} className="shrink-0 min-h-10 px-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold disabled:opacity-50">
                    {adding === f.ref ? 'جارٍ الإضافة…' : 'إضافة'}
                  </button>
                ) : (
                  <span className="shrink-0 text-2xs text-slate-500">نوع غير مدعوم</span>
                )}
              </div>
            )
          )}
      </div>
    </section>
  );
}
