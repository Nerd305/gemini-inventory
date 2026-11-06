import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

// Local dev only: the Vite server stands in for server.js's /api/ai/gemini proxy. It accepts only the one
// call the app makes, strips the Firebase bearer token the browser sends (Google would reject it) and adds
// the Gemini key from .env.local. In production the key lives in Secret Manager and never reaches the browser.
const GEMINI_DEV_ALLOWED = /^\/api\/ai\/gemini\/v1beta\/models\/gemini-2\.5-flash:(generateContent|countTokens)(\?|$)/;

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  const geminiKey = env.GEMINI_API_KEY;
  return {
    plugins: [react(), tailwindcss()],
    define: {
      // GEMINI_API_KEY is deliberately NOT defined here any more: a key defined into the bundle ships to every browser.
      // The commit being built (Dockerfile ARG GIT_SHA / the deploy workflow); shown next to the version badge.
      'process.env.GIT_SHA': JSON.stringify(process.env.GIT_SHA || env.GIT_SHA || ''),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      host: '0.0.0.0',
      port: 3000,
      allowedHosts: true,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify - file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      proxy: geminiKey
        ? {
            '/api/ai/gemini': {
              target: 'https://generativelanguage.googleapis.com',
              changeOrigin: true,
              rewrite: (p: string) => p.replace(/^\/api\/ai\/gemini/, ''),
              // Anything but the one allowed POST (with a bearer token present) gets a 404 instead of using the key.
              bypass: (req: { method?: string; url?: string; headers: Record<string, unknown> }) =>
                req.method === 'POST' &&
                GEMINI_DEV_ALLOWED.test(req.url ?? '') &&
                String(req.headers.authorization ?? '').startsWith('Bearer ')
                  ? undefined
                  : false,
              configure: (proxy: { on: (event: string, handler: (proxyReq: { removeHeader: (n: string) => void; setHeader: (n: string, v: string) => void }) => void) => void }) => {
                proxy.on('proxyReq', (proxyReq) => {
                  proxyReq.removeHeader('authorization');
                  proxyReq.setHeader('x-goog-api-key', geminiKey);
                });
              },
            },
          }
        : undefined,
    },
  };
});
