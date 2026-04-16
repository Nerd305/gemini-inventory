import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  root: path.resolve(__dirname, 'renderer'),
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../src/shared'),
      '@firebase-config': path.resolve(__dirname, '../src/firebase'),
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: path.resolve(__dirname, 'renderer/index.html'),
        print: path.resolve(__dirname, 'renderer/print.html'),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
