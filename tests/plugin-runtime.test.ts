import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InstalledPlugin, PluginManifest, Result } from '@phaser-editor/contracts'
import { commandRegistry } from '../src/renderer/src/lib/commands'
import {
  commandContributionRegistry,
  fileHandlerContributionRegistry,
  panelContributionRegistry,
  schemaContributionRegistry
} from '../src/renderer/src/lib/contribution-registry'
import { matchesPluginFileHandler, PluginContributionRuntime, selectEffectivePlugins, type PluginUiModule } from '../src/renderer/src/lib/plugin-runtime'

describe('plugin contribution runtime', () => {
  let runtime: PluginContributionRuntime | null = null

  afterEach(() => {
    runtime?.resetForTests()
    runtime = null
    vi.unstubAllGlobals()
  })

  it('registers enabled contributions, resolves conflicts deterministically, and disposes disabled plugins', async () => {
    const calls: string[] = []
    const modules = new Map<string, PluginUiModule>([
      ['alpha', { commands: { 'shared.run': () => { calls.push('alpha') }, 'open.panel': (context) => context.openPanel('sharedPanel') }, panels: { sharedPanel: () => null }, fileEditors: { alphaEditor: () => null } }],
      ['beta', { commands: { 'shared.run': () => { calls.push('beta') } }, panels: { sharedPanel: () => null }, fileEditors: { betaEditor: () => null } }]
    ])
    installPluginWindow({
      schemas: { 'alpha:schemas/config.json': '{"title":"Alpha"}', 'beta:schemas/config.json': '{"title":"Beta"}' }
    })
    runtime = new PluginContributionRuntime(async (url) => modules.get(url.includes('alpha') ? 'alpha' : 'beta')!)
    runtime.setReporter(vi.fn())

    const alpha = plugin('alpha', {
      commands: [{ id: 'shared.run', title: 'Run alpha', priority: 5 }, { id: 'open.panel', title: 'Open panel' }],
      panels: [{ id: 'sharedPanel', title: 'Shared alpha', priority: 5 }],
      fileHandlers: [{ id: 'alphaEditor', extensions: ['foo'], editor: 'alphaEditor', priority: 5 }],
      schemas: [{ uri: 'plugin://shared-schema', fileMatch: ['**/*.foo'], path: 'schemas/config.json', priority: 5 }]
    })
    const beta = plugin('beta', {
      commands: [{ id: 'shared.run', title: 'Run beta', priority: 5 }],
      panels: [{ id: 'sharedPanel', title: 'Shared beta', priority: 5 }],
      fileHandlers: [{ id: 'betaEditor', extensions: ['.foo'], editor: 'betaEditor', priority: 5 }],
      schemas: [{ uri: 'plugin://shared-schema', fileMatch: ['**/*.foo'], path: 'schemas/config.json', priority: 5 }]
    })

    await runtime.synchronize([beta, alpha])
    expect(commandContributionRegistry.get('shared.run')?.owner).toBe('alpha')
    expect(panelContributionRegistry.get('sharedPanel')?.owner).toBe('alpha')
    expect(schemaContributionRegistry.get('plugin://shared-schema')?.value.schema).toEqual({ title: 'Alpha' })
    expect(runtime.getFileHandlerResolution('level.foo').candidates.map((entry) => entry.owner)).toEqual(['alpha', 'beta'])
    expect(runtime.getDiagnostics()).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'conflict', category: 'command', pluginId: 'alpha' }),
      expect.objectContaining({ kind: 'conflict', category: 'fileHandler', pluginId: 'alpha' })
    ]))

    await commandRegistry.execute('shared.run')
    expect(calls).toEqual(['alpha'])
    await commandRegistry.execute('open.panel')
    expect(window.dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ detail: 'sharedPanel' }))
    expect(await runtime.loadPanel('sharedPanel')).toBe(modules.get('alpha')!.panels!.sharedPanel)
    expect(await runtime.loadFileEditor('level.foo')).toBe(modules.get('alpha')!.fileEditors!.alphaEditor)

    await runtime.synchronize([{ ...alpha, enabled: false, state: 'disabled' }, beta])
    expect(commandContributionRegistry.get('shared.run')?.owner).toBe('beta')
    expect(fileHandlerContributionRegistry.list().map((entry) => entry.owner)).toEqual(['beta'])
    await commandRegistry.execute('shared.run')
    expect(calls).toEqual(['alpha', 'beta'])
  })

  it('isolates contribution failures and only retries a rejected lazy module on request', async () => {
    let imports = 0
    const reporter = vi.fn()
    installPluginWindow({ schemaFailure: 'broken:schemas/broken.json' })
    runtime = new PluginContributionRuntime(async () => {
      imports += 1
      if (imports === 1) throw new Error('chunk unavailable')
      return { panels: { retryPanel: () => null }, commands: { healthy: () => undefined } }
    })
    runtime.setReporter(reporter)
    const broken = plugin('broken', {
      commands: [{ id: 'healthy', title: 'Healthy' }],
      panels: [{ id: 'retryPanel', title: 'Retry panel' }],
      schemas: [{ uri: 'plugin://broken', fileMatch: ['**/*.broken'], path: 'schemas/broken.json' }]
    })

    await runtime.synchronize([broken])
    expect(commandContributionRegistry.get('healthy')?.owner).toBe('broken')
    expect(schemaContributionRegistry.get('plugin://broken')).toBeUndefined()
    expect(runtime.getDiagnostics()).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'activation', category: 'schema', pluginId: 'broken' })
    ]))

    await expect(runtime.loadPanel('retryPanel')).rejects.toThrow('chunk unavailable')
    await expect(runtime.loadPanel('retryPanel')).rejects.toThrow('chunk unavailable')
    expect(imports).toBe(1)
    expect(runtime.getDiagnostics()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'runtime',
        category: 'plugin',
        pluginId: 'broken',
        contributionId: 'ui.js',
        message: expect.stringContaining('UI import failed')
      })
    ]))
    await expect(runtime.loadPanel('retryPanel', true)).resolves.toBeTypeOf('function')
    expect(imports).toBe(2)
    expect(reporter).toHaveBeenCalledWith(expect.objectContaining({ category: 'schema', pluginId: 'broken' }))
  })

  it('reports an invalid surface export with its contribution context', async () => {
    const reporter = vi.fn()
    installPluginWindow({})
    runtime = new PluginContributionRuntime(async () => ({}))
    runtime.setReporter(reporter)
    await runtime.synchronize([plugin('broken-surface', {
      panels: [{ id: 'missingPanel', title: 'Missing panel' }]
    })])

    await expect(runtime.loadPanel('missingPanel')).rejects.toThrow('does not export')
    expect(runtime.getDiagnostics()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'runtime',
        category: 'panel',
        pluginId: 'broken-surface',
        contributionId: 'missingPanel',
        message: expect.stringContaining('UI resolve failed')
      })
    ]))
    expect(reporter).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'runtime',
      category: 'panel',
      contributionId: 'missingPanel'
    }))
  })

  it('prefers ready and stale project plugins over a same-id global plugin', () => {
    const global = plugin('shared', {}, { instanceId: 'global:shared' })
    const project = plugin('shared', {}, { instanceId: 'project:shared', scope: 'project', buildState: 'ready', uiUrl: 'phaser-plugin://local/project/rev/ui.mjs' })
    expect(selectEffectivePlugins([global, project])).toEqual([project])

    const stale = { ...project, build: { state: 'stale' as const, diagnostics: [{ severity: 'error' as const, message: 'rebuild failed' }] } }
    expect(selectEffectivePlugins([global, stale])).toEqual([stale])

    const failed = { ...project, uiUrl: undefined, build: { state: 'error' as const, diagnostics: [{ severity: 'error' as const, message: 'initial build failed' }] } }
    expect(selectEffectivePlugins([global, failed])).toEqual([global])
  })

  it('matches project-relative globs while preserving extension handlers', () => {
    const globHandler = { id: 'action', editor: 'actionEditor', fileMatch: ['skills/**/*.action.bytes'] }
    expect(matchesPluginFileHandler(globHandler, 'C:\\game\\skills\\boss\\200201.action.bytes', 'skills/boss/200201.action.bytes')).toBe(true)
    expect(matchesPluginFileHandler(globHandler, 'C:\\game\\assets\\200201.action.bytes', 'assets/200201.action.bytes')).toBe(false)
    expect(matchesPluginFileHandler({ id: 'legacy', editor: 'legacyEditor', extensions: ['foo'] }, 'C:\\game\\level.foo')).toBe(true)
  })

  it('routes history commands to the newest active plugin surface and unregisters cleanly', () => {
    runtime = new PluginContributionRuntime()
    const calls: string[] = []
    runtime.registerActiveUndoRedo(() => false, {
      undo: () => calls.push('inactive undo'),
      redo: () => calls.push('inactive redo')
    })
    const disposeFirst = runtime.registerActiveUndoRedo(() => true, {
      undo: () => calls.push('first undo'),
      redo: () => calls.push('first redo')
    })
    const disposeSecond = runtime.registerActiveUndoRedo(() => true, {
      undo: () => calls.push('second undo'),
      redo: () => calls.push('second redo'),
      canRedo: () => false
    })

    expect(runtime.executeActiveHistory('undo')).toBe(true)
    expect(runtime.executeActiveHistory('redo')).toBe(true)
    expect(calls).toEqual(['second undo'])

    disposeSecond()
    expect(runtime.executeActiveHistory('redo')).toBe(true)
    expect(calls).toEqual(['second undo', 'first redo'])

    disposeFirst()
    expect(runtime.executeActiveHistory('undo')).toBe(false)
  })

  it('rolls back a malformed plugin without blocking later plugin activation', async () => {
    installPluginWindow({})
    runtime = new PluginContributionRuntime(async () => ({}))
    const broken = plugin('broken', {})
    ;(broken.manifest.contributes.panels as unknown[]) = [null]
    const healthy = plugin('healthy', { commands: [{ id: 'healthy.run', title: 'Healthy' }] })

    await runtime.synchronize([broken, healthy])

    expect(runtime.getPlugin('broken')).toBeUndefined()
    expect(commandContributionRegistry.get('healthy.run')?.owner).toBe('healthy')
    expect(runtime.getDiagnostics()).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'activation', category: 'plugin', pluginId: 'broken' })
    ]))
  })
})

