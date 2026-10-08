import { createHash } from 'node:crypto';
import type { Plugin } from 'vite';
export function offlineAirManifest(): Plugin {
  return {
    name: 'offline-air-manifest',
    generateBundle(_, bundle) {
      const entry = Object.values(bundle).find(item => item.type === 'chunk' && item.isEntry && item.facadeModuleId?.replace(/\\/g, '/').endsWith('/offline-air.html'));
      if (!entry || entry.type !== 'chunk') throw new Error('Offline air entry missing');
      const assets = new Set<string>(['/offline-air.html']);
      const visit = (name: string) => {
        if (assets.has('/' + name)) return;
        assets.add('/' + name);
        const item = bundle[name];
        if (item?.type === 'chunk') {
          item.imports.forEach(visit);
          (item as any).viteMetadata?.importedCss?.forEach(visit);
          (item as any).viteMetadata?.importedAssets?.forEach(visit);
        }
      };
      visit(entry.fileName);
      const urls = [...assets].sort();
      const version = createHash('sha256').update(urls.join('\n')).digest('hex').slice(0, 24);
      this.emitFile({ type: 'asset', fileName: 'offline-air-assets.json', source: JSON.stringify({ version, assets: urls }) });
    },
  };
}
