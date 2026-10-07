import { describe, expect, it } from 'vitest';
import { evaluateBulletinReadiness } from '../src/shared/bulletinReadiness';
describe('bulletin readiness', () => {
  const bulletin: any = { id: 'b', approvalSteps: [] };
  const story: any = { id: 's', type: 'READER', script: 'نص صالح للقراءة على الهواء', anchorName: 'مذيع', status: 'APPROVED', approvals: [], bulletinId: 'b' };
  it('reader needs no video and floated stories do not block', () => {
    expect(evaluateBulletinReadiness(bulletin, [story], [], [], new Date())).toEqual([]);
    expect(evaluateBulletinReadiness(bulletin, [{ ...story, floated: true, script: '' }], [], [], new Date())).toEqual([]);
  });
  it('requires text, type-specific video and completed approval', () => {
    const issues = evaluateBulletinReadiness(bulletin, [{ ...story, type: 'VO', status: 'READY', script: '' }], [], [], new Date());
    expect(issues.map(i => i.code)).toEqual(expect.arrayContaining(['SCRIPT', 'VIDEO', 'APPROVAL']));
  });
  it('break requires duration but not a script', () => {
    expect(evaluateBulletinReadiness(bulletin, [{ ...story, type: 'BREAK', script: '', manualSeconds: 30 }], [], [], new Date())).toEqual([]);
  });
  it('embargo blocks and newer source warns', () => {
    const issues = evaluateBulletinReadiness(bulletin, [{ ...story, newsId: 'n', newsUpdatedAt: '2026-01-01' }], [{ id: 'n', updatedAt: '2026-02-01', embargoUntil: '2030-01-01' }] as any, [], new Date('2026-03-01'));
    expect(issues.find(i => i.code === 'EMBARGO')?.severity).toBe('blocker');
    expect(issues.find(i => i.code === 'SOURCE_CHANGED')?.severity).toBe('warning');
  });
  it('a newly required signoff blocks an already approved story', () => {
    const changed = { ...bulletin, approvalSteps: [{ id: 'editor', kind: 'BULLETIN_EDITOR' }, { id: 'chief', kind: 'CHIEF' }] };
    const approved = { ...story, approvals: [{ stepId: 'editor', byId: 'e', byName: 'e', at: '2026-01-01' }] };
    expect(evaluateBulletinReadiness(changed as any, [approved], [], [], new Date()).some(i => i.code === 'APPROVAL')).toBe(true);
  });
});
