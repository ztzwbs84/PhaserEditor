import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { utilityProcess } from 'electron'

vi.mock('electron', () => ({
  utilityProcess: { fork: vi.fn(() => ({ once: vi.fn(), postMessage: vi.fn(), kill: vi.fn() })) }
}))

import { ConfigStore } from '../src/main/config-store'
import { PluginService, pluginProtocolHeaders } from '../src/main/plugin-service'
import {
  ProjectPluginCompileAbortedError,
  ProjectPluginCompiler,
  type ProjectPluginCompileRequest,
  type ProjectPluginCompileResult
} from '../src/main/project-plugin-compiler'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
  vi.clearAllMocks()
})

describe('PluginService project plugins', () => {
  it('discovers behind trust, compiles a revision URL, serves it, and unloads without deleting cache', async () => {
    const fixture = await createFixture()
    const changed = vi.fn()
    const service = new PluginService(fixture.store, fixture.globalPlugins, fixture.hostPath, {
      cacheRoot: fixture.cacheRoot,
      editorVersion: '0.1.0',
      onChanged: changed
    })

    const attached = await service.attachProject(fixture.projectRoot)
    expect(attached).toMatchObject({
      projectPath: await fs.realpath(fixture.projectRoot),
      plugins: [{ id: 's3-skill-editor', name: 'S3 Skill Editor' }],
      trustRequired: true,
      loaded: false
    })
    expect((await service.list()).find((plugin) => plugin.scope === 'project')).toMatchObject({
      enabled: false,
      state: 'disabled',
      build: { state: 'idle' }
    })

    const trusted = await service.trustProjectPlugins(fixture.projectRoot, 'trust')
    expect(trusted.trustRequired).toBe(false)
    expect(trusted.loaded).toBe(true)
    const plugin = (await service.list()).find((item) => item.scope === 'project')!
    expect(plugin).toMatchObject({ enabled: true, state: 'active', build: { state: 'ready' } })
    expect(plugin.instanceId).toMatch(/^project:[a-f0-9]{12}:s3-skill-editor$/)
    expect(plugin.uiUrl).toMatch(/^phaser-plugin:\/\/local\/project%3A[a-f0-9]{12}%3As3-skill-editor\/[a-f0-9]{16}\/ui\.js$/)
    expect(plugin.uiUrl).not.toContain(fixture.projectRoot)

    const resource = await service.resolveProtocolResource(plugin.uiUrl!)
    expect(resource?.contentType).toBe('text/javascript; charset=utf-8')
    expect(new TextDecoder().decode(resource!.data)).toContain('skillEditor')
    expect(pluginProtocolHeaders(resource!.contentType)).toMatchObject({
      'Content-Security-Policy': expect.stringContaining("script-src 'self'"),
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff'
    })
    await service.detachProject()
    expect((await service.list()).some((item) => item.scope === 'project')).toBe(false)
    expect(await hasCurrentCache(fixture.cacheRoot)).toBe(true)
    expect(changed).toHaveBeenCalled()
  })

  it('uses last-known-good across a service restart when the next build fails', async () => {
    const fixture = await createFixture()
    const service = new PluginService(fixture.store, fixture.globalPlugins, fixture.hostPath, {
      cacheRoot: fixture.cacheRoot,
      editorVersion: '0.1.0'
    })
    await service.attachProject(fixture.projectRoot)
    await service.trustProjectPlugins(fixture.projectRoot, 'trust')
    const good = (await service.list()).find((item) => item.scope === 'project')!
    await service.detachProject()

    await fs.writeFile(fixture.uiSource, "import { readFile } from 'node:fs'; export { readFile }\n")
    const restarted = new PluginService(fixture.store, fixture.globalPlugins, fixture.hostPath, {
      cacheRoot: fixture.cacheRoot,
      editorVersion: '0.1.0'
    })
    await restarted.attachProject(fixture.projectRoot)
    const stale = (await restarted.list()).find((item) => item.scope === 'project')!
    expect(stale).toMatchObject({
      revision: good.revision,
      enabled: true,
      state: 'active',
      build: { state: 'stale' }
    })
    expect(stale.build.diagnostics[0]?.message).toContain('cannot import Node')
    await restarted.detachProject()
  })

  it('rejects incompatible engines and exposes global UI through instance URLs', async () => {
    const fixture = await createFixture({ engine: '>=9.0.0' })
    const globalRoot = path.join(fixture.globalPlugins, 'global-demo')
    await fs.mkdir(globalRoot, { recursive: true })
    await fs.writeFile(path.join(globalRoot, 'plugin.json'), JSON.stringify({
      id: 'global-demo',
      name: 'Global Demo',
      version: '1.0.0',
      engine: '0.1.0',
      apiVersion: 1,
      ui: 'ui.js'
    }))
    await fs.writeFile(path.join(globalRoot, 'ui.js'), 'export const globalDemo = true\n')
    const service = new PluginService(fixture.store, fixture.globalPlugins, fixture.hostPath, {
      cacheRoot: fixture.cacheRoot,
      editorVersion: '0.1.0'
    })

    await service.attachProject(fixture.projectRoot)
    const plugins = await service.list()
    const projectPlugin = plugins.find((item) => item.scope === 'project')!
    expect(projectPlugin.state).toBe('error')
    expect(projectPlugin.error).toContain('not compatible')
    const globalPlugin = plugins.find((item) => item.scope === 'global')!
    expect(globalPlugin.uiUrl).toMatch(/^phaser-plugin:\/\/local\/global%3Aglobal-demo\/[a-f0-9]{16}\/ui\.js$/)
    const resource = await service.resolveProtocolResource(globalPlugin.uiUrl!)
    expect(new TextDecoder().decode(resource!.data)).toContain('globalDemo')
    await service.detachProject()
  })

  it.each(['commands', 'panels', 'fileHandlers', 'schemas', 'components'] as const)(
    'rejects malformed %s contributions without activating project code',
    async (category) => {
      const fixture = await createFixture()
      const manifestPath = path.join(fixture.projectRoot, '.phaser-editor', 'plugins', 's3-skill-editor', 'plugin.json')
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as Record<string, unknown>
      manifest.contributes = { [category]: [null] }
      await fs.writeFile(manifestPath, JSON.stringify(manifest))
      const service = new PluginService(fixture.store, fixture.globalPlugins, fixture.hostPath, {
        cacheRoot: fixture.cacheRoot,
        editorVersion: '0.1.0'
      })

      const attached = await service.attachProject(fixture.projectRoot)
      expect(attached.plugins).toEqual([])
      expect((await service.list()).find((item) => item.scope === 'project')).toMatchObject({
        enabled: false,
        state: 'error',
        build: { state: 'error' }
      })
      expect(utilityProcess.fork).not.toHaveBeenCalled()
      await service.detachProject()
    }
  )

  it.each([
    ['a missing apiVersion', { apiVersion: undefined }],
    ['a background main entry', { main: 'main.cjs' }]
  ])('rejects project manifests with %s', async (_label, patch) => {
    const fixture = await createFixture()
    const pluginRoot = path.join(fixture.projectRoot, '.phaser-editor', 'plugins', 's3-skill-editor')
    const manifestPath = path.join(pluginRoot, 'plugin.json')
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as Record<string, unknown>
    Object.assign(manifest, patch)
    if ('apiVersion' in patch && patch.apiVersion === undefined) delete manifest.apiVersion
    await fs.writeFile(manifestPath, JSON.stringify(manifest))
    await fs.writeFile(path.join(pluginRoot, 'main.cjs'), 'throw new Error("must not execute")\n')
    const service = new PluginService(fixture.store, fixture.globalPlugins, fixture.hostPath, {
      cacheRoot: fixture.cacheRoot,
      editorVersion: '0.1.0'
    })

    const attached = await service.attachProject(fixture.projectRoot)
    expect(attached.plugins).toEqual([])
    expect((await service.list()).find((item) => item.scope === 'project')?.state).toBe('error')
    expect(utilityProcess.fork).not.toHaveBeenCalled()
    await service.detachProject()
  })

  it('cancels an in-flight project build and suppresses stale commits on detach', async () => {
    const fixture = await createFixture()
    const compiler = new BlockingCompiler(fixture.cacheRoot)
    const changed = vi.fn()
    const service = new PluginService(fixture.store, fixture.globalPlugins, fixture.hostPath, {
      compiler,
      editorVersion: '0.1.0',
      onChanged: changed
    })
    await service.attachProject(fixture.projectRoot)

    const trusting = service.trustProjectPlugins(fixture.projectRoot, 'trust')
    await compiler.started
    expect((service as unknown as { projectWatcher: unknown }).projectWatcher).not.toBeNull()
    const detached = service.detachProject()
    await detached
    await trusting

    expect(compiler.aborted).toBe(true)
    expect((await service.list()).some((plugin) => plugin.scope === 'project')).toBe(false)
    const finalEmission = changed.mock.calls.at(-1)?.[0] as Array<{ scope: string }> | undefined
    expect(finalEmission?.some((plugin) => plugin.scope === 'project')).toBe(false)
  })

  it('does not reuse last-known-good after the same plugin id moves to a different source root', async () => {
    const fixture = await createFixture()
    const first = new PluginService(fixture.store, fixture.globalPlugins, fixture.hostPath, {
      cacheRoot: fixture.cacheRoot,
      editorVersion: '0.1.0'
    })
    await first.attachProject(fixture.projectRoot)
    await first.trustProjectPlugins(fixture.projectRoot, 'trust')
    await first.detachProject()

    const originalRoot = path.dirname(path.dirname(fixture.uiSource))
    const replacementRoot = path.join(path.dirname(originalRoot), 'replacement-editor')
    await fs.rename(originalRoot, replacementRoot)
    await fs.writeFile(path.join(replacementRoot, 'src', 'ui.ts'), "import { readFile } from 'node:fs'; export { readFile }\n")

    const restarted = new PluginService(fixture.store, fixture.globalPlugins, fixture.hostPath, {
      cacheRoot: fixture.cacheRoot,
      editorVersion: '0.1.0'
    })
    await restarted.attachProject(fixture.projectRoot)
    const plugin = (await restarted.list()).find((item) => item.scope === 'project')!
    expect(plugin).toMatchObject({ state: 'error', build: { state: 'error' } })
    expect(plugin.uiUrl).toBeUndefined()
    await restarted.detachProject()
  })

  it('turns watcher failures into stale diagnostics without unloading last-known-good', async () => {
    const fixture = await createFixture()
    const service = new PluginService(fixture.store, fixture.globalPlugins, fixture.hostPath, {
      cacheRoot: fixture.cacheRoot,
      editorVersion: '0.1.0'
    })
    await service.attachProject(fixture.projectRoot)
    await service.trustProjectPlugins(fixture.projectRoot, 'trust')
    const watcher = (service as unknown as { projectWatcher: { emit(event: string, error: Error): boolean } }).projectWatcher

    watcher.emit('error', new Error('EPERM while watching project plugin'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect((await service.list()).find((item) => item.scope === 'project')).toMatchObject({
      enabled: true,
      state: 'active',
      build: {
        state: 'stale',
        diagnostics: [expect.objectContaining({ message: expect.stringContaining('EPERM') })]
      }
    })
    await service.detachProject()
  })
})

class BlockingCompiler extends ProjectPluginCompiler {
  readonly started: Promise<void>
  aborted = false
  private resolveStarted!: () => void

  constructor(cacheRoot: string) {
    super(cacheRoot)
    this.started = new Promise((resolve) => { this.resolveStarted = resolve })
  }

  override async loadLastGood(): Promise<null> {
    return null
  }

  override compile(request: ProjectPluginCompileRequest): Promise<ProjectPluginCompileResult> {
    this.resolveStarted()
    return new Promise((_resolve, reject) => {
      const abort = (): void => {
        this.aborted = true
        reject(new ProjectPluginCompileAbortedError())
      }
      if (request.signal?.aborted) abort()
      else request.signal?.addEventListener('abort', abort, { once: true })
    })
  }
}

async function createFixture(options: { engine?: string } = {}): Promise<{
  root: string
  projectRoot: string
  globalPlugins: string
  cacheRoot: string
  hostPath: string
  uiSource: string
  store: ConfigStore
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'phaser-editor-service-'))
  temporaryRoots.push(root)
  const projectRoot = path.join(root, 'project')
  const pluginRoot = path.join(projectRoot, '.phaser-editor', 'plugins', 's3-skill-editor')
  const uiSource = path.join(pluginRoot, 'src', 'ui.ts')
  const globalPlugins = path.join(root, 'global-plugins')
  const cacheRoot = path.join(root, 'cache')
  const userData = path.join(root, 'user-data')
  const hostPath = path.join(root, 'plugin-host.cjs')
  await fs.mkdir(path.dirname(uiSource), { recursive: true })
  await fs.mkdir(globalPlugins, { recursive: true })
  await fs.writeFile(path.join(projectRoot, 'package.json'), '{"name":"fixture"}\n')
  await fs.writeFile(uiSource, 'export const skillEditor = true\n')
  await fs.writeFile(path.join(pluginRoot, 'plugin.json'), JSON.stringify({
    id: 's3-skill-editor',
    name: 'S3 Skill Editor',
    version: '1.0.0',
    engine: options.engine ?? '>=0.1.0',
    apiVersion: 1,
    uiSource: 'src/ui.ts',
    permissions: ['filesystem:project'],
    contributes: {
      fileHandlers: [{ id: 'skill-action', fileMatch: ['**/*.action.bytes'], editor: 'skill-action' }]
    }
  }))
  await fs.writeFile(hostPath, '')
  const store = new ConfigStore(userData)
  await store.load()
  return { root, projectRoot, globalPlugins, cacheRoot, hostPath, uiSource, store }
}

async function hasCurrentCache(cacheRoot: string): Promise<boolean> {
  const versionRoot = path.join(cacheRoot, 'v1')
  const pending = [versionRoot]
  while (pending.length > 0) {
    const directory = pending.pop()!
    try {
      if ((await fs.stat(path.join(directory, 'current.json'))).isFile()) return true
    } catch {
      // Continue walking cache directories.
    }
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name !== '.build-output') pending.push(path.join(directory, entry.name))
    }
  }
  return false
}
