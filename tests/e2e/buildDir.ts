import path from 'node:path';

/** The runner snapshots the production build once, even if another job rebuilds the workspace. */
export const browserBuildDir = path.resolve(process.env.E2E_DIST_DIR || 'dist');
