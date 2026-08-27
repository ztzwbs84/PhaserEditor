#!/usr/bin/env node
import { mkdir, opendir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { UnityAssetIndex } from './asset-index.js'
import { bakeUnityUIBatch } from './batch.js'
import { bakeUnityUIDocument } from './bake.js'
import { convertUnityPrefab } from './converter.js'
import { scanUnityProject } from './scan.js'

interface UnityUIOptions {
  unityProjectRoot: string
  prefabRoot: string
  uiRawRoot: string | null
  assetRoots: string[]
  assetIndexCache: string
  outputRoot: string
  referenceResolution: { x: number; y: number }
}

const DEFAULT_REFERENCE_RESOLUTION = { x: 750, y: 1334 }

const command = process.argv[2] ?? 'help'
const args = parseArgs(process.argv.slice(3))

try {
  if (command === 'help' || command === '--help' || command === '-h') printHelp()
  else {
    const options = await resolveOptions(args)
    if (command === 'scan') await runScan(options, args)
    else if (command === 'bake') await runBake(options, args)
    else if (command === 'batch') await runBatch(options, args)
    else throw new Error(`Unknown command: ${command}`)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}

async function runScan(options: UnityUIOptions, args: Record<string, string>): Promise<void> {
  const index = await loadIndex(options, hasFlag(args, 'rebuild-index'))
  const report = await scanUnityProject(options.unityProjectRoot, options.prefabRoot, options.uiRawRoot, index.summary())
  const output = path.resolve(args.output ?? path.join(options.outputRoot, 'scan-report.json'))
  await mkdir(path.dirname(output), { recursive: true })
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ output, prefabs: report.prefabs.count, uiRawFiles: report.uiRaw.fileCount, assetMetaFiles: report.assetIndex.metaFileCount }, null, 2))
}

async function runBake(options: UnityUIOptions, args: Record<string, string>): Promise<void> {
  const prefabPath = await resolveBakePrefab(options.prefabRoot, args.prefab)
  const index = await loadIndex(options, hasFlag(args, 'rebuild-index'))
  const unityVersion = await readUnityVersion(options.unityProjectRoot)
  const document = await convertUnityPrefab(prefabPath, index, {
    unityVersion,
    defaultReferenceResolution: options.referenceResolution
  })
  const output = path.resolve(args.output ?? path.join(options.outputRoot, document.name))
  const result = await bakeUnityUIDocument(document, { outputDirectory: output })
  console.log(JSON.stringify({
    output: result.outputDirectory,
    preview: result.previewHtml,
    phaser: result.phaserHtml,
    nodes: document.statistics.nodeCount,
    components: document.statistics.componentCounts,
    resources: result.copiedResources,
    warnings: document.statistics.warningCount,
    errors: document.statistics.errorCount
  }, null, 2))
}

async function runBatch(options: UnityUIOptions, args: Record<string, string>): Promise<void> {
  const configured = await resolveBatchPrefabs(options.prefabRoot, args)
  const limit = args.limit ? Math.max(1, Number(args.limit)) : configured.length
  const prefabPaths = configured.slice(0, Number.isFinite(limit) ? limit : configured.length)
  if (prefabPaths.length === 0) throw new Error(`No Prefab files found below ${options.prefabRoot}.`)
  const index = await loadIndex(options, hasFlag(args, 'rebuild-index'))
  const report = await bakeUnityUIBatch({
    prefabRoot: options.prefabRoot,
    prefabPaths,
    outputRoot: options.outputRoot,
    assetIndex: index,
    convert: {
      unityVersion: await readUnityVersion(options.unityProjectRoot),
      defaultReferenceResolution: options.referenceResolution
    }
  })
  console.log(JSON.stringify({
    report: path.join(report.outputRoot, 'batch-report.json'),
    index: path.join(report.outputRoot, 'index.html'),
    total: report.total,
    passed: report.passed,
    failed: report.failed,
    nodes: report.totalNodes,
    resources: report.totalResources,
    warnings: report.totalWarnings,
    errors: report.totalErrors
  }, null, 2))
}

async function loadIndex(options: UnityUIOptions, rebuild: boolean): Promise<UnityAssetIndex> {
  if (rebuild) {
    const index = await UnityAssetIndex.buildMany(options.assetRoots)
    await index.save(options.assetIndexCache)
    return index
  }
  return UnityAssetIndex.buildMany(options.assetRoots, options.assetIndexCache)
}

