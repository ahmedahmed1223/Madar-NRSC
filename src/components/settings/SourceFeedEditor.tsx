import React, { useState } from 'react';
import { Rss, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import type { NewsSource } from '../../types';
import { apiService } from '../../services/api';

interface SourceFeedEditorProps {
  source: NewsSource;
  onSave: (source: Partial<NewsSource>) => void;
  onClose: () => void;
}

/** Attaches an RSS/Atom feed to a news source; the server polls it into the wire desk. */
export const SourceFeedEditor: React.FC<SourceFeedEditorProps> = ({ source, onSave, onClose }) => {
  const [feedUrl, setFeedUrl] = useState(source.feedUrl || '');
  const [enabled, setEnabled] = useState(source.feedEnabled ?? true);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string; sample?: string[] } | null>(null);

  const validUrl = /^https?:\/\/\S+$/i.test(feedUrl.trim());

  const handleTest = async () => {
    setTesting(true);
    setResult(null);
    try {
      const r = await apiService.testFeed(feedUrl.trim());
      setResult({ ok: true, text: `خلاصة صالحة${r.title ? `: ${r.title}` : ''} (${r.itemCount} مادة)`, sample: r.sample });
    } catch (err: any) {
      setResult({ ok: false, text: err?.message || 'تعذر قراءة الخلاصة' });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = () => {
    const url = feedUrl.trim();
    onSave({ id: source.id, feedUrl: url || undefined, feedEnabled: !!url && enabled });
    onClose();
  };

  return (
    <div className="mt-2 p-3 bg-white border border-blue-200 rounded-xl space-y-2">
      <label htmlFor={`feed-url-${source.id}`} className="flex items-center gap-1.5 font-bold text-slate-700">
        <Rss className="w-3.5 h-3.5 text-orange-500" />
        رابط خلاصة RSS / Atom
      </label>
      <input
        id={`feed-url-${source.id}`}
        type="url"
        dir="ltr"
        value={feedUrl}
        onChange={(e) => {
          setFeedUrl(e.target.value);
          setResult(null);
        }}
        placeholder="https://agency.example/rss.xml"
        className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-mono focus:outline-hidden focus:ring-2 focus:ring-blue-500"
      />
      <label className="flex items-center gap-2 text-slate-600">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        جلب البرقيات تلقائياً إلى مكتب البرقيات
      </label>
      {result && (
        <div className={`p-2 rounded-lg text-[11px] ${result.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-700'}`}>
          <div className="flex items-center gap-1.5 font-bold">
            {result.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
            {result.text}
          </div>
          {result.sample && result.sample.length > 0 && (
            <ul className="list-disc pr-5 mt-1 space-y-0.5">
              {result.sample.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="flex items-center gap-2 justify-end">
        <button type="button" onClick={onClose} className="px-3 py-1.5 text-slate-600 hover:bg-slate-100 rounded-lg">
          إلغاء
        </button>
        <button
          type="button"
          onClick={handleTest}
          disabled={!validUrl || testing}
          className="px-3 py-1.5 border border-slate-300 rounded-lg font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 inline-flex items-center gap-1"
        >
          {testing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          اختبار الرابط
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!!feedUrl.trim() && !validUrl}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold disabled:opacity-50"
        >
          حفظ
        </button>
      </div>
    </div>
  );
};
