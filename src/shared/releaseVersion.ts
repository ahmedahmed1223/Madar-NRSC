import pkg from '../../package.json' with { type: 'json' };

/** The package manifest is the single source of truth for the running app version. */
export const APP_VERSION = pkg.version;
