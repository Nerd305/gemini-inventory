import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  root: path.resolve(__dirname, 'renderer'),
  base: './',
  plugins: [react()],
  resolve: {
    alias: [
      { find: '@shared', replacement: path.resolve(__dirname, '../src/shared') },
      { find: '@firebase-config', replacement: path.resolve(__dirname, '../src/firebase') },
      // ../src/shared imports these; resolve them from this app's node_modules so the print server
      // builds with only `cd desktop && npm install` (no root install needed).
      ...['jspdf', 'qrcode', 'jsbarcode'].map((pkg) => ({ find: new RegExp(`^${pkg}$`), replacement: path.resolve(__dirname, 'node_modules', pkg) })),
    ],
  },
  build: {
    outDir: path.resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: path.resolve(__dirname, 'renderer/index.html'),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
