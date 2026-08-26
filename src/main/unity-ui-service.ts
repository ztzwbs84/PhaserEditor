import { createHash, randomUUID } from 'node:crypto'
import { cp, mkdir, opendir, readFile, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import {
  UnityAssetIndex,
  bakeUnityUIDocument,
  convertUnityPrefab,
  type UIDiagnostic
} from '@phaser-editor/unity-ui-converter'
import type {
  UnityUIConfiguration,
  UnityUIExportResult,
  UnityUIPrefabEntry,
  UnityUIPreviewRequest,
  UnityUIPreviewResult,
  UnityUIWorkspaceState
} from '@phaser-editor/contracts'
import { AppError, isPathInside, normalizeForComparison } from './domain'
import { createUnityUIPreviewUrl } from '../shared/unity-ui-preview-url'

interface ActiveUnityUIWorkspace {
  configuration: UnityUIConfiguration
  unityProjectRoot: string
  assetsRoot: string
  unityVersion: string | null
  prefabs: UnityUIPrefabEntry[]
  assetIndex: UnityAssetIndex
  cacheDirectory: string
}

interface CurrentPreview {
  relativePath: string
  outputDirectory: string
  result: UnityUIPreviewResult
}

export class UnityUIService {
  private workspace: ActiveUnityUIWorkspace | null = null
  private latestPreviewRequestId: string | null = null
  private currentPreview: CurrentPreview | null = null

  constructor(
    private readonly previewRoot: string,
    private readonly loadPreview: (url: string) => Promise<unknown>
  ) {}

  async configure(configuration: UnityUIConfiguration): Promise<UnityUIWorkspaceState> {
    const normalized = normalizeConfiguration(configuration)
    const { unityProjectRoot, assetsRoot } = await resolveUnityRoots(normalized.prefabRoot, normalized.uiRawRoot)
    const cacheDirectory = path.join(this.previewRoot, hashPath(assetsRoot))
    await mkdir(cacheDirectory, { recursive: true })
    const [assetIndex, prefabs, unityVersion] = await Promise.all([
      UnityAssetIndex.build(assetsRoot, path.join(cacheDirectory, 'asset-index.json')),
      listPrefabs(normalized.prefabRoot),
      readUnityVersion(unityProjectRoot)
    ])
    this.workspace = {
      configuration: normalized,
      unityProjectRoot,
      assetsRoot,
      unityVersion,
      prefabs,
      assetIndex,
      cacheDirectory
    }
    this.currentPreview = null
    this.latestPreviewRequestId = null
    return this.snapshot()
  }

  async refreshPrefabs(): Promise<UnityUIWorkspaceState> {
    const workspace = this.requireWorkspace()
    workspace.prefabs = await listPrefabs(workspace.configuration.prefabRoot)
    return this.snapshot()
  }

  async rebuildAssetIndex(): Promise<UnityUIWorkspaceState> {
    const workspace = this.requireWorkspace()
    const cachePath = path.join(workspace.cacheDirectory, 'asset-index.json')
    await rm(cachePath, { force: true })
    workspace.assetIndex = await UnityAssetIndex.build(workspace.assetsRoot, cachePath)
    return this.snapshot()
  }

  async preview(request: UnityUIPreviewRequest): Promise<UnityUIPreviewResult> {
    const workspace = this.requireWorkspace()
    if (!request.requestId.trim()) throw new AppError('INVALID_INPUT', 'Preview request ID is required.')
    this.latestPreviewRequestId = request.requestId
    const prefab = resolvePrefab(workspace, request.relativePath)
    const prefabPath = path.resolve(workspace.configuration.prefabRoot, ...prefab.relativePath.split('/'))
    const outputDirectory = path.join(workspace.cacheDirectory, 'previews', `${hashPath(prefab.relativePath)}-${safeSegment(request.requestId)}-${randomUUID()}`)
    const startedAt = performance.now()
    const document = await convertUnityPrefab(prefabPath, workspace.assetIndex, {
      unityVersion: workspace.unityVersion,
      defaultReferenceResolution: workspace.configuration.referenceResolution
    })
    const baked = await bakeUnityUIDocument(document, { outputDirectory })
    const previewUrl = `${createUnityUIPreviewUrl(this.previewRoot, baked.phaserHtml)}?embedded=1`
    const stale = request.requestId !== this.latestPreviewRequestId
    const result: UnityUIPreviewResult = {
      requestId: request.requestId,
      stale,
      prefab,
      previewUrl,
      outputDirectory,
      durationMs: Math.round(performance.now() - startedAt),
      copiedResources: baked.copiedResources,
      statistics: {
        nodeCount: document.statistics.nodeCount,
        resourceCount: document.statistics.resourceCount,
        componentCounts: document.statistics.componentCounts,
        warningCount: document.statistics.warningCount,
        errorCount: document.statistics.errorCount,
        nestedPrefabCount: document.nestedPrefabs.length
      },
      diagnostics: document.diagnostics.map(toContractDiagnostic)
    }
    if (stale) {
      await rm(outputDirectory, { recursive: true, force: true })
      return result
    }
    const previousOutput = this.currentPreview?.outputDirectory
    await this.loadPreview(previewUrl)
    this.currentPreview = { relativePath: prefab.relativePath, outputDirectory, result }
    if (previousOutput && previousOutput !== outputDirectory && isPathInside(this.previewRoot, previousOutput)) {
      void rm(previousOutput, { recursive: true, force: true })
    }
    return result
  }

  async exportCurrent(outputRoot: string): Promise<UnityUIExportResult> {
    const current = this.currentPreview
    if (!current) throw new AppError('INVALID_INPUT', 'Select and preview a Prefab before exporting it.')
    const resolvedRoot = path.resolve(outputRoot.trim())
    await assertDirectory(resolvedRoot, 'Export directory')
    const baseName = `${safeSegment(path.basename(current.relativePath, path.extname(current.relativePath))) || 'unity-ui'}-unity-ui`
    const outputDirectory = await nextAvailableDirectory(resolvedRoot, baseName)
    await cp(current.outputDirectory, outputDirectory, { recursive: true, errorOnExist: true, force: false })
    return {
      outputDirectory,
      previewHtml: path.join(outputDirectory, 'preview.html'),
      phaserHtml: path.join(outputDirectory, 'phaser.html'),
      documentJson: path.join(outputDirectory, 'ui.json'),
      reportJson: path.join(outputDirectory, 'conversion-report.json')
    }
  }

  getPreviewRoot(): string {
    return this.previewRoot
  }

  private requireWorkspace(): ActiveUnityUIWorkspace {
    if (!this.workspace) throw new AppError('INVALID_INPUT', 'Configure the Unity UI source directories first.')
    return this.workspace
  }

  private snapshot(): UnityUIWorkspaceState {
    const workspace = this.requireWorkspace()
    const summary = workspace.assetIndex.summary()
    return {
      configuration: { ...workspace.configuration, referenceResolution: { ...workspace.configuration.referenceResolution } },
      unityProjectRoot: workspace.unityProjectRoot,
      assetsRoot: workspace.assetsRoot,
      unityVersion: workspace.unityVersion,
      prefabs: workspace.prefabs.map((entry) => ({ ...entry })),
      assetIndex: {
        assetsRoot: summary.assetsRoot,
        metaFileCount: summary.metaFileCount,
        uniqueGuidCount: summary.uniqueGuidCount,
        duplicateGuidCount: summary.duplicateGuidCount
      }
    }
  }
}

export async function resolveUnityRoots(prefabRoot: string, uiRawRoot: string): Promise<{ unityProjectRoot: string; assetsRoot: string }> {
  const resolvedPrefabRoot = path.resolve(prefabRoot)
  const resolvedUiRawRoot = path.resolve(uiRawRoot)
  await Promise.all([assertDirectory(resolvedPrefabRoot, 'Prefab directory'), assertDirectory(resolvedUiRawRoot, 'UIRaw directory')])
  const prefabAssets = findAssetsAncestor(resolvedPrefabRoot)
  const uiRawAssets = findAssetsAncestor(resolvedUiRawRoot)
  if (!prefabAssets || !uiRawAssets) throw new AppError('INVALID_INPUT', 'Both source directories must be located below a Unity Assets directory.')
  if (normalizeForComparison(prefabAssets) !== normalizeForComparison(uiRawAssets)) {
    throw new AppError('INVALID_INPUT', 'Prefab and UIRaw directories must belong to the same Unity Assets directory.')
  }
  return { assetsRoot: prefabAssets, unityProjectRoot: path.dirname(prefabAssets) }
}

export async function listPrefabs(prefabRoot: string): Promise<UnityUIPrefabEntry[]> {
  const root = path.resolve(prefabRoot)
  await assertDirectory(root, 'Prefab directory')
  const entries: UnityUIPrefabEntry[] = []
  for await (const filePath of walkFiles(root)) {
    if (!filePath.toLocaleLowerCase().endsWith('.prefab')) continue
    const metadata = await stat(filePath)
    entries.push({
      name: path.basename(filePath),
      relativePath: path.relative(root, filePath).replaceAll('\\', '/'),
      size: metadata.size,
      modifiedAt: metadata.mtimeMs
    })
  }
  return entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath, 'en', { sensitivity: 'base' }))
}

