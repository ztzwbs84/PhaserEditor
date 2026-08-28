import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { watch, type FSWatcher } from 'chokidar'
import { utilityProcess, type UtilityProcess } from 'electron'
import type { EditorSettings, InstalledPlugin, PluginManifest } from '@phaser-editor/contracts'
import { pluginManifestSchema } from '@phaser-editor/contracts'
import { AppError } from './domain'
import { ConfigStore } from './config-store'
import {
  ProjectPluginCompileAbortedError,
  ProjectPluginCompileError,
  ProjectPluginCompiler,
  type ProjectPluginBuildDiagnostic,
  type ProjectPluginCompileResult
} from './project-plugin-compiler'

const PROJECT_PLUGIN_API_VERSION = 1
const PROJECT_PLUGINS_DIRECTORY = path.join('.phaser-editor', 'plugins')
const PLUGIN_MANIFEST_LIMIT = 1024 * 1024
const PLUGIN_TEXT_RESOURCE_LIMIT = 10 * 1024 * 1024
const PLUGIN_PROTOCOL_RESOURCE_LIMIT = 50 * 1024 * 1024

type ProjectPluginManifest = PluginManifest & {
  apiVersion: number
  uiSource?: string
  contributes: PluginManifest['contributes'] & {
    fileHandlers: Array<PluginManifest['contributes']['fileHandlers'][number] & { fileMatch?: string[] }>
  }
}

type PluginBuildStatus = {
  state: 'idle' | 'building' | 'ready' | 'error' | 'stale'
  diagnostics: ProjectPluginBuildDiagnostic[]
}

type PluginView = InstalledPlugin & {
  scope: 'global' | 'project'
  instanceId: string
  revision?: string
  build: PluginBuildStatus
  uiUrl?: string
  cssUrls: string[]
}

type ProjectAwareSettings = EditorSettings & {
  disabledProjectPlugins?: Record<string, string[]>
}

interface LastGoodBuild {
  manifest: ProjectPluginManifest
  outputRoot: string
  revision?: string
  uiUrl?: string
  cssUrls: string[]
  compileResult?: ProjectPluginCompileResult
}

interface ProjectPluginRecord {
  directoryName: string
  sourceRoot: string
  sourceManifest: ProjectPluginManifest
  instanceId: string
  valid: boolean
  installed: PluginView
  lastGood?: LastGoodBuild
  dependencyFiles: string[]
  allowedRevisions: string[]
}

export interface ProjectPluginSummary {
  id: string
  name: string
  permissions: string[]
}

export interface ProjectPluginAttachResult {
  projectPath: string
  plugins: ProjectPluginSummary[]
  trustRequired: boolean
  loaded: boolean
}

export interface PluginProtocolResource {
  data: Uint8Array
  contentType: string
}

export function pluginProtocolHeaders(contentType: string): Record<string, string> {
  return {
    'Content-Type': contentType,
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    'Access-Control-Allow-Origin': '*',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'public, max-age=31536000, immutable'
  }
}

export interface PluginServiceOptions {
  cacheRoot?: string
  compiler?: ProjectPluginCompiler
  editorVersion?: string
  onChanged?: (plugins: InstalledPlugin[]) => void
}

export class PluginService {
  private readonly processes = new Map<string, UtilityProcess>()
  private readonly compiler: ProjectPluginCompiler
  private readonly onChanged: (plugins: InstalledPlugin[]) => void
  private readonly editorVersion: string
  private globalResourceRoots = new Map<string, { root: string; revision: string }>()
  private projectRecords = new Map<string, ProjectPluginRecord>()
  private projectRoot: string | null = null
  private projectKey: string | null = null
  private projectTrusted = false
  private projectSkipped = false
  private projectWatcher: FSWatcher | null = null
  private watchedDependencies = new Set<string>()
  private refreshTimer: NodeJS.Timeout | null = null
  private refreshQueue: Promise<InstalledPlugin[]> = Promise.resolve([])
  private projectGeneration = 0
  private projectBuildController: AbortController | null = null

  constructor(
    private readonly store: ConfigStore,
    private readonly pluginsRoot: string,
    private readonly hostPath: string,
    options: PluginServiceOptions = {}
  ) {
    const cacheRoot = options.cacheRoot ?? path.join(path.dirname(pluginsRoot), 'project-plugin-cache')
    this.compiler = options.compiler ?? new ProjectPluginCompiler(path.join(cacheRoot, 'v1'))
    this.onChanged = options.onChanged ?? (() => undefined)
    this.editorVersion = options.editorVersion ?? '0.1.0'
  }

  async list(): Promise<InstalledPlugin[]> {
    const globalPlugins = await this.listGlobalPlugins()
    const projectPlugins = [...this.projectRecords.values()]
      .map((record) => record.installed)
      .sort((left, right) => left.instanceId.localeCompare(right.instanceId))
    return [...globalPlugins, ...projectPlugins]
  }

