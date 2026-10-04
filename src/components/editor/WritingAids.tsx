import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, SpellCheck, Wand2, X } from 'lucide-react';
import { applyFixes, ProofIssue, proofread, proofreadHtml } from '../../shared/proofread';
import { completionsFor, newsroomGlossary } from '../../services/glossary';

const KIND_TONE: Record<ProofIssue['kind'], string> = {
  spelling: 'bg-rose-50 text-rose-700 border-rose-200',
  repeat: 'bg-amber-50 text-amber-800 border-amber-200',
  spacing: 'bg-slate-100 text-slate-600 border-slate-200',
  punctuation: 'bg-blue-50 text-blue-700 border-blue-200',
};
const KIND_NAME: Record<ProofIssue['kind'], string> = { spelling: 'إملاء', repeat: 'تكرار', spacing: 'مسافات', punctuation: 'ترقيم' };

/**
 * «تدقيق لغوي»: lists spelling, repetition, spacing and punctuation slips with one-click fixes.
 * Works on plain text (scripts) or HTML (story bodies, tags untouched).
 */
export const ProofreadButton: React.FC<{ value: string; html?: boolean; onFix: (next: string) => void; disabled?: boolean }> = ({ value, html, onFix, disabled }) => {
  const [open, setOpen] = useState(false);
  const [ignored, setIgnored] = useState<Set<string>>(new Set());
  const ref = useRef<HTMLDivElement>(null);
  const result = useMemo(() => {
    if (html) return proofreadHtml(value);
    const issues = proofread(value);
    return { issues, fixAll: () => applyFixes(value, issues), fixOne: (i: ProofIssue) => applyFixes(value, [i]) };
  }, [value, html]);
  const key = (i: ProofIssue) => `${i.start}:${i.original}`;
  const issues = result.issues.filter((i) => !ignored.has(key(i)));
  const source = html ? value.replace(/<[^>]+>/g, '\u0001') : value;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="تدقيق لغوي: الأخطاء الإملائية الشائعة والتكرار والمسافات والترقيم"
        className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] font-bold disabled:opacity-40 ${
          issues.length ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
        }`}
      >
        <SpellCheck className="w-3.5 h-3.5" />
        تدقيق {issues.length > 0 && <span className="font-mono">({issues.length})</span>}
      </button>
      {open && (
        <div role="dialog" aria-label="التدقيق اللغوي" className="absolute z-50 top-full mt-1 left-0 w-80 max-w-[90vw] bg-white border border-slate-200 rounded-2xl shadow-xl p-3 space-y-2 text-right">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-slate-800">التدقيق اللغوي</p>
            {issues.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  onFix(html ? (result as ReturnType<typeof proofreadHtml>).fixAll() : applyFixes(value, issues));
                  setOpen(false);
                }}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-[11px] font-bold"
              >
                <Wand2 className="w-3.5 h-3.5" /> إصلاح الكل ({issues.length})
              </button>
            )}
          </div>
          {issues.length === 0 ? (
            <p className="text-xs text-emerald-700 font-bold flex items-center gap-1">
              <Check className="w-4 h-4" /> لا أخطاء شائعة في النص
            </p>
          ) : (
            <ul className="max-h-72 overflow-y-auto space-y-1.5">
              {issues.map((i) => (
                <li key={key(i)} className="p-2 rounded-xl border border-slate-100 text-xs space-y-1">
                  <div className="flex items-center gap-1.5">
                    <span className={`px-1.5 py-0.5 rounded border text-[10px] font-bold ${KIND_TONE[i.kind]}`}>{KIND_NAME[i.kind]}</span>
                    <span className="text-slate-700 flex-1">{i.message}</span>
                  </div>
                  <p className="text-[11px] text-slate-500 truncate">…{source.slice(Math.max(0, i.start - 25), i.end + 25).replace(/\u0001/g, ' ')}…</p>
                  <div className="flex gap-1.5">
                    <button type="button" onClick={() => onFix(result.fixOne(i))} className="px-2 py-0.5 rounded-md bg-slate-900 text-white text-[11px] font-bold">
                      إصلاح
                    </button>
                    <button type="button" onClick={() => setIgnored(new Set([...ignored, key(i)]))} className="px-2 py-0.5 rounded-md border border-slate-200 text-slate-600 text-[11px]">
                      تجاهل
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[10px] text-slate-500">يقترح الإصلاحات المؤكدة فقط؛ الكلمات التي يتغير رسمها بالمعنى (أن/إن، علي/على) لا تُغيَّر. المدقق الإملائي في المتصفح يعمل أيضاً (الخط الأحمر تحت الكلمة).</p>
        </div>
      )}
    </div>
  );
};

/** The word being typed just before the caret. */
function fragmentBefore(text: string, caret: number): { start: number; word: string } {
  const before = text.slice(0, caret);
  const m = /[^\s،؛؟!.,:;()«»"'\[\]]+$/.exec(before);
  return m ? { start: caret - m[0].length, word: m[0] } : { start: caret, word: '' };
}

/**
 * Autocomplete from the newsroom's own names and terms. Tab (or a click) accepts the first
 * suggestion; Escape hides the list.
 */
export function useAutocomplete(ref: React.RefObject<HTMLTextAreaElement | HTMLInputElement | null>, value: string, setValue: (v: string) => void) {
  const [caret, setCaret] = useState<number | null>(null);
  const [hidden, setHidden] = useState(false);
  const frag = caret === null ? { start: 0, word: '' } : fragmentBefore(value, caret);
  const suggestions = !hidden && frag.word.length >= 2 ? completionsFor(frag.word) : [];

  const track = () => {
    const el = ref.current;
    if (el && document.activeElement === el) setCaret(el.selectionStart ?? null);
  };
  const accept = (term: string) => {
    const el = ref.current;
    if (!el || caret === null) return;
    const next = value.slice(0, frag.start) + term + ' ' + value.slice(caret);
    setValue(next);
    const pos = frag.start + term.length + 1;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(pos, pos);
      setCaret(pos);
    });
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!suggestions.length) return;
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      accept(suggestions[0]);
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      setHidden(true);
    }
  };
  return {
    suggestions,
    accept,
    bind: {
      onKeyDown,
      onKeyUp: (e: React.KeyboardEvent) => {
        if (e.key !== 'Escape') setHidden(false);
        track();
      },
      onClick: track,
      onBlur: () => setTimeout(() => setCaret(null), 150),
    },
  };
}

export const AutocompleteBar: React.FC<{ suggestions: string[]; onPick: (term: string) => void }> = ({ suggestions, onPick }) =>
  suggestions.length ? (
    <div role="listbox" aria-label="اقتراحات الإكمال" className="flex flex-wrap items-center gap-1 mt-1 text-[11px]">
      <span className="text-slate-500">إكمال (Tab):</span>
      {suggestions.map((t, i) => (
        <button
          key={t}
          type="button"
          role="option"
          aria-selected={i === 0}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(t)}
          className={`px-2 py-0.5 rounded-md border ${i === 0 ? 'border-blue-300 bg-blue-50 text-blue-800 font-bold' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
        >
          {t}
        </button>
      ))}
    </div>
  ) : null;

export const DismissButton: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <button type="button" onClick={onClick} aria-label="إخفاء" className="p-0.5 text-slate-500">
    <X className="w-3 h-3" />
  </button>
);

/** Browser-native suggestions (a <datalist>) from the newsroom glossary, for short fields. */
export const GlossaryDatalist: React.FC<{ id: string }> = ({ id }) => {
  const terms = useMemo(() => newsroomGlossary().slice(0, 400), []);
  return (
    <datalist id={id}>
      {terms.map((t) => (
        <option key={t} value={t} />
      ))}
    </datalist>
  );
};
