import { describe, expect, it } from 'vitest'
import { centerSpinePreviewBounds, fitSpinePreviewBounds, panSpinePreview } from '../src/renderer/src/lib/spine-preview-viewport'

describe('Spine preview viewport', () => {
  it('centers the selected animation bounds in the canvas', () => {
    const bounds = { x: -180, y: -16, width: 340, height: 270 }
    const canvas = { width: 467, height: 577 }
    const scale = 1.25
    const position = centerSpinePreviewBounds(canvas.width, canvas.height, bounds, scale, 0, 0)

    expect(position.x + (bounds.x + bounds.width / 2) * scale).toBe(canvas.width / 2)
    expect(position.y + (bounds.y + bounds.height / 2) * scale).toBe(canvas.height / 2)
  })

  it('fits the selected animation bounds within the preview padding', () => {
    expect(fitSpinePreviewBounds(467, 577, { x: 0, y: 0, width: 340, height: 270 })).toBeCloseTo(395 / 340)
  })

  it('moves the artwork down when the pointer is dragged down', () => {
    expect(panSpinePreview(12, -8, 25, 40)).toEqual({ x: 37, y: -48 })
  })
})
