import { describe, expect, it } from 'vitest'
import { createSceneDocument, createSceneTransform, type SceneDocument } from '@phaser-editor/contracts'
import { parseSceneAssetDragPayload, validateSceneAssetDrop } from '../src/renderer/src/lib/scene-assets'
import { planSceneProjection } from '../src/renderer/src/lib/scene-projection'
import { disposeSceneViewport } from '../src/renderer/src/lib/scene-viewport-lifecycle'

const imageId = '42cb4be3-4785-43db-b78e-a26bf3bf11f2'
const textId = 'd9a3f67d-0122-43d3-884e-276c402531a8'

function fixture(assetPath = 'assets/tiles.png'): SceneDocument {
  return {
    ...createSceneDocument(),
    objects: [
      { id: imageId, type: 'image', name: 'Tiles', parentId: null, order: 0, transform: createSceneTransform(), visible: true, alpha: 1, components: [], asset: { path: assetPath, frame: null } },
      { id: textId, type: 'text', name: 'Title', parentId: null, order: 1, transform: createSceneTransform(), visible: true, alpha: 1, components: [], text: 'Ready', style: { fontFamily: 'Arial', fontSize: 24, color: '#ffffff', align: 'left' } }
    ]
  }
}

describe('scene asset drops and projection reconciliation', () => {
  it('accepts supported project assets and rejects unsupported or outside paths', () => {
    const payload = parseSceneAssetDragPayload(JSON.stringify({ kind: 'asset', path: 'C:\\Game\\assets\\hero.png', relativePath: 'assets/hero.png', extension: 'png' }))
    expect(payload).not.toBeNull()
    expect(validateSceneAssetDrop('C:\\Game', payload!)).toEqual({ ok: true, relativePath: 'assets/hero.png', objectType: 'image' })
    expect(validateSceneAssetDrop('C:\\Game', { ...payload!, path: 'C:\\Outside\\hero.png' })).toMatchObject({ ok: false })
    expect(validateSceneAssetDrop('C:\\Game', { ...payload!, path: 'C:\\Game\\assets\\tone.wav' })).toMatchObject({ ok: false, message: expect.stringContaining('not a supported') })
  })

  it('plans mount, incremental texture reload, object removal, and unsupported placeholders', () => {
    const loading = planSceneProjection({}, fixture(), () => 'loading')
    expect(loading.create).toEqual([imageId, textId])
    expect(loading.remove).toEqual([])

    const ready = planSceneProjection(loading.signatures, fixture(), () => 'ready')
    expect(ready.replace).toEqual([imageId])
    expect(ready.update).toEqual([textId])

    const textOnly = { ...fixture(), objects: fixture().objects.filter((object) => object.id === textId) }
    const removed = planSceneProjection(ready.signatures, textOnly, () => 'ready')
    expect(removed.remove).toEqual([imageId])

    const unsupported = planSceneProjection({}, fixture('assets/tone.wav'), () => 'loading')
    expect(unsupported.unsupportedAssets).toEqual(['assets/tone.wav'])
    expect(unsupported.signatures[imageId]).toContain('failed')
  })

  it('disconnects observers and destroys projection resources before removing the Phaser canvas', () => {
    const calls: string[] = []
    disposeSceneViewport({
      resizeObserver: { disconnect: () => calls.push('resize') },
      projection: { destroy: () => calls.push('projection') },
      game: { destroy: (removeCanvas) => calls.push(`game:${removeCanvas}`) },
      releaseController: () => calls.push('controller')
    })
    expect(calls).toEqual(['resize', 'controller', 'projection', 'game:true'])
  })
})
