import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { swManifest } from './scripts/sw-manifest.mjs';

export default defineConfig({
  plugins: [svelte(), swManifest()],
  base: './',
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
