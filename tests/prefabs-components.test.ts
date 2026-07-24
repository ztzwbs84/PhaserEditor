import { beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  createPrefabOverrideKey,
  createSceneDocument,
  createSceneTransform,
  serializeSceneDocument,
  type SceneDocument,
  type SceneObject
} from '@phaser-editor/contracts'
import { SceneComponentProjectionManager } from '../src/renderer/src/lib/component-projection'
import { createPrefabFromScene, instantiatePrefab, refreshPrefabInstance } from '../src/renderer/src/lib/prefabs'
import { sceneComponentRegistry } from '../src/renderer/src/lib/scene-components'
import { updateObjectCommand } from '../src/renderer/src/store/scene-commands'
import { useSceneStore } from '../src/renderer/src/store/scene-store'

const ids = {
  root: 'e73a8de2-4ee2-4318-b219-9c37b9fddda5',
  child: '2f448d68-9a10-49ec-b3a8-9ec4ff81b747',
  component: '83cd22f3-fc28-4577-9557-2d9e6685c11f'
}

function sourceScene(): SceneDocument {
  return {
    ...createSceneDocument('PrefabTest'),
    objects: [
      {
        id: ids.root,
        type: 'sprite',
        name: 'Hero',
        parentId: null,
        order: 0,
        transform: createSceneTransform({ x: 40, y: 50 }),
        visible: true,
        alpha: 1,
        components: [{ id: ids.component, type: 'phaser.arcade-body', version: 1, enabled: true, data: sceneComponentRegistry.get('phaser.arcade-body')!.createDefault() }],
        asset: { path: 'assets/hero.png', frame: null },
        animation: null
      },
      {
        id: ids.child,
        type: 'text',
        name: 'Label',
        parentId: ids.root,
        order: 0,
        transform: createSceneTransform({ x: 0, y: -40 }),
        visible: true,
        alpha: 1,
        components: [],
        text: 'Hero',
        style: { fontFamily: 'Arial', fontSize: 18, color: '#ffffff', align: 'center' }
      }
    ]
  }
}

describe('prefab resolution', () => {
  it('creates a subtree prefab and refreshes base changes while preserving valid overrides', () => {
    const prefab = createPrefabFromScene(sourceScene(), ids.root)
    expect(prefab.objects.map((object) => object.id)).toEqual([ids.root, ids.child])
    expect(prefab.objects[0]?.transform).toMatchObject({ x: 0, y: 0 })

    const overrideKey = createPrefabOverrideKey(ids.root, ids.component, ['bounce', 'x'])
    const instance = instantiatePrefab('assets/Prefabs/Hero.phaser-prefab.json', prefab, { x: 300, y: 220 }, { [overrideKey]: 0.4 })
    const instanceRootId = instance.metadata.objectMap[ids.root]!
    const instanceRoot = instance.objects.find((object) => object.id === instanceRootId)!
    expect(instanceRoot.transform).toMatchObject({ x: 300, y: 220 })
    expect((instanceRoot.components[0]?.data.bounce as { x: number }).x).toBe(0.4)

    const updatedPrefab = structuredClone(prefab)
    updatedPrefab.objects[0]!.name = 'Hero Updated'
    ;(updatedPrefab.objects[0]!.components[0]!.data.bounce as { x: number }).x = 0.8
    const scene = { ...createSceneDocument(), objects: instance.objects }
    const refreshed = refreshPrefabInstance(scene, instanceRootId, updatedPrefab)
    const refreshedRoot = refreshed.document.objects.find((object) => object.id === instanceRootId)!
    expect(refreshedRoot.name).toBe('Hero Updated')
    expect((refreshedRoot.components[0]?.data.bounce as { x: number }).x).toBe(0.4)
    expect(refreshedRoot.prefabInstance?.objectMap).toEqual(instance.metadata.objectMap)
  })

  it('preserves unresolved overrides after a target disappears', () => {
    const prefab = createPrefabFromScene(sourceScene(), ids.root)
    const missingKey = createPrefabOverrideKey(ids.child, null, ['style', 'removed'])
    const instance = instantiatePrefab('assets/Prefabs/Hero.phaser-prefab.json', prefab, { x: 0, y: 0 }, { [missingKey]: '#ff0000' })
    expect(instance.diagnostics).toEqual([expect.objectContaining({ code: 'missing-override-property' })])
    expect(instance.metadata.overrides[missingKey]).toBe('#ff0000')
  })
})

describe('scene component registry and lifecycle', () => {
  beforeEach(() => { useSceneStore.setState({ scenes: {}, activePath: null }) })

  it('mounts, disables, updates, and disposes registered component projections', () => {
    const calls: string[] = []
    const type = 'test.lifecycle'
    const dispose = sceneComponentRegistry.register({
      type,
      version: 1,
      label: 'Lifecycle Test',
      dataSchema: z.object({ value: z.number() }).strict(),
      createDefault: () => ({ value: 1 }),
      supports: () => true,
      properties: [],
      createProjection: () => ({
        update: (data) => calls.push(`update:${String(data.value)}`),
        setActive: (active) => calls.push(`active:${active}`),
        destroy: () => calls.push('destroy')
      })
    })
    try {
      const manager = new SceneComponentProjectionManager()
      const object: SceneObject = { id: ids.root, type: 'container', name: 'Root', parentId: null, order: 0, transform: createSceneTransform(), visible: true, alpha: 1, components: [{ id: ids.component, type, version: 1, enabled: true, data: { value: 1 } }] }
      const context = { scene: {}, gameObject: {}, overlay: {}, documentObjects: [object], resolveGameObject: () => null, ensureTexture: () => ({ key: '', state: 'failed' as const }), requestReconcile: () => undefined, report: () => undefined }
      manager.reconcile([object], () => context)
      manager.setActive(false)
      manager.setActive(true)
      manager.reconcile([{ ...object, components: [{ ...object.components[0]!, enabled: false, data: { value: 2 } }] }], () => context)
      manager.reconcile([], () => null)
      expect(calls).toEqual(['update:1', 'active:true', 'active:false', 'active:true', 'update:2', 'active:false', 'destroy'])
      manager.destroy()
    } finally { dispose() }
  })

  it('undoes and redoes component disable without losing authored data', () => {
    const path = 'browser-demo\\assets\\component.phaser-scene.json'
    const document = sourceScene()
    useSceneStore.getState().load(path, serializeSceneDocument(document))
    const scene = editable(path)
    const before = scene.document.objects[0]!
    const after = { ...before, components: before.components.map((component) => ({ ...component, enabled: false })) }
    useSceneStore.getState().execute(path, updateObjectCommand(before, after, [before.id], 'Disable component'))
    expect(editable(path).document.objects[0]?.components[0]).toMatchObject({ enabled: false, data: before.components[0]?.data })
    useSceneStore.getState().undo(path)
    expect(editable(path).document.objects[0]?.components[0]?.enabled).toBe(true)
    useSceneStore.getState().redo(path)
    expect(editable(path).document.objects[0]?.components[0]?.enabled).toBe(false)
  })
})

function editable(path: string) {
  const scene = useSceneStore.getState().scenes[path]
  if (scene?.status !== 'editable') throw new Error('Expected editable scene.')
  return scene
}
