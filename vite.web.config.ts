import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  root: resolve('src/renderer'),
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src'),
      '@phaser-editor/contracts': resolve('packages/contracts/src/index.ts')
    }
  },
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 4174,
    strictPort: true
  }
})
