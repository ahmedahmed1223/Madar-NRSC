import { parseQuery } from '../shared/arabicSearch';
import { SETTLED_NEWS_STATUSES } from '../shared/collections';
import { archiveTerms, prepareArchiveText, rankArchiveText } from './archiveIndex';
import { ARCHIVE_FILTER } from './dbMigrations';
import type { PostgresDatabase } from './postgres/driver';

const PAGE_SIZE = 128;

export function updatePostgresArchiveEntry(db: PostgresDatabase, id: string, data?: unknown) {
  const item = data as { status?: string; deletedAt?: string } | undefined;
  if (!item || item.deletedAt || !SETTLED_NEWS_STATUSES.some(status => status === item.status)) {
    db.prepare('DELETE FROM news_archive_index WHERE id = ?').run(id);
    return;
  }
  const prepared = prepareArchiveText(JSON.stringify(item));
  db.prepare(`INSERT INTO news_archive_index (id, prepared, terms) VALUES (?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET prepared = excluded.prepared, terms = excluded.terms`).run(id, prepared, archiveTerms(prepared));
}

export function rebuildPostgresArchive(db: PostgresDatabase) {
  db.prepare('DELETE FROM news_archive_index').run();
  let previous = '';
  for (;;) {
    const rows = db.prepare(`SELECT id, data FROM entities WHERE ${ARCHIVE_FILTER} AND id > ? ORDER BY id LIMIT ${PAGE_SIZE}`)
      .all(previous) as { id: string; data: string }[];
    if (!rows.length) return;
    const values = rows.flatMap(({ id, data }) => {
      const prepared = prepareArchiveText(data);
      return [id, prepared, archiveTerms(prepared)];
    });
    db.prepare(`INSERT INTO news_archive_index (id, prepared, terms) VALUES ${rows.map(() => '(?, ?, ?)').join(', ')}`).run(...values);
    previous = rows[rows.length - 1].id;
  }
}

function candidateClauses(query: string, parameters: Record<string, unknown>) {
  const parsed = parseQuery(query);
  const candidates = [...parsed.phrases.map(phrase => [phrase]), ...parsed.terms.map((term, i) => [term, ...parsed.candidates[i]])];
  return candidates.filter(group => group.every(term => [...term].length >= 3)).map((group, index) => {
    const alternatives = group.map((term, i) => {
      const name = `phrase_${index}_${i}`;
      parameters[name] = `%${term.replace(/[\\%_]/g, '\\$&')}%`;
      return `a.terms LIKE @${name} ESCAPE '\\'`;
    });
    return `AND (${alternatives.join(' OR ')})`;
  }).join(' ');
}

interface RankedNews { id: string; updatedAt: string; score: number }

const binaryOrder = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b));

export function rankPostgresArchive(db: PostgresDatabase, query: string, scope: string,
  parameters: Record<string, unknown>, limit: number, offset: number) {
  const candidateSql = candidateClauses(query, parameters);
  let cursor: { at: string; id: string } | undefined;
  let total = 0;
  let best: RankedNews[] = [];
  for (;;) {
    const after = cursor ? 'AND (e.updated_at, e.id) < (@cursorAt, @cursorId)' : '';
    const rows = db.prepare(`SELECT e.id, e.updated_at, a.prepared FROM news_archive_index AS a
      JOIN entities AS e ON e.collection = 'news' AND e.id = a.id
      WHERE e.updated_at < @before ${scope} ${candidateSql} ${after}
      ORDER BY e.updated_at DESC, e.id DESC LIMIT ${PAGE_SIZE}`)
      .all({ ...parameters, cursorAt: cursor?.at, cursorId: cursor?.id }) as { id: string; updated_at: string; prepared: Uint8Array }[];
    if (!rows.length) break;
    for (const { id, updated_at, prepared } of rows) {
      const score = rankArchiveText(query, Buffer.from(prepared));
      if (score === null) continue;
      total++;
      best.push({ id, updatedAt: updated_at, score });
    }
    best = best.sort((a, b) => b.score - a.score || binaryOrder(b.updatedAt, a.updatedAt) || binaryOrder(a.id, b.id))
      .slice(0, offset + limit);
    const last = rows[rows.length - 1];
    cursor = { at: last.updated_at, id: last.id };
  }
  const page = best.slice(offset);
  if (!page.length) return { total, items: [] };
  const ids = page.map(entry => entry.id);
  const data = db.prepare(`SELECT id, data FROM entities WHERE collection = 'news' AND id IN (${ids.map(() => '?').join(', ')})`)
    .all(...ids) as { id: string; data: string }[];
  const byId = new Map(data.map(row => [row.id, JSON.parse(row.data)]));
  return { total, items: page.map(({ id, updatedAt }) => ({ id, updatedAt, d: byId.get(id) })) };
}
