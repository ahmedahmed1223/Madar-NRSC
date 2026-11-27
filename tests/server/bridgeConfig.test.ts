import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('station bridge settings', () => {
  function bridge(args: string[]) {
    return spawnSync(process.execPath, [path.resolve('bridge/madar-bridge.mjs'), '--once',
      '--madar-url=https://example.org', '--madar-bridge-token=test', '--share-path=.', ...args],
    { encoding: 'utf8', timeout: 5000 });
  }

  it('rejects nonnumeric polling settings before starting', () => {
    const result = bridge(['--poll-seconds=invalid']);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('POLL_SECONDS');
  });

  it('requires TLS for the configured server', () => {
    const result = bridge(['--madar-url=http://example.org']);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('HTTPS');
  });
});
