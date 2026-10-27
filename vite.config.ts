import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import pkg from './package.json' with { type: 'json' };
import { offlineAirManifest } from './src/build/offlineAirManifest.ts';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), offlineAirManifest()],
    build: { rolldownOptions: { input: { app: path.resolve(import.meta.dirname, 'index.html'), offlineAir: path.resolve(import.meta.dirname, 'offline-air.html') } } },
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