async function resolveOptions(args: Record<string, string>): Promise<UnityUIOptions> {
  if (args.config) {
    throw new Error('JSON config files are no longer supported. Pass --project <Unity project root> and optional CLI overrides instead.')
  }
  const explicitPrefabRoot = args['prefab-root'] ?? process.env.UNITY_UI_PREFAB_ROOT
  const explicitUiRawRoot = args['ui-raw-root'] ?? process.env.UNITY_UI_RAW_ROOT
  const explicitAssetRoots = args['asset-roots'] ?? args['asset-root'] ?? process.env.UNITY_UI_ASSET_ROOTS
  const projectInput = args.project ?? args['project-root'] ?? process.env.UNITY_PROJECT_ROOT
  const unityProjectRoot = path.resolve(projectInput ?? inferProjectRoot(explicitPrefabRoot ?? explicitUiRawRoot))
  const prefabRoot = explicitPrefabRoot
    ? path.resolve(explicitPrefabRoot)
    : await detectPrefabRoot(unityProjectRoot)
  const uiRawCandidate = path.resolve(explicitUiRawRoot ?? path.join(unityProjectRoot, 'Assets', 'UIRaw'))
  const uiRawRoot = await directoryExists(uiRawCandidate) ? uiRawCandidate : null
  const assetRoots = explicitAssetRoots
    ? splitPaths(explicitAssetRoots).map((assetRoot) => path.resolve(assetRoot))
    : [path.join(unityProjectRoot, 'Assets')]
  const outputRoot = path.resolve(args['output-root'] ?? process.env.UNITY_UI_OUTPUT_ROOT ?? path.join('artifacts', 'unity-ui'))
  const assetIndexCache = path.resolve(args['asset-index'] ?? process.env.UNITY_UI_ASSET_INDEX ?? path.join(outputRoot, 'cache', 'asset-index.json'))
  const referenceResolution = parseResolution(
    args['reference-resolution'] ?? process.env.UNITY_UI_REFERENCE_RESOLUTION,
    args['reference-width'] ?? process.env.UNITY_UI_REFERENCE_WIDTH,
    args['reference-height'] ?? process.env.UNITY_UI_REFERENCE_HEIGHT
  )
  await assertDirectory(unityProjectRoot, 'Unity project root')
  await assertDirectory(path.join(unityProjectRoot, 'Assets'), 'Unity Assets directory')
  await assertDirectory(prefabRoot, 'Prefab directory')
  if (explicitUiRawRoot && !uiRawRoot) await assertDirectory(uiRawCandidate, 'UIRaw directory')
  for (const assetRoot of assetRoots) await assertDirectory(assetRoot, 'Asset root')
  return { unityProjectRoot, prefabRoot, uiRawRoot, assetRoots, assetIndexCache, outputRoot, referenceResolution }
}

async function readUnityVersion(projectRoot: string): Promise<string | null> {
  try {
    const source = await readFile(path.join(projectRoot, 'ProjectSettings', 'ProjectVersion.txt'), 'utf8')
    return source.match(/^m_EditorVersion:\s*(.+)$/m)?.[1]?.trim() ?? null
  } catch { return null }
}

