import React, { useState, useRef } from 'react';
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
  Eye,
  Edit3,
  Undo2,
  Redo2,
  Code,
  Clock,
} from 'lucide-react';
import { Modal } from '../common/Modal';
import { sanitizeHtml } from '../../utils/sanitizeHtml';

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minHeight?: string;
}

export const RichTextEditor: React.FC<RichTextEditorProps> = ({
  value,
  onChange,
  placeholder = 'اكتب نص المادة الصحفية هنا بصياغة مهنية ودقيقة...',
  minHeight = '320px',
}) => {
  const [isPreview, setIsPreview] = useState(false);
  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
  const [isMediaModalOpen, setIsMediaModalOpen] = useState(false);
  const [mediaType, setMediaType] = useState<'IMAGE' | 'VIDEO'>('IMAGE');
  const [mediaUrl, setMediaUrl] = useState('');
  const [mediaCaption, setMediaCaption] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkText, setLinkText] = useState('');

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const insertText = (before: string, after: string = '', defaultInside: string = '') => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = value.substring(start, end) || defaultInside;
    const replacement = before + selected + after;

    const newValue = value.substring(0, start) + replacement + value.substring(end);
    onChange(newValue);

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + before.length, start + before.length + selected.length);
    }, 0);
  };

  const handleBold = () => insertText('<strong>', '</strong>', 'نص عريض');
  const handleItalic = () => insertText('<em>', '</em>', 'نص مائل');
  const handleH2 = () => insertText('\n<h2>', '</h2>\n', 'عنوان رئيسي');
  const handleH3 = () => insertText('\n<h3>', '</h3>\n', 'عنوان فرعي');
  const handleQuote = () => insertText('\n<blockquote>"', '"</blockquote>\n', 'اقتباس أو تصريح صحفي');
  const handleBulletList = () => {
    insertText('\n<ul>\n  <li>', '</li>\n  <li>عنصر ثانٍ</li>\n</ul>\n', 'عنصر قائمة');
  };
  const handleNumberedList = () => {
    insertText('\n<ol>\n  <li>', '</li>\n  <li>عنصر ثانٍ</li>\n</ol>\n', 'عنصر مرقم');
  };

  const handleInsertLink = () => {
    if (!linkUrl) return;
    const text = linkText || linkUrl;
    insertText(`<a href="${linkUrl}" target="_blank" rel="noopener noreferrer" class="text-blue-600 underline">`, `</a>`, text);
    setLinkUrl('');
    setLinkText('');
    setIsLinkModalOpen(false);
  };

  const handleInsertMedia = () => {
    if (!mediaUrl) return;
    if (mediaType === 'IMAGE') {
      const imgTag = `\n<figure class="my-4"><img src="${mediaUrl}" alt="${mediaCaption || 'صورة مرافقة للخبر'}" class="w-full rounded-xl max-h-96 object-cover shadow-sm" />${
        mediaCaption ? `<figcaption class="text-xs text-slate-500 mt-1.5 text-center">${mediaCaption}</figcaption>` : ''
      }</figure>\n`;
      insertText(imgTag);
    } else {
      const videoTag = `\n<figure class="my-4"><video controls src="${mediaUrl}" class="w-full rounded-xl max-h-96 bg-black"></video>${
        mediaCaption ? `<figcaption class="text-xs text-slate-500 mt-1.5 text-center">${mediaCaption}</figcaption>` : ''
      }</figure>\n`;
      insertText(videoTag);
    }
    setMediaUrl('');
    setMediaCaption('');
    setIsMediaModalOpen(false);
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
    <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-xs focus-within:border-blue-500 transition-all">
      {/* Editor Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-1 p-2 bg-slate-50 border-b border-slate-200 text-slate-700">
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={handleH2}
            className="p-1.5 hover:bg-slate-200/70 rounded-md transition-colors text-slate-700 font-bold"
            title="عنوان رئيسي (H2)"
          >
            <Heading2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handleH3}
            className="p-1.5 hover:bg-slate-200/70 rounded-md transition-colors text-slate-700 font-semibold"
            title="عنوان فرعي (H3)"
          >
            <Heading3 className="w-4 h-4" />
          </button>

          <span className="w-px h-5 bg-slate-300 mx-1" />

          <button
            type="button"
            onClick={handleBold}
            className="p-1.5 hover:bg-slate-200/70 rounded-md transition-colors"
            title="نص عريض (Bold)"
          >
            <Bold className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handleItalic}
            className="p-1.5 hover:bg-slate-200/70 rounded-md transition-colors"
            title="نص مائل (Italic)"
          >
            <Italic className="w-4 h-4" />
          </button>

          <span className="w-px h-5 bg-slate-300 mx-1" />

          <button
            type="button"
            onClick={handleBulletList}
            className="p-1.5 hover:bg-slate-200/70 rounded-md transition-colors"
            title="قائمة نقطية"
          >
            <List className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handleNumberedList}
            className="p-1.5 hover:bg-slate-200/70 rounded-md transition-colors"
            title="قائمة رقمية"
          >
            <ListOrdered className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handleQuote}
            className="p-1.5 hover:bg-slate-200/70 rounded-md transition-colors"
            title="اقتباس أو تصريح"
          >
            <Quote className="w-4 h-4" />
          </button>

          <span className="w-px h-5 bg-slate-300 mx-1" />

          <button
            type="button"
            onClick={() => setIsLinkModalOpen(true)}
            className="p-1.5 hover:bg-slate-200/70 rounded-md transition-colors"
            title="إدراج رابط"
          >
            <LinkIcon className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              setMediaType('IMAGE');
              setIsMediaModalOpen(true);
            }}
            className="p-1.5 hover:bg-slate-200/70 rounded-md transition-colors"
            title="إدراج صورة"
          >
            <ImageIcon className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              setMediaType('VIDEO');
              setIsMediaModalOpen(true);
            }}
            className="p-1.5 hover:bg-slate-200/70 rounded-md transition-colors"
            title="إدراج فيديو"
          >
            <Video className="w-4 h-4" />
          </button>
        </div>

        {/* View Toggle */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsPreview(!isPreview)}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-lg border transition-colors ${
              isPreview
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
            }`}
          >
            {isPreview ? (
              <>
                <Edit3 className="w-3.5 h-3.5" />
                تحرير
              </>
            ) : (
              <>
                <Eye className="w-3.5 h-3.5" />
                معاينة
              </>
            )}
          </button>
        </div>
      </div>

      {/* Editor Body */}
      <div className="p-4">
        {isPreview ? (
          <div
            className="prose prose-slate max-w-none min-h-[300px] text-slate-800 leading-relaxed font-sans"
            dangerouslySetInnerHTML={{ __html: value ? sanitizeHtml(value) : '<p class="text-slate-400">لا يوجد نص للمعاينة بعد...</p>' }}
          />
        ) : (
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            style={{ minHeight }}
            className="w-full bg-transparent border-0 focus:ring-0 focus:outline-hidden resize-y text-slate-800 text-base leading-relaxed placeholder:text-slate-400 font-sans"
            dir="rtl"
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
            <label className="block text-xs font-semibold text-slate-700 mb-1">عنوان الرابط (URL)</label>
            <input
              type="url"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="https://example.com"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-left focus:ring-2 focus:ring-blue-500"
              dir="ltr"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">نص الرابط (اختياري)</label>
            <input
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
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              رابط {mediaType === 'IMAGE' ? 'الصورة' : 'الفيديو'} (URL)
            </label>
            <input
              type="url"
              value={mediaUrl}
              onChange={(e) => setMediaUrl(e.target.value)}
              placeholder="https://...jpg أو mp4"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-left focus:ring-2 focus:ring-blue-500"
              dir="ltr"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">وصف أو تعليق توضيحي (Caption)</label>
            <input
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
