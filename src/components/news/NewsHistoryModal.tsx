import { appLocale, zoneOptions } from '../../shared/dateFormat';
import React, { useEffect, useMemo, useState } from 'react';
import { History, Loader2, RotateCcw, AlertCircle, GitCompare } from 'lucide-react';
import { Modal } from '../common/Modal';
import { apiService, NewsRevision } from '../../services/api';
import { sanitizeHtml } from '../../utils/sanitizeHtml';
import type { NewsItem } from '../../types';
import { NEWS_STATUS_LABELS, plainText } from '../../shared/newsWorkflow';
import { diffStats, wordDiff, type DiffRun } from '../../shared/textDiff';
import { countLabel } from '../../shared/arabicPlural';

interface NewsHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  newsId: string;
  /** Loads the chosen version into the editor; it is only saved when the user saves. */
  onRestore: (data: NewsItem) => void;
  canRestore: boolean;
  /** The text as it is now (in the editor), listed first and used for the comparison. */
  current?: Pick<NewsItem, 'title' | 'summary' | 'content' | 'status' | 'updatedAt'> & { updatedByName?: string };
}

const WORDS = { one: 'كلمة واحدة', two: 'كلمتان', few: 'كلمات', many: 'كلمة' };

export interface HistoryEntry {
  key: string;
  label: string;
  version: number | null;
  data: Pick<NewsItem, 'title' | 'summary' | 'content' | 'status'> & Partial<NewsItem>;
  changedAt?: string;
  changedByName?: string | null;
  /** Same text as the next newer entry: only the status or metadata changed. */
  textUnchanged: boolean;
}

const textOf = (d: Partial<NewsItem>) => `${d.title || ''}\n${d.summary || ''}\n${plainText(d.content)}`;

/**
 * The current text first, then the server-kept earlier versions (newest first). A version whose
 * text equals the newer one is marked (a status change), so the list reads as what really changed.
 */
export function historyEntries(revisions: NewsRevision[], current?: NewsHistoryModalProps['current']): HistoryEntry[] {
  const list: HistoryEntry[] = [];
  if (current) list.push({ key: 'current', label: 'النسخة الحالية', version: null, data: current, changedAt: current.updatedAt, changedByName: current.updatedByName, textUnchanged: false });
  revisions.forEach((rev) => {
    const newer = list[list.length - 1]?.data;
    list.push({
      key: `v${rev.version}`,
      label: `النسخة ${rev.version}`,
      version: rev.version,
      data: rev.data,
      changedAt: rev.changedAt,
      changedByName: rev.changedByName,
      textUnchanged: !!newer && textOf(newer) === textOf(rev.data),
    });
  });
  return list;
}

const DiffText: React.FC<{ runs: DiffRun[] }> = ({ runs }) => (
  <p dir="rtl" className="text-sm leading-loose text-slate-800 whitespace-pre-wrap [unicode-bidi:plaintext]">
    {runs.map((r, i) =>
      r.kind === 'same' ? (
        <span key={i}>{r.text} </span>
      ) : r.kind === 'add' ? (
        <ins key={i} className="no-underline bg-emerald-100 text-emerald-900 rounded px-0.5" title="أُضيف في النسخة الحالية">
          {r.text}{' '}
        </ins>
      ) : (
        <del key={i} className="bg-rose-100 text-rose-800 rounded px-0.5" title="حُذف من النسخة الحالية">
          {r.text}{' '}
        </del>
      )
    )}
  </p>
);

