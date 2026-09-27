import React, { useState, useRef, useEffect } from 'react';
import {
  Bold,
  Italic,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Link as LinkIcon,
  Image as ImageIcon,
  Video,
  Edit3,
  Undo2,
  Redo2,
  Code,
  Clock,
} from 'lucide-react';
import { Modal } from '../common/Modal';
import { TextSizeControls, useFullscreenField, useTextSize } from '../common/TextSizeControls';
import { sanitizeHtml } from '../../utils/sanitizeHtml';

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minHeight?: string;
  /** Shows the text without allowing changes (e.g. while a colleague holds the story). */
  readOnly?: boolean;
}

const BLOCKS = new Set(['UL', 'OL', 'H2', 'H3', 'BLOCKQUOTE', 'FIGURE', 'P', 'DIV']);

/** Browsers nest lists and headings inside <p> when editing; store valid, tidy HTML instead. */
function normalizeHtml(html: string): string {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const root = tpl.content;
  root.querySelectorAll('p, div').forEach((el) => {
    if ([...el.children].some((c) => BLOCKS.has(c.tagName))) el.replaceWith(...el.childNodes);
  });
  root.querySelectorAll('div').forEach((el) => {
    const p = document.createElement('p');
    p.append(...el.childNodes);
    el.replaceWith(p);
  });
  root.querySelectorAll('p').forEach((el) => {
    if (!el.textContent?.trim() && !el.querySelector('img, video, br')) el.remove();
  });
  const wrapper = document.createElement('div');
  wrapper.appendChild(root);
  return wrapper.innerHTML;
}

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const safeUrl = (url: string) => (/^(https?:\/\/|\/)/i.test(url.trim()) ? url.trim() : '');

/**
 * What-you-see-is-what-you-get editor for story bodies. Stores sanitised HTML; an "HTML source"
 * mode remains for advanced edits.
 */
