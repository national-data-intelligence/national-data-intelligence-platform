import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// FastAPI serves /api/proxy/* + /static/* (assets). Vite output goes to
// ../dist; FastAPI mounts dist/ at '/'. Asset paths in the build are
// rewritten to /static/ so they line up with FastAPI's static mount.
export default defineConfig({
  plugins: [react()],
  base: '/',
  // Prefer the TypeScript sources over any legacy .js twin (archived during the
  // JS→TS migration) — guards against Vite's default .js-before-.ts resolution.
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
      '/api':    'http://127.0.0.1:8086',
      '/static': 'http://127.0.0.1:8086',
    },
  },
});