  async install(sourceDirectory: string): Promise<InstalledPlugin> {
    const manifest = await readGlobalManifest(sourceDirectory)
    const destination = path.join(this.pluginsRoot, manifest.id)
    try {
      await fs.access(destination)
      throw new AppError('CONFLICT', `Plugin ${manifest.id} is already installed.`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await fs.mkdir(this.pluginsRoot, { recursive: true })
    await fs.cp(sourceDirectory, destination, { recursive: true, errorOnExist: true })
    return this.globalPluginView(manifest, destination, false, 'disabled')
  }

  async setEnabled(identifier: string, enabled: boolean, scope?: 'global' | 'project'): Promise<InstalledPlugin[]> {
    const wantsProject = scope === 'project' || (scope === undefined && identifier.startsWith('project:'))
    const projectRecord = wantsProject
      ? this.resolveProjectRecord(identifier)
      : undefined
    if (wantsProject && !projectRecord) throw new AppError('NOT_FOUND', `Project plugin ${identifier} is not attached.`)
    if (projectRecord) {
      if (!this.projectRoot || !this.projectKey) throw new AppError('INVALID_INPUT', 'No project plugin workspace is attached.')
      if (enabled && !this.projectTrusted) throw new AppError('ACCESS_DENIED', 'Trust this project before enabling its editor plugins.')
      const settings = this.store.get() as ProjectAwareSettings
      const disabledProjectPlugins = { ...(settings.disabledProjectPlugins ?? {}) }
      const disabled = new Set(disabledProjectPlugins[this.projectKey] ?? [])
      if (enabled) disabled.delete(projectRecord.sourceManifest.id)
      else disabled.add(projectRecord.sourceManifest.id)
      if (disabled.size > 0) disabledProjectPlugins[this.projectKey] = [...disabled].sort()
      else delete disabledProjectPlugins[this.projectKey]
      await this.store.update({ disabledProjectPlugins } as Partial<EditorSettings>)
      if (enabled) {
        await this.refreshProject()
      } else {
        this.deactivate(projectRecord.instanceId)
        projectRecord.installed = {
          ...projectRecord.installed,
          enabled: false,
          state: 'disabled',
          build: { state: projectRecord.lastGood ? 'ready' : 'idle', diagnostics: [] }
        }
        await this.emitChanged()
      }
      return this.list()
    }

    const id = identifier.startsWith('global:') ? identifier.slice('global:'.length) : identifier
    try {
      await readGlobalManifest(path.join(this.pluginsRoot, id))
    } catch {
      throw new AppError('NOT_FOUND', `Global plugin ${id} is not installed.`)
    }
    const current = new Set(this.store.get().enabledPlugins)
    if (enabled) current.add(id)
    else current.delete(id)
    await this.store.update({ enabledPlugins: [...current].sort() })
    if (enabled) await this.activateGlobal(id)
    else this.deactivate(globalInstanceId(id))
    const plugins = await this.list()
    this.onChanged(plugins)
    return plugins
  }

  async readResource(identifier: string, relativePath: string): Promise<string> {
    const projectRecord = this.resolveProjectRecord(identifier)
    if (projectRecord) {
      const target = await resolveRealFile(projectRecord.sourceRoot, relativePath)
      const stat = await fs.stat(target)
      if (stat.size > PLUGIN_TEXT_RESOURCE_LIMIT) throw new AppError('UNSUPPORTED', 'Plugin resource is too large.')
      return fs.readFile(target, 'utf8')
    }

    const id = identifier.startsWith('global:') ? identifier.slice('global:'.length) : identifier
    const pluginRoot = path.join(this.pluginsRoot, id)
    const target = await resolveRealFile(pluginRoot, relativePath)
    const stat = await fs.stat(target)
    if (stat.size > PLUGIN_TEXT_RESOURCE_LIMIT) throw new AppError('UNSUPPORTED', 'Plugin resource is too large.')
    return fs.readFile(target, 'utf8')
  }

  async attachProject(projectPath: string): Promise<ProjectPluginAttachResult> {
    const realProjectPath = await fs.realpath(path.resolve(projectPath))
    const key = projectSettingsKey(realProjectPath)
    if (this.projectKey && this.projectKey !== key) await this.detachProject()
    if (this.projectKey === key && this.projectRoot) {
      await this.startProjectWatcher(this.projectGeneration)
      await this.refreshProject()
      return this.projectAttachResult()
    }
    this.projectRoot = realProjectPath
    this.projectKey = key
    this.projectSkipped = false
    this.projectTrusted = this.isProjectTrusted(realProjectPath)
    const generation = this.beginProjectSession()
    await this.startProjectWatcher(generation)
    await this.refreshProject()
    return this.projectAttachResult()
  }

  async trustProjectPlugins(projectPath: string, decision: 'trust' | 'skip'): Promise<ProjectPluginAttachResult> {
    const realProjectPath = await fs.realpath(path.resolve(projectPath))
    if (!this.projectRoot || projectSettingsKey(realProjectPath) !== this.projectKey) {
      await this.attachProject(realProjectPath)
    }
    if (decision === 'skip') {
      this.projectSkipped = true
      this.projectTrusted = false
      for (const record of this.projectRecords.values()) {
        this.deactivate(record.instanceId)
        record.installed = { ...record.installed, enabled: false, state: 'disabled' }
      }
      await this.emitChanged(this.projectGeneration)
      return this.projectAttachResult()
    }
    if (decision !== 'trust') throw new AppError('INVALID_INPUT', 'Unknown project plugin trust decision.')

    const settings = this.store.get()
    const trustedProjects = settings.trustedProjects.filter((entry) => projectSettingsKey(entry) !== this.projectKey)
    trustedProjects.push(realProjectPath)
    await this.store.update({ trustedProjects })
    this.projectTrusted = true
    this.projectSkipped = false
    await this.refreshProject()
    return this.projectAttachResult()
  }

  refreshProject(): Promise<InstalledPlugin[]> {
    const generation = this.projectGeneration
    this.refreshQueue = this.refreshQueue
      .catch(() => [])
      .then(() => this.refreshAttachedProject(generation))
    return this.refreshQueue
  }

  async detachProject(): Promise<InstalledPlugin[]> {
    const generation = this.endProjectSession()
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    this.refreshTimer = null
    const watcher = this.projectWatcher
    this.projectWatcher = null
    for (const instanceId of this.projectRecords.keys()) this.deactivate(instanceId)
    this.projectRecords.clear()
    this.projectRoot = null
    this.projectKey = null
    this.projectTrusted = false
    this.projectSkipped = false
    this.watchedDependencies.clear()
    if (watcher) await watcher.close()
    await this.refreshQueue.catch(() => [])
    const plugins = await this.list()
    if (generation === this.projectGeneration) this.onChanged(plugins)
    return plugins
  }

  async resolveProtocolResource(requestUrl: string): Promise<PluginProtocolResource | null> {
    let url: URL
    try {
      url = new URL(requestUrl)
    } catch {
      return null
    }
    if (url.protocol !== 'phaser-plugin:' || url.hostname !== 'local') return null

    const legacyPath = url.searchParams.get('path')
    let filePath: string | null = null
    if (legacyPath) {
      filePath = await resolveLegacyProtocolFile(this.pluginsRoot, legacyPath)
    } else {
      const segments = url.pathname.split('/').filter(Boolean).map((segment) => decodeURIComponent(segment))
      if (segments.length < 3) return null
      const [instanceId, revision, ...resourceSegments] = segments
      if (!instanceId || !revision) return null
      const projectRecord = this.projectRecords.get(instanceId)
      if (projectRecord) {
        if (!this.projectTrusted
          || !projectRecord.installed.enabled
          || projectRecord.installed.state !== 'active'
          || !projectRecord.allowedRevisions.includes(revision)) return null
        filePath = await this.compiler.resolveOutput(instanceId, revision, resourceSegments.join('/'))
      } else {
        const globalResource = this.globalResourceRoots.get(instanceId)
        if (!globalResource || globalResource.revision !== revision) return null
        filePath = await resolveRealFile(globalResource.root, resourceSegments.join('/')).catch(() => null)
      }
    }
    if (!filePath) return null
    const stat = await fs.stat(filePath)
    if (!stat.isFile() || stat.size > PLUGIN_PROTOCOL_RESOURCE_LIMIT) return null
    return {
      data: new Uint8Array(await fs.readFile(filePath)),
      contentType: pluginContentType(filePath)
    }
  }

  async activateEnabled(): Promise<void> {
    for (const id of this.store.get().enabledPlugins) {
      await this.activateGlobal(id).catch(() => undefined)
    }
  }

  deactivateAll(): void {
    this.endProjectSession()
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    this.refreshTimer = null
    void this.projectWatcher?.close()
    this.projectWatcher = null
    for (const id of [...this.processes.keys()]) this.deactivate(id)
  }

  private async listGlobalPlugins(): Promise<PluginView[]> {
    await fs.mkdir(this.pluginsRoot, { recursive: true })
    const enabled = new Set(this.store.get().enabledPlugins)
    const items: PluginView[] = []
    const resourceRoots = new Map<string, { root: string; revision: string }>()
    for (const entry of await fs.readdir(this.pluginsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const pluginPath = path.join(this.pluginsRoot, entry.name)
      try {
        const manifest = await readGlobalManifest(pluginPath)
        assertEngineCompatible(manifest.engine, this.editorVersion)
        const active = enabled.has(manifest.id)
        const plugin = await this.globalPluginView(
          manifest,
          pluginPath,
          active,
          active ? (!manifest.main || this.processes.has(globalInstanceId(manifest.id)) ? 'active' : 'error') : 'disabled'
        )
        items.push(plugin)
        if (plugin.revision) resourceRoots.set(plugin.instanceId, { root: pluginPath, revision: plugin.revision })
      } catch (error) {
        const manifest = emptyManifest(entry.name)
        items.push({
          ...await this.globalPluginView(manifest, pluginPath, false, 'error'),
          error: errorMessage(error),
          build: { state: 'error', diagnostics: [{ severity: 'error', message: errorMessage(error) }] }
        })
      }
    }
    this.globalResourceRoots = resourceRoots
    return items.sort((left, right) => left.instanceId.localeCompare(right.instanceId))
  }

  private async globalPluginView(manifest: PluginManifest, pluginPath: string, enabled: boolean, state: PluginView['state']): Promise<PluginView> {
    const instanceId = globalInstanceId(manifest.id)
    const uiEntry = manifest.ui?.split('#', 1)[0]
    const revision = uiEntry ? await globalPluginRevision(pluginPath, manifest, uiEntry).catch(() => undefined) : undefined
    return {
      manifest,
      path: pluginPath,
      enabled,
      state,
      scope: 'global',
      instanceId,
      revision,
      build: { state: manifest.ui ? 'ready' : 'idle', diagnostics: [] },
      uiUrl: revision && uiEntry ? projectPluginResourceUrl(instanceId, revision, uiEntry) : undefined,
      cssUrls: []
    }
  }

  private async refreshAttachedProject(generation: number): Promise<InstalledPlugin[]> {
    const projectRoot = this.projectRoot
    const projectKey = this.projectKey
    if (!projectRoot || !projectKey || !this.isCurrentProject(generation, projectRoot, projectKey)) return this.list()
    const previous = this.projectRecords
    const next = await this.discoverProjectPlugins(projectRoot)
    if (!this.isCurrentProject(generation, projectRoot, projectKey)) return this.list()
    for (const record of next.values()) {
      const old = previous.get(record.instanceId)
      if (old && projectSettingsKey(old.sourceRoot) === projectSettingsKey(record.sourceRoot)) {
        record.lastGood = old.lastGood
        record.dependencyFiles = old.dependencyFiles
        record.allowedRevisions = old.allowedRevisions
      }
    }
    for (const instanceId of previous.keys()) {
      if (!next.has(instanceId)) this.deactivate(instanceId)
    }
    this.projectRecords = next

    const disabled = this.disabledProjectPlugins()
    if (!this.projectTrusted || this.projectSkipped) {
      for (const record of this.projectRecords.values()) {
        record.installed = { ...record.installed, enabled: false, state: record.valid ? 'disabled' : 'error' }
      }
      await this.syncWatchedDependencies(generation)
      await this.emitChanged(generation)
      return this.list()
    }

    const compileTargets: ProjectPluginRecord[] = []
    for (const record of this.projectRecords.values()) {
      const enabled = record.valid && !disabled.has(record.sourceManifest.id)
      record.installed = { ...record.installed, enabled, state: enabled ? 'active' : record.valid ? 'disabled' : 'error' }
      if (!enabled) {
        this.deactivate(record.instanceId)
        continue
      }
      if (record.sourceManifest.uiSource) {
        record.installed = record.lastGood
          ? {
              ...record.installed,
              manifest: record.lastGood.manifest,
              path: record.lastGood.outputRoot,
              revision: record.lastGood.revision,
              uiUrl: record.lastGood.uiUrl,
              cssUrls: record.lastGood.cssUrls,
              build: { state: 'building', diagnostics: [] }
            }
          : { ...record.installed, build: { state: 'building', diagnostics: [] } }
      }
      compileTargets.push(record)
    }
    await this.emitChanged(generation)
    await Promise.all(compileTargets.map((record) => this.compileProjectPlugin(record, generation, projectRoot, projectKey)))
    if (!this.isCurrentProject(generation, projectRoot, projectKey)) return this.list()
    await this.syncWatchedDependencies(generation)
    await this.emitChanged(generation)
    return this.list()
  }

  private async discoverProjectPlugins(projectRoot: string): Promise<Map<string, ProjectPluginRecord>> {
    const pluginsDirectory = path.join(projectRoot, PROJECT_PLUGINS_DIRECTORY)
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(pluginsDirectory, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Map()
      throw error
    }

    const candidates: Array<{ directoryName: string; sourceRoot: string; manifest?: ProjectPluginManifest; error?: string }> = []
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const candidatePath = path.join(pluginsDirectory, entry.name)
      try {
        if (!entry.isDirectory() && !(await fs.stat(candidatePath)).isDirectory()) continue
        const sourceRoot = await fs.realpath(candidatePath)
        assertRealPathInside(projectRoot, sourceRoot, 'Project plugin directory resolves outside the active project.')
        const manifest = await readProjectManifest(sourceRoot)
        assertEngineCompatible(manifest.engine, this.editorVersion)
        candidates.push({ directoryName: entry.name, sourceRoot, manifest })
      } catch (error) {
        candidates.push({ directoryName: entry.name, sourceRoot: candidatePath, error: errorMessage(error) })
      }
    }

    const idCounts = new Map<string, number>()
    for (const candidate of candidates) {
      if (candidate.manifest) idCounts.set(candidate.manifest.id, (idCounts.get(candidate.manifest.id) ?? 0) + 1)
    }
    const projectHash = projectInstanceHash(projectRoot)
    const result = new Map<string, ProjectPluginRecord>()
    for (const candidate of candidates) {
      let manifest = candidate.manifest
      let error = candidate.error
      if (manifest && (idCounts.get(manifest.id) ?? 0) > 1) error = `Duplicate project plugin id ${manifest.id}.`
      if (!manifest) manifest = emptyProjectManifest(`invalid-${shortHash(candidate.directoryName)}`)
      const instanceId = projectInstanceId(projectHash, manifest.id)
      if (result.has(instanceId)) continue
      const valid = !error
      const build: PluginBuildStatus = error
        ? { state: 'error', diagnostics: [{ severity: 'error', message: error }] }
        : { state: 'idle', diagnostics: [] }
      const record: ProjectPluginRecord = {
        directoryName: candidate.directoryName,
        sourceRoot: candidate.sourceRoot,
        sourceManifest: manifest,
        instanceId,
        valid,
        dependencyFiles: [],
        allowedRevisions: [],
        installed: {
          manifest,
          path: candidate.sourceRoot,
          enabled: false,
          state: error ? 'error' : 'disabled',
          error,
          scope: 'project',
          instanceId,
          build,
          cssUrls: []
        }
      }
      if (valid) await this.restoreCachedLastGood(record)
      result.set(instanceId, record)
    }
    return result
  }

  private async restoreCachedLastGood(record: ProjectPluginRecord): Promise<void> {
    if (!this.projectRoot || !record.sourceManifest.uiSource) return
    const cached = await this.compiler.loadLastGood(record.instanceId)
    if (!cached || !isRecord(cached.cacheMetadata)) return
    try {
      const [projectRoot, pluginRoot, sourcePath] = await Promise.all([
        fs.realpath(this.projectRoot),
        fs.realpath(record.sourceRoot),
        fs.realpath(path.resolve(record.sourceRoot, record.sourceManifest.uiSource))
      ])
      const uiSource = path.relative(pluginRoot, sourcePath).replaceAll('\\', '/')
      if (cached.identity.projectRoot !== projectRoot
        || cached.identity.pluginRoot !== pluginRoot
        || cached.identity.sourcePath !== sourcePath
        || cached.identity.uiSource !== uiSource) return
      const manifest = parseProjectManifest(cached.cacheMetadata)
      if (manifest.id !== record.sourceManifest.id) return
      const compileResult = cached.compileResult
      record.lastGood = {
        manifest: { ...manifest, ui: compileResult.entryPath },
        outputRoot: compileResult.outputRoot,
        revision: compileResult.revision,
        uiUrl: projectPluginResourceUrl(record.instanceId, compileResult.revision, compileResult.entryPath),
        cssUrls: compileResult.cssPaths.map((cssPath) => projectPluginResourceUrl(record.instanceId, compileResult.revision, cssPath)),
        compileResult
      }
      record.dependencyFiles = compileResult.inputs
      record.allowedRevisions = [compileResult.revision]
    } catch {
      // Invalid or obsolete cache metadata is ignored and replaced by the next successful build.
    }
  }

  private async compileProjectPlugin(
    record: ProjectPluginRecord,
    generation: number,
    projectRoot: string,
    projectKey: string
  ): Promise<void> {
    if (!this.isCurrentProject(generation, projectRoot, projectKey)) return
    const signal = this.projectBuildController?.signal
    if (!signal || signal.aborted) return
    const previousFingerprint = record.lastGood ? lastGoodFingerprint(record.lastGood) : null
    try {
      let good: LastGoodBuild
      if (record.sourceManifest.uiSource) {
        const compileResult = await this.compiler.compile({
          instanceId: record.instanceId,
          projectRoot,
          pluginRoot: record.sourceRoot,
          uiSource: record.sourceManifest.uiSource,
          cacheMetadata: record.sourceManifest,
          signal
        })
        if (!this.isCurrentProject(generation, projectRoot, projectKey)) return
        const manifest = { ...record.sourceManifest, ui: compileResult.entryPath }
        good = {
          manifest,
          outputRoot: compileResult.outputRoot,
          revision: compileResult.revision,
          uiUrl: projectPluginResourceUrl(record.instanceId, compileResult.revision, compileResult.entryPath),
          cssUrls: compileResult.cssPaths.map((cssPath) => projectPluginResourceUrl(record.instanceId, compileResult.revision, cssPath)),
          compileResult
        }
        record.dependencyFiles = compileResult.inputs
      } else {
        if (!this.isCurrentProject(generation, projectRoot, projectKey)) return
        good = {
          manifest: record.sourceManifest,
          outputRoot: record.sourceRoot,
          cssUrls: []
        }
        record.dependencyFiles = []
      }
      record.lastGood = good
      if (good.revision) record.allowedRevisions = [good.revision, ...record.allowedRevisions.filter((revision) => revision !== good.revision)].slice(0, 2)
      record.installed = {
        manifest: good.manifest,
        path: good.outputRoot,
        enabled: true,
        state: 'active',
        scope: 'project',
        instanceId: record.instanceId,
        revision: good.revision,
        build: { state: 'ready', diagnostics: good.compileResult?.diagnostics ?? [] },
        uiUrl: good.uiUrl,
        cssUrls: good.cssUrls
      }
      const nextFingerprint = lastGoodFingerprint(good)
      if (previousFingerprint !== nextFingerprint) this.deactivate(record.instanceId)
    } catch (error) {
      if (error instanceof ProjectPluginCompileAbortedError || signal.aborted || !this.isCurrentProject(generation, projectRoot, projectKey)) return
      const diagnostics = error instanceof ProjectPluginCompileError
        ? error.diagnostics
        : [{ severity: 'error' as const, message: errorMessage(error) }]
      if (record.lastGood) {
        const good = record.lastGood
        record.installed = {
          manifest: good.manifest,
          path: good.outputRoot,
          enabled: true,
          state: 'active',
          error: diagnostics[0]?.message,
          scope: 'project',
          instanceId: record.instanceId,
          revision: good.revision,
          build: { state: 'stale', diagnostics },
          uiUrl: good.uiUrl,
          cssUrls: good.cssUrls
        }
      } else {
        record.installed = {
          ...record.installed,
          enabled: true,
          state: 'error',
          error: diagnostics[0]?.message,
          build: { state: 'error', diagnostics }
        }
      }
    }
  }

  private async activateGlobal(id: string): Promise<void> {
    const instanceId = globalInstanceId(id)
    if (this.processes.has(instanceId)) return
    const pluginPath = path.join(this.pluginsRoot, id)
    const manifest = await readGlobalManifest(pluginPath)
    assertEngineCompatible(manifest.engine, this.editorVersion)
    await this.activateProcess(instanceId, pluginPath, manifest)
  }

  private async activateProcess(instanceId: string, pluginPath: string, manifest: PluginManifest): Promise<void> {
    if (!manifest.main || this.processes.has(instanceId)) return
    const child = utilityProcess.fork(this.hostPath, [], {
      env: {
        PHASER_EDITOR_PLUGIN_PATH: pluginPath,
        PHASER_EDITOR_PLUGIN_MAIN: manifest.main,
        PHASER_EDITOR_PLUGIN_PERMISSIONS: JSON.stringify(manifest.permissions)
      },
      serviceName: `plugin:${instanceId}`
    })
    this.processes.set(instanceId, child)
    child.once('exit', () => this.processes.delete(instanceId))
  }

  private deactivate(instanceId: string): void {
    const child = this.processes.get(instanceId)
    child?.postMessage({ type: 'deactivate' })
    child?.kill()
    this.processes.delete(instanceId)
  }

  private resolveProjectRecord(identifier: string): ProjectPluginRecord | undefined {
    const direct = this.projectRecords.get(identifier)
    if (direct) return direct
    const matches = [...this.projectRecords.values()].filter((record) => record.sourceManifest.id === identifier)
    return matches.length === 1 ? matches[0] : undefined
  }

  private isProjectTrusted(projectPath: string): boolean {
    const key = projectSettingsKey(projectPath)
    return this.store.get().trustedProjects.some((entry) => projectSettingsKey(entry) === key)
  }

  private disabledProjectPlugins(): Set<string> {
    if (!this.projectKey) return new Set()
    const settings = this.store.get() as ProjectAwareSettings
    return new Set(settings.disabledProjectPlugins?.[this.projectKey] ?? [])
  }

  private projectAttachResult(): ProjectPluginAttachResult {
    const records = [...this.projectRecords.values()]
    const summaries = records
      .filter((record) => record.valid)
      .map((record) => ({
        id: record.sourceManifest.id,
        name: record.sourceManifest.name,
        permissions: [...record.sourceManifest.permissions]
      }))
    const loaded = this.projectTrusted
      && records.every((record) => !record.valid || !record.installed.enabled || record.installed.state === 'active')
    return {
      projectPath: this.projectRoot ?? '',
      plugins: summaries,
      trustRequired: summaries.length > 0 && !this.projectTrusted && !this.projectSkipped,
      loaded
    }
  }

  private beginProjectSession(): number {
    this.projectBuildController?.abort()
    this.projectGeneration += 1
    this.projectBuildController = new AbortController()
    return this.projectGeneration
  }

  private endProjectSession(): number {
    this.projectBuildController?.abort()
    this.projectBuildController = null
    this.projectGeneration += 1
    return this.projectGeneration
  }

  private isCurrentProject(generation: number, projectRoot: string, projectKey: string): boolean {
    return generation === this.projectGeneration
      && projectSettingsKey(this.projectRoot ?? '') === projectSettingsKey(projectRoot)
      && this.projectKey === projectKey
  }

  private async startProjectWatcher(generation: number): Promise<void> {
    const projectRoot = this.projectRoot
    const projectKey = this.projectKey
    if (!projectRoot || !projectKey || this.projectWatcher || !this.isCurrentProject(generation, projectRoot, projectKey)) return
    const pluginsDirectory = path.join(projectRoot, '.phaser-editor')
    const dependencyFiles = [...new Set([...this.projectRecords.values()].flatMap((record) => record.dependencyFiles))]
    this.watchedDependencies = new Set(dependencyFiles)
    const watcher = watch([pluginsDirectory, ...dependencyFiles], {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 30 }
    })
    if (!this.isCurrentProject(generation, projectRoot, projectKey)) {
      await watcher.close()
      return
    }
    this.projectWatcher = watcher
    watcher.on('all', () => this.scheduleProjectRefresh(generation))
    watcher.on('error', (error) => this.handleProjectWatcherError(generation, error))
  }

  private async syncWatchedDependencies(generation: number): Promise<void> {
    const watcher = this.projectWatcher
    if (!watcher || generation !== this.projectGeneration) return
    const next = new Set([...this.projectRecords.values()].flatMap((record) => record.dependencyFiles))
    const added = [...next].filter((filePath) => !this.watchedDependencies.has(filePath))
    const removed = [...this.watchedDependencies].filter((filePath) => !next.has(filePath))
    if (added.length > 0) watcher.add(added)
    if (removed.length > 0) await watcher.unwatch(removed)
    if (watcher !== this.projectWatcher || generation !== this.projectGeneration) return
    this.watchedDependencies = next
  }

  private scheduleProjectRefresh(generation: number): void {
    if (!this.projectRoot || !this.projectWatcher || generation !== this.projectGeneration) return
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null
      if (generation !== this.projectGeneration) return
      void this.refreshProject().catch(() => undefined)
    }, 100)
  }

  private handleProjectWatcherError(generation: number, error: unknown): void {
    if (generation !== this.projectGeneration) return
    const diagnostic = { severity: 'error' as const, message: `Project plugin watcher failed: ${errorMessage(error)}` }
    for (const record of this.projectRecords.values()) {
      if (!record.installed.enabled) continue
      record.installed = {
        ...record.installed,
        state: record.lastGood ? 'active' : 'error',
        error: diagnostic.message,
        build: { state: record.lastGood ? 'stale' : 'error', diagnostics: [diagnostic] }
      }
    }
    void this.emitChanged(generation)
  }

  private async emitChanged(generation = this.projectGeneration): Promise<void> {
    const plugins = await this.list()
    if (generation === this.projectGeneration) this.onChanged(plugins)
  }
}

