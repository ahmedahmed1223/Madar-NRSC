import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer as createNetServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
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

  it('keeps the built browser, health endpoint, and built release notes in sync', async () => {
    const build = spawnSync('npm', ['run', 'build'], { encoding: 'utf8', timeout: 120_000 });
    expect(build.status, `${build.stdout}\n${build.stderr}`).toBe(0);

    const dist = path.resolve('dist');
    const html = readFileSync(path.join(dist, 'index.html'), 'utf8');
    const packageVersion = JSON.parse(readFileSync('package.json', 'utf8')).version as string;
    const htmlVersion = /<meta name="application-version" content="([^"]+)"/.exec(html)?.[1] ?? 'missing';
    assertVersionAt('dist/index.html application-version metadata', htmlVersion, packageVersion);

    const appBundleName = readdirSync(path.join(dist, 'assets')).find(name => /^App-.+\.js$/.test(name));
    const appBundleLocation = `dist/assets/${appBundleName ?? 'App-*.js'}`;
    const appBundle = appBundleName
      ? readFileSync(path.join(dist, 'assets', appBundleName), 'utf8')
      : '';
    const browserVersion = /الإصدار: v`,\s*`([^`]+)`/.exec(appBundle)?.[1] ?? 'missing';
    assertVersionAt(`${appBundleLocation} sidebar version`, browserVersion, packageVersion);

    const releaseTitle = RELEASES[0].title;
    const titleIndex = appBundle.indexOf(`title:\`${releaseTitle}\``);
    const releasePrefix = titleIndex >= 0 ? appBundle.slice(Math.max(0, titleIndex - 180), titleIndex) : '';
    const builtNotesVersion = /version:`([^`]+)`,date:`[^`]*`,/.exec(releasePrefix)?.[1] ?? 'missing';

    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'release-version-smoke-'));
    const portProbe = createNetServer();
    await new Promise<void>((resolve, reject) => {
      portProbe.once('error', reject);
      portProbe.listen(0, '127.0.0.1', () => resolve());
    });
    const address = portProbe.address();
    if (!address || typeof address === 'string') throw new Error('Could not reserve a port for the built server');
    const port = address.port;
    await new Promise<void>((resolve, reject) => portProbe.close(error => error ? reject(error) : resolve()));

    const builtServer = spawn(process.execPath, [path.join(dist, 'server.cjs')], {
      env: {
        PATH: process.env.PATH,
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: String(port),
        DATA_DIR: dataDir,
        DATABASE_ENGINE: 'sqlite',
        SEED_DEMO_DATA: 'false',
        BACKUP_INTERVAL_HOURS: '0',
        NOTIFY_DELIVERY_SECONDS: '0',
        STORAGE_SYNC_SECONDS: '0',
        WIRE_POLL_MINUTES: '0',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let startupErrors = '';
    builtServer.stderr?.on('data', chunk => {
      startupErrors = `${startupErrors}${String(chunk)}`.slice(-4000);
    });

    try {
      const healthUrl = `http://127.0.0.1:${port}/api/health`;
      let healthResponse: Response | undefined;
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        if (builtServer.exitCode !== null) {
          throw new Error(`Built server exited before /api/health responded: ${startupErrors}`);
        }
        try {
          const response = await fetch(healthUrl);
          if (response.ok) {
            healthResponse = response;
            break;
          }
        } catch {
          // The server may still be starting; retry until the startup deadline.
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (!healthResponse) throw new Error(`Built server did not answer /api/health: ${startupErrors}`);
      const healthPayload = await healthResponse.json() as { status?: string; version?: string };
      expect(healthPayload.status, '/api/health returned an unexpected status payload').toBe('ok');
      const healthVersion = healthPayload.version ?? 'missing';
      assertVersionAt('dist/index.html application-version vs /api/health', htmlVersion, healthVersion);
      assertVersionAt(`${appBundleLocation} sidebar version vs /api/health`, browserVersion, healthVersion);
      assertVersionAt(`${appBundleLocation} «ما الجديد» latest release vs /api/health`, builtNotesVersion, healthVersion);
      assertVersionAt('src/content/whatsNew.ts CURRENT_VERSION vs /api/health', CURRENT_VERSION, healthVersion);
    } finally {
      if (builtServer.exitCode === null && builtServer.signalCode === null) {
        const exited = once(builtServer, 'exit');
        builtServer.kill('SIGTERM');
        let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
        const forced = new Promise(resolve => {
          forceKillTimer = setTimeout(() => {
            builtServer.kill('SIGKILL');
            resolve(undefined);
          }, 5_000);
        });
        const result = await Promise.race([exited.then(() => 'exit'), forced.then(() => 'forced')]);
        if (forceKillTimer) clearTimeout(forceKillTimer);
        if (result === 'forced') await exited;
      }
      rmSync(dataDir, { recursive: true, force: true });
    }
  }, 120_000);

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
