import React, { useState } from 'react';
import { matchesQuery } from '../../shared/search';
import type { PronunciationNote } from '../../shared/pronunciation';

export function PronunciationPanel({ notes, preparedAt, floating = false }: { notes: PronunciationNote[]; preparedAt?: string; floating?: boolean }) {
  const [query, setQuery] = useState('');
  return <details aria-label="مراجع النطق" className={`pronunciation-panel text-sm text-slate-800 bg-white border border-slate-300 rounded p-2 ${floating ? 'absolute top-16 end-3 z-[60] w-72 max-w-[calc(100%-1.5rem)] shadow-lg' : 'my-3'}`}>
    <summary className="cursor-pointer min-h-11 flex items-center font-semibold">مراجع النطق ({notes.length})</summary>
    <div className="max-h-64 overflow-auto space-y-2" style={{ maxHeight: '16rem', overflow: 'auto' }}>
      {preparedAt && <p className="text-xs text-slate-500">نسخة مرجعية وقت تجهيز الحلقة: {new Date(preparedAt).toLocaleString('ar')}</p>}
      <input aria-label="البحث في مراجع النطق" type="search" value={query} onChange={e => setQuery(e.target.value)} className="w-full min-h-11 border border-slate-300 rounded px-2 bg-white" />
      {!notes.length && <p>لا توجد أسماء مطابقة في النص الحالي.</p>}
      <ul className="divide-y divide-slate-200">{notes.filter(n => matchesQuery(query, n.term, n.pronunciation, n.note)).map(n => <li key={n.term} className="py-2 break-words"><strong>{n.term}</strong><p>{n.pronunciation}</p>{n.note && <p className="text-xs text-slate-600">{n.note}</p>}</li>)}</ul>
    </div>
  </details>;
}
