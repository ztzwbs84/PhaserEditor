import { describe, expect, it } from 'vitest'
import {
  CURRENT_SCENE_VERSION,
  SCENE_FORMAT,
  SceneDocumentError,
  createSceneDocument,
  createSceneTransform,
  parseSceneDocument,
  serializeSceneDocument,
  type SceneDocument
} from '@phaser-editor/contracts'

const ids = {
  root: '9f89ce06-33fb-4ecf-9fd8-0b90f29c15c9',
  child: 'bf6b954a-7b82-4ef3-8880-103bf93a2725'
}

function sceneFixture(): SceneDocument {
  return {
    ...createSceneDocument('LevelOne'),
    objects: [
      {
        id: ids.root,
        type: 'container',
        name: 'World',
        parentId: null,
        order: 0,
        transform: createSceneTransform({ x: 16, y: 24 }),
        visible: true,
        alpha: 1,
        components: []
      },
      {
        id: ids.child,
        type: 'image',
        name: 'Backdrop',
        parentId: ids.root,
        order: 0,
        transform: createSceneTransform({ x: 320, y: 180, originX: 0, originY: 0 }),
        visible: true,
        alpha: 0.8,
        components: [],
        asset: { path: 'assets/background.png', frame: null }
      }
    ]
  }
}

describe('scene document schema', () => {
  it('round trips deterministically without changing IDs or hierarchy order', () => {
    const first = serializeSceneDocument(sceneFixture())
    const parsed = parseSceneDocument(first)
    expect(parsed.status).toBe('editable')
    if (parsed.status !== 'editable') return
    const second = serializeSceneDocument(parsed.document)
    expect(second).toBe(first)
    expect(parsed.document.objects.map((object) => object.id)).toEqual([ids.root, ids.child])
  })

  it('reports the exact data path for invalid properties and outside-project assets', () => {
    const invalid = sceneFixture() as unknown as { objects: Array<Record<string, unknown>> }
    invalid.objects[1]!.asset = { path: '../outside.png', frame: null }
    expect(() => serializeSceneDocument(invalid as unknown as SceneDocument)).toThrowError(expect.objectContaining({
      issues: expect.arrayContaining([expect.objectContaining({ path: '$.objects[1].asset.path' })])
    }))
  })

  it('rejects duplicate IDs, missing parents, and hierarchy cycles', () => {
    const duplicate = sceneFixture()
    duplicate.objects[1]!.id = ids.root
    expectSceneIssue(duplicate, '$.objects[1].id')

    const missing = sceneFixture()
    missing.objects[1]!.parentId = '3446fac5-166e-4a68-b447-bce7821c954d'
    expectSceneIssue(missing, '$.objects[1].parentId')

    const cycle = sceneFixture()
    cycle.objects[0]!.parentId = ids.child
    expectSceneIssue(cycle, '$.objects[0].parentId')
  })

  it('migrates version 1 transforms into the current schema', () => {
    const legacy = JSON.stringify({
      format: SCENE_FORMAT,
      version: 1,
      settings: { key: 'Legacy', width: 800, height: 600, backgroundColor: '#112233', pixelArt: true },
      objects: [{
        id: ids.root,
        type: 'text',
        name: 'Title',
        parentId: null,
        order: 0,
        x: 100,
        y: 80,
        angle: 90,
        text: 'Ready',
        fontFamily: 'Verdana',
        fontSize: 24,
        color: '#ffcc00'
      }]
    })
    const parsed = parseSceneDocument(legacy)
    expect(parsed.status).toBe('editable')
    if (parsed.status !== 'editable') return
    expect(parsed.migratedFrom).toBe(1)
    expect(parsed.document.version).toBe(CURRENT_SCENE_VERSION)
    expect(parsed.document.objects[0]?.transform.rotation).toBeCloseTo(Math.PI / 2)
  })

  it('migrates version 2 objects with an empty ordered component list', () => {
    const current = sceneFixture()
    const version2 = JSON.stringify({
      ...current,
      version: 2,
      objects: current.objects.map(({ components: _components, ...object }) => object)
    })
    const parsed = parseSceneDocument(version2)
    expect(parsed.status).toBe('editable')
    if (parsed.status !== 'editable') return
    expect(parsed.migratedFrom).toBe(2)
    expect(parsed.document.version).toBe(CURRENT_SCENE_VERSION)
    expect(parsed.document.objects.every((object) => object.components.length === 0)).toBe(true)
  })

  it('keeps newer scene bytes read-only and rejects malformed JSON', () => {
    const newer = `{\"format\":\"${SCENE_FORMAT}\",\"version\":${CURRENT_SCENE_VERSION + 1},\"future\":true}`
    expect(parseSceneDocument(newer)).toMatchObject({ status: 'readonly', raw: newer, version: CURRENT_SCENE_VERSION + 1 })
    expect(() => parseSceneDocument('{')).toThrow(SceneDocumentError)
  })
})

function expectSceneIssue(document: SceneDocument, path: string): void {
  try {
    serializeSceneDocument(document)
    throw new Error('Expected scene validation to fail.')
  } catch (error) {
    expect(error).toBeInstanceOf(SceneDocumentError)
    expect((error as SceneDocumentError).issues.some((issue) => issue.path === path)).toBe(true)
  }
}
