import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { UnityUIService, listPrefabs, resolveUnityRoots } from '../src/main/unity-ui-service'
import { createUnityUIPreviewUrl, resolveUnityUIPreviewUrl } from '../src/shared/unity-ui-preview-url'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('Unity UI editor service', () => {
  it('derives the common Unity project and lists Prefabs deterministically', async () => {
    const fixture = await createUnityFixture()
    await mkdir(path.join(fixture.prefabRoot, 'Zeta'), { recursive: true })
    await writeFile(path.join(fixture.prefabRoot, 'Zeta', 'Second.prefab'), prefabFixture('Second'), 'utf8')

    await expect(resolveUnityRoots(fixture.prefabRoot, fixture.uiRawRoot)).resolves.toEqual({
      unityProjectRoot: fixture.projectRoot,
      assetsRoot: path.join(fixture.projectRoot, 'Assets')
    })
    await expect(listPrefabs(fixture.prefabRoot)).resolves.toEqual([
      expect.objectContaining({ name: 'Main.prefab', relativePath: 'Main.prefab' }),
      expect.objectContaining({ name: 'Second.prefab', relativePath: 'Zeta/Second.prefab' })
    ])
  })

  it('rejects source directories from different Unity projects', async () => {
    const first = await createUnityFixture()
    const second = await createUnityFixture()
    await expect(resolveUnityRoots(first.prefabRoot, second.uiRawRoot)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('converts, loads and exports the selected Prefab without overwriting prior exports', async () => {
    const fixture = await createUnityFixture()
    const previewRoot = path.join(fixture.root, 'cache')
    const loadPreview = vi.fn(async () => true)
    const service = new UnityUIService(previewRoot, loadPreview)
    const workspace = await service.configure({
      prefabRoot: fixture.prefabRoot,
      uiRawRoot: fixture.uiRawRoot,
      referenceResolution: { x: 750, y: 1334 }
    })

    expect(workspace.unityVersion).toBe('2022.3.20f1')
    expect(workspace.prefabs).toHaveLength(1)
    const preview = await service.preview({ relativePath: 'Main.prefab', requestId: 'request-1' })
    expect(preview).toMatchObject({ stale: false, statistics: { nodeCount: 1, errorCount: 0 } })
    expect(preview.previewUrl).toMatch(/^unity-ui-preview:\/\/local\/.+\/phaser\.html\?embedded=1$/)
    expect(loadPreview).toHaveBeenCalledWith(preview.previewUrl)
    await expect(stat(path.join(preview.outputDirectory, 'phaser.html'))).resolves.toBeDefined()
    expect(await readFile(path.join(preview.outputDirectory, 'ui.json'), 'utf8')).toContain('"name": "Main"')

    const exportRoot = path.join(fixture.root, 'exports')
    await mkdir(exportRoot)
    const first = await service.exportCurrent(exportRoot)
    const second = await service.exportCurrent(exportRoot)
    expect(path.basename(first.outputDirectory)).toBe('Main-unity-ui')
    expect(path.basename(second.outputDirectory)).toBe('Main-unity-ui-2')
    await expect(stat(second.reportJson)).resolves.toBeDefined()
  })

  it('rejects absolute and unknown Prefab selections', async () => {
    const fixture = await createUnityFixture()
    const service = new UnityUIService(path.join(fixture.root, 'cache'), async () => true)
    await service.configure({ prefabRoot: fixture.prefabRoot, uiRawRoot: fixture.uiRawRoot, referenceResolution: { x: 750, y: 1334 } })

    await expect(service.preview({ relativePath: path.join(fixture.root, 'outside.prefab'), requestId: 'absolute' })).rejects.toMatchObject({ code: 'ACCESS_DENIED' })
    await expect(service.preview({ relativePath: '../outside.prefab', requestId: 'traversal' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('Unity UI preview URL containment', () => {
  it('round-trips files inside the cache and rejects traversal', async () => {
    const root = await temporaryRoot()
    const filePath = path.join(root, 'project', 'preview', 'phaser.html')
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, '<html></html>', 'utf8')
    const url = createUnityUIPreviewUrl(root, filePath)
    expect(resolveUnityUIPreviewUrl(url, root)).toBe(filePath)
    expect(resolveUnityUIPreviewUrl('unity-ui-preview://local/%2e%2e%2foutside.txt', root)).toBeNull()
    expect(resolveUnityUIPreviewUrl('https://localhost/phaser.html', root)).toBeNull()
  })
})

async function createUnityFixture(): Promise<{ root: string; projectRoot: string; prefabRoot: string; uiRawRoot: string }> {
  const root = await temporaryRoot()
  const projectRoot = path.join(root, 'UnityProject')
  const prefabRoot = path.join(projectRoot, 'Assets', 'Resources', 'UI')
  const uiRawRoot = path.join(projectRoot, 'Assets', 'UIRaw')
  await Promise.all([
    mkdir(prefabRoot, { recursive: true }),
    mkdir(uiRawRoot, { recursive: true }),
    mkdir(path.join(projectRoot, 'ProjectSettings'), { recursive: true })
  ])
  await Promise.all([
    writeFile(path.join(prefabRoot, 'Main.prefab'), prefabFixture('Main'), 'utf8'),
    writeFile(path.join(projectRoot, 'ProjectSettings', 'ProjectVersion.txt'), 'm_EditorVersion: 2022.3.20f1\n', 'utf8')
  ])
  return { root, projectRoot, prefabRoot, uiRawRoot }
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'phaser-unity-ui-'))
  temporaryRoots.push(root)
  return root
}

function prefabFixture(name: string): string {
  return `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1 &1000
GameObject:
  m_ObjectHideFlags: 0
  m_Component:
  - component: {fileID: 2000}
  m_Layer: 5
  m_Name: ${name}
  m_IsActive: 1
--- !u!224 &2000
RectTransform:
  m_ObjectHideFlags: 0
  m_GameObject: {fileID: 1000}
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalPosition: {x: 0, y: 0, z: 0}
  m_LocalScale: {x: 1, y: 1, z: 1}
  m_Children: []
  m_Father: {fileID: 0}
  m_RootOrder: 0
  m_AnchorMin: {x: 0.5, y: 0.5}
  m_AnchorMax: {x: 0.5, y: 0.5}
  m_AnchoredPosition: {x: 0, y: 0}
  m_SizeDelta: {x: 300, y: 160}
  m_Pivot: {x: 0.5, y: 0.5}
`
}
