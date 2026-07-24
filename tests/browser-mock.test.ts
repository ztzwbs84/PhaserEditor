import { afterEach, describe, expect, it, vi } from 'vitest'
import { installBrowserMock, simulateBrowserFileChange } from '../src/renderer/src/dev/browser-mock'

describe('browser project bridge', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uses the requested project instead of returning the bundled demo', async () => {
    vi.stubGlobal('window', {})
    installBrowserMock()

    const opened = await window.editorApi.project.open('D:\\Games\\Solar Dash')
    expect(opened).toMatchObject({
      ok: true,
      value: { name: 'Solar Dash', path: 'D:\\Games\\Solar Dash' }
    })

    const created = await window.editorApi.project.create({
      name: 'Commercial Demo',
      targetDirectory: 'E:\\Phaser Projects\\Commercial Demo',
      installDependencies: false
    })
    expect(created).toMatchObject({
      ok: true,
      value: { name: 'commercial-demo', path: 'E:\\Phaser Projects\\Commercial Demo' }
    })

    const recent = await window.editorApi.project.listRecent()
    expect(recent.ok && recent.value.slice(0, 2).map(({ name }) => name)).toEqual([
      'commercial-demo',
      'Solar Dash'
    ])

    const files = await window.editorApi.fileSystem.list('E:\\Phaser Projects\\Commercial Demo')
    expect(files.ok && files.value.every(({ path }) => path.startsWith('E:\\Phaser Projects\\Commercial Demo'))).toBe(true)
  })

  it('models direct directory contents, mutations, change events and conflicts', async () => {
    vi.stubGlobal('window', {})
    installBrowserMock()
    await window.editorApi.project.open('browser-demo')
    const events: string[] = []
    const dispose = window.editorApi.fileSystem.onChange((event) => events.push(`${event.kind}:${event.path}`))

    const rootEntries = await window.editorApi.fileSystem.list('browser-demo')
    expect(rootEntries.ok && rootEntries.value.filter((entry) => entry.kind === 'directory').map((entry) => entry.name)).toEqual(['assets', 'public', 'src'])
    expect(rootEntries.ok && rootEntries.value.filter((entry) => entry.kind === 'file').map((entry) => entry.name)).toEqual(['index.html', 'package.json', 'README.md', 'tsconfig.json'])

    const created = await window.editorApi.fileSystem.createFile('browser-demo\\src', 'state.ts')
    expect(created.ok).toBe(true)
    const renamed = await window.editorApi.fileSystem.rename('browser-demo\\src\\state.ts', 'store.ts')
    expect(renamed.ok && renamed.value.path).toBe('browser-demo\\src\\store.ts')
    const moved = await window.editorApi.fileSystem.move('browser-demo\\src\\store.ts', 'browser-demo\\assets')
    expect(moved.ok && moved.value.path).toBe('browser-demo\\assets\\store.ts')
    await window.editorApi.fileSystem.trash('browser-demo\\assets\\store.ts')
    expect(events).toContain('add:browser-demo\\src\\state.ts')
    expect(events).toContain('unlink:browser-demo\\assets\\store.ts')

    const before = await window.editorApi.fileSystem.read('browser-demo\\package.json')
    expect(before.ok).toBe(true)
    simulateBrowserFileChange({ kind: 'change', path: 'browser-demo\\package.json' }, '{"external":true}\n')
    const conflict = await window.editorApi.fileSystem.write('browser-demo\\package.json', '{}\n', before.ok ? before.value.modifiedAt : undefined)
    expect(conflict).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
    dispose()
  })
})