/** Server-kept previous versions of a story, newest first, with a comparison to the current text. */
export const NewsHistoryModal: React.FC<NewsHistoryModalProps> = ({ isOpen, onClose, newsId, onRestore, canRestore, current }) => {
  const [revisions, setRevisions] = useState<NewsRevision[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [compare, setCompare] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setError(null);
    setSelectedKey(null);
    apiService
      .getNewsHistory(newsId)
      .then((list) => setRevisions(Array.isArray(list) ? list : []))
      .catch((err) => setError(err?.message || 'تعذر تحميل سجل النسخ من الخادم'))
      .finally(() => setLoading(false));
  }, [isOpen, newsId]);

  const entries = useMemo(() => historyEntries(revisions, current), [revisions, current]);
  // Open on the latest earlier version whose text differs, so the comparison shows something.
  const fallback = entries.find((e) => e.version !== null && !e.textUnchanged) || entries.find((e) => e.version !== null) || entries[0];
  const selected = entries.find((e) => e.key === selectedKey) || fallback;
  const isCurrent = selected?.version === null;
  const diff = useMemo(() => {
    if (!selected || isCurrent || !current) return null;
    return {
      title: wordDiff(selected.data.title || '', current.title || ''),
      summary: wordDiff(selected.data.summary || '', current.summary || ''),
      body: wordDiff(plainText(selected.data.content), plainText(current.content)),
    };
  }, [selected, isCurrent, current]);
  const stats = diff ? [diff.title, diff.summary, diff.body].map(diffStats).reduce((a, b) => ({ added: a.added + b.added, removed: a.removed + b.removed })) : null;
  const earlier = entries.filter((e) => e.version !== null).length;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="سجل نسخ الخبر" maxWidth="4xl">
      <div className="text-right" dir="rtl">
        {loading && (
          <div className="py-16 flex justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
          </div>
        )}
        {error && (
          <div role="alert" className="flex items-center gap-2 p-3 mb-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 font-semibold">
            <AlertCircle className="w-4 h-4" />
            {error}
          </div>
        )}
        {!loading && entries.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 min-h-[400px]">
            <div className="md:col-span-1 space-y-2">
              {!error && earlier === 0 && (
                <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-xl p-2.5">لم يُعدَّل هذا الخبر بعد حفظه الأول؛ تظهر هنا كل نسخة سابقة بعد أول تعديل أو تغيير حالة.</p>
              )}
              <ul className="space-y-1.5 max-h-[60vh] overflow-y-auto" aria-label="نسخ الخبر">
                {entries.map((entry) => (
                  <li key={entry.key}>
                    <button
                      type="button"
                      aria-pressed={selected?.key === entry.key}
                      onClick={() => setSelectedKey(entry.key)}
                      className={`w-full text-right p-2.5 rounded-xl border text-xs transition-colors ${
                        selected?.key === entry.key ? 'bg-blue-50 border-blue-300' : 'bg-white border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 font-bold text-slate-800">
                        <History className="w-3.5 h-3.5 text-slate-500" />
                        {entry.label}
                        <span className="text-2xs font-semibold text-slate-500">({NEWS_STATUS_LABELS[entry.data.status] || entry.data.status})</span>
                      </div>
                      {entry.changedAt && (
                        <div className="text-2xs text-slate-500 mt-1">
                          {new Date(entry.changedAt).toLocaleString(appLocale(), zoneOptions())}
                          {entry.version !== null ? ` — عدّلها بعد ذلك: ${entry.changedByName || 'النظام'}` : ''}
                        </div>
                      )}
                      {entry.textUnchanged && <div className="text-2xs text-slate-500 mt-0.5">النص كما في النسخة الأحدث (تغيّرت الحالة أو البيانات)</div>}
                      <div className="text-2xs text-slate-700 mt-1 truncate">{entry.data.title}</div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            {selected && (
              <div className="md:col-span-2 border border-slate-200 rounded-xl p-4 space-y-3 max-h-[60vh] overflow-y-auto">
                {!isCurrent && current && (
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
                    <div role="group" aria-label="طريقة العرض" className="inline-flex rounded-lg border border-slate-300 overflow-hidden text-xs font-bold">
                      <button type="button" aria-pressed={compare} onClick={() => setCompare(true)} className={`min-h-9 px-3 inline-flex items-center gap-1 ${compare ? 'bg-slate-900 text-white' : 'bg-white text-slate-700'}`}>
                        <GitCompare className="w-3.5 h-3.5" /> الفرق عن النسخة الحالية
                      </button>
                      <button type="button" aria-pressed={!compare} onClick={() => setCompare(false)} className={`min-h-9 px-3 ${!compare ? 'bg-slate-900 text-white' : 'bg-white text-slate-700'}`}>
                        نص هذه النسخة
                      </button>
                    </div>
                    {stats && (
                      <span className="text-2xs text-slate-600">
                        {stats.added || stats.removed ? (
                          <>
                            <span className="text-emerald-700 font-bold">+{countLabel(stats.added, WORDS)}</span> ·{' '}
                            <span className="text-rose-700 font-bold">−{countLabel(stats.removed, WORDS)}</span>
                          </>
                        ) : (
                          'لا فرق في النص'
                        )}
                      </span>
                    )}
                  </div>
                )}
                {diff && compare ? (
                  <div className="space-y-3">
                    <p className="text-2xs text-slate-500">
                      <ins className="no-underline bg-emerald-100 text-emerald-900 rounded px-1">أُضيف</ins> و
                      <del className="bg-rose-100 text-rose-800 rounded px-1">حُذف</del> منذ هذه النسخة.
                    </p>
                    <div>
                      <h4 className="text-2xs font-bold text-slate-500">العنوان</h4>
                      <DiffText runs={diff.title} />
                    </div>
                    {(selected.data.summary || current?.summary) && (
                      <div>
                        <h4 className="text-2xs font-bold text-slate-500">المقدمة</h4>
                        <DiffText runs={diff.summary} />
                      </div>
                    )}
                    <div>
                      <h4 className="text-2xs font-bold text-slate-500">النص</h4>
                      <DiffText runs={diff.body} />
                    </div>
                  </div>
                ) : (
                  <>
                    <h3 className="text-base font-bold text-slate-900">{selected.data.title}</h3>
                    {selected.data.summary && <p className="text-xs text-slate-600 leading-relaxed">{selected.data.summary}</p>}
                    <div className="rich-content text-sm text-slate-800" dangerouslySetInnerHTML={{ __html: sanitizeHtml(selected.data.content || '') }} />
                  </>
                )}
                {canRestore && !isCurrent && (
                  <button
                    type="button"
                    onClick={() => {
                      onRestore(selected.data as NewsItem);
                      onClose();
                    }}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    تحميل هذه النسخة في المحرر (لا تُحفظ حتى تضغط حفظ)
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
};
