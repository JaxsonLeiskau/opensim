import { defineConfig } from 'vite';
export default defineConfig({
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 60000 },
});
