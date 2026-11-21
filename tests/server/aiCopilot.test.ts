import { afterEach, describe, expect, it, vi } from 'vitest';
import { canUseCopilot, getAiStatus, runCopilot } from '../../src/server/ai';
import { loadConfig } from '../../src/server/config';

const { geminiGenerate } = vi.hoisted(() => ({ geminiGenerate: vi.fn() }));
vi.mock('@google/genai', () => ({ GoogleGenAI: class {
  models = { generateContent: geminiGenerate };
} }));

afterEach(() => {
  vi.unstubAllGlobals();
  geminiGenerate.mockReset();
});

const config = () => loadConfig({ NODE_ENV: 'test', GEMINI_API_KEY: 'fake-gemini', OPENAI_API_KEY: 'fake-openai', OPENROUTER_API_KEY: 'fake-openrouter' });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('AI provider configuration', () => {
  it('keeps Gemini as the implicit default and returns only public provider metadata', () => {
    const status = getAiStatus(config());
    expect(status).toEqual({ configured: true, model: 'gemini-2.5-flash', defaultProvider: 'gemini', providers: [
      { id: 'gemini', model: 'gemini-2.5-flash' }, { id: 'openai', model: 'gpt-4.1-mini' }, { id: 'openrouter', model: 'openai/gpt-4.1-mini' },
    ] });
  });

  it('uses an explicitly configured default and rejects a default without a key', () => {
    expect(getAiStatus(loadConfig({ NODE_ENV: 'test', AI_DEFAULT_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'test' })).defaultProvider).toBe('openrouter');
    expect(() => loadConfig({ NODE_ENV: 'test', AI_DEFAULT_PROVIDER: 'openai' })).toThrow(/AI_DEFAULT_PROVIDER/);
    expect(getAiStatus(loadConfig({ NODE_ENV: 'test', AI_DEFAULT_PROVIDER: '', OPENAI_API_KEY: 'test' })).defaultProvider).toBe('openai');
  });

  it('keeps the unconfigured status compatible with old clients', () => {
    expect(getAiStatus(loadConfig({ NODE_ENV: 'test' }))).toEqual({ configured: false, model: 'gemini-2.5-flash', defaultProvider: null, providers: [] });
  });
});

describe('AI access', () => {
  const allows = (...permissions: string[]) => (permission: string) => permissions.includes(permission);

  it('allows episode producers and newsroom writers to plan while keeping existing copilot rules', () => {
    expect(canUseCopilot('QUESTIONS', allows('episodes.edit'))).toBe(true);
    expect(canUseCopilot('IDEAS', allows('episodes.create'))).toBe(true);
    expect(canUseCopilot('GUESTS', allows('news.edit_own'))).toBe(true);
    expect(canUseCopilot('GUESTS', allows('news.view', 'episodes.view'))).toBe(false);
    expect(canUseCopilot('BRIEF', allows('cards.work'))).toBe(true);
    expect(canUseCopilot('BRIEF', allows('news.create'))).toBe(false);
    expect(canUseCopilot('HEADLINES', allows('news.edit_own'))).toBe(true);
    expect(canUseCopilot('PROOFREAD', allows('episodes.edit'))).toBe(false);
  });
});

