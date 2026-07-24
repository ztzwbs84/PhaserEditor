import { describe, expect, it } from 'vitest'
import { createSceneTransform, type SceneObject } from '@phaser-editor/contracts'
import { sceneComponentRegistry } from '../src/renderer/src/lib/scene-components'

const objectId = 'd4614bc1-c3a0-4ce8-80f1-170b6044fb9f'

function object(): SceneObject {
  return { id: objectId, type: 'container', name: 'World', parentId: null, order: 0, transform: createSceneTransform(), visible: true, alpha: 1, components: [] }
}

describe('Phaser gameplay component models', () => {
  it('creates valid versioned defaults for every built-in component', () => {
    const types = ['phaser.camera', 'phaser.arcade-body', 'phaser.matter-body', 'phaser.particle-emitter', 'phaser.tween']
    for (const type of types) {
      const component = sceneComponentRegistry.create(type)
      expect(component).toMatchObject({ type, version: 1, enabled: true })
      expect(sceneComponentRegistry.validate(component)).toEqual([])
    }
  })

  it('validates camera/tween targets and rejects a self-intersecting Matter polygon', () => {
    const camera = sceneComponentRegistry.create('phaser.camera')
    camera.data.followTargetId = '9a5d7b65-6cd8-4bc7-a089-a2b79efac4fe'
    expect(sceneComponentRegistry.validate(camera, [object()])).toEqual([expect.stringContaining('does not exist')])

    const tween = sceneComponentRegistry.create('phaser.tween')
    tween.data.targetId = objectId
    expect(sceneComponentRegistry.validate(tween, [object()])).toEqual([])

    const matter = sceneComponentRegistry.create('phaser.matter-body')
    matter.data.shape = 'polygon'
    matter.data.vertices = [{ x: 0, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }, { x: 20, y: 0 }]
    expect(sceneComponentRegistry.validate(matter)).toEqual([expect.stringContaining('self-intersect')])
  })

  it('enforces bounded particle preview limits and typed tween timing', () => {
    const particle = sceneComponentRegistry.create('phaser.particle-emitter')
    particle.data.maxAliveParticles = 20_000
    expect(sceneComponentRegistry.validate(particle)).toEqual([expect.stringMatching(/maxAliveParticles.*2000/)])

    const tween = sceneComponentRegistry.create('phaser.tween')
    tween.data.duration = 0
    tween.data.repeat = -2
    expect(sceneComponentRegistry.validate(tween)).toEqual(expect.arrayContaining([expect.stringContaining('duration'), expect.stringContaining('repeat')]))
  })
})