async function readGlobalManifest(pluginPath: string): Promise<PluginManifest> {
  const raw = await readManifestJson(pluginPath)
  return pluginManifestSchema.parse(raw)
}

async function readProjectManifest(pluginPath: string): Promise<ProjectPluginManifest> {
  const raw = await readManifestJson(pluginPath)
  return parseProjectManifest(raw)
}

function parseProjectManifest(raw: unknown): ProjectPluginManifest {
  const parsed = pluginManifestSchema.parse(raw) as PluginManifest & { apiVersion?: number; uiSource?: string }
  const rawRecord = isRecord(raw) ? raw : {}
  if (rawRecord.apiVersion === undefined) throw new Error(`Project plugins must declare apiVersion ${PROJECT_PLUGIN_API_VERSION}.`)
  const apiVersion = rawRecord.apiVersion
  const uiSource = rawRecord.uiSource ?? parsed.uiSource
  if (uiSource !== undefined && typeof uiSource !== 'string') throw new Error('uiSource must be a string.')
  const rawContributes = isRecord(rawRecord.contributes) ? rawRecord.contributes : {}
  const rawFileHandlers = Array.isArray(rawContributes.fileHandlers) ? rawContributes.fileHandlers : []
  const fileHandlers = parsed.contributes.fileHandlers.map((handler, index) => {
    const rawHandler = isRecord(rawFileHandlers[index]) ? rawFileHandlers[index] : {}
    const fileMatch = rawHandler.fileMatch ?? (handler as typeof handler & { fileMatch?: unknown }).fileMatch
    return {
      ...handler,
      fileMatch: Array.isArray(fileMatch)
        ? fileMatch.map((pattern) => typeof pattern === 'string' ? pattern.replaceAll('\\', '/') : pattern) as string[]
        : undefined
    }
  })
  const manifest = {
    ...parsed,
    apiVersion,
    uiSource: typeof uiSource === 'string' ? uiSource : undefined,
    contributes: { ...parsed.contributes, fileHandlers }
  } as ProjectPluginManifest
  validateProjectManifest(manifest)
  return manifest
}