function normalizeConfiguration(configuration: UnityUIConfiguration): UnityUIConfiguration {
  const prefabRoot = configuration.prefabRoot.trim()
  const uiRawRoot = configuration.uiRawRoot.trim()
  const x = Math.round(Number(configuration.referenceResolution.x))
  const y = Math.round(Number(configuration.referenceResolution.y))
  if (!prefabRoot || !uiRawRoot) throw new AppError('INVALID_INPUT', 'Prefab and UIRaw directories are required.')
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 1 || y < 1) throw new AppError('INVALID_INPUT', 'Reference resolution must contain positive whole numbers.')
  return {
    prefabRoot: path.resolve(prefabRoot),
    uiRawRoot: path.resolve(uiRawRoot),
    referenceResolution: { x, y },
    lastPrefabRelativePath: configuration.lastPrefabRelativePath
  }
}

function resolvePrefab(workspace: ActiveUnityUIWorkspace, requestedPath: string): UnityUIPrefabEntry {
  if (!requestedPath.trim() || path.isAbsolute(requestedPath)) throw new AppError('ACCESS_DENIED', 'Prefab selection must use a relative path from the configured Prefab directory.')
  const normalized = requestedPath.replaceAll('\\', '/')
  const prefab = workspace.prefabs.find((entry) => entry.relativePath === normalized)
  if (!prefab) throw new AppError('NOT_FOUND', 'The selected Prefab is not present in the configured directory.')
  const candidate = path.resolve(workspace.configuration.prefabRoot, ...normalized.split('/'))
  if (!isPathInside(workspace.configuration.prefabRoot, candidate)) throw new AppError('ACCESS_DENIED', 'The selected Prefab is outside the configured directory.')
  return prefab
}

