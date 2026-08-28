import type { ComponentType } from 'react'
import { z } from 'zod'
import type {
  PluginSurfaceContext,
  PluginSurfaceDefinition,
  PluginSurfaceHandle,
  PluginSurfaceKind,
  PluginUndoRedoHandlers
} from '@phaser-editor/plugin-sdk'
import type {
  EditorDocument,
  FileEntry,
  FileSnapshot,
  InstalledPlugin,
  PluginBuildDiagnostic
} from '@phaser-editor/contracts'
import { commandRegistry } from './commands'
import {
  commandContributionRegistry,
  componentProviderContributionRegistry,
  fileHandlerContributionRegistry,
  panelContributionRegistry,
  schemaContributionRegistry,
  type ContributionEntry
} from './contribution-registry'
import {
  sceneComponentRegistry,
  type ComponentProjectionContext,
  type ComponentProjectionHandle
} from './scene-components'

export type {
  PluginSurfaceContext,
  PluginSurfaceDefinition,
  PluginSurfaceHandle,
  PluginSurfaceKind,
  PluginUndoRedoHandlers
} from '@phaser-editor/plugin-sdk'

export interface PluginSurfaceProps {
  pluginId: string
  contributionId: string
  document?: EditorDocument
  context: PluginSurfaceContext
}

export type PluginSurfaceComponent = ComponentType<PluginSurfaceProps>

export type PluginSurfaceExport = PluginSurfaceComponent | PluginSurfaceDefinition

export interface PluginCommandContext {
  pluginId: string
  instanceId: string
  openPanel(id: string): void
  openFile(path: string): void
  readResource(relativePath: string): Promise<string>
}

export interface PluginUiModule {
  default?: PluginSurfaceExport
  mount?: PluginSurfaceDefinition['mount']
  update?: PluginSurfaceDefinition['update']
  dispose?: PluginSurfaceDefinition['dispose']
  commands?: Record<string, (context: PluginCommandContext) => void | Promise<void>>
  panels?: Record<string, PluginSurfaceExport>
  fileEditors?: Record<string, PluginSurfaceExport>
  components?: Record<string, PluginComponentProvider | PluginProjectionFactory>
}

export type PluginProjectionFactory = (data: Record<string, unknown>, context: ComponentProjectionContext) => ComponentProjectionHandle
export interface PluginComponentProvider { createProjection?: PluginProjectionFactory }

export interface PluginRuntimeDiagnostic {
  kind: 'activation' | 'execution' | 'conflict' | 'runtime'
  category: 'command' | 'panel' | 'fileHandler' | 'schema' | 'component' | 'plugin'
  pluginId: string
  instanceId?: string
  contributionId?: string
  severity?: 'info' | 'warning' | 'error'
  message: string
  file?: string
  line?: number
  column?: number
}

interface ActivePlugin {
  plugin: InstalledPlugin
  fingerprint: string
  dispose(): void
}

interface ActiveHistoryRegistration {
  id: number
  isActive(): boolean
  handlers: PluginUndoRedoHandlers
}

export interface FileHandlerResolution {
  winner?: ContributionEntry<InstalledPlugin['manifest']['contributes']['fileHandlers'][number]>
  candidates: Array<ContributionEntry<InstalledPlugin['manifest']['contributes']['fileHandlers'][number]>>
}

export class PluginContributionRuntime {
  private readonly active = new Map<string, ActivePlugin>()
  private readonly modulePromises = new Map<string, Promise<PluginUiModule>>()
  private readonly componentRegistrations = new Map<string, { owner: string; contributionId: string; dispose(): void }>()
  private readonly listeners = new Set<() => void>()
  private readonly historyRegistrations: ActiveHistoryRegistration[] = []
  private diagnostics: PluginRuntimeDiagnostic[] = []
  private revision = 0
  private historyRegistrationId = 0
  private projectRoot: string | null = null
  private synchronization: Promise<void> = Promise.resolve()
  private reporter: (diagnostic: PluginRuntimeDiagnostic) => void = (diagnostic) => console.error(diagnostic.message)

  constructor(private readonly importer: (url: string) => Promise<PluginUiModule> = importPluginUiModule) {
    const registries = [commandContributionRegistry, panelContributionRegistry, fileHandlerContributionRegistry, schemaContributionRegistry, componentProviderContributionRegistry]
    registries.forEach((registry) => registry.subscribe(() => this.emitChange()))
    componentProviderContributionRegistry.subscribe(() => this.reconcileComponentProviders())
  }