async function readManifestJson(pluginPath: string): Promise<unknown> {
  const manifestPath = path.join(pluginPath, 'plugin.json')
  const stat = await fs.stat(manifestPath)
  if (!stat.isFile() || stat.size > PLUGIN_MANIFEST_LIMIT) throw new Error('plugin.json is missing or too large.')
  return JSON.parse(await fs.readFile(manifestPath, 'utf8'))
}

function validateProjectManifest(manifest: ProjectPluginManifest): void {
  if (!Number.isInteger(manifest.apiVersion) || manifest.apiVersion !== PROJECT_PLUGIN_API_VERSION) {
    throw new Error(`Unsupported project plugin apiVersion ${String(manifest.apiVersion)}; expected ${PROJECT_PLUGIN_API_VERSION}.`)
  }
  if (manifest.main) throw new Error('Project plugin apiVersion 1 does not support a background main entry.')
  if (manifest.uiSource) {
    if (!isSafeManifestPath(manifest.uiSource) || !/\.[cm]?[jt]sx?$/i.test(manifest.uiSource)) {
      throw new Error('uiSource must be a relative JavaScript or TypeScript module path inside the project.')
    }
  } else if (manifest.contributes.panels.length > 0 || manifest.contributes.fileHandlers.length > 0) {
    throw new Error('Project plugins with panels or file handlers must declare uiSource.')
  }
  assertUniqueContributions(manifest.contributes.commands, (contribution) => contribution.id, 'command')
  assertUniqueContributions(manifest.contributes.panels, (contribution) => contribution.id, 'panel')
  assertUniqueContributions(manifest.contributes.fileHandlers, (contribution) => contribution.id, 'file handler')
  assertUniqueContributions(manifest.contributes.schemas, (contribution) => contribution.uri, 'schema')
  assertUniqueContributions(manifest.contributes.components, (contribution) => contribution.id, 'component')
  assertUniqueContributions(manifest.contributes.components, (contribution) => contribution.type, 'component type')
  for (const panel of manifest.contributes.panels) validateProjectUiReference(panel.entry, `Panel ${panel.id}`)
  for (const handler of manifest.contributes.fileHandlers) {
    if (!handler || typeof handler.id !== 'string' || !handler.id.trim() || typeof handler.editor !== 'string' || !handler.editor.trim()) {
      throw new Error('Project plugin file handlers require non-empty id and editor fields.')
    }
    const fileMatch = handler.fileMatch ?? []
    const extensions = handler.extensions ?? []
    if (!Array.isArray(extensions) || extensions.some((extension) => typeof extension !== 'string' || !extension.trim())) {
      throw new Error(`File handler ${handler.id} contains an invalid extension.`)
    }
    if (fileMatch.length === 0 && extensions.length === 0) {
      throw new Error(`File handler ${handler.id} must declare fileMatch or extensions.`)
    }
    if (fileMatch.some((pattern) => typeof pattern !== 'string' || !isSafeFileMatch(pattern))) {
      throw new Error(`File handler ${handler.id} contains an invalid fileMatch pattern.`)
    }
    validateProjectUiReference(handler.editor, `File handler ${handler.id}`)
  }
  for (const schema of manifest.contributes.schemas) {
    if (!isSafeManifestPath(schema.path)) throw new Error(`Schema ${schema.uri} contains an invalid resource path.`)
    if (schema.fileMatch.some((pattern) => !isSafeFileMatch(pattern))) {
      throw new Error(`Schema ${schema.uri} contains an invalid fileMatch pattern.`)
    }
  }
  for (const component of manifest.contributes.components) {
    validateProjectUiReference(component.entry, `Component ${component.id}`)
  }
}

