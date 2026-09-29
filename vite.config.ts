import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    // Never watch build outputs: electron-builder creates release/win-unpacked.tmp
    // during packaging, and this dev server's watcher holding a handle on it
    // breaks the final rename with EPERM.
    watch: {
      ignored: ['**/release/**', '**/release-build/**', '**/dist/**', '**/dist-server/**'],
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5005',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://127.0.0.1:5005',
        ws: true,
      },
    },
  },
});