  setReporter(reporter: (diagnostic: PluginRuntimeDiagnostic) => void): void {
    this.reporter = reporter
  }

  setProjectRoot(root: string | null): void {
    const next = root ? normalizePath(root).replace(/\/$/, '') : null
    if (this.projectRoot === next) return
    this.projectRoot = next
    this.emitChange()
  }

  async refresh(): Promise<void> {
    const result = await window.editorApi.plugins.list()
    if (!result.ok) {
      this.record({ kind: 'activation', category: 'plugin', pluginId: 'runtime', severity: 'error', message: result.error.message })
      return
    }
    await this.synchronize(result.value)
  }

  synchronize(plugins: InstalledPlugin[]): Promise<void> {
    this.synchronization = this.synchronization.catch(() => undefined).then(() => this.applySynchronization(plugins))
    return this.synchronization
  }

  getPlugin(id: string): InstalledPlugin | undefined {
    return this.active.get(id)?.plugin ?? [...this.active.values()].find((record) => record.plugin.manifest.id === id)?.plugin
  }

  getDiagnostics(): PluginRuntimeDiagnostic[] {
    return [...this.diagnostics, ...this.conflictDiagnostics()]
  }

  reportSurfaceDiagnostic(instanceId: string, contributionId: string, diagnostic: string | Partial<PluginBuildDiagnostic> & { message: string }): void {
    const plugin = this.getPlugin(instanceId)
    const detail = typeof diagnostic === 'string' ? { message: diagnostic } : diagnostic
    this.record({
      kind: 'runtime',
      category: 'plugin',
      pluginId: plugin?.manifest.id ?? instanceId,
      instanceId,
      contributionId,
      severity: detail.severity ?? 'error',
      message: detail.message,
      file: detail.file,
      line: detail.line,
      column: detail.column
    })
  }

  registerActiveUndoRedo(isActive: () => boolean, handlers: PluginUndoRedoHandlers): () => void {
    const registration = { id: ++this.historyRegistrationId, isActive, handlers }
    this.historyRegistrations.push(registration)
    return () => {
      const index = this.historyRegistrations.indexOf(registration)
      if (index >= 0) this.historyRegistrations.splice(index, 1)
    }
  }

  executeActiveHistory(action: 'undo' | 'redo'): boolean {
    for (let index = this.historyRegistrations.length - 1; index >= 0; index -= 1) {
      const registration = this.historyRegistrations[index]!
      if (!registration.isActive()) continue
      const canExecute = action === 'undo' ? registration.handlers.canUndo : registration.handlers.canRedo
      if (canExecute?.() === false) return true
      registration.handlers[action]()
      return true
    }
    return false
  }

  getFileHandlerResolution(path: string): FileHandlerResolution {
    const relativePath = projectRelativePath(path, this.projectRoot)
    const candidates = fileHandlerContributionRegistry.list()
      .filter((entry) => matchesPluginFileHandler(entry.value, path, relativePath))
      .sort(compareEntries)
    return { winner: candidates[0], candidates }
  }

  async loadPanel(id: string, retry = false): Promise<PluginSurfaceExport> {
    const contribution = panelContributionRegistry.get(id)
    if (!contribution) throw new Error(`Panel ${id} is no longer registered.`)
    const plugin = this.requirePlugin(contribution.owner)
    const reference = parseUiReference(contribution.value.entry, plugin.manifest.uiSource ?? plugin.manifest.ui, id)
    const module = await this.loadUiModule(plugin, reference.entry, retry)
    try {
      return resolveSurface(module, 'panels', id, reference.exportName)
    } catch (error) {
      this.record(this.uiRuntimeDiagnostic(plugin, 'panel', id, 'resolve', error))
      throw error
    }
  }

  async loadFileEditor(path: string, retry = false): Promise<PluginSurfaceExport> {
    const contribution = this.getFileHandlerResolution(path).winner
    if (!contribution) throw new Error(`No plugin file editor is registered for ${path}.`)
    const plugin = this.requirePlugin(contribution.owner)
    const reference = parseUiReference(contribution.value.editor, plugin.manifest.uiSource ?? plugin.manifest.ui, contribution.id)
    const module = await this.loadUiModule(plugin, reference.entry, retry)
    try {
      return resolveSurface(module, 'fileEditors', contribution.id, reference.exportName)
    } catch (error) {
      this.record(this.uiRuntimeDiagnostic(plugin, 'fileHandler', contribution.id, 'resolve', error))
      throw error
    }
  }

