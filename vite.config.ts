import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import {assertNoPublicSecrets} from './src/services/serverEnvironment';

export default defineConfig(({mode}) => {
  assertNoPublicSecrets({...loadEnv(mode, process.cwd(), ''), ...process.env});
  return {
    plugins: [react(), tailwindcss()],
    build: {
      outDir: 'dist/client',
      // Open tabs can still lazy-load chunks from the previous build.
      emptyOutDir: false,
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: {
        ignored: ['**/uploads/**', '**/data/**'],
      },
    },
  };
});
