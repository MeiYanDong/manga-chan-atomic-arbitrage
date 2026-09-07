import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  root: fileURLToPath(new URL('./ui', import.meta.url)),
  base: '/dashboard/',
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL('./public/dashboard', import.meta.url)),
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
  },
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api': 'http://127.0.0.1:8788',
      '/healthz': 'http://127.0.0.1:8788',
    },
  },
})
