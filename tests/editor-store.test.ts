import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SCENE_FORMAT, createSceneTransform, type ProjectDescriptor, type Result, type RunSession } from '@phaser-editor/contracts'
import { installBrowserMock, simulateBrowserFileChange } from '../src/renderer/src/dev/browser-mock'
import { useEditorStore } from '../src/renderer/src/store/editor-store'
import { useSceneStore } from '../src/renderer/src/store/scene-store'
import { createObjectsCommand } from '../src/renderer/src/store/scene-commands'

const root = 'browser-demo'
const packagePath = `${root}\\package.json`

describe('editor lifecycle store', () => {
  beforeEach(async () => {
    vi.stubGlobal('window', {
      confirm: vi.fn(() => true),
      prompt: vi.fn(),
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout
    })
    installBrowserMock()
    await window.editorApi.project.open(root)
    useEditorStore.setState({
      ready: true,
      project: null,
      documents: {},
      selectedPath: null,
      notices: [],
      runSession: { id: 'test', status: 'idle' }
    })
    useSceneStore.setState({ scenes: {}, activePath: null })
    await useEditorStore.getState().openProject(root)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('reloads clean external changes and protects dirty buffers as conflicts', async () => {
    await useEditorStore.getState().openDocument(packagePath)
    simulateBrowserFileChange({ kind: 'change', path: packagePath }, '{"external":1}\n')
    await useEditorStore.getState().handleFileChange({ kind: 'change', path: packagePath })
    expect(useEditorStore.getState().documents[packagePath]?.content).toBe('{"external":1}\n')

    useEditorStore.getState().updateDocument(packagePath, '{"local":2}\n')
    simulateBrowserFileChange({ kind: 'change', path: packagePath }, '{"external":3}\n')
    await useEditorStore.getState().handleFileChange({ kind: 'change', path: packagePath })
    expect(useEditorStore.getState().documents[packagePath]).toMatchObject({ content: '{"local":2}\n', dirty: true, conflict: true })

    await useEditorStore.getState().overwriteDocument(packagePath)
    expect(useEditorStore.getState().documents[packagePath]).toMatchObject({ dirty: false, conflict: false, savedContent: '{"local":2}\n' })
  })

  it('rebases renamed paths and preserves dirty deleted buffers as read-only', async () => {
    await useEditorStore.getState().openDocument(packagePath)
    const renamed = `${root}\\game.package.json`
    useEditorStore.getState().rebaseDocuments(packagePath, renamed)
    expect(useEditorStore.getState().documents[renamed]).toMatchObject({ path: renamed, name: 'game.package.json' })

    useEditorStore.getState().updateDocument(renamed, '{"dirty":true}\n')
    await useEditorStore.getState().handleFileChange({ kind: 'unlink', path: renamed })
    expect(useEditorStore.getState().documents[renamed]).toMatchObject({ dirty: true, missing: true, readOnly: true })
  })

  it('cancels a dirty project switch before stopping or opening', async () => {
    await useEditorStore.getState().openDocument(packagePath)
    useEditorStore.getState().updateDocument(packagePath, '{"dirty":true}\n')
    useEditorStore.setState({ runSession: { id: 'running', status: 'running' } })
    vi.mocked(window.confirm).mockReturnValue(false)
    const stop = vi.spyOn(window.editorApi.runner, 'stop')
    const open = vi.spyOn(window.editorApi.project, 'open')

    expect(await useEditorStore.getState().openProject('D:\\Games\\Other')).toBe(false)
    expect(stop).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
    expect(useEditorStore.getState().project?.path).toBe(root)
  })

  it('stops a running project before activating the next project', async () => {
    useEditorStore.setState({ runSession: { id: 'running', status: 'running' } })
    const calls: string[] = []
    vi.spyOn(window.editorApi.runner, 'stop').mockImplementation(async () => {
      calls.push('stop')
      return success<RunSession>({ id: 'running', status: 'stopped' })
    })
    vi.spyOn(window.editorApi.project, 'open').mockImplementation(async (path) => {
      calls.push('open')
      return success<ProjectDescriptor>({
        name: 'other', path: path!, phaserVersion: '4.2.1', packageManager: 'npm', scripts: {}, dependencies: {}, folders: [], lastOpenedAt: '', valid: true
      })
    })

    expect(await useEditorStore.getState().openProject('D:\\Games\\Other')).toBe(true)
    expect(calls).toEqual(['stop', 'open'])
    expect(useEditorStore.getState().project?.path).toBe('D:\\Games\\Other')
  })

  it('keeps the current project when the runner cannot stop', async () => {
    useEditorStore.setState({ runSession: { id: 'running', status: 'running' } })
    vi.spyOn(window.editorApi.runner, 'stop').mockResolvedValue({
      ok: false,
      error: { code: 'PROCESS_FAILED', message: 'The process tree is still running.' }
    })
    const open = vi.spyOn(window.editorApi.project, 'open')

    expect(await useEditorStore.getState().openProject('D:\\Games\\Other')).toBe(false)
    expect(open).not.toHaveBeenCalled()
    expect(useEditorStore.getState().project?.path).toBe(root)
    expect(useEditorStore.getState().notices.at(-1)?.message).toContain('process tree is still running')
  })

  it('keeps documents and project state when the destination fails to open', async () => {
    await useEditorStore.getState().openDocument(packagePath)
    vi.spyOn(window.editorApi.project, 'open').mockResolvedValue({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'The recent project no longer exists.' }
    })

    expect(await useEditorStore.getState().openProject('D:\\Games\\Missing')).toBe(false)
    expect(useEditorStore.getState().project?.path).toBe(root)
    expect(useEditorStore.getState().documents[packagePath]).toBeDefined()
    expect(useEditorStore.getState().notices.at(-1)?.message).toContain('no longer exists')
  })

  it('waits for an explicit project plugin trust decision before finishing open', async () => {
    vi.spyOn(window.editorApi.plugins, 'attachProject').mockResolvedValue(success({
      projectPath: 'D:\\Games\\WithPlugins',
      plugins: [{ id: 'timeline', name: 'Timeline', permissions: ['filesystem:project'] }],
      trustRequired: true,
      loaded: false
    }))
    const trust = vi.spyOn(window.editorApi.plugins, 'trustProjectPlugins').mockResolvedValue(success({
      projectPath: 'D:\\Games\\WithPlugins',
      plugins: [{ id: 'timeline', name: 'Timeline', permissions: ['filesystem:project'] }],
      trustRequired: false,
      loaded: false
    }))

    const opening = useEditorStore.getState().openProject('D:\\Games\\WithPlugins')
    await vi.waitFor(() => expect(useEditorStore.getState().pluginTrustRequest?.plugins[0]?.id).toBe('timeline'))
    useEditorStore.getState().respondProjectPluginTrust('skip')

    await expect(opening).resolves.toBe(true)
    expect(trust).toHaveBeenCalledWith('D:\\Games\\WithPlugins', 'skip')
    expect(useEditorStore.getState().pluginTrustRequest).toBeNull()
  })

  it('stops a running project before closing it', async () => {
    useEditorStore.setState({ runSession: { id: 'running', status: 'running' } })
    const calls: string[] = []
    vi.spyOn(window.editorApi.runner, 'stop').mockImplementation(async () => {
      calls.push('stop')
      return success<RunSession>({ id: 'running', status: 'stopped' })
    })
    vi.spyOn(window.editorApi.project, 'close').mockImplementation(async () => {
      calls.push('close')
      return success(true as const)
    })

    expect(await useEditorStore.getState().closeProject()).toBe(true)
    expect(calls).toEqual(['stop', 'close'])
    expect(useEditorStore.getState().project).toBeNull()
  })

  it('reports automatic dependency installation while creating a project', async () => {
    await useEditorStore.getState().closeProject()
    const create = vi.spyOn(window.editorApi.project, 'create')

    await useEditorStore.getState().createProject({
      name: 'Progress Demo',
      targetDirectory: 'D:\\Games\\Progress Demo',
      installDependencies: false
    })

    expect(create).toHaveBeenCalledOnce()
    expect(useEditorStore.getState().notices.some(({ message }) => message.includes('installing dependencies'))).toBe(true)
  })

  it('removes a project from recents without deleting its files', async () => {
    const removeRecent = vi.spyOn(window.editorApi.project, 'removeRecent')

    expect(useEditorStore.getState().recentProjects.some((project) => project.path === root)).toBe(true)
    await expect(useEditorStore.getState().removeRecentProject(root)).resolves.toBe(true)

    expect(removeRecent).toHaveBeenCalledWith(root)
    expect(useEditorStore.getState().recentProjects.some((project) => project.path === root)).toBe(false)
    expect(await window.editorApi.fileSystem.stat(packagePath)).toMatchObject({ ok: true })
    expect(useEditorStore.getState().notices.at(-1)?.message).toBe('Removed browser-demo from recent projects')
  })

  it('keeps a recent project when removing it fails', async () => {
    vi.spyOn(window.editorApi.project, 'removeRecent').mockResolvedValue({
      ok: false,
      error: { code: 'ACCESS_DENIED', message: 'Recent projects could not be updated.' }
    })

    await expect(useEditorStore.getState().removeRecentProject(root)).resolves.toBe(false)

    expect(useEditorStore.getState().recentProjects.some((project) => project.path === root)).toBe(true)
    expect(useEditorStore.getState().notices.at(-1)?.message).toBe('Recent projects could not be updated.')
  })

  it('creates, opens, edits, conflict-checks, and overwrites a visual scene', async () => {
    const document = await useEditorStore.getState().createScene(`${root}\\assets\\Scenes`, 'LevelOne')
    expect(document).toMatchObject({ kind: 'scene', dirty: false, readOnly: false })
    const path = document!.path
    const scene = useSceneStore.getState().load(path, document!.content)
    expect(scene.status).toBe('editable')
    if (scene.status !== 'editable') return

    const object = {
      id: '71513ed5-ae3b-4e29-b248-28ae09cc0b19',
      type: 'container' as const,
      name: 'World',
      parentId: null,
      order: 0,
      transform: createSceneTransform(),
      visible: true,
      alpha: 1,
      components: []
    }
    useSceneStore.getState().execute(path, createObjectsCommand(scene.document, [object]))
    expect(useEditorStore.getState().documents[path]).toMatchObject({ kind: 'scene', dirty: true })

    simulateBrowserFileChange({ kind: 'change', path }, `${JSON.stringify({ format: SCENE_FORMAT, version: 99 })}\n`)
    expect(await useEditorStore.getState().saveDocument(path)).toBe(false)
    expect(useEditorStore.getState().documents[path]?.conflict).toBe(true)
    expect(await useEditorStore.getState().overwriteDocument(path)).toBe(true)
    expect(useEditorStore.getState().documents[path]).toMatchObject({ dirty: false, conflict: false })
    const savedScene = useSceneStore.getState().scenes[path]
    expect(savedScene?.status).toBe('editable')
    if (savedScene?.status === 'editable') expect(savedScene.history.cursor).toBe(savedScene.history.savePoint)
  })

  it('rejects invalid scenes before opening and preserves newer scenes read-only', async () => {
    const parent = `${root}\\assets\\Scenes`
    const invalid = await window.editorApi.fileSystem.createFile(parent, 'Broken.phaser-scene.json')
    expect(invalid.ok).toBe(true)
    if (!invalid.ok) return
    await window.editorApi.fileSystem.write(invalid.value.path, '{')
    expect(await useEditorStore.getState().openDocument(invalid.value.path)).toBeNull()
    expect(useEditorStore.getState().notices.at(-1)?.message).toContain('Could not open scene')

    const future = await window.editorApi.fileSystem.createFile(parent, 'Future.phaser-scene.json')
    expect(future.ok).toBe(true)
    if (!future.ok) return
    await window.editorApi.fileSystem.write(future.value.path, `${JSON.stringify({ format: SCENE_FORMAT, version: 99 })}\n`)
    expect(await useEditorStore.getState().openDocument(future.value.path)).toMatchObject({ kind: 'scene', readOnly: true, dirty: false })
  })
})

function success<T>(value: T): Result<T> {
  return { ok: true, value }
}
