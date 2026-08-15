import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  build: {
    chunkSizeWarningLimit: 1750,
    sourcemap: false,
    target: 'es2022'
  }
})