export const RichTextEditor: React.FC<RichTextEditorProps> = ({
  value,
  onChange,
  placeholder = 'اكتب نص المادة الصحفية هنا بصياغة مهنية ودقيقة...',
  minHeight = '320px',
  readOnly = false,
}) => {
  const [isSource, setIsSource] = useState(false);
  const text = useTextSize('story-body');
  const fs = useFullscreenField();
  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
  const [isMediaModalOpen, setIsMediaModalOpen] = useState(false);
  const [mediaType, setMediaType] = useState<'IMAGE' | 'VIDEO'>('IMAGE');
  const [mediaUrl, setMediaUrl] = useState('');
  const [mediaCaption, setMediaCaption] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkText, setLinkText] = useState('');

  const editorRef = useRef<HTMLDivElement>(null);
  const lastEmitted = useRef<string | null>(null);
  const savedRange = useRef<Range | null>(null);

  // Mirror outside changes (loading a story, AI co-pilot, restored drafts) into the editable area,
  // but never overwrite what the user is typing.
  useEffect(() => {
    const el = editorRef.current;
    if (!el || isSource) return;
    if (value !== lastEmitted.current) {
      el.innerHTML = sanitizeHtml(value);
      lastEmitted.current = value;
    }
  }, [value, isSource]);

  const emit = () => {
    const el = editorRef.current;
    if (!el) return;
    const html = ['<br>', '<p><br></p>'].includes(el.innerHTML) ? '' : el.innerHTML;
    const clean = html ? sanitizeHtml(normalizeHtml(html)) : '';
    lastEmitted.current = clean;
    onChange(clean);
  };

  const saveSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && editorRef.current?.contains(sel.anchorNode)) savedRange.current = sel.getRangeAt(0).cloneRange();
  };

  const restoreSelection = () => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (sel && savedRange.current) {
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
    }
  };

  const exec = (command: string, arg?: string) => {
    if (readOnly) return;
    if (isSource) setIsSource(false);
    editorRef.current?.focus();
    document.execCommand('defaultParagraphSeparator', false, 'p');
    document.execCommand(command, false, arg);
    emit();
  };

  const insertHtml = (html: string) => {
    restoreSelection();
    document.execCommand('insertHTML', false, sanitizeHtml(html));
    emit();
  };

  const toggleBlock = (tag: 'h2' | 'h3' | 'blockquote') => {
    const current = String(document.queryCommandValue('formatBlock') || '').toLowerCase();
    exec('formatBlock', current === tag ? 'p' : tag);
  };

  const handleBold = () => exec('bold');
  const handleItalic = () => exec('italic');
  const handleH2 = () => toggleBlock('h2');
  const handleH3 = () => toggleBlock('h3');
  const handleQuote = () => toggleBlock('blockquote');
  const handleBulletList = () => exec('insertUnorderedList');
  const handleNumberedList = () => exec('insertOrderedList');

  const openModal = (open: () => void) => {
    saveSelection();
    open();
  };

  const handleInsertLink = () => {
    const url = safeUrl(linkUrl);
    if (!url) return;
    const selected = savedRange.current?.toString() || '';
    const text = linkText || selected || url;
    insertHtml(`<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${escapeAttr(text)}</a>`);
    setLinkUrl('');
    setLinkText('');
    setIsLinkModalOpen(false);
  };

  const handleInsertMedia = () => {
    const url = safeUrl(mediaUrl);
    if (!url) return;
    const caption = mediaCaption ? `<figcaption>${escapeAttr(mediaCaption)}</figcaption>` : '';
    insertHtml(
      mediaType === 'IMAGE'
        ? `<figure><img src="${escapeAttr(url)}" alt="${escapeAttr(mediaCaption || 'صورة مرافقة للخبر')}" />${caption}</figure><p><br></p>`
        : `<figure><video controls src="${escapeAttr(url)}"></video>${caption}</figure><p><br></p>`
    );
    setMediaUrl('');
    setMediaCaption('');
    setIsMediaModalOpen(false);
  };

  // Pasted text keeps its paragraphs but not the source site's styling or scripts.
  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    const content = html
      ? sanitizeHtml(html).replace(/\s(style|class|id)="[^"]*"/gi, '')
      : text
          .split(/\n{2,}|\r\n\r\n/)
          .map((p) => `<p>${escapeAttr(p).replace(/\n/g, '<br>')}</p>`)
          .join('');
    document.execCommand('insertHTML', false, content);
    emit();
  };

  // Word count & Char count calculation
  // Tags become spaces so adjacent paragraphs are not counted as one word.
  const cleanText = value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  const wordCount = cleanText ? cleanText.split(/\s+/).length : 0;
  const charCount = cleanText.length;
  // Standard Arabic broadcast reading speed is ~130 words per minute
  const readingSeconds = Math.round((wordCount / 130) * 60);
  const readMin = Math.floor(readingSeconds / 60);
  const readSec = readingSeconds % 60;
  const readingTimeStr = `${readMin > 0 ? `${readMin} دقيقة و ` : ''}${readSec} ثانية`;

  return (
    <div
      role={fs.full ? 'dialog' : undefined}
      aria-modal={fs.full || undefined}
      aria-label={fs.full ? 'نص الخبر' : undefined}
      className={`border border-slate-200 overflow-hidden bg-white shadow-xs focus-within:border-blue-500 transition-all ${
        fs.full ? 'fixed inset-0 z-[70] flex flex-col rounded-none' : 'rounded-xl'
      }`}
    >
      {/* Editor Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-1 p-2 bg-slate-50 border-b border-slate-200 text-slate-700">
        <div className={`flex flex-wrap items-center gap-1 ${readOnly ? 'opacity-40 pointer-events-none' : ''}`} aria-disabled={readOnly}>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleH2}
            className="p-1.5 hover:bg-slate-200/70 rounded-md transition-colors text-slate-700 font-bold"
            title="عنوان رئيسي (H2)"
          >
            <Heading2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleH3}
            className="p-1.5 hover:bg-slate-200/70 rounded-md transition-colors text-slate-700 font-semibold"
            title="عنوان فرعي (H3)"
          >
            <Heading3 className="w-4 h-4" />
          </button>

          <span className="w-px h-5 bg-slate-300 mx-1" />

          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleBold}
            className="p-1.5 hover:bg-slate-200/70 rounded-md transition-colors"
            title="نص عريض (Bold)"
          >
            <Bold className="w-4 h-4" />
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleItalic}
            className="p-1.5 hover:bg-slate-200/70 rounded-md transition-colors"
            title="نص مائل (Italic)"
          >
            <Italic className="w-4 h-4" />
          </button>

          <span className="w-px h-5 bg-slate-300 mx-1" />

          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleBulletList}
            className="p-1.5 hover:bg-slate-200/70 rounded-md transition-colors"
            title="قائمة نقطية"
          >
            <List className="w-4 h-4" />
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleNumberedList}
            className="p-1.5 hover:bg-slate-200/70 rounded-md transition-colors"
            title="قائمة رقمية"
          >
            <ListOrdered className="w-4 h-4" />
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleQuote}
            className="p-1.5 hover:bg-slate-200/70 rounded-md transition-colors"
            title="اقتباس أو تصريح"
          >
            <Quote className="w-4 h-4" />
          </button>

          <span className="w-px h-5 bg-slate-300 mx-1" />

          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => openModal(() => setIsLinkModalOpen(true))}
            className="p-1.5 hover:bg-slate-200/70 rounded-md transition-colors"
            title="إدراج رابط"
          >
            <LinkIcon className="w-4 h-4" />
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() =>
              openModal(() => {
                setMediaType('IMAGE');
                setIsMediaModalOpen(true);
              })
            }
            className="p-1.5 hover:bg-slate-200/70 rounded-md transition-colors"
            title="إدراج صورة"
          >
            <ImageIcon className="w-4 h-4" />
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() =>
              openModal(() => {
                setMediaType('VIDEO');
                setIsMediaModalOpen(true);
              })
            }
            className="p-1.5 hover:bg-slate-200/70 rounded-md transition-colors"
            title="إدراج فيديو"
          >
            <Video className="w-4 h-4" />
          </button>
        </div>

        {/* Reading size, full screen, and source toggle for advanced edits */}
        <div className="flex items-center gap-2">
          <TextSizeControls label="نص الخبر" text={text} fullscreen={fs} />
          <button
            type="button"
            onClick={() => setIsSource(!isSource)}
            aria-pressed={isSource}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-lg border transition-colors ${
              isSource ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
            }`}
            title={isSource ? 'العودة إلى المحرر المرئي' : 'عرض وتحرير شيفرة HTML'}
          >
            {isSource ? <Edit3 className="w-3.5 h-3.5" /> : <Code className="w-3.5 h-3.5" />}
            {isSource ? 'المحرر المرئي' : 'HTML'}
          </button>
        </div>
      </div>

      {/* Editor Body: scrolls inside itself so long stories keep the toolbar in view */}
      <div className={`p-4 overflow-y-auto ${fs.full ? 'flex-1' : 'max-h-[75vh] resize-y'}`}>
        {isSource ? (
          <textarea
            value={value}
            readOnly={readOnly}
            onChange={(e) => onChange(e.target.value)}
            style={{ minHeight }}
            aria-label="شيفرة HTML لمحتوى الخبر"
            className="w-full bg-transparent border-0 focus:ring-0 focus:outline-hidden resize-y text-slate-800 text-sm leading-relaxed font-mono"
            dir="ltr"
          />
        ) : (
          <div
            ref={editorRef}
            role="textbox"
            aria-multiline="true"
            aria-label="محتوى الخبر"
            aria-readonly={readOnly}
            contentEditable={!readOnly}
            suppressContentEditableWarning
            data-placeholder={placeholder}
            onInput={emit}
            onFocus={() => {
              document.execCommand('defaultParagraphSeparator', false, 'p');
              const el = editorRef.current;
              // Start the body inside a paragraph so every line is stored as <p>.
              if (el && !el.innerHTML.trim()) {
                el.innerHTML = '<p><br></p>';
                const range = document.createRange();
                range.setStart(el.firstChild!, 0);
                range.collapse(true);
                const sel = window.getSelection();
                sel?.removeAllRanges();
                sel?.addRange(range);
              }
            }}
            onBlur={() => {
              const el = editorRef.current;
              if (el && el.innerHTML === '<p><br></p>') el.innerHTML = '';
              saveSelection();
              emit();
            }}
            onKeyUp={saveSelection}
            onMouseUp={saveSelection}
            onPaste={handlePaste}
            style={{ minHeight, fontSize: text.size }}
            dir="rtl"
            className="rich-editor text-slate-800 leading-relaxed font-sans focus:outline-hidden"
          />
        )}
      </div>

      {/* Word & Char Footer */}
      <div className="px-4 py-2 border-t border-slate-100 bg-slate-50/60 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <div className="flex flex-wrap items-center gap-4">
          <span>الكلمات: <strong className="text-slate-700 font-bold">{wordCount}</strong></span>
          <span>الحروف: <strong className="text-slate-700 font-bold">{charCount}</strong></span>
          <span className="flex items-center gap-1.5 text-blue-700 font-semibold bg-blue-50 px-2.5 py-0.5 rounded-md border border-blue-100">
            <Clock className="w-3.5 h-3.5 text-blue-600 shrink-0" />
            زمن الإلقاء التقديري: {wordCount > 0 ? readingTimeStr : '0 ثانية'} (~130 ك/د)
          </span>
        </div>
        <span className="text-[11px] text-slate-400">محرر متوافق مع نظام النشر والأوتوكيو</span>
      </div>

      {/* Link Modal */}
      <Modal
        isOpen={isLinkModalOpen}
        onClose={() => setIsLinkModalOpen(false)}
        title="إدراج رابط إلكتروني"
        maxWidth="md"
      >
        <div className="space-y-4">
          <div>
            <label htmlFor="rich-text-editor-field-1" className="block text-xs font-semibold text-slate-700 mb-1">عنوان الرابط (URL)</label>
            <input id="rich-text-editor-field-1"
              type="url"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="https://example.com"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-left focus:ring-2 focus:ring-blue-500"
              dir="ltr"
            />
          </div>
          <div>
            <label htmlFor="rich-text-editor-field-2" className="block text-xs font-semibold text-slate-700 mb-1">نص الرابط (اختياري)</label>
            <input id="rich-text-editor-field-2"
              type="text"
              value={linkText}
              onChange={(e) => setLinkText(e.target.value)}
              placeholder="النص الذي سيظهر للقارئ"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setIsLinkModalOpen(false)}
              className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg"
            >
              إلغاء
            </button>
            <button
              type="button"
              onClick={handleInsertLink}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              إدراج الرابط
            </button>
          </div>
        </div>
      </Modal>

      {/* Media Modal */}
      <Modal
        isOpen={isMediaModalOpen}
        onClose={() => setIsMediaModalOpen(false)}
        title={mediaType === 'IMAGE' ? 'إدراج صورة داخل المادة' : 'إدراج مقطع فيديو داخل المادة'}
        maxWidth="md"
      >
        <div className="space-y-4">
          <div>
            <label htmlFor="rich-text-editor-field-3" className="block text-xs font-semibold text-slate-700 mb-1">
              رابط {mediaType === 'IMAGE' ? 'الصورة' : 'الفيديو'} (URL)
            </label>
            <input id="rich-text-editor-field-3"
              type="url"
              value={mediaUrl}
              onChange={(e) => setMediaUrl(e.target.value)}
              placeholder="https://...jpg أو mp4"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-left focus:ring-2 focus:ring-blue-500"
              dir="ltr"
            />
          </div>
          <div>
            <label htmlFor="rich-text-editor-field-4" className="block text-xs font-semibold text-slate-700 mb-1">وصف أو تعليق توضيحي (Caption)</label>
            <input id="rich-text-editor-field-4"
              type="text"
              value={mediaCaption}
              onChange={(e) => setMediaCaption(e.target.value)}
              placeholder="مثال: الجلسة الافتتاحية للمؤتمر الدولي"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setIsMediaModalOpen(false)}
              className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg"
            >
              إلغاء
            </button>
            <button
              type="button"
              onClick={handleInsertMedia}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              إدراج في المحتوى
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
