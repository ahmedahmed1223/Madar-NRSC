import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CURRENT_VERSION, RELEASES } from '../../src/content/whatsNew';

describe('release version', () => {
  it('keeps package, lockfile, server and release notes in sync', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
    const server = readFileSync('src/server/app.ts', 'utf8');
    expect(CURRENT_VERSION).toBe(pkg.version);
    expect(lock.version).toBe(pkg.version);
    expect(lock.packages[''].version).toBe(pkg.version);
    expect(server).toContain(`export const APP_VERSION = '${pkg.version}';`);
    expect(RELEASES[0].version).toBe(pkg.version);
    expect(RELEASES[0].items.length).toBeGreaterThan(0);
    expect(new Set(RELEASES.map(release => release.version)).size).toBe(RELEASES.length);
  });
});
