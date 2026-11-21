import { describe, expect, it } from 'vitest';
import { buildCopilotRequest, copilotTextChanges } from '../../src/shared/aiReview';

const source = { title: 'عنوان', shortTitle: 'قصير', summary: 'الملخص الأول', content: '<p>متن مع <strong>نص</strong></p>' };
const controls = { provider: 'openai', localOnly: false, tone: 'URGENT', instruction: 'اختصر النص' } as const;

describe('AI draft review', () => {
  it('does not construct an upstream request in local-only mode', () => {
    expect(buildCopilotRequest({ ...source, ...controls, mode: 'TV_REWRITE', localOnly: true })).toBeNull();
  });

  it('sends only the source fields needed for the selected editing operation', () => {
    expect(buildCopilotRequest({ ...source, ...controls, mode: 'PROOFREAD' })).toEqual({ mode: 'PROOFREAD', provider: 'openai', content: 'متن مع نص', instruction: 'اختصر النص' });
    expect(buildCopilotRequest({ ...source, ...controls, mode: 'HEADLINES' })).toEqual({ mode: 'HEADLINES', provider: 'openai', title: 'عنوان', summary: 'الملخص الأول', tone: 'URGENT', instruction: 'اختصر النص' });
  });

  it('shows only fields the suggestion would change, with additions and deletions', () => {
    const changes = copilotTextChanges(source, { summary: 'الملخص الثاني', content: '<b>متن مع نص</b>' });
    expect(changes).toEqual([{ field: 'summary', runs: [
      { kind: 'same', text: 'الملخص' }, { kind: 'del', text: 'الأول' }, { kind: 'add', text: 'الثاني' },
    ] }]);
  });
});
