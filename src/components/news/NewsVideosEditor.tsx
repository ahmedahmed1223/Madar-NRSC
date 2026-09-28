import React, { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, FolderOpen, Link2, Plus, Trash2, Video } from 'lucide-react';
import { apiService } from '../../services/api';
import {
  MAX_NEWS_VIDEOS,
  NewsVideo,
  NewsVideoKind,
  VIDEO_KIND_NAMES,
  formatClipDuration,
  parseClipDuration,
  totalVideoSeconds,
  videoError,
} from '../../shared/newsVideos';

const newId = () => `vid-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const KIND_ICON: Record<NewsVideoKind, React.ElementType> = { link: Link2, library: Video, location: FolderOpen };

/**
 * The story's clips in playout order: add a link, pick from the media library, or write where
 * the clip is (server folder, card, reporter) when it is not attached yet. Up/down reorder.
 */
export const NewsVideosEditor: React.FC<{ videos: NewsVideo[]; onChange: (next: NewsVideo[]) => void; disabled?: boolean }> = ({ videos, onChange, disabled }) => {
  const library = useMemo(
    () => (apiService.getMediaAssets?.() || []).filter((m: any) => m.mediaType === 'VIDEO' && !m.deletedAt),
    []
  );
  const [durationText, setDurationText] = useState<Record<string, string>>({});

  const update = (id: string, patch: Partial<NewsVideo>) => onChange(videos.map((v) => (v.id === id ? { ...v, ...patch } : v)));
  const move = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= videos.length) return;
    const next = [...videos];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const add = (kind: NewsVideoKind) => {
    if (videos.length >= MAX_NEWS_VIDEOS) return;
    onChange([...videos, { id: newId(), title: `المقطع ${videos.length + 1}`, kind }]);
  };
  const total = totalVideoSeconds(videos);

  return (
    <div className="space-y-2" data-testid="news-videos">
      {videos.length === 0 && (
        <p className="text-[11px] text-slate-500 bg-slate-50 border border-dashed border-slate-200 rounded-xl p-3">
          لا مقاطع بعد. أضف رابطاً، أو اختر من مكتبة الوسائط، أو اكتب مكان المقطع ليعرف فريق التنفيذ أين يجده.
        </p>
      )}

      <ol className="space-y-2">
        {videos.map((v, i) => {
          const Icon = KIND_ICON[v.kind];
          const err = videoError(v, i);
          const dur = durationText[v.id] ?? formatClipDuration(v.seconds);
          const durBad = Number.isNaN(parseClipDuration(dur) as number);
          return (
            <li key={v.id} className={`p-2.5 rounded-xl border ${err ? 'border-amber-300 bg-amber-50/40' : 'border-slate-200 bg-white'} space-y-2`}>
              <div className="flex items-center gap-1.5">
                <span className="w-6 h-6 shrink-0 rounded-lg bg-slate-900 text-white text-[11px] font-bold flex items-center justify-center tabular-nums">{i + 1}</span>
                <input
                  value={v.title}
                  onChange={(e) => update(v.id, { title: e.target.value })}
                  disabled={disabled}
                  maxLength={120}
                  aria-label={`اسم المقطع ${i + 1}`}
                  placeholder="اسم المقطع (مثل: لقطات الافتتاح)"
                  className="flex-1 min-w-0 px-2 py-1 text-xs font-bold border border-slate-200 rounded-lg"
                />
              </div>
              <div className="flex items-center gap-1">
                <Icon className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden />
                <select
                  value={v.kind}
                  onChange={(e) => update(v.id, { kind: e.target.value as NewsVideoKind })}
                  disabled={disabled}
                  aria-label={`نوع المقطع ${i + 1}`}
                  className="text-[11px] px-1.5 py-1 border border-slate-200 rounded-lg"
                >
                  {(Object.keys(VIDEO_KIND_NAMES) as NewsVideoKind[]).map((k) => (
                    <option key={k} value={k}>
                      {VIDEO_KIND_NAMES[k]}
                    </option>
                  ))}
                </select>
                <span className="ms-auto flex items-center">
                  <button type="button" onClick={() => move(i, -1)} disabled={disabled || i === 0} aria-label={`تقديم المقطع ${i + 1}`} title="تقديم" className="p-1.5 text-slate-400 hover:text-slate-800 disabled:opacity-30" data-compact>
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" onClick={() => move(i, 1)} disabled={disabled || i === videos.length - 1} aria-label={`تأخير المقطع ${i + 1}`} title="تأخير" className="p-1.5 text-slate-400 hover:text-slate-800 disabled:opacity-30" data-compact>
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" onClick={() => onChange(videos.filter((x) => x.id !== v.id))} disabled={disabled} aria-label={`حذف المقطع ${i + 1}`} title="حذف" className="p-1.5 text-slate-300 hover:text-rose-600" data-compact>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </span>
              </div>

              {v.kind === 'link' && (
                <input
                  value={v.url || ''}
                  onChange={(e) => update(v.id, { url: e.target.value.trim() })}
                  disabled={disabled}
                  dir="ltr"
                  inputMode="url"
                  autoCapitalize="none"
                  spellCheck={false}
                  aria-label={`رابط المقطع ${i + 1}`}
                  placeholder="https://…/clip.mp4"
                  className="w-full px-2.5 py-1.5 text-xs font-mono text-left border border-slate-200 rounded-lg"
                />
              )}
              {v.kind === 'library' && (
                <select
                  value={v.mediaId || ''}
                  onChange={(e) => {
                    const m: any = library.find((x: any) => x.id === e.target.value);
                    update(v.id, { mediaId: e.target.value || undefined, ...(m?.durationSeconds && !v.seconds ? { seconds: m.durationSeconds } : {}), ...(m && /^المقطع \d+$/.test(v.title) ? { title: m.title || m.fileName } : {}) });
                  }}
                  disabled={disabled}
                  aria-label={`مادة المقطع ${i + 1} من المكتبة`}
                  className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded-lg"
                >
                  <option value="">اختر فيديو من مكتبة الوسائط…</option>
                  {library.map((m: any) => (
                    <option key={m.id} value={m.id}>
                      {m.title || m.fileName}
                      {m.durationSeconds ? ` (${formatClipDuration(m.durationSeconds)})` : ''}
                    </option>
                  ))}
                </select>
              )}
              {v.kind === 'location' && (
                <input
                  value={v.location || ''}
                  onChange={(e) => update(v.id, { location: e.target.value })}
                  disabled={disabled}
                  maxLength={500}
                  aria-label={`مكان المقطع ${i + 1}`}
                  placeholder="أين يوجد المقطع؟ مثل: خادم المونتاج \\NAS01\القمة\، أو مع المراسل على البطاقة 2"
                  className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg"
                />
              )}

              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1 text-[11px] text-slate-600">
                  المدة
                  <input
                    value={dur}
                    onChange={(e) => setDurationText({ ...durationText, [v.id]: e.target.value })}
                    onBlur={() => {
                      const secs = parseClipDuration(dur);
                      if (!Number.isNaN(secs as number)) {
                        update(v.id, { seconds: secs });
                        setDurationText(({ [v.id]: _drop, ...rest }) => rest);
                      }
                    }}
                    disabled={disabled}
                    dir="ltr"
                    placeholder="mm:ss"
                    aria-invalid={durBad || undefined}
                    className={`w-16 px-1.5 py-1 text-xs font-mono text-center border rounded-lg ${durBad ? 'border-rose-400' : 'border-slate-200'}`}
                  />
                </label>
                <input
                  value={v.note || ''}
                  onChange={(e) => update(v.id, { note: e.target.value || undefined })}
                  disabled={disabled}
                  maxLength={1000}
                  aria-label={`ملاحظة للتنفيذ عن المقطع ${i + 1}`}
                  placeholder="ملاحظة للتنفيذ (نقطة البدء، الصوت، الحقوق…)"
                  className="flex-1 min-w-[10rem] px-2 py-1 text-[11px] border border-slate-200 rounded-lg"
                />
              </div>
              {err && <p className="text-[11px] font-bold text-amber-800">{err}</p>}
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-center gap-1.5">
        {(['link', 'library', 'location'] as NewsVideoKind[]).map((k) => {
          const Icon = KIND_ICON[k];
          return (
            <button
              key={k}
              type="button"
              onClick={() => add(k)}
              disabled={disabled || videos.length >= MAX_NEWS_VIDEOS || (k === 'library' && !library.length)}
              title={k === 'library' && !library.length ? 'لا فيديوهات في مكتبة الوسائط' : undefined}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-[11px] font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              <Plus className="w-3 h-3" />
              <Icon className="w-3.5 h-3.5" /> {k === 'link' ? 'رابط مقطع' : k === 'library' ? 'من المكتبة' : 'مكان مقطع (نص)'}
            </button>
          );
        })}
        {videos.length > 0 && (
          <span className="text-[11px] text-slate-500 w-full tabular-nums">
            {videos.length} · المجموع {formatClipDuration(total) || '—'}
          </span>
        )}
      </div>
    </div>
  );
};

/** Read-only list for production: order, name, duration, and where each clip is. */
export const NewsVideosList: React.FC<{ videos: NewsVideo[] }> = ({ videos }) => {
  if (!videos.length) return null;
  const media = apiService.getMedia?.() || [];
  const total = totalVideoSeconds(videos);
  return (
    <section aria-label="مقاطع الفيديو" className="p-3 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2">
      <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
        <Video className="w-4 h-4 text-blue-600" /> مقاطع الفيديو بترتيب العرض ({videos.length})
        {total > 0 && <span className="text-slate-500 font-normal tabular-nums">· المجموع {formatClipDuration(total)}</span>}
      </h4>
      <ol className="space-y-1.5">
        {videos.map((v, i) => {
          const m: any = v.kind === 'library' ? media.find((x: any) => x.id === v.mediaId) : null;
          const href = v.kind === 'link' ? v.url : m?.fileUrl || m?.url;
          return (
            <li key={v.id} className="flex items-start gap-2 text-xs">
              <span className="w-5 h-5 shrink-0 rounded-md bg-slate-900 text-white text-[10px] font-bold flex items-center justify-center tabular-nums">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="font-bold text-slate-800">
                  {v.title || 'مقطع'}
                  {v.seconds ? <span className="font-mono font-normal text-slate-500 mr-1.5">{formatClipDuration(v.seconds)}</span> : null}
                  <span className="mr-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-600">{VIDEO_KIND_NAMES[v.kind]}</span>
                </p>
                {v.kind === 'location' ? (
                  <p className="text-slate-700 select-all">📍 {v.location}</p>
                ) : href ? (
                  <a href={href} target="_blank" rel="noreferrer" dir="ltr" className="block text-left font-mono text-[11px] text-blue-700 hover:underline break-all">
                    {v.kind === 'library' ? m?.title || m?.fileName || href : href}
                  </a>
                ) : (
                  <p className="text-amber-700">المادة غير موجودة في المكتبة</p>
                )}
                {v.note && <p className="text-[11px] text-slate-500">{v.note}</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
};
