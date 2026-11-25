import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { APP_VERSION } from '../../src/server/app';
import { BACKUP_REHEARSAL_VERSION } from '../../src/server/databaseRecovery';
import { CURRENT_VERSION, RELEASES } from '../../src/content/whatsNew';

function assertVersionAt(location: string, actual: string, expected: string) {
  if (actual !== expected) {
    throw new Error(`[release version] ${location}: found "${actual}", expected "${expected}"`);
  }
}

function createReleaseFixture(root: string, readme: string) {
  const script = path.resolve('scripts/set-release-version.mjs');
  const scriptsDirectory = path.join(root, 'scripts');
  mkdirSync(scriptsDirectory);
  copyFileSync(script, path.join(scriptsDirectory, 'set-release-version.mjs'));

  writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'fixture',
    version: '4.5.0',
    scripts: { 'release:version': 'node scripts/set-release-version.mjs' },
  }));
  writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({
    name: 'fixture',
    version: '4.5.0',
    packages: { '': { name: 'fixture', version: '4.5.0' } },
  }));

  const notesPath = path.join(root, 'src/content/whatsNew.ts');
  mkdirSync(path.dirname(notesPath), { recursive: true });
  writeFileSync(notesPath, "export const RELEASES = [{ version: '4.5.0' }, { version: '4.4.0' }];\n");
  writeFileSync(path.join(root, 'README.md'), readme);

  return ['package.json', 'package-lock.json', 'src/content/whatsNew.ts', 'README.md']
    .map(file => [file, readFileSync(path.join(root, file), 'utf8')] as const);
}

describe('release version', () => {
  it('keeps package, lockfile, server and release notes in sync', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
    const readme = readFileSync('README.md', 'utf8');
    assertVersionAt('package-lock.json version', lock.version, pkg.version);
    assertVersionAt('package-lock.json packages[""] version', lock.packages[''].version, pkg.version);
    assertVersionAt('src/server/app.ts APP_VERSION', APP_VERSION, pkg.version);
    assertVersionAt('src/server/databaseRecovery.ts BACKUP_REHEARSAL_VERSION', BACKUP_REHEARSAL_VERSION, pkg.version);
    assertVersionAt('src/content/whatsNew.ts CURRENT_VERSION', CURRENT_VERSION, pkg.version);
    assertVersionAt('src/content/whatsNew.ts RELEASES[0].version', RELEASES[0].version, pkg.version);
    const latestReleaseLink = /\[ملاحظات الإصدار\s+(\d+\.\d+\.\d+)\]\(docs\/releases\/(\d+\.\d+\.\d+)\.md\)/.exec(readme);
    assertVersionAt('README.md latest release notes link label', latestReleaseLink?.[1] ?? 'missing', pkg.version);
    assertVersionAt('README.md latest release notes link target', latestReleaseLink?.[2] ?? 'missing', pkg.version);
    expect(pkg.scripts['release:version']).toBe('node scripts/set-release-version.mjs');
    expect(RELEASES[0].items.length).toBeGreaterThan(0);
    expect(new Set(RELEASES.map(release => release.version)).size).toBe(RELEASES.length);
  });

  it('reports the exact location and values when a version differs', () => {
    expect(() => assertVersionAt('package-lock.json version', '4.4.9', '4.5.0')).toThrow(
      '[release version] package-lock.json version: found "4.4.9", expected "4.5.0"',
    );
  });

  it('updates package metadata, lockfile metadata and the current release note with one command', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'release-version-'));
    const script = path.resolve('scripts/set-release-version.mjs');
    try {
      writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({
        name: 'fixture', version: '4.5.0', packages: { '': { name: 'fixture', version: '4.5.0' } },
      }));
      writeFileSync(path.join(root, 'README.md'), '[ملاحظات الإصدار 4.5.0](docs/releases/4.5.0.md) و[4.4.1](docs/releases/4.4.1.md)\n');
      const notesPath = path.join(root, 'src/content/whatsNew.ts');
      const notesDirectory = path.dirname(notesPath);
      mkdirSync(notesDirectory, { recursive: true });
      writeFileSync(notesPath, "export const RELEASES = [{ version: '4.5.0' }, { version: '4.4.0' }];\n");
      const scriptsDirectory = path.join(root, 'scripts');
      mkdirSync(scriptsDirectory);
      copyFileSync(script, path.join(scriptsDirectory, 'set-release-version.mjs'));
      const fixturePackage = {
        name: 'fixture',
        version: '4.5.0',
        scripts: { 'release:version': 'node scripts/set-release-version.mjs' },
      };
      writeFileSync(path.join(root, 'package.json'), JSON.stringify(fixturePackage));

      const result = spawnSync('npm', ['run', 'release:version', '--', '4.6.0'], {
        cwd: root,
        encoding: 'utf8',
      });

      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version).toBe('4.6.0');
      const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
      expect(lock.version).toBe('4.6.0');
      expect(lock.packages[''].version).toBe('4.6.0');
      expect(readFileSync(notesPath, 'utf8')).toContain("version: '4.6.0'");
      expect(readFileSync(notesPath, 'utf8')).toContain("version: '4.4.0'");
      expect(readFileSync(path.join(root, 'README.md'), 'utf8')).toContain('[ملاحظات الإصدار 4.6.0](docs/releases/4.6.0.md)');
      expect(readFileSync(path.join(root, 'README.md'), 'utf8')).toContain('[4.4.1](docs/releases/4.4.1.md)');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects an invalid version without changing release files', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'release-version-invalid-'));
    try {
      const originalFiles = createReleaseFixture(
        root,
        '[ملاحظات الإصدار 4.5.0](docs/releases/4.5.0.md)\n',
      );

      const result = spawnSync('npm', ['run', 'release:version', '--', 'not-a-version'], {
        cwd: root,
        encoding: 'utf8',
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Usage: npm run release:version -- <major.minor.patch>');
      expect(
        originalFiles.map(([file]) => [file, readFileSync(path.join(root, file), 'utf8')]),
      ).toEqual(originalFiles);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports a missing README release link without changing release files', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'release-version-missing-link-'));
    try {
      const originalFiles = createReleaseFixture(root, 'No release notes link yet.\n');

      const result = spawnSync('npm', ['run', 'release:version', '--', '4.6.0'], {
        cwd: root,
        encoding: 'utf8',
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        '[release version] README.md is missing the latest release notes link',
      );
      expect(
        originalFiles.map(([file]) => [file, readFileSync(path.join(root, file), 'utf8')]),
      ).toEqual(originalFiles);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
