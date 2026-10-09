import { expect, it, vi } from 'vitest';
import { logger, getRecentErrors } from '../../src/server/logger';
it('bounds errors to 100 and replaces unapproved dynamic messages', () => {
  const output = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  try {
  for (let index = 0; index < 110; index++) logger.error('unhandled error', { error: `private-${index}` });
  logger.error('Bearer secret-token news text');
  const records = getRecentErrors();
  expect(records.entries).toHaveLength(100);
  expect(records.entries[0].message).toBe('server error');
  expect(JSON.stringify(records)).not.toContain('secret-token');
  expect(JSON.stringify(records)).not.toContain('private-');
  records.entries[0].message = 'modified';
  expect(getRecentErrors().entries[0].message).toBe('server error');
  } finally { output.mockRestore(); }
});
