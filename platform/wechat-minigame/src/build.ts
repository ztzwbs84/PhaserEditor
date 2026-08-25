import { createRequire } from 'node:module'
import { access, copyFile, mkdir, mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, type Plugin } from 'vite'
import type { BuildResult, ProjectAnalysis } from './types.js'
import { createWechatTransformPlugin, type TransformStats } from './transform.js'

export async function buildWechatBundle(
  analysis: ProjectAnalysis,
  width: number,
  height: number,
  orientation: 'portrait' | 'landscape'
): Promise<BuildResult> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'phaser-wechat-'))
  const stats: TransformStats = {
    transformedGames: 0,
    removedCssImports: [],
    rewrittenAssets: []
  }
  const runtimePath = await resolveRuntimeModulePath()
  const plugin = createWechatTransformPlugin({
    projectRoot: analysis.projectRoot,
    entryPath: analysis.entryPath,
    stats
  })

  await build({
    root: analysis.projectRoot,
    configFile: analysis.viteConfigPath ?? false,
    publicDir: false,
    logLevel: 'silent',
    plugins: [plugin],
    build: {
      outDir: directory,
      emptyOutDir: true,
      copyPublicDir: false,
      cssCodeSplit: false,
      modulePreload: false,
      minify: 'esbuild',
      sourcemap: false,
      target: 'es2018',
      lib: false,
      rollupOptions: {
        input: 'virtual:phaser-wechat-bootstrap',
        external: (id) => id === 'phaser',
        output: {
          format: 'iife',
          name: 'PhaserWechatGame',
          inlineDynamicImports: true,
          globals: {
            phaser: 'GameGlobal.__PHASER_WECHAT_PHASER__'
          },
          entryFileNames: 'js/game.bundle.js',
          chunkFileNames: 'js/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]'
        }
      }
    }
  })

  await buildWechatAdapter(runtimePath, directory, {
    width,
    height,
    orientation,
    phaserVersion: analysis.phaserVersion
  })
  const phaserBundlePath = await resolvePhaserBundlePath(analysis)
  const outputPhaserPath = path.join(directory, 'js', 'phaser.js')
  await mkdir(path.dirname(outputPhaserPath), { recursive: true })
  await copyFile(phaserBundlePath, outputPhaserPath)

  const bundlePath = path.join(directory, 'js', 'game.bundle.js')
  await access(bundlePath).catch(() => {
    throw new Error(`Vite did not produce the expected bundle: ${bundlePath}`)
  })
  return {
    directory,
    bundlePath,
    transformedGames: stats.transformedGames,
    removedCssImports: [...new Set(stats.removedCssImports)].sort(),
    rewrittenAssets: [...new Set(stats.rewrittenAssets)].sort()
  }
}

async function buildWechatAdapter(
  runtimePath: string,
  directory: string,
  options: { width: number; height: number; orientation: 'portrait' | 'landscape'; phaserVersion: string }
): Promise<void> {
  const entryId = '\0phaser-wechat-adapter-entry'
  const plugin: Plugin = {
    name: 'phaser-editor-wechat-adapter-entry',
    resolveId(source) {
      if (source === 'virtual:phaser-wechat-adapter-entry') return entryId
      if (source === 'virtual:phaser-wechat-runtime') return runtimePath
      return null
    },
    load(id) {
      if (id !== entryId) return null
      return [
        'import { installWechatRuntime } from "virtual:phaser-wechat-runtime";',
        `installWechatRuntime(${JSON.stringify(options)});`
      ].join('\n')
    }
  }

  await build({
    root: path.dirname(runtimePath),
    configFile: false,
    publicDir: false,
    logLevel: 'silent',
    plugins: [plugin],
    build: {
      outDir: directory,
      emptyOutDir: false,
      copyPublicDir: false,
      modulePreload: false,
      minify: 'esbuild',
      sourcemap: false,
      target: 'es2018',
      lib: false,
      rollupOptions: {
        input: 'virtual:phaser-wechat-adapter-entry',
        output: {
          format: 'iife',
          name: 'PhaserWechatAdapter',
          inlineDynamicImports: true,
          entryFileNames: 'js/weapp-adapter.js'
        }
      }
    }
  })
}

async function resolvePhaserBundlePath(analysis: ProjectAnalysis): Promise<string> {
  const require = createRequire(analysis.packageJsonPath)
  const candidates: string[] = [path.join(analysis.projectRoot, 'node_modules', 'phaser', 'dist', 'phaser.min.js')]
  try {
    candidates.push(path.join(path.dirname(require.resolve('phaser/package.json')), 'dist', 'phaser.min.js'))
  } catch {}
  for (const candidate of candidates) {
    if (await access(candidate).then(() => true, () => false)) return candidate
  }
  throw new Error(`Installed Phaser ${analysis.phaserVersion} does not provide dist/phaser.min.js.`)
}

async function resolveRuntimeModulePath(): Promise<string> {
  const directory = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    path.join(directory, 'runtime', 'wechat-runtime.js'),
    path.join(directory, 'runtime', 'wechat-runtime.ts')
  ]
  for (const candidate of candidates) {
    if (await access(candidate).then(() => true, () => false)) return candidate
  }
  throw new Error('Wechat runtime module is missing from the converter package.')
}
