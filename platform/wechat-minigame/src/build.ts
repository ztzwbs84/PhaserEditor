import { createRequire } from 'node:module'
import { access, copyFile, mkdir, mkdtemp, readFile } from 'node:fs/promises'
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
  const fonts = await collectCssFonts(analysis)
  const runtimePath = await resolveRuntimeModulePath()
  const plugin = createWechatTransformPlugin({
    projectRoot: analysis.projectRoot,
    entryPath: analysis.entryPath,
    fontFamilies: fonts.map((font) => font.family),
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
    phaserVersion: analysis.phaserVersion,
    fonts
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
  options: {
    width: number
    height: number
    orientation: 'portrait' | 'landscape'
    phaserVersion: string
    fonts: RuntimeFont[]
  }
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

export interface RuntimeFont {
  family: string
  path: string
}

async function collectCssFonts(analysis: ProjectAnalysis): Promise<RuntimeFont[]> {
  const fonts = new Map<string, RuntimeFont>()
  for (const label of analysis.source.cssImports) {
    const match = /^(.*):(\d+):(.+)$/.exec(label)
    if (!match) continue
    const importer = path.resolve(analysis.projectRoot, ...match[1]!.split('/'))
    const specifier = match[3]!
    if (!specifier.startsWith('.') && !specifier.startsWith('/')) continue
    const cssPath = specifier.startsWith('/')
      ? path.resolve(analysis.projectRoot, specifier.slice(1))
      : path.resolve(path.dirname(importer), specifier)
    const css = await readFile(cssPath, 'utf8').catch(() => undefined)
    if (!css) continue
    for (const font of parseCssFontFaces(css)) {
      const runtimePath = normalizeFontPath(font.path, cssPath, analysis.projectRoot)
      if (!runtimePath) continue
      fonts.set(`${font.family}\0${runtimePath}`, { family: font.family, path: runtimePath })
    }
  }
  return [...fonts.values()].sort((left, right) => left.family.localeCompare(right.family))
}

export function parseCssFontFaces(css: string): RuntimeFont[] {
  const fonts: RuntimeFont[] = []
  for (const block of css.matchAll(/@font-face\s*\{([^}]*)\}/gi)) {
    const declarations = block[1] ?? ''
    const familyMatch = /font-family\s*:\s*(?:"([^"]+)"|'([^']+)'|([^;]+))/i.exec(declarations)
    const sourceMatch = /src\s*:\s*[^;]*?url\(\s*(?:"([^"]+)"|'([^']+)'|([^)'"\s]+))\s*\)/i.exec(declarations)
    const family = (familyMatch?.[1] ?? familyMatch?.[2] ?? familyMatch?.[3] ?? '').trim()
    const fontPath = (sourceMatch?.[1] ?? sourceMatch?.[2] ?? sourceMatch?.[3] ?? '').trim()
    if (family && fontPath) fonts.push({ family, path: fontPath })
  }
  return fonts
}

function normalizeFontPath(fontPath: string, cssPath: string, projectRoot: string): string | undefined {
  const clean = fontPath.split(/[?#]/, 1)[0]!.replace(/\\/g, '/')
  if (/^(?:data:|blob:)/i.test(clean)) return undefined
  if (/^https?:\/\//i.test(clean)) return clean
  if (clean.startsWith('/')) return clean.slice(1)
  const absolute = path.resolve(path.dirname(cssPath), ...clean.split('/'))
  const publicRoot = path.join(projectRoot, 'public')
  const relative = path.relative(publicRoot, absolute)
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return undefined
  return relative.split(path.sep).join('/')
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
