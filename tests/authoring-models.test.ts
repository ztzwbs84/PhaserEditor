import { describe, expect, it } from 'vitest'
import {
  ANIMATION_ASSET_FORMAT,
  CURRENT_ANIMATION_ASSET_VERSION,
  CURRENT_PREFAB_VERSION,
  PREFAB_FORMAT,
  createPrefabOverrideKey,
  createSceneTransform,
  parseAnimationAsset,
  parsePrefab,
  serializeAnimationAsset,
  serializePrefab,
  validateAnimationFrameReferences,
  validatePrefabOverrides,
  type AnimationAsset,
  type PrefabDocument,
  type PrefabInstance
} from '@phaser-editor/contracts'
import { createSpritesheetFrameSource, importPhaserAtlas } from '../src/renderer/src/lib/frame-sources'

const ids = {
  clip: '8c1ef434-8901-47aa-9108-424f14dabf76',
  object: '04752295-94a9-44a8-b782-7c9f7be877d8',
  component: '0bb99af7-bb2d-4ea5-b92f-c36c192568c8',
  exposed: '9685e4e1-a970-43f8-b90f-bcac5dcc6564',
  instance: '1b9fa916-c71b-4e2d-89d0-b872c2a820fe'
}

describe('frame source adapters', () => {
  it('normalizes Phaser hash and array atlases without rewriting metadata', () => {
    const hash = JSON.stringify({
      frames: {
        idle: { frame: { x: 0, y: 0, w: 16, h: 20 }, rotated: false, trimmed: false },
        run: { frame: { x: 16, y: 0, w: 16, h: 20 }, rotated: false, trimmed: false }
      },
      meta: { image: 'hero.png', size: { w: 32, h: 20 } }
    })
    const hashResult = importPhaserAtlas(hash, 'assets/hero.json')
    expect(hashResult.issues).toEqual([])
    expect(hashResult.source?.source).toEqual({ kind: 'atlas', imagePath: 'assets/hero.png', metadataPath: 'assets/hero.json' })
    expect(hashResult.source?.frames.map((frame) => frame.key)).toEqual(['idle', 'run'])

    const array = {
      textures: [{
        image: 'effects.png',
        size: { w: 32, h: 16 },
        frames: [{ filename: 'spark', frame: { x: 0, y: 0, w: 16, h: 16 }, rotated: false, trimmed: false }]
      }]
    }
    const arrayResult = importPhaserAtlas(array, 'assets/fx/effects.json')
    expect(arrayResult.source?.source.imagePath).toBe('assets/fx/effects.png')
    expect(arrayResult.source?.frames[0]?.key).toBe('spark')
  })

  it('validates atlas bounds and excludes incomplete spritesheet edge frames', () => {
    const invalid = importPhaserAtlas({
      frames: { broken: { frame: { x: 30, y: 0, w: 8, h: 8 } } },
      meta: { image: 'sheet.png', size: { w: 32, h: 16 } }
    }, 'assets/sheet.json')
    expect(invalid.source?.frames).toEqual([])
    expect(invalid.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'frame-out-of-bounds', path: expect.stringContaining('broken') })]))

    const grid = createSpritesheetFrameSource({ imagePath: 'assets/sheet.png', imageWidth: 35, imageHeight: 17, frameWidth: 16, frameHeight: 16, margin: 0, spacing: 1 })
    expect(grid.source?.frames.map((frame) => frame.bounds.x)).toEqual([0, 17])
    expect(grid.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'incomplete-grid-edge', severity: 'warning' })]))
  })
})

describe('animation and prefab documents', () => {
  it('round trips animation assets and preserves missing frame references', () => {
    const asset: AnimationAsset = {
      format: ANIMATION_ASSET_FORMAT,
      version: CURRENT_ANIMATION_ASSET_VERSION,
      clips: [{
        id: ids.clip,
        key: 'hero-run',
        frames: [
          { source: 'assets/hero.json', frame: 'run-0' },
          { source: 'assets/hero.json', frame: 'removed-frame' }
        ],
        frameRate: 12,
        duration: null,
        delay: 40,
        repeat: -1,
        repeatDelay: 20,
        yoyo: true,
        skipMissedFrames: true
      }]
    }
    const serialized = serializeAnimationAsset(asset)
    expect(serializeAnimationAsset(parseAnimationAsset(serialized))).toBe(serialized)

    const source = importPhaserAtlas({
      frames: { 'run-0': { frame: { x: 0, y: 0, w: 16, h: 16 } } },
      meta: { image: 'hero.png', size: { w: 16, h: 16 } }
    }, 'assets/hero.json').source!
    expect(validateAnimationFrameReferences(asset, [source])).toEqual([
      expect.objectContaining({ code: 'missing-frame', path: '$.clips[0].frames[1].frame' })
    ])
    expect(parseAnimationAsset(serialized).clips[0]?.frames[1]?.frame).toBe('removed-frame')
  })

  it('round trips prefabs and reports unresolved overrides without dropping them', () => {
    const prefab: PrefabDocument = {
      format: PREFAB_FORMAT,
      version: CURRENT_PREFAB_VERSION,
      rootObjectId: ids.object,
      objects: [{
        id: ids.object,
        type: 'sprite',
        name: 'Hero',
        parentId: null,
        order: 0,
        transform: createSceneTransform(),
        visible: true,
        alpha: 1,
        components: [{ id: ids.component, type: 'phaser.arcade-body', version: 1, enabled: true, data: { bounce: 0.2 } }],
        asset: { path: 'assets/hero.png', frame: null },
        animation: null
      }],
      exposedProperties: [{ id: ids.exposed, name: 'Bounce', objectId: ids.object, componentId: ids.component, propertyPath: ['bounce'] }]
    }
    const serialized = serializePrefab(prefab)
    expect(serializePrefab(parsePrefab(serialized))).toBe(serialized)

    const missingKey = createPrefabOverrideKey(ids.object, ids.component, ['removed'])
    const instance: PrefabInstance = { prefabPath: 'assets/Hero.phaser-prefab.json', instanceId: ids.instance, overrides: { [missingKey]: 1 } }
    expect(validatePrefabOverrides(prefab, instance)).toEqual([expect.objectContaining({ code: 'missing-override-property' })])
    expect(instance.overrides[missingKey]).toBe(1)
  })
})
