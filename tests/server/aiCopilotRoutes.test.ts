import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createTestServer, loginAgent } from '../helpers';

let server: Awaited<ReturnType<typeof createTestServer>>;
let producer: request.Agent;
let viewer: request.Agent;
let editor: request.Agent;
const headers = { 'X-NRCS-Client': 'web' };
const copilot = '/api/v1/ai/copilot';

beforeAll(async () => {
  server = await createTestServer({ OPENAI_API_KEY: 'test-provider-key', OPENAI_MODEL: 'configured-test-model', AI_DAILY_REQUESTS_BY_ROLE: '{"EDITOR":1}' });
  producer = await loginAgent(server.app, 'producer@akhbar.tv');
  viewer = await loginAgent(server.app, 'trainee@akhbar.tv');
  editor = await loginAgent(server.app, 'editor@akhbar.tv');
});

afterEach(() => vi.unstubAllGlobals());
afterAll(() => server?.close());

describe('AI copilot API', () => {
  it('keeps statuses authenticated and exposes only public model configuration', async () => {
    expect((await request(server.app).get('/api/v1/ai/status')).status).toBe(401);
    const response = await producer.get('/api/v1/ai/status');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual({ success: true, configured: true, model: 'configured-test-model', defaultProvider: 'openai', providers: [
      { id: 'openai', model: 'configured-test-model' },
    ], budget: { limit: 120, remaining: 120, resetsAt: expect.any(String) } });
  });

  it('enforces planning access and server-controlled providers before any upstream request', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 500 }));
    vi.stubGlobal('fetch', fetch);
    const input = { mode: 'QUESTIONS', content: 'تحضير مقابلة' };
    expect((await viewer.post(copilot).set(headers).send(input)).status).toBe(403);
    expect((await producer.post(copilot).set(headers).send({ ...input, model: 'arbitrary-model' })).status).toBe(400);
    expect((await producer.post(copilot).set(headers).send({ ...input, provider: 'https://example.test' })).status).toBe(400);
    const unavailable = await producer.post(copilot).set(headers).send({ ...input, provider: 'openrouter' });
    expect(unavailable.status).toBe(503);
    expect(unavailable.body.code).toBe('AI_NOT_CONFIGURED');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns suggestions through the API using the configured default', async () => {
    const suggestions = [{ title: 'ما أثر القرار؟', reason: 'توضيح النتائج' }];
    const fetch = vi.fn(async () => Response.json({ status: 'completed', output: [
      { type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ suggestions }) }] },
    ] }));
    vi.stubGlobal('fetch', fetch);
    const response = await producer.post(copilot).set(headers).send({ mode: 'QUESTIONS', content: 'تحضير مقابلة' });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, data: { type: 'QUESTIONS', suggestions }, budget: { limit: 120, remaining: 119, resetsAt: expect.any(String) } });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('returns a sanitized 502 when a provider supplies an unusable editor result', async () => {
    const fetch = vi.fn(async () => Response.json({ status: 'completed', output: [
      { type: 'message', content: [{ type: 'output_text', text: '{"upstreamDetail":"private diagnostic"}' }] },
    ] }));
    vi.stubGlobal('fetch', fetch);
    const response = await producer.post(copilot).set(headers).send({ mode: 'TV_REWRITE', title: 'عنوان الخبر الحالي' });
    expect(response.status).toBe(502);
    expect(response.body.code).toBe('AI_BAD_RESPONSE');
    expect(response.text).not.toContain('private diagnostic');
  });

  it('blocks sensitive requests before charging and enforces the effective role daily limit', async () => {
    const fetch = vi.fn(async () => Response.json({ status: 'completed', output: [
      { type: 'message', content: [{ type: 'output_text', text: '{"suggestions":[]}' }] },
    ] }));
    vi.stubGlobal('fetch', fetch);
    const payload = { mode: 'QUESTIONS', content: 'تحضير مقابلة' };
    const sensitive = await editor.post(copilot).set(headers).send({ ...payload, sensitive: true });
    expect(sensitive.status).toBe(400);
    expect(sensitive.body.code).toBe('AI_SENSITIVE_CONTENT');
    expect(fetch).not.toHaveBeenCalled();
    expect((await editor.get('/api/v1/ai/status')).body.budget).toMatchObject({ limit: 1, remaining: 1 });
    expect((await editor.post(copilot).set(headers).send(payload)).body.budget).toMatchObject({ limit: 1, remaining: 0 });
    const exhausted = await editor.post(copilot).set(headers).send(payload);
    expect(exhausted.status).toBe(429);
    expect(exhausted.body.code).toBe('AI_DAILY_BUDGET');
    expect(Number(exhausted.headers['retry-after'])).toBeGreaterThan(0);
    expect(fetch).toHaveBeenCalledOnce();
  });
});
