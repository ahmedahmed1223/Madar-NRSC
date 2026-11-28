import { useEffect, useState } from 'react';
import { ArchiveRestore, RefreshCw, Trash2 } from 'lucide-react';
import { TrashLink } from '../components/layout/SectionTrashLink';
import { formatDay } from '../shared/dateFormat';
import { isTrashCollection, isTrashScreen, TRASH_SCREEN_LABELS, TRASH_SECTIONS, type TrashItem, type TrashPage, type TrashScreen } from '../shared/trash';
import { dataStore } from '../services/dataStore';
import { RbacService } from '../services/rbacService';
import { listTrash, restoreTrashItem } from '../services/trashClient';
import type { User } from '../types';

const messageOf = (error: unknown, fallback: string) => error instanceof Error && error.name !== 'TypeError' ? error.message : fallback;

export function TrashView({ focusId, user, onOpen }: { focusId?: string | null; user: User; onOpen: (path: string) => void }) {
  const available = new Set(RbacService.availableTrashCollections(user).map(key => TRASH_SECTIONS[key].screen));
  const section = isTrashScreen(focusId) ? focusId : isTrashCollection(focusId) ? TRASH_SECTIONS[focusId].screen : null;
  if (section && available.has(section)) return <SectionTrashView key={section} section={section} onOpen={onOpen} />;
  return (
    <section aria-labelledby="trash-title" className="mx-auto w-full max-w-6xl space-y-5">
      <h1 id="trash-title" className="text-2xl font-bold text-slate-900">سلة المحذوفات</h1>
      {focusId && <p role="alert" className="text-sm text-slate-700">سلة هذا القسم غير متاحة لحسابك.</p>}
      <ul aria-label="سلال المحذوفات حسب القسم" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {[...available].map(screen => (
          <li key={screen}>
            <TrashLink path={'/trash/' + screen} onOpen={onOpen} className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-600">
              <Trash2 className="size-4 shrink-0" aria-hidden="true" /> محذوفات {TRASH_SCREEN_LABELS[screen]}
            </TrashLink>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SectionTrashView({ section, onOpen }: { section: TrashScreen; onOpen: (path: string) => void }) {
  const [cursor, setCursor] = useState<string | null>(null);
  const [request, setRequest] = useState(0);
  const [page, setPage] = useState<TrashPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [restoring, setRestoring] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setListError('');
    void listTrash(section, cursor, controller.signal).then(result => {
      if (!controller.signal.aborted) setPage(previous => ({
        ...result,
        items: cursor ? [...(previous?.items ?? []), ...result.items] : result.items,
      }));
    }).catch(error => {
      if (!controller.signal.aborted) setListError(messageOf(error, 'تعذّر تحميل السلة. تحقق من الاتصال ثم أعد المحاولة.'));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [section, cursor, request]);

  const refresh = () => {
    setCursor(null);
    setPage(previous => previous && { ...previous, items: [], nextCursor: null });
    setFeedback(null);
    setRequest(previous => previous + 1);
  };

  const restore = async (item: TrashItem) => {
    if (restoring) return;
    setRestoring(`${item.collection}:${item.id}`);
    setFeedback(null);
    try {
      await restoreTrashItem(item);
      void dataStore.pull();
      setPage(previous => previous && {
        ...previous,
        items: previous.items.filter(row => row.collection !== item.collection || row.id !== item.id),
      });
      setFeedback({ ok: true, message: `أُعيد «${item.title}» إلى قسمه.` });
    } catch (error) {
      setFeedback({ ok: false, message: messageOf(error, 'تعذّرت استعادة السجل. تحقق من الاتصال ثم أعد المحاولة.') });
    } finally {
      setRestoring(null);
    }
  };

  return (
    <section aria-labelledby="trash-title" className="mx-auto w-full max-w-6xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 id="trash-title" className="text-2xl font-bold text-slate-900">محذوفات {TRASH_SCREEN_LABELS[section]}</h1>
          <TrashLink path={'/' + section} onOpen={onOpen} className="mt-2 inline-flex min-h-11 items-center rounded-lg px-2 text-sm font-semibold text-blue-800 hover:bg-blue-50 focus-visible:ring-2 focus-visible:ring-blue-600">
            العودة إلى {TRASH_SCREEN_LABELS[section]}
          </TrashLink>
        </div>
        <button type="button" disabled={loading || !!restoring} onClick={() => refresh()} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60">
          <RefreshCw className="size-4" aria-hidden="true" /> تحديث السلة
        </button>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white" aria-busy={loading}>
        {feedback && <p role={feedback.ok ? 'status' : 'alert'} className={`mx-4 mt-3 rounded-lg px-3 py-2 text-sm ${feedback.ok ? 'bg-emerald-50 text-emerald-900' : 'bg-rose-50 text-rose-800'}`}>{feedback.message}</p>}
        {listError && <p role="alert" className="m-4 text-sm text-rose-800">{listError}</p>}
        {loading && <p role="status" className="px-4 py-5 text-sm text-slate-600">جارٍ تحميل السجلات المحذوفة…</p>}
        {!loading && !listError && page?.items.length === 0 && <p className="px-4 py-8 text-sm font-semibold text-slate-700">لا توجد سجلات في هذا القسم من السلة.</p>}

        {!!page?.items.length && (
          <ul aria-label="السجلات المحذوفة" className="divide-y divide-slate-200">
            {page.items.map(item => {
              const key = `${item.collection}:${item.id}`;
              return (
                <li key={key} className="grid min-w-0 gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:px-5">
                  <div className="min-w-0">
                    <h2 className="break-words text-sm font-bold text-slate-900">{item.title}</h2>
                    {page.collections.length > 1 && <p className="mt-1 text-xs text-slate-600">{TRASH_SECTIONS[item.collection].label}</p>}
                  </div>
                  <div className="text-xs text-slate-600">
                    <p>نُقل إلى السلة في <time dateTime={item.deletedAt}>{formatDay(new Date(item.deletedAt))}</time></p>
                    {item.retentionDays > 0
                      ? <p className="mt-1">مؤهل للحذف في {formatDay(new Date(Date.parse(item.deletedAt) + item.retentionDays * 86_400_000))}</p>
                      : <p className="mt-1">احتفاظ دون مدة محددة</p>}
                  </div>
                  <button type="button" disabled={loading || !!restoring} onClick={() => void restore(item)} aria-label={`استعادة ${item.title}`}
                    className="inline-flex min-h-11 items-center justify-center gap-2 justify-self-start rounded-lg border border-slate-300 px-3 text-sm font-semibold text-blue-800 hover:bg-blue-50 disabled:opacity-60">
                    <ArchiveRestore className="size-4" aria-hidden="true" /> {restoring === key ? 'جارٍ الاستعادة…' : 'استعادة'}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {page?.nextCursor && <div className="border-t border-slate-200 px-4 py-3">
          <button type="button" disabled={loading || !!restoring} onClick={() => setCursor(page.nextCursor)} className="min-h-11 rounded-lg px-3 text-sm font-bold text-blue-800 hover:bg-blue-50 disabled:opacity-60">عرض سجلات أقدم</button>
        </div>}
      </div>
    </section>
  );
}