  async loadComponentProvider(type: string, retry = false): Promise<PluginComponentProvider | PluginProjectionFactory> {
    const contribution = componentProviderContributionRegistry.get(type)
    if (!contribution) throw new Error(`Component provider ${type} is no longer registered.`)
    const plugin = this.requirePlugin(contribution.owner)
    const reference = parseUiReference(contribution.value.entry, plugin.manifest.uiSource ?? plugin.manifest.ui, contribution.value.id)
    const module = await this.loadUiModule(plugin, reference.entry, retry)
    const named = reference.exportName ? (module as PluginUiModule & Record<string, unknown>)[reference.exportName] : undefined
    const provider = named ?? module.components?.[reference.exportName ?? contribution.value.id] ?? module.components?.[type]
    if (!provider || (typeof provider !== 'function' && typeof provider !== 'object')) throw new Error(`UI module does not export a component provider for ${type}.`)
    return provider as PluginComponentProvider | PluginProjectionFactory
  }

  async executeCommand(instanceId: string, commandId: string): Promise<void> {
    try {
      const plugin = this.requirePlugin(instanceId)
      const module = await this.loadUiModule(plugin)
      const handler = module.commands?.[commandId]
      if (!handler) throw new Error(`UI module does not export commands[${JSON.stringify(commandId)}].`)
      await handler(this.createCommandContext(plugin))
    } catch (error) {
      const diagnostic = this.errorDiagnostic('execution', 'command', instanceId, commandId, error)
      this.record(diagnostic)
      throw new Error(diagnostic.message)
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getRevision(): number {
    return this.revision
  }

  resetForTests(): void {
    this.active.forEach((record) => record.dispose())
    this.active.clear()
    this.componentRegistrations.forEach((registration) => registration.dispose())
    this.componentRegistrations.clear()
    this.modulePromises.clear()
    this.historyRegistrations.splice(0)
    this.projectRoot = null
    this.diagnostics = []
    this.emitChange()
  }

  private reconcileComponentProviders(): void {
    const wanted = new Map(componentProviderContributionRegistry.list().map((entry) => [entry.id, entry]))
    for (const [type, registration] of this.componentRegistrations) {
      const entry = wanted.get(type)
      if (!entry || entry.owner !== registration.owner || entry.value.id !== registration.contributionId) {
        registration.dispose()
        this.componentRegistrations.delete(type)
      }
    }
    for (const [type, entry] of wanted) {
      if (this.componentRegistrations.has(type)) continue
      if (sceneComponentRegistry.get(type)) continue
      try {
        const contribution = entry.value
        const definition = {
          type,
          version: contribution.version,
          label: contribution.label,
          dataSchema: z.record(z.string(), z.unknown()),
          createDefault: () => structuredClone(contribution.defaultData ?? {}),
          supports: () => true,
          properties: contribution.properties ?? [],
          createProjection: contribution.entry || this.active.get(entry.owner)?.plugin.manifest.ui || this.active.get(entry.owner)?.plugin.manifest.uiSource
            ? (data: Record<string, unknown>, context: ComponentProjectionContext) => this.createLazyComponentProjection(entry.owner, type, contribution.id, data, context)
            : undefined
        }
        const dispose = sceneComponentRegistry.register(definition)
        this.componentRegistrations.set(type, { owner: entry.owner, contributionId: contribution.id, dispose })
      } catch (error) {
        this.record(this.errorDiagnostic('activation', 'component', entry.owner, entry.value.id, error))
      }
    }
  }

  private createLazyComponentProjection(instanceId: string, type: string, contributionId: string, data: Record<string, unknown>, context: ComponentProjectionContext): ComponentProjectionHandle {
    let currentData = data
    let currentContext = context
    let delegate: ComponentProjectionHandle | null = null
    let active = true
    let destroyed = false
    let loading = false
    let failed = false

    const load = (retry: boolean): void => {
      if (loading || destroyed) return
      loading = true
      failed = false
      void this.loadComponentProvider(type, retry).then((provider) => {
        const factory = typeof provider === 'function' ? provider : provider.createProjection
        if (!factory) throw new Error(`Component provider ${type} does not export createProjection.`)
        const handle = factory(currentData, currentContext)
        if (destroyed) handle.destroy()
        else {
          delegate = handle
          delegate.setActive?.(active)
          delegate.update(currentData, currentContext)
        }
      }).catch((error) => {
        failed = true
        this.record(this.errorDiagnostic('activation', 'component', instanceId, contributionId, error))
        currentContext.report(`Plugin ${this.getPlugin(instanceId)?.manifest.id ?? instanceId} component ${type} could not be projected.`)
      }).finally(() => { loading = false })
    }
    load(false)

    return {
      update: (nextData, nextContext) => {
        currentData = nextData
        currentContext = nextContext
        delegate?.update(nextData, nextContext)
        if (failed && !loading) load(true)
      },
      setActive: (nextActive) => { active = nextActive; delegate?.setActive?.(nextActive) },
      destroy: () => { destroyed = true; delegate?.destroy(); delegate = null }
    }
  }

  private async applySynchronization(plugins: InstalledPlugin[]): Promise<void> {
    const targets = new Map(selectEffectivePlugins(plugins).map((plugin) => [plugin.instanceId, plugin]))

    for (const [instanceId, record] of this.active) {
      const target = targets.get(instanceId)
      if (!target || fingerprint(target) !== record.fingerprint) {
        record.dispose()
        this.active.delete(instanceId)
        this.clearModuleCache(instanceId)
      }
    }

    const activeInstances = new Set(targets.keys())
    this.diagnostics = this.diagnostics.filter((diagnostic) => diagnostic.kind === 'execution' && (!diagnostic.instanceId || activeInstances.has(diagnostic.instanceId)))
    for (const plugin of targets.values()) {
      if (!this.active.has(plugin.instanceId)) await this.activate(plugin)
    }
    this.emitChange()
  }

  private async activate(plugin: InstalledPlugin): Promise<void> {
    const owner = plugin.instanceId
    const disposers: Array<() => void> = []
    const activePlugin: ActivePlugin = {
      plugin,
      fingerprint: fingerprint(plugin),
      dispose: () => disposers.splice(0).reverse().forEach((dispose) => dispose())
    }
    this.active.set(owner, activePlugin)
    const add = (category: PluginRuntimeDiagnostic['category'], id: string, register: () => () => void): void => {
      try {
        disposers.push(register())
      } catch (error) {
        this.record(this.errorDiagnostic('activation', category, owner, id, error))
      }
    }

    try {
      for (const contribution of plugin.manifest.contributes.commands) {
        add('command', contribution.id, () => commandContributionRegistry.register({ owner, id: contribution.id, priority: contribution.priority, value: contribution }))
        add('command', contribution.id, () => commandRegistry.registerContribution(owner, {
          id: contribution.id,
          title: contribution.title,
          shortcut: contribution.defaultShortcut,
          execute: () => this.executeCommand(owner, contribution.id)
        }, contribution.priority))
      }
      for (const contribution of plugin.manifest.contributes.panels) {
        add('panel', contribution.id, () => panelContributionRegistry.register({ owner, id: contribution.id, priority: contribution.priority, value: contribution }))
      }
      for (const contribution of plugin.manifest.contributes.fileHandlers) {
        add('fileHandler', contribution.id, () => fileHandlerContributionRegistry.register({ owner, id: contribution.id, priority: contribution.priority, value: contribution }))
      }
      for (const contribution of plugin.manifest.contributes.components) {
        add('component', contribution.id, () => componentProviderContributionRegistry.register({ owner, id: contribution.type, priority: contribution.priority, value: contribution }))
      }
      for (const contribution of plugin.manifest.contributes.schemas) {
        try {
          const resource = await window.editorApi.plugins.readResource(owner, contribution.path)
          if (!resource.ok) throw new Error(resource.error.message)
          const schema = JSON.parse(resource.value) as Record<string, unknown>
          add('schema', contribution.uri, () => schemaContributionRegistry.register({ owner, id: contribution.uri, priority: contribution.priority, value: { ...contribution, schema } }))
        } catch (error) {
          this.record(this.errorDiagnostic('activation', 'schema', owner, contribution.uri, error))
        }
      }
    } catch (error) {
      activePlugin.dispose()
      this.active.delete(owner)
      this.clearModuleCache(owner)
      this.record(this.errorDiagnostic('activation', 'plugin', owner, plugin.manifest.id, error))
    }
  }

  private createCommandContext(plugin: InstalledPlugin): PluginCommandContext {
    return {
      pluginId: plugin.manifest.id,
      instanceId: plugin.instanceId,
      openPanel: (id) => window.dispatchEvent(new CustomEvent('phaser-editor:show-contributed-panel', { detail: id })),
      openFile: (path) => window.dispatchEvent(new CustomEvent('phaser-editor:open-document-tab', { detail: path })),
      readResource: async (relativePath) => {
        const result = await window.editorApi.plugins.readResource(plugin.instanceId, relativePath)
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      }
    }
  }

  private loadUiModule(plugin: InstalledPlugin, entry = plugin.manifest.uiSource ?? plugin.manifest.ui, retry = false): Promise<PluginUiModule> {
    if (!entry && !plugin.uiUrl) return Promise.reject(new Error('Plugin manifest does not declare a UI entry.'))
    const relativeEntry = entry?.split('#', 1)[0] ?? ''
    const manifestUiEntry = plugin.manifest.ui?.split('#', 1)[0] ?? ''
    const usePublishedUrl = Boolean(plugin.uiUrl) && (plugin.scope === 'project' || !relativeEntry || relativeEntry === manifestUiEntry)
    const url = usePublishedUrl ? plugin.uiUrl! : window.editorApi.plugins.resourceUrl(joinPath(plugin.path, relativeEntry))
    const key = `${plugin.instanceId}:${plugin.revision ?? 'legacy'}:${url}`
    if (retry) this.modulePromises.delete(key)
    const cached = this.modulePromises.get(key)
    if (cached) return cached
    const promise = Promise.resolve()
      .then(() => this.importer(url))
      .catch((error: unknown) => {
        this.record(this.uiRuntimeDiagnostic(plugin, 'plugin', relativeEntry || plugin.manifest.id, 'import', error, url))
        throw error
      })
    this.modulePromises.set(key, promise)
    return promise
  }

  private requirePlugin(id: string): InstalledPlugin {
    const plugin = this.getPlugin(id)
    if (!plugin) throw new Error(`Plugin ${id} is not active.`)
    return plugin
  }

  private clearModuleCache(instanceId: string): void {
    for (const key of this.modulePromises.keys()) if (key.startsWith(`${instanceId}:`)) this.modulePromises.delete(key)
  }

  private conflictDiagnostics(): PluginRuntimeDiagnostic[] {
    const diagnostics: PluginRuntimeDiagnostic[] = []
    const add = (category: PluginRuntimeDiagnostic['category'], conflicts: Array<{ id: string; winner: { owner: string }; shadowed: Array<{ owner: string }> }>): void => {
      conflicts.forEach((conflict) => {
        const owners = [conflict.winner, ...conflict.shadowed].map((entry) => this.describeOwner(entry.owner))
        diagnostics.push({
          kind: 'conflict',
          category,
          pluginId: this.getPlugin(conflict.winner.owner)?.manifest.id ?? conflict.winner.owner,
          instanceId: conflict.winner.owner,
          contributionId: conflict.id,
          severity: 'warning',
          message: `${category} ${conflict.id} is provided by ${owners.join(', ')}; ${owners[0]} wins.`
        })
      })
    }
    add('command', commandContributionRegistry.conflicts())
    add('panel', panelContributionRegistry.conflicts())
    add('schema', schemaContributionRegistry.conflicts())
    add('component', componentProviderContributionRegistry.conflicts())

    const byPattern = new Map<string, ReturnType<typeof fileHandlerContributionRegistry.list>>()
    fileHandlerContributionRegistry.list().forEach((entry) => fileHandlerPatterns(entry.value).forEach((pattern) => {
      const key = pattern.toLocaleLowerCase()
      byPattern.set(key, [...(byPattern.get(key) ?? []), entry])
    }))
    for (const [pattern, entries] of byPattern) {
      const sorted = entries.sort(compareEntries)
      if (sorted.length > 1) diagnostics.push({
        kind: 'conflict',
        category: 'fileHandler',
        pluginId: this.getPlugin(sorted[0]!.owner)?.manifest.id ?? sorted[0]!.owner,
        instanceId: sorted[0]!.owner,
        contributionId: pattern,
        severity: 'warning',
        message: `fileHandler ${pattern} is provided by ${sorted.map((entry) => this.describeOwner(entry.owner)).join(', ')}; ${this.describeOwner(sorted[0]!.owner)} wins.`
      })
    }
    return diagnostics
  }

  private describeOwner(owner: string): string {
    const plugin = this.getPlugin(owner)
    return plugin ? `${plugin.manifest.id} (${plugin.scope})` : owner
  }

  private errorDiagnostic(kind: 'activation' | 'execution', category: PluginRuntimeDiagnostic['category'], instanceId: string, contributionId: string, error: unknown): PluginRuntimeDiagnostic {
    const reason = error instanceof Error ? error.message : String(error)
    const pluginId = this.getPlugin(instanceId)?.manifest.id ?? instanceId
    return { kind, category, pluginId, instanceId, contributionId, severity: 'error', message: `Plugin ${pluginId} ${category} ${contributionId} failed: ${reason}` }
  }

  private uiRuntimeDiagnostic(
    plugin: InstalledPlugin,
    category: PluginRuntimeDiagnostic['category'],
    contributionId: string,
    phase: 'import' | 'resolve',
    error: unknown,
    file = plugin.uiUrl
  ): PluginRuntimeDiagnostic {
    const reason = error instanceof Error ? error.message : String(error)
    const location = file ? ` from ${file}` : ''
    return {
      kind: 'runtime',
      category,
      pluginId: plugin.manifest.id,
      instanceId: plugin.instanceId,
      contributionId,
      severity: 'error',
      message: `Plugin ${plugin.manifest.id} UI ${phase} failed${location}: ${reason}`,
      file
    }
  }

  private record(diagnostic: PluginRuntimeDiagnostic): void {
    this.diagnostics.push(diagnostic)
    try {
      this.reporter(diagnostic)
    } catch (error) {
      console.error('Plugin runtime diagnostic reporter failed.', error)
    }
    this.emitChange()
  }

  private emitChange(): void {
    this.revision += 1
    this.listeners.forEach((listener) => listener())
  }
}

export function selectEffectivePlugins(plugins: InstalledPlugin[]): InstalledPlugin[] {
  const candidates = plugins.filter((plugin) => plugin.enabled && plugin.state === 'active' && isPluginActivatable(plugin))
  const byId = new Map<string, InstalledPlugin[]>()
  for (const plugin of candidates) byId.set(plugin.manifest.id, [...(byId.get(plugin.manifest.id) ?? []), plugin])
  return [...byId.values()].map((entries) => entries.sort(comparePluginPrecedence)[0]!).sort((left, right) => compareText(left.manifest.id, right.manifest.id))
}

function isPluginActivatable(plugin: InstalledPlugin): boolean {
  if (plugin.scope === 'global') return true
  if (plugin.build.state === 'ready') return true
  return Boolean(plugin.uiUrl) && ['building', 'stale'].includes(plugin.build.state)
}

export function matchesPluginFileHandler(
  handler: InstalledPlugin['manifest']['contributes']['fileHandlers'][number],
  absolutePath: string,
  relativePath: string | null = null
): boolean {
  const normalizedAbsolute = normalizePath(absolutePath).toLocaleLowerCase()
  const extensionMatch = (handler.extensions ?? []).some((extension) => normalizedAbsolute.endsWith(`.${extension.replace(/^\./, '').toLocaleLowerCase()}`))
  const normalizedRelative = relativePath ? normalizePath(relativePath).replace(/^\.\//, '') : null
  const globMatch = normalizedRelative !== null && (handler.fileMatch ?? []).some((pattern) => matchesGlob(normalizedRelative, pattern))
  return extensionMatch || globMatch
}

function comparePluginPrecedence(left: InstalledPlugin, right: InstalledPlugin): number {
  return pluginPrecedence(left) - pluginPrecedence(right) || compareText(left.instanceId, right.instanceId)
}

function pluginPrecedence(plugin: InstalledPlugin): number {
  if (plugin.scope === 'project' && plugin.build.state === 'ready') return 0
  if (plugin.scope === 'project' && plugin.uiUrl && ['building', 'stale'].includes(plugin.build.state)) return 1
  if (plugin.scope === 'global') return 2
  return 3
}

function fingerprint(plugin: InstalledPlugin): string {
  return JSON.stringify({
    instanceId: plugin.instanceId,
    path: plugin.path,
    scope: plugin.scope,
    revision: plugin.revision,
    uiUrl: plugin.uiUrl,
    cssUrls: plugin.cssUrls,
    manifest: plugin.manifest
  })
}

function compareEntries<T>(left: ContributionEntry<T>, right: ContributionEntry<T>): number {
  return right.priority - left.priority || compareText(left.owner, right.owner) || compareText(left.id, right.id)
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function joinPath(parent: string, child: string): string {
  const separator = parent.includes('\\') ? '\\' : '/'
  return `${parent.replace(/[\\/]+$/, '')}${separator}${child.replace(/^[\\/]+/, '')}`
}

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/')
}

function projectRelativePath(candidate: string, root: string | null): string | null {
  const normalized = normalizePath(candidate)
  if (!isAbsolutePath(normalized)) return normalized.replace(/^\.\//, '').replace(/^\//, '')
  if (!root) return null
  const normalizedRoot = normalizePath(root).replace(/\/$/, '')
  const comparisonCandidate = normalized.toLocaleLowerCase()
  const comparisonRoot = normalizedRoot.toLocaleLowerCase()
  if (comparisonCandidate === comparisonRoot) return ''
  if (!comparisonCandidate.startsWith(`${comparisonRoot}/`)) return null
  return normalized.slice(normalizedRoot.length + 1)
}

function isAbsolutePath(value: string): boolean {
  return /^[a-z]:\//i.test(value) || value.startsWith('/')
}

function fileHandlerPatterns(handler: InstalledPlugin['manifest']['contributes']['fileHandlers'][number]): string[] {
  return [...(handler.fileMatch ?? []), ...(handler.extensions ?? []).map((extension) => `*.${extension.replace(/^\./, '')}`)]
}

function matchesGlob(candidate: string, pattern: string): boolean {
  const normalizedPattern = normalizePath(pattern).replace(/^\.\//, '').replace(/^\//, '')
  const target = normalizedPattern.includes('/') ? candidate : candidate.split('/').at(-1) ?? candidate
  return globToRegExp(normalizedPattern).test(target)
}

function globToRegExp(pattern: string): RegExp {
  let source = '^'
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]!
    if (character === '*') {
      if (pattern[index + 1] === '*') {
        index += 1
        if (pattern[index + 1] === '/') {
          index += 1
          source += '(?:.*/)?'
        } else source += '.*'
      } else source += '[^/]*'
    } else if (character === '?') source += '[^/]'
    else source += character.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
  }
  return new RegExp(`${source}$`, 'i')
}

function importPluginUiModule(url: string): Promise<PluginUiModule> {
  return import(/* @vite-ignore */ url) as Promise<PluginUiModule>
}

function parseUiReference(value: string | undefined, fallbackEntry: string | undefined, fallbackExport: string): { entry: string; exportName?: string } {
  if (value?.includes('#')) {
    const [entry, exportName] = value.split('#', 2)
    return { entry: entry || fallbackEntry || '', exportName: exportName || fallbackExport }
  }
  if (value && (/[\\/]/.test(value) || /\.[cm]?[jt]sx?$/i.test(value))) return { entry: value }
  return { entry: fallbackEntry ?? '', exportName: value || fallbackExport }
}

function resolveSurface(module: PluginUiModule, collection: 'panels' | 'fileEditors', id: string, exportName?: string): PluginSurfaceExport {
  const named = exportName ? (module as PluginUiModule & Record<string, unknown>)[exportName] : undefined
  const moduleDefinition = typeof module.mount === 'function' ? module as PluginSurfaceDefinition : undefined
  const surface = named ?? module[collection]?.[exportName ?? id] ?? module[collection]?.[id] ?? module.default ?? moduleDefinition
  if (!surface || (typeof surface !== 'function' && typeof surface !== 'object')) {
    throw new Error(`UI module does not export ${collection}[${JSON.stringify(id)}] or a default surface.`)
  }
  return surface as PluginSurfaceExport
}

export function isPluginSurfaceDefinition(surface: PluginSurfaceExport): surface is PluginSurfaceDefinition {
  return typeof surface === 'object' && surface !== null && typeof (surface as PluginSurfaceDefinition).mount === 'function'
}

export const pluginContributionRuntime = new PluginContributionRuntime()