function assertUniqueContributions<T>(items: T[], key: (item: T) => string, label: string): void {
  const seen = new Set<string>()
  for (const item of items) {
    const value = key(item)
    if (seen.has(value)) throw new Error(`Duplicate project plugin ${label} ${value}.`)
    seen.add(value)
  }
}

function validateProjectUiReference(value: string | undefined, label: string): void {
  if (!value) return
  const [entry] = value.split('#', 1)
  if (!entry || (!/[\\/]/.test(entry) && !/\.[cm]?[jt]sx?$/i.test(entry))) return
  if (!isSafeManifestPath(entry)) throw new Error(`${label} contains an invalid UI entry path.`)
}

function isSafeManifestPath(value: string): boolean {
  if (!value.trim() || value.includes('\0') || path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value)) return false
  return !value.replaceAll('\\', '/').split('/').some((segment) => segment === '..' || segment === '')
}

function isSafeFileMatch(value: string): boolean {
  if (!value.trim() || value.includes('\0') || path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value)) return false
  return !value.replaceAll('\\', '/').split('/').some((segment) => segment === '..')
}

async function resolveRealFile(root: string, relativePath: string): Promise<string> {
  if (!isSafeManifestPath(relativePath)) throw new AppError('ACCESS_DENIED', 'Plugin resource path is invalid.')
  const [realRoot, realTarget] = await Promise.all([
    fs.realpath(root),
    fs.realpath(path.resolve(root, relativePath))
  ])
  assertRealPathInside(realRoot, realTarget, 'Plugin resource is outside the plugin folder.')
  if (!(await fs.stat(realTarget)).isFile()) throw new AppError('UNSUPPORTED', 'Plugin resource is not a file.')
  return realTarget
}

