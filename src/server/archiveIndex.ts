import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { parseQuery, prepareText, scorePrepared, termLevel, type PreparedText } from '../shared/arabicSearch';

export function prepareArchiveText(json: string): Buffer {
  const data = JSON.parse(json);
  const title = prepareText(data.title, data.shortTitle);
  const body = prepareText(data.keywords, data.summary, data.locationName, String(data.content || '').replace(/<[^>]*>/g, ' '));
  const titleBytes = Buffer.from(JSON.stringify(title));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(titleBytes.length);
  return Buffer.concat([header, titleBytes, deflateRawSync(JSON.stringify(body), { level: 1 })]);
}

const bodyOffset = (prepared: Buffer) => 4 + prepared.readUInt32LE();
const readTitle = (prepared: Buffer): PreparedText => JSON.parse(prepared.toString('utf8', 4, bodyOffset(prepared)));
const readBody = (prepared: Buffer): PreparedText => JSON.parse(inflateRawSync(prepared.subarray(bodyOffset(prepared))).toString('utf8'));

export function archiveTerms(prepared: Buffer): string {
  const title = readTitle(prepared);
  const body = readBody(prepared);
  return [title.hay, title.bare, body.hay, body.bare].join(' ');
}

export function rankArchiveText(query: string, prepared: Buffer): number | null {
  const q = parseQuery(query);
  const title = readTitle(prepared);
  // A title score of at least six already beats every body match for a single term.
  if (q.terms.length === 1 && !q.excluded.length && !q.phrases.length && termLevel(title, q.terms[0], q.candidates[0]) >= 2) {
    return scorePrepared(q, title);
  }
  return scorePrepared(q, title, readBody(prepared));
}

/** A superset of Arabic matches. Boundary, exclusion and relevance rules are applied afterwards. */
export function archiveMatch(query: string): string {
  const { terms, candidates, phrases } = parseQuery(query);
  const quotable = (text: string) => [...text].length >= 3;
  const quote = (text: string) => `"${text.replaceAll('"', '""')}"`;
  const clauses = phrases.filter(quotable).map(quote);
  terms.forEach((term, i) => {
    const forms = [term, ...candidates[i]];
    if (forms.every(quotable)) clauses.push(`(${forms.map(quote).join(' OR ')})`);
  });
  return clauses.join(' AND ');
}