function parseArgs(values: string[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (let index = 0; index < values.length; index++) {
    const value = values[index]!
    if (!value.startsWith('--')) continue
    const key = value.slice(2)
    const next = values[index + 1]
    if (!next || next.startsWith('--')) result[key] = 'true'
    else { result[key] = next; index++ }
  }
  return result
}

function printHelp(): void {
  console.log(`Unity UGUI to HTML/Phaser converter

Commands:
  scan  --project <Unity project> [options]
  bake  --project <Unity project> --prefab <file> [options]
  batch --project <Unity project> [--prefabs <file,...>] [options]

Project options:
  --prefab-root <dir>       Auto-detects Assets/Resources/UI, Assets/UI, then Assets
  --ui-raw-root <dir>       Optional raw UI directory; omitted when it does not exist
  --asset-roots <dir;dir>   Limit GUID indexing to one or more directories
  --output-root <dir>       Defaults to artifacts/unity-ui
  --asset-index <file>      Defaults to <output-root>/cache/asset-index.json
  --reference-resolution WxH (default: 750x1334)

Command options:
  scan  --output <file>     Write scan-report.json to this path
  bake  --output <dir>      Write one baked Prefab to this directory
  batch --limit <count>     Bake only the first N Prefabs
  --rebuild-index           Rebuild the GUID index before conversion

The same values can be supplied through UNITY_PROJECT_ROOT, UNITY_UI_PREFAB_ROOT,
UNITY_UI_RAW_ROOT, UNITY_UI_ASSET_ROOTS, UNITY_UI_OUTPUT_ROOT, UNITY_UI_ASSET_INDEX, and
UNITY_UI_REFERENCE_RESOLUTION.`)
}

function hasFlag(args: Record<string, string>, name: string): boolean {
  return args[name] === 'true' || args[name.replaceAll('-', '')] === 'true'
}

async function resolveBakePrefab(prefabRoot: string, requested: string | undefined): Promise<string> {
  if (requested?.trim()) return resolvePrefabPath(prefabRoot, requested)
  const prefabs = await listPrefabPaths(prefabRoot)
  if (prefabs.length === 0) throw new Error(`No Prefab files found below ${prefabRoot}.`)
  return prefabs[0]!
}

async function resolveBatchPrefabs(prefabRoot: string, args: Record<string, string>): Promise<string[]> {
  const requested = (args.prefabs ?? args.prefab ?? '').split(/[;,]/).map((value) => value.trim()).filter(Boolean)
  if (requested.length > 0) return requested.map((value) => resolvePrefabPath(prefabRoot, value))
  return listPrefabPaths(prefabRoot)
}

function resolvePrefabPath(prefabRoot: string, requested: string): string {
  const candidate = path.isAbsolute(requested) ? path.resolve(requested) : path.resolve(prefabRoot, requested)
  const normalizedRoot = `${path.resolve(prefabRoot)}${path.sep}`
  if (candidate !== path.resolve(prefabRoot) && !candidate.startsWith(normalizedRoot)) {
    throw new Error(`Prefab must be inside the Prefab root: ${requested}`)
  }
  return candidate
}

async function listPrefabPaths(root: string): Promise<string[]> {
  const result: string[] = []
  for await (const file of walkFiles(root)) if (file.toLocaleLowerCase().endsWith('.prefab')) result.push(file)
  return result.sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))
}

async function* walkFiles(directory: string): AsyncGenerator<string> {
  const entries = await opendir(directory)
  for await (const entry of entries) {
    const filePath = path.join(directory, entry.name)
    if (entry.isDirectory()) yield* walkFiles(filePath)
    else if (entry.isFile()) yield filePath
  }
}

async function assertDirectory(directory: string, label: string): Promise<void> {
  try {
    if (!(await stat(directory)).isDirectory()) throw new Error(`${label} is not a directory: ${directory}`)
  } catch (error) {
    if (error instanceof Error && !('code' in error)) throw error
    throw new Error(`${label} does not exist: ${directory}`)
  }
}

async function directoryExists(directory: string): Promise<boolean> {
  try { return (await stat(directory)).isDirectory() } catch { return false }
}

async function detectPrefabRoot(projectRoot: string): Promise<string> {
  const assetsRoot = path.join(projectRoot, 'Assets')
  const candidates = [
    path.join(assetsRoot, 'Resources', 'UI'),
    path.join(assetsRoot, 'UI'),
    assetsRoot
  ]
  for (const candidate of candidates) if (await directoryExists(candidate)) return path.resolve(candidate)
  return path.resolve(assetsRoot)
}

function inferProjectRoot(explicitPrefabRoot: string | undefined): string {
  const start = explicitPrefabRoot ? path.resolve(explicitPrefabRoot) : path.resolve(process.cwd())
  let current = start
  while (true) {
    if (path.basename(current).toLocaleLowerCase() === 'assets') return path.dirname(current)
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return start
}

function splitPaths(value: string): string[] {
  return value.split(';').map((entry) => entry.trim()).filter(Boolean)
}

function parseResolution(value: string | undefined, width: string | undefined, height: string | undefined): { x: number; y: number } {
  let x = width ? Number(width) : DEFAULT_REFERENCE_RESOLUTION.x
  let y = height ? Number(height) : DEFAULT_REFERENCE_RESOLUTION.y
  if (value?.trim()) {
    const parts = value.trim().split(/[x,; ]+/).filter(Boolean)
    if (parts.length !== 2) throw new Error(`Invalid reference resolution: ${value}. Use WIDTHxHEIGHT.`)
    x = Number(parts[0]); y = Number(parts[1])
  }
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 1 || y < 1) throw new Error('Reference resolution must contain positive numbers.')
  return { x: Math.round(x), y: Math.round(y) }
}
