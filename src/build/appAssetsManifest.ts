import { createHash } from 'node:crypto';
import type { Plugin } from 'vite';

/**
 * Lists the built app files (hashed JS/CSS chunks and woff2 fonts) in `app-assets.json`, so the
 * service worker can keep every screen on the device: a reporter who loses the network can still
 * open screens they have not visited yet in this session.
 */
export function appAssetsManifest(): Plugin {
  return {
    name: 'app-assets-manifest',
    generateBundle(_, bundle) {
      const assets = Object.keys(bundle)
        .filter((name) => /^assets\/[A-Za-z0-9_.-]+\.(js|css|woff2)$/.test(name))
        .map((name) => '/' + name)
        .sort();
      if (assets.length > 400) this.warn(`app-assets.json lists ${assets.length} files; the service worker caches at most 400`);
      const version = createHash('sha256').update(assets.join('\n')).digest('hex').slice(0, 24);
      this.emitFile({ type: 'asset', fileName: 'app-assets.json', source: JSON.stringify({ version, assets: assets.slice(0, 400) }) });
    },
  };
}
