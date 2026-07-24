import type { SceneDocument, SceneObject } from '@phaser-editor/contracts'
import { isSupportedSceneImage } from './scene-assets'

export type SceneAssetReadiness = 'loading' | 'ready' | 'failed'

export interface SceneProjectionPlan {
  create: string[]
  replace: string[]
  update: string[]
  remove: string[]
  unsupportedAssets: string[]
  signatures: Record<string, string>
}

export function planSceneProjection(
  current: Record<string, string>,
  document: SceneDocument,
  readiness: (path: string) => SceneAssetReadiness
): SceneProjectionPlan {
  const signatures = Object.fromEntries(document.objects.map((object) => [object.id, sceneProjectionSignature(object, readiness)]))
  const wanted = new Set(Object.keys(signatures))
  const create = Object.keys(signatures).filter((id) => current[id] === undefined)
  const replace = Object.keys(signatures).filter((id) => current[id] !== undefined && current[id] !== signatures[id])
  const update = Object.keys(signatures).filter((id) => current[id] === signatures[id])
  const remove = Object.keys(current).filter((id) => !wanted.has(id))
  const unsupportedAssets = document.objects.flatMap((object) => object.type === 'image' || object.type === 'sprite'
    ? isSupportedSceneImage(object.asset.path) ? [] : [object.asset.path]
    : [])
  return { create, replace, update, remove, unsupportedAssets, signatures }
}

export function sceneProjectionSignature(object: SceneObject, readiness: (path: string) => SceneAssetReadiness): string {
  if (object.type === 'container' || object.type === 'text') return object.type
  const animation = object.type === 'sprite' && object.animation ? `:${object.animation.assetPath}:${object.animation.clipKey}:${object.animation.autoPlay}` : ''
  return `${object.type}:scene-asset:${object.asset.path}:${String(object.asset.frame)}:${isSupportedSceneImage(object.asset.path) ? readiness(object.asset.path) : 'failed'}${animation}`
}