async function resolveLegacyProtocolFile(pluginsRoot: string, candidate: string): Promise<string | null> {
  try {
    const [realRoot, realCandidate] = await Promise.all([fs.realpath(pluginsRoot), fs.realpath(candidate)])
    if (!isPathInside(realRoot, realCandidate) || !(await fs.stat(realCandidate)).isFile()) return null
    return realCandidate
  } catch {
    return null
  }
}

function assertRealPathInside(root: string, candidate: string, message: string): void {
  if (!isPathInside(root, candidate)) throw new AppError('ACCESS_DENIED', message)
}

function isPathInside(root: string, candidate: string): boolean {
  const relativePath = path.relative(root, candidate)
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
}

function projectSettingsKey(projectPath: string): string {
  const normalized = path.resolve(projectPath).replaceAll('\\', '/')
  return process.platform === 'win32' ? normalized.toLocaleLowerCase() : normalized
}

function projectInstanceHash(projectPath: string): string {
  return createHash('sha256').update(projectSettingsKey(projectPath)).digest('hex').slice(0, 12)
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 8)
}

function projectInstanceId(projectHash: string, pluginId: string): string {
  return `project:${projectHash}:${pluginId}`
}

function globalInstanceId(pluginId: string): string {
  return `global:${pluginId}`
}

