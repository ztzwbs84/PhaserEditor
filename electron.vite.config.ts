import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@phaser-editor/contracts', 'zod'] })],
    resolve: {
      alias: {
        '@phaser-editor/contracts': resolve('packages/contracts/src/index.ts')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@phaser-editor/contracts', 'zod'] })],
    resolve: {
      alias: {
        '@phaser-editor/contracts': resolve('packages/contracts/src/index.ts')
      }
    },
    build: {
      rollupOptions: {
        output: {
          format: 'cjs',
          entryFileNames: 'index.cjs'
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@phaser-editor/contracts': resolve('packages/contracts/src/index.ts')
      }
    },
    plugins: [react()],
    build: {
      manifest: true,
      rollupOptions: {
        input: resolve('src/renderer/index.html')
      }
    }
  }
})
