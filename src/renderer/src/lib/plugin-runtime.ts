import type { ComponentType } from 'react'
import { z } from 'zod'
import type { EditorDocument, InstalledPlugin } from '@phaser-editor/contracts'
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

export interface PluginSurfaceProps {
  pluginId: string
  contributionId: string
  document?: EditorDocument
}

export type PluginSurfaceComponent = ComponentType<PluginSurfaceProps>

export interface PluginCommandContext {
  pluginId: string
  openPanel(id: string): void
  readResource(relativePath: string): Promise<string>
}

export interface PluginUiModule {
  default?: PluginSurfaceComponent
  commands?: Record<string, (context: PluginCommandContext) => void | Promise<void>>
  panels?: Record<string, PluginSurfaceComponent>
  fileEditors?: Record<string, PluginSurfaceComponent>
  components?: Record<string, PluginComponentProvider | PluginProjectionFactory>
}

export type PluginProjectionFactory = (data: Record<string, unknown>, context: ComponentProjectionContext) => ComponentProjectionHandle
export interface PluginComponentProvider { createProjection?: PluginProjectionFactory }

export interface PluginRuntimeDiagnostic {
  kind: 'activation' | 'execution' | 'conflict'
  category: 'command' | 'panel' | 'fileHandler' | 'schema' | 'component' | 'plugin'
  pluginId: string
  contributionId?: string
  message: string
}

interface ActivePlugin {
  plugin: InstalledPlugin
  fingerprint: string
  dispose(): void
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
  private diagnostics: PluginRuntimeDiagnostic[] = []
  private revision = 0
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

  async refresh(): Promise<void> {
    const result = await window.editorApi.plugins.list()
    if (!result.ok) {
      this.record({ kind: 'activation', category: 'plugin', pluginId: 'runtime', message: result.error.message })
      return
    }
    await this.synchronize(result.value)
  }

  synchronize(plugins: InstalledPlugin[]): Promise<void> {
    this.synchronization = this.synchronization.catch(() => undefined).then(() => this.applySynchronization(plugins))
    return this.synchronization
  }

  getPlugin(id: string): InstalledPlugin | undefined {
    return this.active.get(id)?.plugin
  }

  getDiagnostics(): PluginRuntimeDiagnostic[] {
    return [...this.diagnostics, ...this.conflictDiagnostics()]
  }

  getFileHandlerResolution(path: string): FileHandlerResolution {
    const extension = path.split('.').pop()?.toLocaleLowerCase() ?? ''
    const candidates = fileHandlerContributionRegistry.list()
      .filter((entry) => entry.value.extensions.some((value) => value.replace(/^\./, '').toLocaleLowerCase() === extension))
      .sort(compareEntries)
    return { winner: candidates[0], candidates }
  }

  async loadPanel(id: string, retry = false): Promise<PluginSurfaceComponent> {
    const contribution = panelContributionRegistry.get(id)
    if (!contribution) throw new Error(`Panel ${id} is no longer registered.`)
    const plugin = this.requirePlugin(contribution.owner)
    const reference = parseUiReference(contribution.value.entry, plugin.manifest.ui, id)
    const module = await this.loadUiModule(plugin, reference.entry, retry)
    return resolveSurface(module, 'panels', id, reference.exportName)
  }

  async loadFileEditor(path: string, retry = false): Promise<PluginSurfaceComponent> {
    const contribution = this.getFileHandlerResolution(path).winner
    if (!contribution) throw new Error(`No plugin file editor is registered for ${path}.`)
    const plugin = this.requirePlugin(contribution.owner)
    const reference = parseUiReference(contribution.value.editor, plugin.manifest.ui, contribution.id)
    const module = await this.loadUiModule(plugin, reference.entry, retry)
    return resolveSurface(module, 'fileEditors', contribution.id, reference.exportName)
  }

  async loadComponentProvider(type: string, retry = false): Promise<PluginComponentProvider | PluginProjectionFactory> {
    const contribution = componentProviderContributionRegistry.get(type)
    if (!contribution) throw new Error(`Component provider ${type} is no longer registered.`)
    const plugin = this.requirePlugin(contribution.owner)
    const reference = parseUiReference(contribution.value.entry, plugin.manifest.ui, contribution.value.id)
    const module = await this.loadUiModule(plugin, reference.entry, retry)
    const named = reference.exportName ? (module as PluginUiModule & Record<string, unknown>)[reference.exportName] : undefined
    const provider = named ?? module.components?.[reference.exportName ?? contribution.value.id] ?? module.components?.[type]
    if (!provider || (typeof provider !== 'function' && typeof provider !== 'object')) throw new Error(`UI module does not export a component provider for ${type}.`)
    return provider as PluginComponentProvider | PluginProjectionFactory
  }

