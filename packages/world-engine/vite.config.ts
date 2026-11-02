import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Local development harness for the engine (not Codex's app). `pnpm --filter @hello-world/world-engine dev`
export default defineConfig({
  root: 'dev',
  plugins: [react()],
  server: { host: '0.0.0.0', port: 5180, fs: { allow: ['..', '../../..'] } },
  build: { outDir: '../dist-demo', emptyOutDir: true, chunkSizeWarningLimit: 4000 },
  test: { root: '.', include: ['test/**/*.test.ts', 'src/**/*.test.ts'], environment: 'node' },
} as never);
