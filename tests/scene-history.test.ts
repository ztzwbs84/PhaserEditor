import { beforeEach, describe, expect, it } from 'vitest'
import {
  createSceneDocument,
  createSceneTransform,
  serializeSceneDocument,
  type EditorDocument,
  type SceneDocument,
  type SceneObject
} from '@phaser-editor/contracts'
import { useEditorStore } from '../src/renderer/src/store/editor-store'
import { useSceneStore } from '../src/renderer/src/store/scene-store'
import {
  createObjectsCommand,
  deleteObjectsCommand,
  groupSceneCommands,
  transformObjectsCommand,
  updateObjectCommand
} from '../src/renderer/src/store/scene-commands'

const pathA = 'browser-demo\\assets\\Scenes\\A.phaser-scene.json'
const pathB = 'browser-demo\\assets\\Scenes\\B.phaser-scene.json'
const rootId = '7ff10ae8-b59d-4f18-8ad5-43986b06ad4d'
const childId = 'd048c50a-c0ba-43f7-ae24-1e457999998f'

function rootObject(): SceneObject {
  return { id: rootId, type: 'container', name: 'World', parentId: null, order: 0, transform: createSceneTransform(), visible: true, alpha: 1, components: [] }
}

function childObject(): SceneObject {
  return {
    id: childId,
    type: 'text',
    name: 'Label',
    parentId: rootId,
    order: 0,
    transform: createSceneTransform({ x: 10, y: 20 }),
    visible: true,
    alpha: 1,
    components: [],
    text: 'Ready',
    style: { fontFamily: 'Arial', fontSize: 24, color: '#ffffff', align: 'left' }
  }
}

function scene(objects: SceneObject[] = []): SceneDocument {
  return { ...createSceneDocument('TestScene'), objects }
}

describe('scene command history', () => {
  beforeEach(() => {
    useSceneStore.setState({ scenes: {}, activePath: null })
    const a = serializeSceneDocument(scene())
    const b = serializeSceneDocument(scene())
    useEditorStore.setState({ documents: { [pathA]: editorDocument(pathA, a), [pathB]: editorDocument(pathB, b) }, selectedPath: pathA })
    useSceneStore.getState().load(pathA, a)
    useSceneStore.getState().load(pathB, b)
    useSceneStore.getState().activate(pathA)
  })

  it('creates, undoes, redoes, and truncates an abandoned redo branch', () => {
    const initial = editable(pathA)
    useSceneStore.getState().execute(pathA, createObjectsCommand(initial.document, [rootObject()]))
    expect(editable(pathA).document.objects).toHaveLength(1)
    expect(useSceneStore.getState().undo(pathA)).toBe(true)
    expect(editable(pathA).document.objects).toHaveLength(0)
    expect(useSceneStore.getState().redo(pathA)).toBe(true)
    expect(editable(pathA).document.objects[0]?.id).toBe(rootId)

    useSceneStore.getState().undo(pathA)
    useSceneStore.getState().execute(pathA, createObjectsCommand(editable(pathA).document, [childObjectWithRoot(null)]))
    expect(editable(pathA).history.entries).toHaveLength(1)
    expect(useSceneStore.getState().redo(pathA)).toBe(false)
  })

  it('deletes and restores a subtree with selection', () => {
    const loaded = scene([rootObject(), childObject()])
    useSceneStore.getState().load(pathA, serializeSceneDocument(loaded))
    useSceneStore.getState().select(pathA, [rootId])
    useSceneStore.getState().execute(pathA, deleteObjectsCommand(editable(pathA).document, [rootId], [rootId]))
    expect(editable(pathA).document.objects).toHaveLength(0)
    useSceneStore.getState().undo(pathA)
    expect(editable(pathA).document.objects.map((object) => object.id)).toEqual([rootId, childId])
    expect(editable(pathA).selection).toEqual([rootId])
  })

  it('commits one transform entry for many previews and rolls cancelled gestures back', () => {
    useSceneStore.getState().load(pathA, serializeSceneDocument(scene([rootObject()])))
    useSceneStore.getState().select(pathA, [rootId])
    expect(useSceneStore.getState().beginTransformGesture(pathA, [rootId], 'Move object')).toBe(true)
    useSceneStore.getState().previewTransforms(pathA, { [rootId]: createSceneTransform({ x: 20 }) })
    useSceneStore.getState().previewTransforms(pathA, { [rootId]: createSceneTransform({ x: 40 }) })
    expect(useSceneStore.getState().commitTransformGesture(pathA)).toBe(true)
    expect(editable(pathA).history.entries).toHaveLength(1)
    expect(editable(pathA).document.objects[0]?.transform.x).toBe(40)
    useSceneStore.getState().undo(pathA)
    expect(editable(pathA).document.objects[0]?.transform.x).toBe(0)

    useSceneStore.getState().beginTransformGesture(pathA, [rootId], 'Move object')
    useSceneStore.getState().previewTransforms(pathA, { [rootId]: createSceneTransform({ y: 90 }) })
    useSceneStore.getState().cancelTransformGesture(pathA)
    expect(editable(pathA).document.objects[0]?.transform.y).toBe(0)
    expect(editable(pathA).history.cursor).toBe(0)
  })

  it('groups commands, tracks the save point, and isolates scene histories', () => {
    const original = rootObject()
    const renamed = { ...original, name: 'Renamed' }
    const moved = transformObjectsCommand({ [rootId]: original.transform }, { [rootId]: createSceneTransform({ x: 64 }) }, [rootId], 'Move object')
    const create = createObjectsCommand(editable(pathA).document, [original])
    const rename = updateObjectCommand(original, renamed, [rootId], 'Rename object')
    useSceneStore.getState().execute(pathA, groupSceneCommands('Create and configure object', [create, rename, moved]))
    expect(editable(pathA).history.entries).toHaveLength(1)
    expect(useEditorStore.getState().documents[pathA]?.dirty).toBe(true)
    useSceneStore.getState().markSaved(pathA)
    expect(useEditorStore.getState().documents[pathA]?.dirty).toBe(false)

    useSceneStore.getState().execute(pathB, createObjectsCommand(editable(pathB).document, [childObjectWithRoot(null)]))
    useSceneStore.getState().activate(pathB)
    useSceneStore.getState().undo()
    expect(editable(pathB).document.objects).toHaveLength(0)
    expect(editable(pathA).document.objects[0]?.name).toBe('Renamed')

    useSceneStore.getState().activate(pathA)
    useSceneStore.getState().undo()
    expect(useEditorStore.getState().documents[pathA]?.dirty).toBe(true)
    useSceneStore.getState().redo()
    expect(useEditorStore.getState().documents[pathA]?.dirty).toBe(false)
  })
})

function editable(path: string) {
  const record = useSceneStore.getState().scenes[path]
  if (record?.status !== 'editable') throw new Error(`Expected editable scene at ${path}.`)
  return record
}

function editorDocument(path: string, content: string): EditorDocument {
  return { id: crypto.randomUUID(), path, name: path.split('\\').pop()!, kind: 'scene', language: 'json', content, savedContent: content, modifiedAt: 1, dirty: false }
}

function childObjectWithRoot(parentId: string | null): SceneObject {
  return { ...childObject(), parentId }
}