function projectPluginResourceUrl(instanceId: string, revision: string, relativePath: string): string {
  const resourcePath = relativePath.replaceAll('\\', '/').split('/').map(encodeURIComponent).join('/')
  return `phaser-plugin://local/${encodeURIComponent(instanceId)}/${revision}/${resourcePath}`
}

function lastGoodFingerprint(build: LastGoodBuild): string {
  return JSON.stringify({ revision: build.revision, manifest: build.manifest })
}

function emptyProjectManifest(id: string): ProjectPluginManifest {
  return { ...emptyManifest(id), apiVersion: PROJECT_PLUGIN_API_VERSION }
}

function emptyManifest(id: string): PluginManifest {
  return {
    id,
    name: id,
    version: 'invalid',
    engine: '>=0.1.0',
    apiVersion: PROJECT_PLUGIN_API_VERSION,
    permissions: [],
    contributes: { commands: [], panels: [], fileHandlers: [], schemas: [], components: [] }
  }
}

function pluginContentType(filePath: string): string {
  const extension = path.extname(filePath).toLocaleLowerCase()
  return ({
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.wasm': 'application/wasm'
  } as Record<string, string>)[extension] ?? 'application/octet-stream'
}

async function globalPluginRevision(pluginRoot: string, manifest: PluginManifest, uiEntry: string): Promise<string> {
  await resolveRealFile(pluginRoot, uiEntry)
  const realRoot = await fs.realpath(pluginRoot)
  const files = await collectFiles(realRoot)
  const hash = createHash('sha256').update(JSON.stringify(manifest)).update('\0')
  for (const filePath of files) {
    hash.update(path.relative(realRoot, filePath).replaceAll('\\', '/')).update('\0')
    hash.update(await fs.readFile(filePath)).update('\0')
  }
  return hash.digest('hex').slice(0, 16)
}