  async executeCommand(pluginId: string, commandId: string): Promise<void> {
    try {
      const plugin = this.requirePlugin(pluginId)
      const module = await this.loadUiModule(plugin)
      const handler = module.commands?.[commandId]
      if (!handler) throw new Error(`UI module does not export commands[${JSON.stringify(commandId)}].`)
      await handler(this.createCommandContext(plugin))
    } catch (error) {
      const diagnostic = this.errorDiagnostic('execution', 'command', pluginId, commandId, error)
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
          createProjection: contribution.entry || this.active.get(entry.owner)?.plugin.manifest.ui
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

  private createLazyComponentProjection(pluginId: string, type: string, contributionId: string, data: Record<string, unknown>, context: ComponentProjectionContext): ComponentProjectionHandle {
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
        this.record(this.errorDiagnostic('activation', 'component', pluginId, contributionId, error))
        currentContext.report(`Plugin ${pluginId} component ${type} could not be projected.`)
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
    const targets = new Map(plugins
      .filter((plugin) => plugin.enabled && plugin.state === 'active')
      .sort((left, right) => compareText(left.manifest.id, right.manifest.id))
      .map((plugin) => [plugin.manifest.id, plugin]))

    for (const [id, record] of this.active) {
      const target = targets.get(id)
      if (!target || fingerprint(target) !== record.fingerprint) {
        record.dispose()
        this.active.delete(id)
        this.clearModuleCache(id)
      }
    }

    this.diagnostics = this.diagnostics.filter((diagnostic) => diagnostic.kind === 'execution' && targets.has(diagnostic.pluginId))
    for (const plugin of targets.values()) {
      if (!this.active.has(plugin.manifest.id)) await this.activate(plugin)
    }
    this.emitChange()
  }

  private async activate(plugin: InstalledPlugin): Promise<void> {
    const disposers: Array<() => void> = []
    this.active.set(plugin.manifest.id, {
      plugin,
      fingerprint: fingerprint(plugin),
      dispose: () => disposers.splice(0).reverse().forEach((dispose) => dispose())
    })
    const add = (category: PluginRuntimeDiagnostic['category'], id: string, register: () => () => void): void => {
      try {
        disposers.push(register())
      } catch (error) {
        this.record(this.errorDiagnostic('activation', category, plugin.manifest.id, id, error))
      }
    }

    for (const contribution of plugin.manifest.contributes.commands) {
      add('command', contribution.id, () => commandContributionRegistry.register({ owner: plugin.manifest.id, id: contribution.id, priority: contribution.priority, value: contribution }))
      add('command', contribution.id, () => commandRegistry.registerContribution(plugin.manifest.id, {
        id: contribution.id,
        title: contribution.title,
        shortcut: contribution.defaultShortcut,
        execute: () => this.executeCommand(plugin.manifest.id, contribution.id)
      }, contribution.priority))
    }
    for (const contribution of plugin.manifest.contributes.panels) {
      add('panel', contribution.id, () => panelContributionRegistry.register({ owner: plugin.manifest.id, id: contribution.id, priority: contribution.priority, value: contribution }))
    }
    for (const contribution of plugin.manifest.contributes.fileHandlers) {
      add('fileHandler', contribution.id, () => fileHandlerContributionRegistry.register({ owner: plugin.manifest.id, id: contribution.id, priority: contribution.priority, value: contribution }))
    }
    for (const contribution of plugin.manifest.contributes.components) {
      add('component', contribution.id, () => componentProviderContributionRegistry.register({ owner: plugin.manifest.id, id: contribution.type, priority: contribution.priority, value: contribution }))
    }
    for (const contribution of plugin.manifest.contributes.schemas) {
      try {
        const resource = await window.editorApi.plugins.readResource(plugin.manifest.id, contribution.path)
        if (!resource.ok) throw new Error(resource.error.message)
        const schema = JSON.parse(resource.value) as Record<string, unknown>
        add('schema', contribution.uri, () => schemaContributionRegistry.register({ owner: plugin.manifest.id, id: contribution.uri, priority: contribution.priority, value: { ...contribution, schema } }))
      } catch (error) {
        this.record(this.errorDiagnostic('activation', 'schema', plugin.manifest.id, contribution.uri, error))
      }
    }

  }

  private createCommandContext(plugin: InstalledPlugin): PluginCommandContext {
    return {
      pluginId: plugin.manifest.id,
      openPanel: (id) => window.dispatchEvent(new CustomEvent('phaser-editor:show-contributed-panel', { detail: id })),
      readResource: async (relativePath) => {
        const result = await window.editorApi.plugins.readResource(plugin.manifest.id, relativePath)
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      }
    }
  }

  private loadUiModule(plugin: InstalledPlugin, entry = plugin.manifest.ui, retry = false): Promise<PluginUiModule> {
    if (!entry) return Promise.reject(new Error('Plugin manifest does not declare a UI entry.'))
    const relativeEntry = entry.split('#', 1)[0]!
    const key = `${plugin.manifest.id}:${relativeEntry}`
    if (retry) this.modulePromises.delete(key)
    const cached = this.modulePromises.get(key)
    if (cached) return cached
    const absolutePath = joinPath(plugin.path, relativeEntry)
    const promise = this.importer(window.editorApi.plugins.resourceUrl(absolutePath))
    this.modulePromises.set(key, promise)
    return promise
  }

  private requirePlugin(id: string): InstalledPlugin {
    const plugin = this.active.get(id)?.plugin
    if (!plugin) throw new Error(`Plugin ${id} is not active.`)
    return plugin
  }

  private clearModuleCache(pluginId: string): void {
    for (const key of this.modulePromises.keys()) if (key.startsWith(`${pluginId}:`)) this.modulePromises.delete(key)
  }

  private conflictDiagnostics(): PluginRuntimeDiagnostic[] {
    const diagnostics: PluginRuntimeDiagnostic[] = []
    const add = (category: PluginRuntimeDiagnostic['category'], conflicts: Array<{ id: string; winner: { owner: string }; shadowed: Array<{ owner: string }> }>): void => {
      conflicts.forEach((conflict) => diagnostics.push({
        kind: 'conflict',
        category,
        pluginId: conflict.winner.owner,
        contributionId: conflict.id,
        message: `${category} ${conflict.id} is provided by ${[conflict.winner, ...conflict.shadowed].map((entry) => entry.owner).join(', ')}; ${conflict.winner.owner} wins.`
      }))
    }
    add('command', commandContributionRegistry.conflicts())
    add('panel', panelContributionRegistry.conflicts())
    add('schema', schemaContributionRegistry.conflicts())
    add('component', componentProviderContributionRegistry.conflicts())

    const byExtension = new Map<string, ReturnType<typeof fileHandlerContributionRegistry.list>>()
    fileHandlerContributionRegistry.list().forEach((entry) => entry.value.extensions.forEach((extension) => {
      const key = extension.replace(/^\./, '').toLocaleLowerCase()
      byExtension.set(key, [...(byExtension.get(key) ?? []), entry])
    }))
    for (const [extension, entries] of byExtension) {
      const sorted = entries.sort(compareEntries)
      if (sorted.length > 1) diagnostics.push({
        kind: 'conflict', category: 'fileHandler', pluginId: sorted[0]!.owner, contributionId: `*.${extension}`,
        message: `fileHandler *.${extension} is provided by ${sorted.map((entry) => entry.owner).join(', ')}; ${sorted[0]!.owner} wins.`
      })
    }
    return diagnostics
  }

  private errorDiagnostic(kind: 'activation' | 'execution', category: PluginRuntimeDiagnostic['category'], pluginId: string, contributionId: string, error: unknown): PluginRuntimeDiagnostic {
    const reason = error instanceof Error ? error.message : String(error)
    return { kind, category, pluginId, contributionId, message: `Plugin ${pluginId} ${category} ${contributionId} failed: ${reason}` }
  }

  private record(diagnostic: PluginRuntimeDiagnostic): void {
    this.diagnostics.push(diagnostic)
    this.reporter(diagnostic)
    this.emitChange()
  }

  private emitChange(): void {
    this.revision += 1
    this.listeners.forEach((listener) => listener())
  }
}

function fingerprint(plugin: InstalledPlugin): string {
  return JSON.stringify({ path: plugin.path, manifest: plugin.manifest })
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

function importPluginUiModule(url: string): Promise<PluginUiModule> {
  return import(/* @vite-ignore */ url) as Promise<PluginUiModule>
}

function parseUiReference(value: string | undefined, fallbackEntry: string | undefined, fallbackExport: string): { entry: string; exportName?: string } {
  if (value?.includes('#')) {
    const [entry, exportName] = value.split('#', 2)
    return { entry: entry || fallbackEntry || '', exportName: exportName || fallbackExport }
  }
  if (value && (/[\\/]/.test(value) || /\.[cm]?jsx?$/i.test(value))) return { entry: value }
  return { entry: fallbackEntry ?? '', exportName: value || fallbackExport }
}

function resolveSurface(module: PluginUiModule, collection: 'panels' | 'fileEditors', id: string, exportName?: string): PluginSurfaceComponent {
  const named = exportName ? (module as PluginUiModule & Record<string, unknown>)[exportName] : undefined
  const surface = named ?? module[collection]?.[exportName ?? id] ?? module[collection]?.[id] ?? module.default
  if (!surface || (typeof surface !== 'function' && typeof surface !== 'object')) {
    throw new Error(`UI module does not export ${collection}[${JSON.stringify(id)}] or a default component.`)
  }
  return surface as PluginSurfaceComponent
}

export const pluginContributionRuntime = new PluginContributionRuntime()