describe('AI provider requests', () => {
  it('keeps old unqualified requests on Gemini and escapes returned editor HTML', async () => {
    geminiGenerate.mockResolvedValue({ text: JSON.stringify({ notes: ['خطأ إملائي'], paragraphs: ['<script>اختبار</script>'] }) });
    const result = await runCopilot(config(), { mode: 'PROOFREAD', content: '<article>متن</article>' });
    expect(result).toEqual({ type: 'PROOFREAD', correctionsCount: 1, notes: ['خطأ إملائي'], polishedContent: '<p>&lt;script&gt;اختبار&lt;/script&gt;</p>' });
    expect(geminiGenerate).toHaveBeenCalledOnce();
  });

  it('bounds explicit editing instructions and excludes them from planning prompts', async () => {
    const instruction = `${'أ'.repeat(800)}مرجع خاص`;
    const content = `<p>${'ب'.repeat(12_000)}سياق زائد</p>`;
    geminiGenerate.mockResolvedValue({ text: JSON.stringify({ suggestions: [], headlines: [{ title: 'عنوان بديل' }] }) });
    await runCopilot(config(), { mode: 'HEADLINES', instruction, content });
    const editing = geminiGenerate.mock.calls[0][0].contents as string;
    expect(editing).toContain(`التوجيه التحريري: ${'أ'.repeat(800)}\n`);
    expect(editing).toContain(`المتن: ${'ب'.repeat(1600)}`);
    expect(editing).not.toContain('ب'.repeat(1601));
    expect(editing).not.toMatch(/مرجع خاص|سياق زائد|<p>/);
    await runCopilot(config(), { mode: 'QUESTIONS', instruction, title: 'موضوع التخطيط' });
    const planning = geminiGenerate.mock.calls[1][0].contents as string;
    expect(planning).toContain('موضوع التخطيط');
    expect(planning).not.toContain('التوجيه التحريري');
  });

  it('keeps the title and summary outside proofreading and excludes body text from summarized headlines', async () => {
    geminiGenerate.mockResolvedValue({ text: JSON.stringify({ paragraphs: ['تصويب'], headlines: [{ title: 'عنوان بديل' }] }) });
    const source = { title: 'عنوان خاص', summary: 'ملخص خاص', content: 'متن خاص', tone: 'URGENT' };
    await runCopilot(config(), { ...source, mode: 'PROOFREAD' });
    const proofread = geminiGenerate.mock.calls[0][0].contents as string;
    expect(proofread).toContain(source.content);
    expect(proofread).not.toMatch(/عنوان خاص|ملخص خاص|عاجل ومكثف/);
    await runCopilot(config(), { ...source, mode: 'HEADLINES' });
    const headlines = geminiGenerate.mock.calls[1][0].contents as string;
    expect(headlines).toContain(source.summary);
    expect(headlines).not.toContain(source.content);
  });

  it.each(['IDEAS', 'QUESTIONS', 'GUESTS'] as const)('sends only the explicit topic and title for %s', async (mode) => {
    geminiGenerate.mockResolvedValue({ text: JSON.stringify({ suggestions: [] }) });
    const result = await runCopilot(config(), {
      mode, title: 'عنوان الموضوع', content: 'موضوع للمناقشة', summary: 'ملخص غير مخصص للتخطيط', tone: 'URGENT', instruction: 'تعليمات تحرير خاصة',
    });
    expect(result).toEqual({ type: mode, suggestions: [] });
    const prompt = geminiGenerate.mock.calls[0][0].contents as string;
    expect(prompt).toContain('عنوان الموضوع');
    expect(prompt).toContain('موضوع للمناقشة');
    expect(prompt).not.toMatch(/ملخص غير مخصص للتخطيط|النبرة المطلوبة|عاجل ومكثف|تعليمات تحرير خاصة/);
  });

  it.each([
    { mode: 'TV_REWRITE', reply: {} },
    { mode: 'TV_REWRITE', reply: { title: 'عنوان', summary: 'ملخص', anchorIntro: 'مقدمة' } },
    { mode: 'HEADLINES', reply: { headlines: [{}] } },
    { mode: 'PROOFREAD', reply: { paragraphs: [' ', {}], notes: ['ملاحظة'] } },
    { mode: 'BRIEF', reply: { brief: ' ', gaps: ['معلومة ناقصة'] } },
    { mode: 'ANCHOR_LEAD', reply: { lead2: 'مقدمة ثانية' } },
    { mode: 'IDEAS', reply: { suggestions: [{}] } },
  ] as const)('rejects an unusable $mode reply', async ({ mode, reply }) => {
    geminiGenerate.mockResolvedValue({ text: JSON.stringify(reply) });
    await expect(runCopilot(config(), { mode, title: 'عنوان الخبر الحالي', content: 'متن الخبر الحالي' })).rejects.toThrow(/^AI_BAD_RESPONSE$/);
  });

  it('returns only usable headlines from a mixed array', async () => {
    geminiGenerate.mockResolvedValue({ text: JSON.stringify({ headlines: [{ title: 'عنوان بديل' }, {}, { title: '  ' }] }) });
    const result = await runCopilot(config(), { mode: 'HEADLINES', title: 'عنوان الخبر الحالي' });
    expect(result).toEqual({ type: 'HEADLINES', headlines: [{ title: 'عنوان بديل', type: '', strap: '' }] });
  });

  it('calls OpenAI Responses with the server model and returns planning suggestions', async () => {
    const payload = JSON.stringify({ suggestions: [{ title: 'عنوان', reason: 'سبب' }] });
    const fetch = vi.fn(async () => json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: payload }] }] }));
    vi.stubGlobal('fetch', fetch);
    expect(await runCopilot(config(), { provider: 'openai', mode: 'IDEAS', title: 'مادة' })).toEqual({ type: 'IDEAS', suggestions: [{ title: 'عنوان', reason: 'سبب' }] });
    expect(fetch).toHaveBeenCalledWith('https://api.openai.com/v1/responses', expect.objectContaining({ redirect: 'error' }));
    const [, options] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(options.body))).toMatchObject({ model: 'gpt-4.1-mini', store: false });
    expect(geminiGenerate).not.toHaveBeenCalled();
  });

  it('filters contacts from guest output and adds a durable verification reminder', async () => {
    const payload = JSON.stringify({ suggestions: [
      { title: 'خبير اقتصاد عام', reason: 'تفسير الآثار' },
      { title: 'شخص خاص', reason: 'hidden@example.test' },
      { title: 'هاتف ٠٥٠-١٢٣-٤٥٦٧', reason: 'اتصل به' },
    ] });
    const fetch = vi.fn(async () => json({ choices: [{ finish_reason: 'stop', message: { content: payload } }] }));
    vi.stubGlobal('fetch', fetch);
    const result = await runCopilot(config(), { provider: 'openrouter', mode: 'GUESTS', title: 'ضيوف الاستثمار' });
    expect(result).toEqual({ type: 'GUESTS', suggestions: [{ title: 'خبير اقتصاد عام', reason: 'تفسير الآثار. اقتراح مبدئي. تحقّق من الاسم والصفة الحالية قبل التواصل.' }] });
    expect(fetch).toHaveBeenCalledWith('https://openrouter.ai/api/v1/chat/completions', expect.objectContaining({ redirect: 'error' }));
    const [, options] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(options.body))).toMatchObject({ model: 'openai/gpt-4.1-mini', provider: { allow_fallbacks: false, require_parameters: true } });
  });

  it('fails an explicitly selected provider without falling back or returning upstream error bodies', async () => {
    const fetch = vi.fn(async () => json({ error: 'sensitive example upstream message' }, 429));
    vi.stubGlobal('fetch', fetch);
    await expect(runCopilot(config(), { provider: 'openai', mode: 'QUESTIONS' })).rejects.toThrow(/^AI_UPSTREAM_ERROR$/);
    await expect(runCopilot(loadConfig({ NODE_ENV: 'test', GEMINI_API_KEY: 'fake-gemini' }), { provider: 'openrouter', mode: 'QUESTIONS' })).rejects.toThrow(/^AI_NOT_CONFIGURED$/);
    expect(fetch).toHaveBeenCalledOnce();
    expect(geminiGenerate).not.toHaveBeenCalled();
  });
});
