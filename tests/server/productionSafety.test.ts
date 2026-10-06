import { afterEach, beforeEach, expect, it } from 'vitest';
import request from 'supertest';
import { createTestServer, loginAgent } from '../helpers';

let server: Awaited<ReturnType<typeof createTestServer>>;
beforeEach(async () => { server = await createTestServer({ RATE_LIMIT_PER_MINUTE: '10' }); });
afterEach(() => server.close());

it('health checks remain available after the network quota is exhausted', async () => {
  for (let i = 0; i < 12; i++) await request(server.app).get('/api/v1/auth/me');
  expect((await request(server.app).get('/api/health')).status).toBe(200);
  expect((await request(server.app).get('/api/ready')).status).toBe(200);
});

it('colleagues behind one IP have independent authenticated quotas', async () => {
  const editor = await loginAgent(server.app, 'editor@akhbar.tv');
  const producer = await loginAgent(server.app, 'producer@akhbar.tv');
  for (let i = 0; i < 10; i++) await editor.get('/api/v1/auth/me');
  expect((await editor.get('/api/v1/auth/me')).status).toBe(429);
  expect((await producer.get('/api/v1/auth/me')).status).toBe(200);
});

it('draining disables readiness and rejects new writes without touching data', async () => {
  const editor = await loginAgent(server.app, 'editor@akhbar.tv');
  server.app.locals.beginShutdown();
  expect((await request(server.app).get('/api/ready')).status).toBe(503);
  expect((await request(server.app).get('/api/health')).status).toBe(200);
  expect((await editor.post('/api/v1/data/sync').set('X-NRCS-Client', 'web').send({ ops: [] })).status).toBe(503);
});
