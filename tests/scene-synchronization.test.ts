import { beforeEach, describe, expect, it } from 'vitest'
import { createSceneDocument, createSceneTransform, serializeSceneDocument, type EditorDocument, type SceneDocument } from '@phaser-editor/contracts'
import { coreScenePropertyDescriptors } from '../src/renderer/src/lib/scene-properties'
import { planSceneProjection } from '../src/renderer/src/lib/scene-projection'
import { updateObjectCommand } from '../src/renderer/src/store/scene-commands'
import { useEditorStore } from '../src/renderer/src/store/editor-store'
import { useSceneStore } from '../src/renderer/src/store/scene-store'

const path = 'browser-demo\\assets\\Scenes\\Sync.phaser-scene.json'
const objectId = '5c2149ce-a097-43ad-ae8f-0d51ee89674f'

function fixture(): SceneDocument {
  return {
    ...createSceneDocument('SyncScene'),
    objects: [{
      id: objectId,
      type: 'text',
      name: 'Title',
      parentId: null,
      order: 0,
      transform: createSceneTransform({ x: 80, y: 90 }),
      visible: true,
      alpha: 1,
      components: [],
      text: 'Ready',
      style: { fontFamily: 'Arial', fontSize: 24, color: '#ffffff', align: 'left' }
    }]
  }
}

describe('scene surface synchronization', () => {
  beforeEach(() => {
    const content = serializeSceneDocument(fixture())
    const editorDocument: EditorDocument = { id: crypto.randomUUID(), path, name: 'Sync.phaser-scene.json', kind: 'scene', language: 'json', content, savedContent: content, modifiedAt: 1, dirty: false }
    useEditorStore.setState({ documents: { [path]: editorDocument }, selectedPath: path })
    useSceneStore.setState({ scenes: {}, activePath: null })
    useSceneStore.getState().load(path, content)
    useSceneStore.getState().select(path, [objectId])
  })

  it('keeps selection, Inspector edits, projection updates, serialized model, dirty state, and undo aligned', () => {
    const descriptor = coreScenePropertyDescriptors.find((candidate) => candidate.id === 'x')!
    const before = editable().document.objects[0]!
    const after = descriptor.write(before, 240)
    useSceneStore.getState().execute(path, updateObjectCommand(before, after, [objectId], 'Edit Position X'))

    const edited = editable()
    expect(edited.selection).toEqual([objectId])
    expect(edited.document.objects[0]?.transform.x).toBe(240)
    expect(useEditorStore.getState().documents[path]).toMatchObject({ dirty: true })
    expect(useEditorStore.getState().documents[path]?.content).toContain('"x": 240')
    const projection = planSceneProjection({ [objectId]: 'text' }, edited.document, () => 'ready')
    expect(projection.update).toEqual([objectId])

    useSceneStore.getState().undo(path)
    expect(editable().document.objects[0]?.transform.x).toBe(80)
    expect(editable().selection).toEqual([objectId])
    expect(useEditorStore.getState().documents[path]?.dirty).toBe(false)
  })

  it('rejects invalid descriptor values before a command mutates the model', () => {
    const descriptor = coreScenePropertyDescriptors.find((candidate) => candidate.id === 'style.color')!
    expect(descriptor.validate?.('red')).toContain('six-digit hex')
    const object = editable().document.objects[0]
    expect(object?.type === 'text' ? object.style.color : null).toBe('#ffffff')
    expect(editable().history.entries).toHaveLength(0)
  })
})

function editable() {
  const scene = useSceneStore.getState().scenes[path]
  if (scene?.status !== 'editable') throw new Error('Expected editable scene.')
  return scene
}