async function collectFiles(root: string): Promise<string[]> {
  const files: string[] = []
  const visitedDirectories = new Set<string>()
  const visit = async (directory: string): Promise<void> => {
    if (visitedDirectories.has(directory)) return
    visitedDirectories.add(directory)
    const entries = await fs.readdir(directory, { withFileTypes: true })
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const candidate = path.join(directory, entry.name)
      const realCandidate = await fs.realpath(candidate)
      assertRealPathInside(root, realCandidate, 'Global plugin resource resolves outside the plugin folder.')
      const stat = await fs.stat(realCandidate)
      if (stat.isDirectory()) await visit(realCandidate)
      else if (stat.isFile()) files.push(realCandidate)
    }
  }
  await visit(root)
  return [...new Set(files)].sort((left, right) => left.localeCompare(right))
}

function assertEngineCompatible(engineRange: string, editorVersion: string): void {
  const version = parseVersion(editorVersion)
  if (!version || !engineRange.split('||').some((clause) => matchesEngineClause(version, clause.trim()))) {
    throw new Error(`Plugin engine ${JSON.stringify(engineRange)} is not compatible with Phaser Editor ${editorVersion}.`)
  }
}

function matchesEngineClause(version: readonly number[], clause: string): boolean {
  if (!clause || clause === '*') return true
  const comparators = clause.split(/\s+/).filter(Boolean)
  return comparators.every((comparator) => {
    const caret = comparator.match(/^\^(\d+\.\d+\.\d+)$/)
    if (caret?.[1]) {
      const minimum = parseVersion(caret[1])!
      const maximum = minimum[0] > 0
        ? [minimum[0] + 1, 0, 0]
        : minimum[1] > 0 ? [0, minimum[1] + 1, 0] : [0, 0, minimum[2] + 1]
      return compareVersions(version, minimum) >= 0 && compareVersions(version, maximum) < 0
    }
    const tilde = comparator.match(/^~(\d+\.\d+\.\d+)$/)
    if (tilde?.[1]) {
      const minimum = parseVersion(tilde[1])!
      return compareVersions(version, minimum) >= 0
        && compareVersions(version, [minimum[0], minimum[1] + 1, 0]) < 0
    }
    const match = comparator.match(/^(>=|<=|>|<|=)?v?(\d+\.\d+\.\d+)$/)
    if (!match?.[2]) return false
    const comparison = compareVersions(version, parseVersion(match[2])!)
    return match[1] === '>=' ? comparison >= 0
      : match[1] === '<=' ? comparison <= 0
        : match[1] === '>' ? comparison > 0
          : match[1] === '<' ? comparison < 0
            : comparison === 0
  })
}

function parseVersion(value: string): [number, number, number] | null {
  const match = value.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/)
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

function compareVersions(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < 3; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0)
    if (difference !== 0) return Math.sign(difference)
  }
  return 0
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
