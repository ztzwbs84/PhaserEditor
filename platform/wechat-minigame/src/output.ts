import { createHash } from 'node:crypto'
import { access, copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type {
  BuildResult,
  ConversionReport,
  Diagnostic,
  FileSummary,
  Orientation,
  PatchManifest,
  ProjectAnalysis
} from './types.js'
import {
  GAME_ENTRY,
  MANUAL_ACCEPTANCE,
  OPTIONAL_AUDIO_MODULE,
  OPTIONAL_SPINE_MODULE,
  OPTIONAL_STORAGE_MODULE,
  gameJson,
  projectConfig
} from './templates.js'

const MANIFEST_NAME = '.wechat-patch-manifest.json'
const REPORT_NAME = 'conversion-report.json'
const MAIN_PACKAGE_BUDGET = 4 * 1024 * 1024

export interface PublishOptions {
  outputRoot: string
  width: number
  height: number
  orientation: Orientation
  explicitAppid?: string
  force: boolean
}

export interface PublishResult {
  appid: string
  generatedFiles: string[]
  packageBytes: number
  diagnostics: Diagnostic[]
  manifest: PatchManifest
}

export async function readPreservedAppid(outputRoot: string, explicitAppid?: string): Promise<string> {
  if (explicitAppid) return explicitAppid
  try {
    const config = JSON.parse(await readFile(path.join(outputRoot, 'project.config.json'), 'utf8')) as { appid?: string }
    if (config.appid) return config.appid
  } catch {}
  return 'touristappid'
}

export async function publishWechatProject(
  analysis: ProjectAnalysis,
  build: BuildResult,
  options: PublishOptions
): Promise<PublishResult> {
  const outputRoot = path.resolve(options.outputRoot)
  const oldManifest = await readManifest(outputRoot)
  const outputEntries = await readdir(outputRoot).catch(() => [] as string[])
  if (outputEntries.length > 0 && !oldManifest && !options.force) {
    throw new Error(`Output directory is not empty and has no ${MANIFEST_NAME}. Use --force to publish into it.`)
  }

  const appid = await readPreservedAppid(outputRoot, options.explicitAppid)
  await mkdir(outputRoot, { recursive: true })
  if (oldManifest) await removeGeneratedFiles(outputRoot, oldManifest.generatedFiles)

  const generated = new Set<string>()
  const diagnostics: Diagnostic[] = []
  await copyTree(build.directory, outputRoot, generated)

  const publicRoot = path.join(analysis.projectRoot, 'public')
  if (await exists(publicRoot)) {
    const publicFiles = await walkFiles(publicRoot)
    for (const source of publicFiles) {
      const relative = normalizeRelative(publicRoot, source)
      await publishFile(source, path.join(outputRoot, relative), outputRoot, generated)
      const encoded = encodeResourcePath(relative)
      if (encoded !== relative) {
        await publishFile(source, path.join(outputRoot, encoded), outputRoot, generated)
      }
    }
  }

  await publishText(outputRoot, 'game.js', GAME_ENTRY, generated)
  await publishText(outputRoot, 'game.json', gameJson(options.orientation), generated)
  await publishText(outputRoot, 'project.config.json', projectConfig(appid, path.basename(outputRoot)), generated)
  await publishText(outputRoot, 'optional/wechat-storage.js', OPTIONAL_STORAGE_MODULE, generated)
  await publishText(outputRoot, 'optional/wechat-audio.js', OPTIONAL_AUDIO_MODULE, generated)
  await publishText(outputRoot, 'optional/spine-fallback.js', OPTIONAL_SPINE_MODULE, generated)

  diagnostics.push(...await auditAssets(analysis, outputRoot))
  const bundle = await readFile(path.join(outputRoot, 'js', 'game.bundle.js'), 'utf8')
  if (/\bimport\s*\(/.test(bundle)) {
    diagnostics.push({
      code: 'RUNTIME_DYNAMIC_IMPORT',
      severity: 'error',
      message: 'The generated bundle still contains a runtime dynamic import.',
      runtimeImpact: true,
      file: 'js/game.bundle.js'
    })
  }
  if (bundle.includes('"/assets/') || bundle.includes("'/assets/")) {
    diagnostics.push({
      code: 'ABSOLUTE_ASSET_PATH',
      severity: 'error',
      message: 'The generated bundle still contains an absolute /assets path.',
      runtimeImpact: true,
      file: 'js/game.bundle.js'
    })
  }

  generated.add(MANIFEST_NAME)
  generated.add(REPORT_NAME)
  const sourceFiles = await summarizeSourceFiles(analysis)
  const manifest: PatchManifest = {
    schemaVersion: 1,
    generator: '@phaser-editor/wechat-minigame@0.1.0',
    generatedAt: new Date().toISOString(),
    generatedFiles: [...generated].sort(),
    sourceProject: analysis.projectRoot,
    sourceEntry: normalizeRelative(analysis.projectRoot, analysis.entryPath),
    phaserVersion: analysis.phaserVersion,
    parameters: {
      width: options.width,
      height: options.height,
      orientation: options.orientation
    },
    sourceFiles
  }
  await writeFile(path.join(outputRoot, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  const packageBytes = await directoryBytes(outputRoot)
  if (packageBytes > MAIN_PACKAGE_BUDGET) {
    diagnostics.push({
      code: 'MAIN_PACKAGE_BUDGET_EXCEEDED',
      severity: 'warning',
      message: `Generated package is ${formatBytes(packageBytes)}; it exceeds the ${formatBytes(MAIN_PACKAGE_BUDGET)} main-package budget. Move large assets to CDN or subpackages before upload.`,
      runtimeImpact: true
    })
  }

  return {
    appid,
    generatedFiles: manifest.generatedFiles,
    packageBytes,
    diagnostics,
    manifest
  }
}

export async function writeConversionReport(outputRoot: string, report: ConversionReport): Promise<void> {
  await writeFile(path.join(outputRoot, REPORT_NAME), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}

export function manualChecklist(): string[] {
  return [...MANUAL_ACCEPTANCE]
}

async function auditAssets(analysis: ProjectAnalysis, outputRoot: string): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = []
  for (const reference of analysis.source.assetReferences) {
    if (/^(?:data:|blob:|https?:\/\/|\/\/)/i.test(reference)) continue
    const relative = reference.replace(/^\//, '').split(/[?#]/, 1)[0]!
    const rawPath = path.join(outputRoot, ...relative.split('/'))
    const decodedPath = safeDecodePath(rawPath)
    if (!await exists(rawPath) && !await exists(decodedPath)) {
      diagnostics.push({
        code: 'ASSET_MISSING',
        severity: 'error',
        message: `Referenced asset is missing from the output: ${reference}`,
        runtimeImpact: true
      })
    }
  }

  const atlasFiles = (await walkFiles(outputRoot)).filter((file) => /\.atlas(?:\.txt)?$/i.test(file))
  for (const atlasFile of atlasFiles) {
    const source = await readFile(atlasFile, 'utf8').catch(() => '')
    for (const page of extractAtlasPages(source)) {
      const pagePath = path.resolve(path.dirname(atlasFile), page)
      if (!isInside(outputRoot, pagePath) || !await exists(pagePath)) {
        diagnostics.push({
          code: 'SPINE_ATLAS_PAGE_MISSING',
          severity: 'error',
          message: `Spine atlas page is missing: ${normalizeRelative(outputRoot, atlasFile)} -> ${page}`,
          runtimeImpact: true,
          file: normalizeRelative(outputRoot, atlasFile)
        })
      }
    }
  }
  return diagnostics
}

export function extractAtlasPages(source: string): string[] {
  const lines = source.split(/\r?\n/)
  const pages: string[] = []
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!.trim()
    if (!line || line.includes(':')) continue
    let next = index + 1
    while (next < lines.length && !lines[next]!.trim()) next++
    if (/^(?:size|format|filter|repeat|pma):/i.test(lines[next]?.trim() ?? '')) pages.push(line)
  }
  return [...new Set(pages)]
}

async function summarizeSourceFiles(analysis: ProjectAnalysis): Promise<FileSummary[]> {
  const relativeFiles = new Set([
    'package.json',
    'index.html',
    ...analysis.source.files,
    ...(analysis.viteConfigPath ? [normalizeRelative(analysis.projectRoot, analysis.viteConfigPath)] : [])
  ])
  const summaries: FileSummary[] = []
  for (const relative of [...relativeFiles].sort()) {
    const source = await readFile(path.join(analysis.projectRoot, relative))
    summaries.push({
      path: relative,
      sha256: createHash('sha256').update(source).digest('hex'),
      bytes: source.byteLength
    })
  }
  return summaries
}

async function readManifest(outputRoot: string): Promise<PatchManifest | undefined> {
  try {
    const value = JSON.parse(await readFile(path.join(outputRoot, MANIFEST_NAME), 'utf8')) as PatchManifest
    return value.schemaVersion === 1 && Array.isArray(value.generatedFiles) ? value : undefined
  } catch {
    return undefined
  }
}

async function removeGeneratedFiles(outputRoot: string, generatedFiles: string[]): Promise<void> {
  const ordered = [...generatedFiles].sort((left, right) => right.length - left.length)
  for (const relative of ordered) {
    if (relative === 'project.private.config.json') continue
    const target = path.resolve(outputRoot, relative)
    if (!isInside(outputRoot, target)) continue
    await rm(target, { force: true, recursive: false }).catch(() => undefined)
  }
}

async function copyTree(sourceRoot: string, outputRoot: string, generated: Set<string>): Promise<void> {
  for (const source of await walkFiles(sourceRoot)) {
    const relative = normalizeRelative(sourceRoot, source)
    await publishFile(source, path.join(outputRoot, relative), outputRoot, generated)
  }
}

async function publishFile(source: string, target: string, outputRoot: string, generated: Set<string>): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true })
  await copyFile(source, target)
  generated.add(normalizeRelative(outputRoot, target))
}

async function publishText(outputRoot: string, relative: string, value: string, generated: Set<string>): Promise<void> {
  const target = path.join(outputRoot, relative)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, value, 'utf8')
  generated.add(relative.split(path.sep).join('/'))
}

async function walkFiles(root: string): Promise<string[]> {
  if (!await exists(root)) return []
  const files: string[] = []
  const pending = [root]
  while (pending.length > 0) {
    const directory = pending.pop()!
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const value = path.join(directory, entry.name)
      if (entry.isDirectory()) pending.push(value)
      else if (entry.isFile()) files.push(value)
    }
  }
  return files.sort()
}

async function directoryBytes(root: string): Promise<number> {
  let bytes = 0
  for (const file of await walkFiles(root)) bytes += (await stat(file)).size
  return bytes
}

export function encodeResourcePath(relative: string): string {
  return relative.split('/').map((segment) => encodeURIComponent(segment)).join('/')
}

function safeDecodePath(value: string): string {
  try { return decodeURI(value) } catch { return value }
}

function normalizeRelative(root: string, value: string): string {
  return path.relative(root, value).split(path.sep).join('/')
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

async function exists(value: string): Promise<boolean> {
  return access(value).then(() => true, () => false)
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`
}
