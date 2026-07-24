export interface SceneViewportResources {
  resizeObserver: { disconnect(): void }
  projection: { destroy(): void } | null
  game: { destroy(removeCanvas: boolean): void }
  releaseController(): void
}

export function disposeSceneViewport(resources: SceneViewportResources): void {
  resources.resizeObserver.disconnect()
  resources.releaseController()
  resources.projection?.destroy()
  resources.game.destroy(true)
}
