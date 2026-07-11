import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// FastAPI serves /api/proxy/* + /static/* (assets). Vite output goes to
// ../dist; FastAPI mounts dist/ at '/'. Asset paths in the build are
// rewritten to /static/ so they line up with FastAPI's static mount.
export default defineConfig({
  plugins: [react()],
  base: '/',
  // Prefer the TypeScript sources over any legacy .js twin. (The JS originals
  // were archived during the JS→TS migration; this guards against Vite's
  // default resolution silently picking a stale .js over the maintained .ts.)
  resolve: {
    extensions: ['.tsx', '.ts', '.jsx', '.js', '.json', '.mjs'],
  },
  build: {
    outDir: path.resolve(__dirname, '../dist'),
    emptyOutDir: true,
    assetsDir: 'assets',
    sourcemap: false,
  },
  server: {
    proxy: {
      '/api':    'http://127.0.0.1:8087',
      '/static': 'http://127.0.0.1:8087',
    },
  },
});