function findAssetsAncestor(start: string): string | null {
  let current = path.resolve(start)
  while (true) {
    if (path.basename(current).toLocaleLowerCase() === 'assets') return current
    const parent = path.dirname(current)
    if (parent === current) return null
    current = parent
  }
}

async function assertDirectory(directory: string, label: string): Promise<void> {
  try {
    if (!(await stat(directory)).isDirectory()) throw new AppError('INVALID_INPUT', `${label} is not a directory.`)
  } catch (error) {
    if (error instanceof AppError) throw error
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new AppError('NOT_FOUND', `${label} does not exist: ${directory}`)
    throw error
  }
}

async function readUnityVersion(projectRoot: string): Promise<string | null> {
  try {
    const source = await readFile(path.join(projectRoot, 'ProjectSettings', 'ProjectVersion.txt'), 'utf8')
    return source.match(/^m_EditorVersion:\s*(.+)$/m)?.[1]?.trim() ?? null
  } catch {
    return null
  }
}

async function* walkFiles(directory: string): AsyncGenerator<string> {
  const entries = await opendir(directory)
  for await (const entry of entries) {
    const filePath = path.join(directory, entry.name)
    if (entry.isDirectory()) yield* walkFiles(filePath)
    else if (entry.isFile()) yield filePath
  }
}

async function nextAvailableDirectory(root: string, baseName: string): Promise<string> {
  for (let index = 1; index < 10_000; index += 1) {
    const candidate = path.join(root, index === 1 ? baseName : `${baseName}-${index}`)
    try {
      await stat(candidate)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return candidate
      throw error
    }
  }
  throw new AppError('CONFLICT', 'Could not allocate a unique export directory.')
}

function hashPath(value: string): string {
  const normalized = process.platform === 'win32' ? value.toLocaleLowerCase() : value
  return createHash('sha256').update(normalized).digest('hex').slice(0, 20)
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+$/, '_')
}

function toContractDiagnostic(diagnostic: UIDiagnostic): UnityUIPreviewResult['diagnostics'][number] {
  return {
    severity: diagnostic.severity,
    code: diagnostic.code,
    message: diagnostic.message,
    sourcePath: diagnostic.sourcePath,
    nodeId: diagnostic.nodeId,
    componentId: diagnostic.componentId,
    propertyPath: diagnostic.propertyPath,
    details: diagnostic.details
  }
}
