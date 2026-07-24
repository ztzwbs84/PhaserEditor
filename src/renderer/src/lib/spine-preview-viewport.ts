export interface SpinePreviewBounds {
  x: number
  y: number
  width: number
  height: number
}

export function fitSpinePreviewBounds(
  canvasWidth: number,
  canvasHeight: number,
  bounds: SpinePreviewBounds,
  padding = 72
): number {
  return clamp(Math.min(
    Math.max(1, canvasWidth - padding) / Math.max(1, bounds.width),
    Math.max(1, canvasHeight - padding) / Math.max(1, bounds.height)
  ), 0.05, 8)
}

export function centerSpinePreviewBounds(
  canvasWidth: number,
  canvasHeight: number,
  bounds: SpinePreviewBounds,
  scale: number,
  panX: number,
  panY: number
): { x: number; y: number } {
  return {
    x: canvasWidth / 2 - (bounds.x + bounds.width / 2) * scale + panX,
    y: canvasHeight / 2 - (bounds.y + bounds.height / 2) * scale + panY
  }
}

export function panSpinePreview(
  panX: number,
  panY: number,
  pointerDeltaX: number,
  pointerDeltaY: number
): { x: number; y: number } {
  return { x: panX + pointerDeltaX, y: panY - pointerDeltaY }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
