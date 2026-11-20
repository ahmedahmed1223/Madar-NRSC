import request from 'supertest';
import { expect, it } from 'vitest';
import { createTestServer, DEMO_PASSWORD, listen } from '../helpers';
import { DEFAULT_STATIONS } from '../../src/shared/stations';

it('coordinates 36 signed-in employees across four stations without losing assignments or leaking alerts', async () => {
  // Use configured defaults instead of the test helper's relaxed limits.
  const server = await createTestServer({ LOGIN_RATE_LIMIT_PER_15MIN: '', RATE_LIMIT_PER_MINUTE: '' });
  const { db } = server;
  const stations = [...DEFAULT_STATIONS, { id: 'amman', name: 'عمّان' }];
  const employees = Array.from({ length: 36 }, (_, index) => ({
    id: `scale-user-${index}`,
    email: `scale-user-${index}@example.test`,
    fullName: `موظف تجريبي ${index + 1}`,
    stationId: stations[index % stations.length].id,
  }));
  db.transaction(() => {
    const settings = db.getRow('settings', 'singleton')!;
    db.writeRow('settings', settings.id, { ...settings.d, stations }, settings.p, null);
    const reporter = db.getRow('users', 'usr-6')!.d;
    const hash = db.getCredentials('usr-6')!.passwordHash;
    employees.forEach((employee, i) => {
      db.writeRow('users', employee.id, { ...reporter, ...employee }, 100 + i, null);
      db.setPassword(employee.id, employee.email, hash, false);
    });
  });
  const http = await listen(server.app);
  const headers = { 'X-NRCS-Client': 'web' };
  const login = async (email: string) => {
    const agent = request.agent(http.baseUrl);
    const response = await agent.post('/api/v1/auth/login').set(headers).send({ email, password: DEMO_PASSWORD });
    expect(response.status).toBe(200);
    return agent;
  };
  const sync = (agent: ReturnType<typeof request.agent>, ops: unknown[]) => agent.post('/api/v1/data/sync').set(headers).send({ ops });
  const timings: Record<string, number> = {};
  const measure = async <T>(label: string, work: Promise<T>[]) => {
    const start = performance.now();
    const result = await Promise.all(work);
    timings[label] = Math.round(performance.now() - start);
    return result;
  };

  try {
    const manager = await login('admin@akhbar.tv');
    const agents = await measure('signIn', employees.map(employee => login(employee.email)));
    const boot = await measure('bootstrap', agents.map(agent => agent.get('/api/v1/data').then(response => {
      expect(response.status).toBe(200);
      return response.body.rev as number;
    })));
    const cards = employees.map((employee, i) => {
      const id = `crd-scale-${i}`;
      return {
        id, title: `تغطية متعددة المحطات ${i + 1}`, kind: 'REPORT', priority: 'URGENT', status: 'OPEN',
        steps: [
          { id: `${id}-gather`, type: 'gather', status: 'TODO', complexity: 1, assigneeId: employee.id },
          { id: `${id}-verify`, type: 'verify', status: 'TODO', complexity: 1, assigneeId: employees[(i + 1) % employees.length].id },
        ],
        log: [],
      };
    });
    const op = (card: { id: string }, baseV?: number) => ({ c: 'productionCards', op: 'upsert', id: card.id, d: card, baseV });
    const [created] = await measure('createAssignments', [sync(manager, cards.map(card => op(card)))]);
    expect(created.status).toBe(200);
    expect(created.body.results).toHaveLength(cards.length);
    expect(created.body.results.every((result: any) => result.ok)).toBe(true);

    const checkAlerts = async (label: string, since: number[], expected: (i: number) => string) =>
      measure(label, agents.map((agent, i) => agent.get('/api/v1/data/changes').query({ since: since[i] }).then(response => {
        expect(response.status).toBe(200);
        expect(response.body.reset).toBe(false);
        const alerts = response.body.changes.filter((row: any) => row.c === 'notifications' && row.d?.linkUrl?.startsWith('/cards/crd-scale-'));
        expect(alerts.map((row: any) => row.d.userId)).toEqual(alerts.map(() => employees[i].id));
        expect(alerts.some((row: any) => row.d.linkUrl === `/cards/${expected(i)}`)).toBe(true);
        return response.body.rev as number;
      })));
    const assigned = await checkAlerts('assignedAlerts', boot, i => cards[i].id);
    const finish = async (label: string, step: number, indexFor: (i: number) => number) => {
      await measure(label, agents.map((agent, i) => {
        const row = db.getRow('productionCards', cards[indexFor(i)].id)!;
        const steps = row.d.steps.map((item: any, index: number) => index === step
          ? { ...item, status: 'DONE', spentMinutes: 5, note: 'تم التسليم للمحطة التالية' } : item);
        return sync(agent, [op({ ...row.d, steps }, row.v)]).then(response => {
          expect(response.status).toBe(200);
          expect(response.body.results[0]).toMatchObject({ ok: true });
        });
      }));
    };
    const preceding = (i: number) => (i + employees.length - 1) % employees.length;
    await finish('firstDelivery', 0, i => i);
    await checkAlerts('handoffAlerts', assigned, i => cards[preceding(i)].id);
    await finish('secondDelivery', 1, preceding);

    const final = await manager.get('/api/v1/data');
    expect(final.status).toBe(200);
    const confirmed = final.body.collections.productionCards.filter((row: any) => row.id.startsWith('crd-scale-'));
    expect(confirmed).toHaveLength(36);
    expect(confirmed.every((row: any) => row.d.steps.every((step: any) => step.status === 'DONE' && step.doneAt))).toBe(true);
    expect(new Set(confirmed.map((row: any) => row.d.steps[0].stationId))).toEqual(new Set(stations.map(station => station.id)));
    expect(confirmed.every((row: any) => row.d.steps[0].stationId !== row.d.steps[1].stationId)).toBe(true);
    console.info('multi-station batch milliseconds', timings);
  } finally {
    await http.close();
    server.close();
  }
}, 60_000);