function plugin(id: string, contributes: Partial<PluginManifest['contributes']>, options: {
  instanceId?: string
  scope?: InstalledPlugin['scope']
  buildState?: InstalledPlugin['build']['state']
  uiUrl?: string
} = {}): InstalledPlugin {
  return {
    path: `C:\\plugins\\${id}`,
    scope: options.scope ?? 'global',
    instanceId: options.instanceId ?? id,
    build: { state: options.buildState ?? 'idle', diagnostics: [] },
    uiUrl: options.uiUrl,
    cssUrls: [],
    enabled: true,
    state: 'active',
    manifest: {
      id,
      name: id,
      version: '1.0.0',
      engine: '>=0.1.0',
      apiVersion: 1,
      ui: 'ui.js',
      permissions: [],
      contributes: {
        commands: contributes.commands ?? [],
        panels: contributes.panels ?? [],
        fileHandlers: contributes.fileHandlers ?? [],
        schemas: contributes.schemas ?? [],
        components: contributes.components ?? []
      }
    }
  }
}

function installPluginWindow(options: { schemas?: Record<string, string>; schemaFailure?: string }): void {
  const dispatchEvent = vi.fn(() => true)
  vi.stubGlobal('window', {
    dispatchEvent,
    editorApi: {
      plugins: {
        list: async () => success([]),
        installFromDirectory: async () => failure('CANCELLED', 'cancelled'),
        setEnabled: async () => success([]),
        readResource: async (id: string, path: string) => {
          const key = `${id}:${path}`
          if (key === options.schemaFailure) return failure('NOT_FOUND', 'schema missing')
          const value = options.schemas?.[key]
          return value === undefined ? failure('NOT_FOUND', 'schema missing') : success(value)
        },
        resourceUrl: (path: string) => path
      }
    }
  })
}

function success<T>(value: T): Result<T> { return { ok: true, value } }
function failure<T>(code: 'CANCELLED' | 'NOT_FOUND', message: string): Result<T> { return { ok: false, error: { code, message } } }
