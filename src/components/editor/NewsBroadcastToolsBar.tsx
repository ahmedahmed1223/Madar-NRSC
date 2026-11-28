import React from 'react';
import {
  ArrowLeftRight,
  Bot,
  CheckCircle,
  Clock,
  Copy,
  Settings2,
  Sparkles,
} from 'lucide-react';
import type { NewsItem, NewsPriority } from '../../types';
import { countLabel } from '../../shared/arabicPlural';
import { NewsTemplatePicker } from './NewsTemplatePicker';
import { ExportMenu, docContext } from '../common/ExportMenu';
import { newsStoryDoc } from '../../services/documents/builders';
import type { RequestDraft } from '../requests/RequestFormPage';

export interface NewsBroadcastToolsBarProps {
  textStats: { label: string; words: number; chars: number };
  content: string;
  onContentChange: (value: string) => void;
  canEditContent: boolean;
  saving: boolean;
  canUseEditorialAi: boolean;
  onOpenAiCopilot: () => void;
  onOpenCgModal: () => void;
  newsItem?: NewsItem | null;
  canCreateRequest: boolean;
  onCreateRequest: (draft: RequestDraft) => void;
  title: string;
  shortTitle: string;
  summary: string;
  priority: NewsPriority;
  locationName: string;
  keywords: string[];
  copiedPrompter: boolean;
  onCopyPrompterText: () => void;
}

export const NewsBroadcastToolsBar: React.FC<NewsBroadcastToolsBarProps> = ({
  textStats,
  content,
  onContentChange,
  canEditContent,
  saving,
  canUseEditorialAi,
  onOpenAiCopilot,
  onOpenCgModal,
  newsItem,
  canCreateRequest,
  onCreateRequest,
  title,
  shortTitle,
  summary,
  priority,
  locationName,
  keywords,
  copiedPrompter,
  onCopyPrompterText,
}) => {
  return (
    <div className="text-slate-800 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
      <div className="flex flex-wrap items-center gap-4 sm:gap-6 text-xs">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-blue-50 text-blue-600 rounded-lg">
            <Clock className="w-4 h-4" />
          </div>
          <div>
            <span className="text-xs text-slate-500 block">زمن الإلقاء (المقدمة والنص):</span>
            <strong className="text-sm tabular-nums text-emerald-700">{textStats.label}</strong>
          </div>
        </div>

        <div className="h-6 w-px bg-slate-200 hidden sm:block" />

        <div>
          <span className="text-xs text-slate-500 block">الكلمات المقروءة:</span>
          <span className="tabular-nums font-bold text-slate-800">
            {countLabel(textStats.words, { one: 'كلمة واحدة', two: 'كلمتان', few: 'كلمات', many: 'كلمة' })}
          </span>
        </div>

        <div className="h-6 w-px bg-slate-200 hidden sm:block" />

        <div>
          <span className="text-xs text-slate-500 block">عدد الأحرف:</span>
          <span className="tabular-nums text-slate-700">
            {countLabel(textStats.chars, { one: 'حرف واحد', two: 'حرفان', few: 'أحرف', many: 'حرفاً' })}
          </span>
        </div>
      </div>

      {/* Broadcast Helper Tools */}
      <details className="w-full sm:w-auto">
        <summary className="min-h-11 flex items-center gap-2 cursor-pointer text-sm font-semibold text-slate-700 rounded-lg px-2 hover:bg-slate-100">
          <Settings2 className="w-4 h-4" /> أدوات الخبر
        </summary>
        <div className="flex flex-wrap items-center gap-2 pt-2">
          <NewsTemplatePicker content={content} onChange={onContentChange} disabled={!canEditContent || saving} />
          {canUseEditorialAi && (
            <button
              type="button"
              onClick={onOpenAiCopilot}
              disabled={!canEditContent || saving}
              className="flex items-center gap-1.5 min-h-11 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-bold transition-colors border border-slate-300 disabled:opacity-40"
              title="المساعد التحريري الذكي للصياغة والتدقيق والاقتراحات"
            >
              <Bot className="w-3.5 h-3.5 text-blue-600" />
              المساعد الذكي
            </button>
          )}

          <button
            type="button"
            onClick={onOpenCgModal}
            className="flex items-center gap-1.5 min-h-9 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-bold transition-colors border border-slate-300"
            title="توليد وسوم شارات الجرافيكس التلفزيوني وعناوين الشاشة"
          >
            <Sparkles className="w-3.5 h-3.5 text-blue-600" />
            مولد الشارات
          </button>

          {newsItem?.id && canCreateRequest && (
            <button
              type="button"
              onClick={() => onCreateRequest({ link: { kind: 'news', newsId: newsItem.id, title: newsItem.title }, title: '' })}
              className="flex items-center gap-1.5 min-h-9 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-bold transition-colors border border-slate-300"
              title="طلب مونتاج أو جرافيك أو غيرها لهذا الخبر"
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
              طلب من قسم
            </button>
          )}

          {newsItem?.id && (
            <ExportMenu
              label="تصدير الخبر"
              items={[
                {
                  id: 'story',
                  label: 'نسخة الخبر',
                  hint: 'البيانات والموجز والنص ومسار الاعتماد (بالنص الحالي في المحرر)',
                  build: () => newsStoryDoc({ ...newsItem, title, shortTitle, summary, content, priority, locationName, keywords }, docContext()),
                },
              ]}
            />
          )}

          <button
            type="button"
            onClick={onCopyPrompterText}
            className="flex items-center gap-1.5 min-h-9 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-bold transition-colors border border-slate-300"
            title="نسخ نص الملقن المباشر للمذيع"
          >
            {copiedPrompter ? <CheckCircle className="w-3.5 h-3.5 text-emerald-700" /> : <Copy className="w-3.5 h-3.5" />}
            {copiedPrompter ? 'تم نسخ نص الملقن' : 'نسخ للأوتوكيو'}
          </button>
        </div>
      </details>
    </div>
  );
};
