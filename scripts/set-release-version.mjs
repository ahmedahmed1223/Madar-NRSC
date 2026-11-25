import fs from 'node:fs';
import path from 'node:path';

const [version, ...extraArgs] = process.argv.slice(2);
if (extraArgs.length || !/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  console.error('Usage: npm run release:version -- <major.minor.patch>');
  process.exit(1);
}

const root = process.cwd();
const packagePath = path.join(root, 'package.json');
const lockPath = path.join(root, 'package-lock.json');
const notesPath = path.join(root, 'src/content/whatsNew.ts');
const readmePath = path.join(root, 'README.md');

try {
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  const notes = fs.readFileSync(notesPath, 'utf8');
  const readme = fs.readFileSync(readmePath, 'utf8');
  if (!lock.packages?.['']) {
    throw new Error('package-lock.json is missing packages[""] metadata');
  }

  const releasesStart = notes.indexOf('export const RELEASES');
  const remainingNotes = releasesStart >= 0 ? notes.slice(releasesStart) : '';
  const firstReleaseVersion = /(\bversion\s*:\s*)(['"])([^'"]+)\2/.exec(remainingNotes);
  if (!firstReleaseVersion) {
    throw new Error('src/content/whatsNew.ts is missing the first release version');
  }
  const latestReleaseLink = /(\[ملاحظات الإصدار\s+)(\d+\.\d+\.\d+)(\]\(docs\/releases\/)\d+\.\d+\.\d+(\.md\))/.exec(readme);
  if (!latestReleaseLink) {
    throw new Error('README.md is missing the latest release notes link');
  }

  pkg.version = version;
  lock.version = version;
  lock.packages[''].version = version;
  const updatedNotes = notes.slice(0, releasesStart)
    + remainingNotes.slice(0, firstReleaseVersion.index)
    + firstReleaseVersion[1] + firstReleaseVersion[2] + version + firstReleaseVersion[2]
    + remainingNotes.slice(firstReleaseVersion.index + firstReleaseVersion[0].length);
  const updatedReadme = readme.slice(0, latestReleaseLink.index)
    + latestReleaseLink[1] + version + latestReleaseLink[3] + version + latestReleaseLink[4]
    + readme.slice(latestReleaseLink.index + latestReleaseLink[0].length);

  fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
  fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  fs.writeFileSync(notesPath, updatedNotes);
  fs.writeFileSync(readmePath, updatedReadme);
  console.log(`Release version set to ${version} in package.json, package-lock.json, release notes and README.`);
} catch (error) {
  console.error(`[release version] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
