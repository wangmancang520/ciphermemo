import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://127.0.0.1:8787' } },
  // The rich text editor is a separate lazily loaded chunk of roughly 510 kB (160 kB gzip).
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 600 },
});
