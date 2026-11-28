import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestServer } from '../helpers';

let server: Awaited<ReturnType<typeof createTestServer>>;

beforeAll(async () => {
  server = await createTestServer();
});
afterAll(() => server.close());

function queryPlan(sql: string, ...params: unknown[]): string {
  const sqlite = (server.db as any).db;
  const rows = sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as { detail: string }[];
  return rows.map((row) => row.detail).join('\n');
}

describe('indexed SQL queries (v12)', () => {
  it('uses idx_bookings_resource_window for resource booking lookups', () => {
    const plan = queryPlan(
      `SELECT * FROM entities INDEXED BY idx_bookings_resource_window WHERE collection = 'bookings' AND deleted = 0 AND json_extract(data, '$.resourceId') = ?`,
      'res-studio-1',
    );
    expect(plan).toContain('USING INDEX idx_bookings_resource_window');
  });

  it('uses idx_entities_category_id, idx_entities_source_id, and idx_entities_program_type_id for foreign-key lookups', () => {
    const newsCategoryPlan = queryPlan(
      `SELECT * FROM entities INDEXED BY idx_entities_category_id WHERE collection IN ('news', 'stories') AND collection = ? AND deleted = 0 AND json_extract(data, '$.categoryId') = ?`,
      'news',
      'cat-1',
    );
    const storiesCategoryPlan = queryPlan(
      `SELECT * FROM entities INDEXED BY idx_entities_category_id WHERE collection IN ('news', 'stories') AND collection = ? AND deleted = 0 AND json_extract(data, '$.categoryId') = ?`,
      'stories',
      'cat-1',
    );
    const newsSourcePlan = queryPlan(
      `SELECT * FROM entities INDEXED BY idx_entities_source_id WHERE collection IN ('news', 'wires') AND collection = ? AND deleted = 0 AND json_extract(data, '$.sourceId') = ?`,
      'news',
      'src-1',
    );
    const wiresSourcePlan = queryPlan(
      `SELECT * FROM entities INDEXED BY idx_entities_source_id WHERE collection IN ('news', 'wires') AND collection = ? AND deleted = 0 AND json_extract(data, '$.sourceId') = ?`,
      'wires',
      'src-1',
    );
    const programTypePlan = queryPlan(
      `SELECT * FROM entities INDEXED BY idx_entities_program_type_id WHERE collection = 'programs' AND collection = ? AND deleted = 0 AND json_extract(data, '$.typeId') = ?`,
      'programs',
      'ptype-1',
    );

    expect(newsCategoryPlan).toContain('USING INDEX idx_entities_category_id');
    expect(storiesCategoryPlan).toContain('USING INDEX idx_entities_category_id');
    expect(newsSourcePlan).toContain('USING INDEX idx_entities_source_id');
    expect(wiresSourcePlan).toContain('USING INDEX idx_entities_source_id');
    expect(programTypePlan).toContain('USING INDEX idx_entities_program_type_id');
  });

  it('returns only live matching rows from listBookingsForResource and listByJsonField', () => {
    const now = new Date().toISOString();
    server.db.writeRow('bookings', 'bkg-idx-1', { id: 'bkg-idx-1', resourceId: 'res-idx-a', title: 'أ', start: now, end: now, status: 'CONFIRMED' }, 1, null);
    server.db.writeRow('bookings', 'bkg-idx-2', { id: 'bkg-idx-2', resourceId: 'res-idx-b', title: 'ب', start: now, end: now, status: 'CONFIRMED' }, 2, null);
    const later = new Date(Date.now() + 3600000).toISOString();
    server.db.writeRow('bookings', 'bkg-idx-leading', { id: 'bkg-idx-leading', resourceId: 'res-idx-a', title: 'أولوية', start: later, end: later, status: 'CONFIRMED' }, 0, null);
    server.db.writeRow('bookings', 'bkg-idx-del', { id: 'bkg-idx-del', resourceId: 'res-idx-a', title: 'محذوف', start: now, end: now, status: 'CONFIRMED' }, 3, null);
    server.db.deleteRow('bookings', 'bkg-idx-del', null);

    expect(server.db.listBookingsForResource('res-idx-a').map((r) => r.id)).toEqual(['bkg-idx-leading', 'bkg-idx-1']);
    expect(server.db.listBookingsForResource('res-idx-b').map((r) => r.id)).toEqual(['bkg-idx-2']);

    server.db.writeRow('news', 'nws-idx-1', { id: 'nws-idx-1', title: 'خبر', categoryId: 'cat-idx-x', sourceId: 'src-idx-y' }, 10, null);
    server.db.writeRow('news', 'nws-idx-2', { id: 'nws-idx-2', title: 'خبر 2', categoryId: 'cat-idx-other', sourceId: 'src-idx-other' }, 11, null);
    expect(server.db.listByJsonField('news', 'categoryId', 'cat-idx-x').map((r) => r.id)).toEqual(['nws-idx-1']);
    expect(server.db.listByJsonField('news', 'sourceId', 'src-idx-y').map((r) => r.id)).toEqual(['nws-idx-1']);

    expect(() => server.db.listByJsonField('news', 'title' as any, 'x')).toThrow(/Unsupported indexed JSON field/);
  });
});
