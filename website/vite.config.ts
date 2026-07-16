import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  // A relative base works for both mirek.github.io/cave and a custom domain.
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      'util': fileURLToPath(new URL('./src/playground/util-shim.ts', import.meta.url)),
    },
  },
  optimizeDeps: {
    exclude: ['sql.js'],
  },
  build: {
    target: 'es2022',
  },
})
