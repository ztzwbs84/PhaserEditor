import { promises as fs } from 'node:fs'
import path from 'node:path'
import { utilityProcess, type UtilityProcess } from 'electron'
import type { InstalledPlugin, PluginManifest } from '@phaser-editor/contracts'
import { pluginManifestSchema } from '@phaser-editor/contracts'
import { AppError } from './domain'
import { ConfigStore } from './config-store'

export class PluginService {
  private readonly processes = new Map<string, UtilityProcess>()

  constructor(
    private readonly store: ConfigStore,
    private readonly pluginsRoot: string,
    private readonly hostPath: string
  ) {}

  async list(): Promise<InstalledPlugin[]> {
    await fs.mkdir(this.pluginsRoot, { recursive: true })
    const enabled = new Set(this.store.get().enabledPlugins)
    const items: InstalledPlugin[] = []
    for (const entry of await fs.readdir(this.pluginsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const pluginPath = path.join(this.pluginsRoot, entry.name)
      try {
        const manifest = await readManifest(pluginPath)
        items.push({
          manifest,
          path: pluginPath,
          enabled: enabled.has(manifest.id),
          state: enabled.has(manifest.id)
            ? (!manifest.main || this.processes.has(manifest.id) ? 'active' : 'error')
            : 'disabled'
        })
      } catch (error) {
        items.push({
          manifest: { id: entry.name, name: entry.name, version: 'invalid', engine: '>=0.1.0', permissions: [], contributes: { commands: [], panels: [], fileHandlers: [], schemas: [], components: [] } },
          path: pluginPath,
          enabled: false,
          state: 'error',
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }
    return items
  }

  async install(sourceDirectory: string): Promise<InstalledPlugin> {
    const manifest = await readManifest(sourceDirectory)
    const destination = path.join(this.pluginsRoot, manifest.id)
    try {
      await fs.access(destination)
      throw new AppError('CONFLICT', `Plugin ${manifest.id} is already installed.`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await fs.mkdir(this.pluginsRoot, { recursive: true })
    await fs.cp(sourceDirectory, destination, { recursive: true, errorOnExist: true })
    return { manifest, path: destination, enabled: false, state: 'disabled' }
  }

  async setEnabled(id: string, enabled: boolean): Promise<InstalledPlugin[]> {
    const current = new Set(this.store.get().enabledPlugins)
    if (enabled) current.add(id)
    else current.delete(id)
    await this.store.update({ enabledPlugins: [...current] })
    if (enabled) await this.activate(id)
    else this.deactivate(id)
    return this.list()
  }

  async readResource(id: string, relativePath: string): Promise<string> {
    const pluginPath = path.resolve(this.pluginsRoot, id)
    const target = path.resolve(pluginPath, relativePath)
    if (target !== pluginPath && !target.startsWith(`${pluginPath}${path.sep}`)) throw new AppError('ACCESS_DENIED', 'Plugin resource is outside the plugin folder.')
    const stat = await fs.stat(target)
    if (!stat.isFile() || stat.size > 10 * 1024 * 1024) throw new AppError('UNSUPPORTED', 'Plugin resource is not a supported text file.')
    return fs.readFile(target, 'utf8')
  }

  containsResource(candidate: string): boolean {
    const root = path.resolve(this.pluginsRoot)
    const target = path.resolve(candidate)
    return target.startsWith(`${root}${path.sep}`)
  }

  async activateEnabled(): Promise<void> {
    for (const id of this.store.get().enabledPlugins) {
      await this.activate(id).catch(() => undefined)
    }
  }

  deactivateAll(): void {
    for (const id of this.processes.keys()) this.deactivate(id)
  }

  private async activate(id: string): Promise<void> {
    if (this.processes.has(id)) return
    const pluginPath = path.join(this.pluginsRoot, id)
    const manifest = await readManifest(pluginPath)
    if (!manifest.main) return
    const child = utilityProcess.fork(this.hostPath, [], {
      env: {
        PHASER_EDITOR_PLUGIN_PATH: pluginPath,
        PHASER_EDITOR_PLUGIN_MAIN: manifest.main,
        PHASER_EDITOR_PLUGIN_PERMISSIONS: JSON.stringify(manifest.permissions)
      },
      serviceName: `plugin:${id}`
    })
    this.processes.set(id, child)
    child.once('exit', () => this.processes.delete(id))
  }

  private deactivate(id: string): void {
    const child = this.processes.get(id)
    child?.postMessage({ type: 'deactivate' })
    child?.kill()
    this.processes.delete(id)
  }
}

async function readManifest(pluginPath: string): Promise<PluginManifest> {
  const content = await fs.readFile(path.join(pluginPath, 'plugin.json'), 'utf8')
  return pluginManifestSchema.parse(JSON.parse(content))
}
