import { describe, expect, it, vi } from 'vitest';
import { offlineAirManifest } from '../../src/build/offlineAirManifest';

describe('offlineAirManifest', () => {
  it('includes dynamically imported chunks required by the offline screen', () => {
    const emitted: Array<{ fileName: string; source: string }> = [];
    const plugin = offlineAirManifest();
    const bundle = {
      'assets/offline-air.js': {
        type: 'chunk',
        fileName: 'assets/offline-air.js',
        isEntry: true,
        facadeModuleId: '/project/offline-air.html',
        imports: [],
        dynamicImports: ['assets/offline-lazy.js'],
        viteMetadata: { importedCss: new Set(['assets/offline-air.css']), importedAssets: new Set() },
      },
      'assets/offline-lazy.js': {
        type: 'chunk',
        fileName: 'assets/offline-lazy.js',
        isEntry: false,
        facadeModuleId: null,
        imports: [],
        dynamicImports: [],
        viteMetadata: { importedCss: new Set(), importedAssets: new Set() },
      },
      'assets/offline-air.css': { type: 'asset', fileName: 'assets/offline-air.css', source: '' },
    };

    const generateBundleHook = plugin.generateBundle!;
    const generateBundle = typeof generateBundleHook === 'function' ? generateBundleHook : generateBundleHook.handler;
    generateBundle.call(
      { emitFile: vi.fn((asset) => { emitted.push(asset as { fileName: string; source: string }); }) } as never,
      {} as never,
      bundle as never,
      false,
    );

    const manifest = JSON.parse(emitted[0].source) as { assets: string[] };
    expect(manifest.assets, 'Offline-air manifest omitted a dynamically imported chunk').toContain('/assets/offline-lazy.js');
  });
});
