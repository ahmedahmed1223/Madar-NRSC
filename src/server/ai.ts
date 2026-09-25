import { GoogleGenAI } from '@google/genai';
import type { AppConfig } from './config';

export const COPILOT_MODES = ['TV_REWRITE', 'HEADLINES', 'ANCHOR_LEAD', 'PROOFREAD'] as const;
export type CopilotMode = (typeof COPILOT_MODES)[number];

const TONES: Record<string, string> = {
  URGENT: 'عاجل ومكثف',
  NEUTRAL_FORMAL: 'رسمي محايد',
  ANALYTICAL: 'تحليلي معمق',
  HUMAN_INTEREST: 'إنساني قريب من المشاهد',
};

const MAX_INPUT_CHARS = 12000;

const escapeHtml = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const paragraphs = (items: unknown) =>
  (Array.isArray(items) ? items : [items])
    .map((p) => String(p ?? '').trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join('');

const PROMPTS: Record<CopilotMode, string> = {
  TV_REWRITE:
    'أعد صياغة الخبر كنص تلفزيوني. أعد JSON بالحقول: title (عنوان لا يتجاوز 90 حرفاً), summary (جملة واحدة), anchorIntro (مقدمة المذيع على الكاميرا), voiceOver (مصفوفة فقرات نص التقرير المصور).',
  HEADLINES:
    'اقترح ثلاثة عناوين بديلة. أعد JSON بالحقل headlines: مصفوفة من ثلاثة عناصر لكل منها title و type (وصف قصير للأسلوب) و strap (سطر فرعي قصير).',
  ANCHOR_LEAD: 'اكتب مقدمتين بديلتين يقرأهما المذيع قبل التقرير. أعد JSON بالحقلين lead1 و lead2.',
  PROOFREAD:
    'دقق النص لغوياً وأسلوبياً دون تغيير الحقائق. أعد JSON بالحقول: notes (مصفوفة ملاحظات التصحيح), paragraphs (مصفوفة فقرات النص المصحح).',
};

export interface CopilotInput {
  mode: CopilotMode;
  tone?: string;
  title?: string;
  summary?: string;
  content?: string;
}

function stripHtml(html: string) {
  return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

export function isAiConfigured(config: AppConfig) {
  return !!config.gemini.apiKey;
}

let client: GoogleGenAI | null = null;

/**
 * Calls Gemini and converts the model's JSON into the shapes the editor modal renders.
 * All model text is HTML-escaped here so it is safe to inject into the page.
 */
export async function runCopilot(config: AppConfig, input: CopilotInput) {
  if (!config.gemini.apiKey) throw new Error('AI_NOT_CONFIGURED');
  client ??= new GoogleGenAI({ apiKey: config.gemini.apiKey });

  const body = stripHtml(input.content || '').slice(0, MAX_INPUT_CHARS);
  const prompt = [
    PROMPTS[input.mode],
    `النبرة المطلوبة: ${TONES[input.tone || ''] || TONES.NEUTRAL_FORMAL}.`,
    'اكتب بالعربية الفصحى وبأسلوب غرف الأخبار التلفزيونية. لا تخترع حقائق أو أرقاماً غير موجودة في النص.',
    '--- الخبر ---',
    `العنوان: ${(input.title || '').slice(0, 500)}`,
    `الملخص: ${(input.summary || '').slice(0, 2000)}`,
    `المتن: ${body}`,
  ].join('\n');

  const response = await client.models.generateContent({
    model: config.gemini.model,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      temperature: 0.6,
      systemInstruction: 'أنت محرر أول في غرفة أخبار تلفزيونية عربية. أجب دائماً بكائن JSON صالح فقط.',
    },
  });

  let data: any;
  try {
    data = JSON.parse(response.text || '{}');
  } catch {
    throw new Error('AI_BAD_RESPONSE');
  }

  switch (input.mode) {
    case 'TV_REWRITE':
      return {
        type: 'TV_REWRITE',
        title: String(data.title || input.title || '').slice(0, 200),
        summary: String(data.summary || ''),
        content:
          `<h3>مقدمة المذيع (On-Camera Reader):</h3>${paragraphs(data.anchorIntro)}` +
          `<h3>متن التقرير المصور (Voice Over VT):</h3>${paragraphs(data.voiceOver)}`,
      };
    case 'HEADLINES':
      return {
        type: 'HEADLINES',
        headlines: (Array.isArray(data.headlines) ? data.headlines : []).slice(0, 5).map((h: any) => ({
          title: String(h?.title || ''),
          type: String(h?.type || ''),
          strap: String(h?.strap || ''),
        })),
      };
    case 'ANCHOR_LEAD':
      return { type: 'ANCHOR_LEAD', lead1: String(data.lead1 || ''), lead2: String(data.lead2 || '') };
    case 'PROOFREAD': {
      const notes = (Array.isArray(data.notes) ? data.notes : []).map((n: unknown) => String(n));
      return { type: 'PROOFREAD', correctionsCount: notes.length, notes, polishedContent: paragraphs(data.paragraphs) };
    }
  }
}
