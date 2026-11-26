import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'esbuild';

const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');
const args = process.argv.slice(2);
const outputFlag = args.findIndex(arg => arg === '--output' || arg.startsWith('--output='));
let outputRoot = path.resolve('test-results', 'isolated');
if (outputFlag !== -1) {
  const combined = args[outputFlag].startsWith('--output=');
  const value = combined ? args[outputFlag].slice('--output='.length) : args[outputFlag + 1];
  if (!value || value.startsWith('--')) throw new Error('--output requires a directory.');
  outputRoot = path.resolve(value);
  args.splice(outputFlag, combined ? 1 : 2);
}
const processes = new Set();
const usedPorts = new Set();
let interrupted = false;

function portForFile() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => {
        if (usedPorts.has(port)) resolve(portForFile());
        else {
          usedPorts.add(port);
          resolve(port);
        }
      });
    });
  });
}

function testFiles(report) {
  return [...new Set(report.suites.map(suite => suite.file).filter(Boolean))];
}

function run(command, env) {
  const child = spawn(process.execPath, command, { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  processes.add(child);
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const completion = new Promise(resolve => {
    child.once('error', error => { output += String(error); });
    child.once('close', code => { processes.delete(child); resolve({ code, output }); });
  });
  return { child, completion, output: () => output };
}

async function waitForServer(server, port) {
  const deadline = Date.now() + 60_000;
  while (server.child.exitCode === null && Date.now() < deadline) {
    const ready = await fetch(`http://127.0.0.1:${port}/api/ready`, { signal: AbortSignal.timeout(1500) }).catch(() => null);
    if (ready?.ok) return;
    await delay(250);
  }
  throw new Error(`Test server on port ${port} failed to start.\n${server.output()}`);
}

async function runFile(file, index, distDir) {
  const port = await portForFile();
  const dataRoot = path.resolve('tests/e2e/.data');
  await mkdir(dataRoot, { recursive: true });
  const dataDir = await mkdtemp(path.join(dataRoot, `${port}-`));
  const suffix = String(index + 1).padStart(3, '0') + '-' + path.basename(file, '.spec.ts');
  const env = { ...process.env, E2E_PORT: String(port), E2E_EXTERNAL_SERVER: 'true', E2E_OFFLINE_FIXTURE_READY: 'true',
    E2E_TEST_DATA_DIR: dataDir, E2E_DIST_DIR: distDir, E2E_SPEC_FILE: file.replaceAll('\\', '/'),
    E2E_OUTPUT_DIR: path.join(outputRoot, suffix) };
  const server = run(['tests/e2e/server.mjs'], env);
  try {
    await waitForServer(server, port);
    const result = await run([cli, 'test', ...args], env).completion;
    process.stdout.write(`\n[${index + 1}] ${file}\n${result.output}`);
    return result.code === 0;
  } catch (error) {
    process.stderr.write(`\n[${index + 1}] ${file}\n${String(error)}\n`);
    return false;
  } finally {
    server.child.kill();
    await server.completion;
    await rm(dataDir, { recursive: true, force: true, maxRetries: 5 });
  }
}

function stop(signal) {
  interrupted = true;
  process.exitCode = signal === 'SIGINT' ? 130 : 143;
  for (const child of processes) child.kill(signal);
}
process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));

if (args.includes('--list') || args.includes('--help')) {
  const listed = spawnSync(process.execPath, [cli, 'test', ...args], { stdio: 'inherit', windowsHide: true });
  process.exitCode = listed.status ?? 1;
} else {
  const listing = spawnSync(process.execPath, [cli, 'test', ...args, '--list', '--reporter=json'], {
    encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, windowsHide: true,
  });
  if (listing.status !== 0) {
    process.stderr.write(listing.stderr || listing.stdout || 'Unable to list browser tests.\n');
    process.exitCode = 1;
  } else {
    const files = testFiles(JSON.parse(listing.stdout));
    if (!files.length) throw new Error('No matching browser test files.');
    const concurrency = Number(process.env.E2E_FILE_WORKERS || 2);
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) {
      throw new Error('E2E_FILE_WORKERS must be an integer from 1 to 8.');
    }
    const dataRoot = path.resolve('tests/e2e/.data');
    await mkdir(dataRoot, { recursive: true });
    const snapshot = await mkdtemp(path.join(dataRoot, 'build-'));
    const distDir = path.join(snapshot, 'dist');
    const failed = [];
    let next = 0;
    try {
      await cp('dist', distDir, { recursive: true });
      await cp('bridge', path.join(snapshot, 'bridge'), { recursive: true });
      await build({ entryPoints: ['tests/e2e/offline-test-entry.ts'], bundle: true, format: 'esm', platform: 'browser',
        outfile: path.join(distDir, 'offline-store-test.js') });
      await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, async () => {
        while (!interrupted && next < files.length) {
          const index = next++;
          if (!await runFile(files[index], index, distDir)) failed.push(files[index]);
        }
      }));
    } finally {
      await rm(snapshot, { recursive: true, force: true, maxRetries: 5 });
    }
    console.log(`\n${next - failed.length}/${files.length} isolated browser spec files passed.`);
    if (failed.length && !interrupted) {
      console.log(failed.join('\n'));
      process.exitCode = 1;
    }
  }
}
