import { plainText } from './newsWorkflow';
import { wordDiff } from './textDiff';

export type AiReviewMode = 'TV_REWRITE' | 'PROOFREAD' | 'HEADLINES' | 'ANCHOR_LEAD' | 'IDEAS' | 'QUESTIONS' | 'GUESTS';
export type AiProviderId = 'gemini' | 'openai' | 'openrouter';
export type AiEditorPatch = { title?: string; shortTitle?: string; summary?: string; content?: string };

interface RequestInput extends AiEditorPatch {
  mode: AiReviewMode;
  provider: AiProviderId | '';
  localOnly: boolean;
  tone?: string;
  instruction?: string;
}

/** Only the selected operation's disclosure fields become eligible to leave the browser. */
export function buildCopilotRequest(input: RequestInput) {
  const { mode, provider, localOnly, tone } = input;
  if (!provider || localOnly) return null;
  const title = (input.title || '').trim().slice(0, 500);
  const content = plainText(input.content || '').slice(0, 12_000);
  const basic = { mode, provider };
  if (mode === 'IDEAS' || mode === 'QUESTIONS' || mode === 'GUESTS') return { ...basic, title, content };

  const instruction = (input.instruction || '').trim().slice(0, 800);
  const edit = { ...basic, ...(instruction ? { instruction } : {}) };
  if (mode === 'PROOFREAD') return { ...edit, content };

  const summary = plainText(input.summary || '').slice(0, 2000);
  const context = { ...edit, title, ...(tone ? { tone } : {}) };
  if (mode === 'TV_REWRITE') return { ...context, summary, content };
  return summary ? { ...context, summary } : { ...context, content: content.slice(0, 1600) };
}

const FIELDS = ['title', 'shortTitle', 'summary', 'content'] as const;
export function copilotTextChanges(before: AiEditorPatch, patch: AiEditorPatch) {
  return FIELDS.flatMap(field => {
    if (!patch[field]) return [];
    const original = field === 'content' ? plainText(before[field] || '') : before[field] || '';
    const proposed = field === 'content' ? plainText(patch[field]) : patch[field];
    const runs = wordDiff(original, proposed);
    return runs.some(run => run.kind !== 'same') ? [{ field, runs }] : [];
  });
}
