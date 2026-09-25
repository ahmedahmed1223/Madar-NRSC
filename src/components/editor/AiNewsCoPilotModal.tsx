import React, { useState } from 'react';
import {
  Sparkles,
  Bot,
  CheckCircle2,
  Copy,
  ArrowRight,
  RefreshCw,
  Sliders,
  AlignRight,
  Tv,
  Check,
  AlertCircle,
  FileText,
} from 'lucide-react';
import { Modal } from '../common/Modal';
import { apiFetch, ApiError } from '../../services/http';
import { sanitizeHtml } from '../../utils/sanitizeHtml';

interface AiNewsCoPilotModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentTitle: string;
  currentSummary: string;
  currentContent: string;
  onApplyChanges: (data: {
    title?: string;
    summary?: string;
    content?: string;
    shortTitle?: string;
  }) => void;
}

export const AiNewsCoPilotModal: React.FC<AiNewsCoPilotModalProps> = ({
  isOpen,
  onClose,
  currentTitle,
  currentSummary,
  currentContent,
  onApplyChanges,
}) => {
  const [activeMode, setActiveMode] = useState<
    'TV_REWRITE' | 'HEADLINES' | 'ANCHOR_LEAD' | 'PROOFREAD' | 'FACT_CHECK'
  >('TV_REWRITE');

  const [tone, setTone] = useState<'URGENT' | 'NEUTRAL_FORMAL' | 'ANALYTICAL' | 'HUMAN_INTEREST'>('NEUTRAL_FORMAL');
  const [isProcessing, setIsProcessing] = useState(false);
  const [generatedResult, setGeneratedResult] = useState<any>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [isTemplateMode, setIsTemplateMode] = useState(false);

  const cleanText = (html: string) => {
    return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').trim();
  };

  /** Offline template used only when the server has no GEMINI_API_KEY configured. */
  const buildTemplateResult = (): any => {
    const rawBody = cleanText(currentContent) || currentSummary || currentTitle || 'خبر إخباري جديد';
    const mainHeadline = currentTitle || 'قمة دولية تبحث استقرار الاقتصاد وتحديات الطاقة النظيفة';
      if (activeMode === 'TV_REWRITE') {
        const rewrittenLead = `أكدت المصادر الرسمية في مستهل التطورات المتسارعة، أن الجهود المشتركة تتجه نحو تبني حلول استراتيجية شاملة. وفي هذا السياق، أوضح المتحدثون أن المرحلة الراهنة تتطلب تعزيز التنسيق المباشر بين مختلف الأطراف الفاعلة لضمان استدامة النتائج المحققة ومواكبة متطلبات الميدان.`;
        const tvScript = `<h3>مقدمة المذيع (On-Camera Reader):</h3><p><strong>[CG_ANCHOR: استوديو الأخبار]</strong><br />مساء الخير، نبدأ جولتنا الإخبارية بهذا التطور الميداني الأبرز، حيث تتواصل التحركات الرسمية المكثفة لإنجاز الأهداف المعلنة وسط ترحيب واسع من الأوساط المعنية.</p><h3>متن التقرير المصور (Voice Over VT):</h3><p>${rawBody.slice(0, 300) || rewrittenLead}</p><p>وتشير المعطيات الميدانية إلى أن الساعات القادمة ستشهد إعلاناً رسمياً يتضمن تفاصيل الآليات التنفيذية والجداول الزمنية المعتمدة.</p>`;

        return ({
          type: 'TV_REWRITE',
          title: `تطورات حاسمة: ${mainHeadline.slice(0, 60)}`,
          summary: `متابعة إخبارية حية لأبرز مخرجات التنسيق المشترك والقرارات الاستراتيجية المرتقبة.`,
          content: tvScript,
        });
      } else if (activeMode === 'HEADLINES') {
        return ({
          type: 'HEADLINES',
          headlines: [
            {
              title: `عاجل: ${mainHeadline.slice(0, 50)}`,
              type: 'عاجل ومكثف',
              strap: 'تطورات متسارعة وقرارات حاسمة في الميدان',
            },
            {
              title: `اتفاق استراتيجي جديد يعيد رسم المشهد في الملفات الحيوية`,
              type: 'رسمي متزن',
              strap: 'إشادة دولية واسعة بالمخرجات المعلنة',
            },
            {
              title: `ما وراء التطورات: قراءة في الأبعاد الاقتصادية والسياسية للحدث`,
              type: 'تحليلي معمق',
              strap: 'خبراء يؤكدون أهمية المرحلة المقبلة',
            },
          ],
        });
      } else if (activeMode === 'ANCHOR_LEAD') {
        return ({
          type: 'ANCHOR_LEAD',
          lead1: `أهلاً بكم، نبدأ نشرتنا من هذا الملف البارز؛ حيث أعلنت الجهات المعنية قبل قليل حزمة من الإجراءات المشتركة، واصفة الخطوة بأنها محطة مفصلية في مسار العمل المستمر. التفاصيل في سياق هذا التقرير:`,
          lead2: `في متابعتنا المباشرة، تتصدر هذه التطورات المشهد الإخباري اليوم، مع ترقب واسع لما ستسفر عنه الاجتماعات المنعقدة حالياً لتحديد الخطوات التنفيذية المقبلة.`,
        });
      } else if (activeMode === 'PROOFREAD') {
        return ({
          type: 'PROOFREAD',
          correctionsCount: 3,
          notes: [
            'تم ضبط صياغة الأفعال للمبني للمعلوم لتعزيز الرشاقة الصحفية التلفزيونية.',
            'تم استبدال الكلمات التقريرية الطويلة بمفردات مسموعة واضحة وسريعة النطق.',
            'تم التحقق من مطابقة الأرقام والنسب وفق الدليل الأسلوبي المعتمد.',
          ],
          polishedContent: `<p>${rawBody || 'النص بعد التدقيق الصياغي واللغوي المعتمد وفق المعايير المهنية لغرفة الأخبار.'}</p>`,
        });
      }

    return null;
  };

  const handleGenerate = async () => {
    setIsProcessing(true);
    setGeneratedResult(null);
    setAiError(null);
    setIsTemplateMode(false);
    try {
      const res = await apiFetch<{ data: any }>('/api/v1/ai/copilot', {
        method: 'POST',
        json: { mode: activeMode, tone, title: currentTitle, summary: currentSummary, content: currentContent },
      });
      setGeneratedResult(res.data);
    } catch (err: any) {
      if (err instanceof ApiError && err.code === 'AI_NOT_CONFIGURED') {
        setIsTemplateMode(true);
        setGeneratedResult(buildTemplateResult());
      } else {
        setAiError(err?.message || 'تعذر الاتصال بالمساعد الذكي');
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="المساعد التحريري الذكي لغرفة الأخبار (AI Newsroom Co-Pilot)"
      maxWidth="xl"
    >
      <div className="space-y-5 text-right">
        {/* Modes Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-slate-100 p-1.5 rounded-xl border border-slate-200">
          <button
            type="button"
            onClick={() => {
              setActiveMode('TV_REWRITE');
              setGeneratedResult(null);
            }}
            className={`flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-lg text-xs font-bold transition-all ${
              activeMode === 'TV_REWRITE'
                ? 'bg-white text-blue-600 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Tv className="w-3.5 h-3.5" />
            الصياغة التلفزيونية
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveMode('HEADLINES');
              setGeneratedResult(null);
            }}
            className={`flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-lg text-xs font-bold transition-all ${
              activeMode === 'HEADLINES'
                ? 'bg-white text-blue-600 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            توليد العناوين والشارات
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveMode('ANCHOR_LEAD');
              setGeneratedResult(null);
            }}
            className={`flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-lg text-xs font-bold transition-all ${
              activeMode === 'ANCHOR_LEAD'
                ? 'bg-white text-blue-600 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Bot className="w-3.5 h-3.5 text-purple-500" />
            مقدمة المذيع (Lead)
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveMode('PROOFREAD');
              setGeneratedResult(null);
            }}
            className={`flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-lg text-xs font-bold transition-all ${
              activeMode === 'PROOFREAD'
                ? 'bg-white text-blue-600 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
            التدقيق الأسلوبي
          </button>
        </div>

        {/* Action Trigger Box */}
        <div className="bg-slate-50 border border-slate-200 p-4 rounded-xl flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 text-blue-700 rounded-lg">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <strong className="text-xs text-slate-800 font-bold block">
                تحليل وتوليد المحتوى الصحفي والتلفزيوني الذكي
              </strong>
              <span className="text-[11px] text-slate-500">
                يعتمد على معايير الدليل التحريري وأسلوب الإلقاء التلفزيوني السلس
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="ai-tone-select" className="text-xs font-bold text-slate-700 sr-only">
              نبرة التحرير
            </label>
            <select
              id="ai-tone-select"
              value={tone}
              onChange={(e) => setTone(e.target.value as any)}
              className="px-3.5 py-2 border border-slate-300 rounded-xl text-xs bg-white text-slate-800 font-semibold focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
            >
              <option value="NEUTRAL_FORMAL">أسلوب إخباري رصين</option>
              <option value="URGENT">تغطية عاجلة وميدانية</option>
              <option value="ANALYTICAL">قراءة تحليلية معمقة</option>
              <option value="HUMAN_INTEREST">قصة إنسانية مشوقة</option>
            </select>

            <button
              type="button"
              onClick={handleGenerate}
              disabled={isProcessing}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-all shadow-xs"
            >
              {isProcessing ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  جاري المعالجة...
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                  توليد المقترحات
                </>
              )}
            </button>
          </div>
        </div>

        {/* Results Area */}
        {aiError && (
          <div role="alert" className="flex items-start gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 font-semibold">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{aiError}</span>
          </div>
        )}

        {generatedResult && isTemplateMode && (
          <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 font-semibold">
            وضع القوالب: خدمة الذكاء الاصطناعي غير مفعّلة على الخادم، والنص أدناه قالب تحريري ثابت وليس صياغة آلية للخبر.
          </div>
        )}

        {generatedResult && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
            {generatedResult.type === 'TV_REWRITE' && (
              <div className="space-y-3 bg-white border border-slate-200 p-4 rounded-xl shadow-2xs">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <Tv className="w-4 h-4 text-blue-600" />
                    المسودة التلفزيونية المقترحة (VT + Reader Script)
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      onApplyChanges({
                        title: generatedResult.title,
                        summary: generatedResult.summary,
                        content: generatedResult.content,
                      });
                      onClose();
                    }}
                    className="flex items-center gap-1 px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-colors shadow-xs"
                  >
                    <Check className="w-3.5 h-3.5" />
                    اعتماد واستبدال بالمحرر
                  </button>
                </div>

                <div>
                  <span className="text-[11px] text-slate-400 font-bold block">العنوان المقترح:</span>
                  <div className="text-xs font-bold text-slate-800 bg-slate-50 p-2 rounded-lg border border-slate-200 mt-1">
                    {generatedResult.title}
                  </div>
                </div>

                <div>
                  <span className="text-[11px] text-slate-400 font-bold block">مقدمة المذيع / الملخص:</span>
                  <div className="text-xs text-slate-700 bg-slate-50 p-2 rounded-lg border border-slate-200 mt-1 leading-relaxed">
                    {generatedResult.summary}
                  </div>
                </div>

                <div>
                  <span className="text-[11px] text-slate-400 font-bold block">متن التقرير التلفزيوني:</span>
                  <div
                    className="text-xs text-slate-700 bg-slate-50 p-3 rounded-lg border border-slate-200 mt-1 leading-relaxed space-y-2"
                    dangerouslySetInnerHTML={{ __html: sanitizeHtml(generatedResult.content) }}
                  />
                </div>
              </div>
            )}

            {generatedResult.type === 'HEADLINES' && (
              <div className="space-y-3">
                <span className="text-xs font-bold text-slate-700 block">
                  خيارات العناوين المقترحة للشاشة والموقع:
                </span>
                <div className="grid grid-cols-1 gap-2.5">
                  {generatedResult.headlines.map((hl: any, idx: number) => (
                    <div
                      key={idx}
                      className="p-3 bg-white border border-slate-200 rounded-xl hover:border-blue-300 transition-all flex items-center justify-between gap-3 shadow-2xs"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 text-[10px] font-bold rounded">
                            {hl.type}
                          </span>
                          <strong className="text-xs text-slate-800 font-bold">{hl.title}</strong>
                        </div>
                        <p className="text-[11px] text-slate-500">{hl.strap}</p>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleCopy(hl.title, `hl-${idx}`)}
                          className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500"
                          title="نسخ العنوان"
                        >
                          {copiedKey === `hl-${idx}` ? (
                            <Check className="w-3.5 h-3.5 text-emerald-600" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            onApplyChanges({ title: hl.title, shortTitle: hl.title });
                            onClose();
                          }}
                          className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold rounded-lg text-xs"
                        >
                          استخدام
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {generatedResult.type === 'ANCHOR_LEAD' && (
              <div className="space-y-3">
                <span className="text-xs font-bold text-slate-700 block">
                  صيغ مقترحة لمقدمة المذيع على الهواء:
                </span>
                <div className="space-y-2">
                  <div className="p-3.5 bg-white border border-slate-200 rounded-xl space-y-2 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-purple-700">الصيغة المباشرة (Direct Lead):</span>
                      <button
                        type="button"
                        onClick={() => {
                          onApplyChanges({ summary: generatedResult.lead1 });
                          onClose();
                        }}
                        className="px-2.5 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-bold"
                      >
                        اعتماد كملخص
                      </button>
                    </div>
                    <p className="text-xs text-slate-700 leading-relaxed">{generatedResult.lead1}</p>
                  </div>

                  <div className="p-3.5 bg-white border border-slate-200 rounded-xl space-y-2 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-blue-700">الصيغة التفاعلية (Engaging Lead):</span>
                      <button
                        type="button"
                        onClick={() => {
                          onApplyChanges({ summary: generatedResult.lead2 });
                          onClose();
                        }}
                        className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold"
                      >
                        اعتماد كملخص
                      </button>
                    </div>
                    <p className="text-xs text-slate-700 leading-relaxed">{generatedResult.lead2}</p>
                  </div>
                </div>
              </div>
            )}

            {generatedResult.type === 'PROOFREAD' && (
              <div className="space-y-3 bg-emerald-50/50 border border-emerald-200 p-4 rounded-xl">
                <div className="flex items-center justify-between border-b border-emerald-200/60 pb-2">
                  <span className="text-xs font-bold text-emerald-900 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    تقرير التدقيق والتصويب الأسلوبي
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      onApplyChanges({ content: generatedResult.polishedContent });
                      onClose();
                    }}
                    className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold"
                  >
                    تطبيق النص المصوب
                  </button>
                </div>

                <ul className="space-y-1 text-xs text-emerald-800">
                  {generatedResult.notes.map((note: string, idx: number) => (
                    <li key={idx} className="flex items-start gap-1.5">
                      <span className="text-emerald-600 font-bold">•</span>
                      <span>{note}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
};
