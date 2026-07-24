export const SCENE_ASSET_MIME = 'application/x-phaser-editor-asset'

export interface SceneAssetDragPayload {
  kind: 'asset'
  path: string
  relativePath: string
  extension: string
}

export type SceneAssetDropValidation =
  | { ok: true; relativePath: string; objectType: 'image' | 'sprite' | 'prefab' }
  | { ok: false; message: string }

export function parseSceneAssetDragPayload(serialized: string, fallbackPath = ''): SceneAssetDragPayload | null {
  if (serialized) {
    try {
      const value = JSON.parse(serialized) as Partial<SceneAssetDragPayload>
      if (value.kind === 'asset' && typeof value.path === 'string' && typeof value.relativePath === 'string' && typeof value.extension === 'string') {
        return { kind: 'asset', path: value.path, relativePath: value.relativePath, extension: value.extension }
      }
    } catch {
      // The legacy path payload below remains supported for older drag sources.
    }
  }
  if (!fallbackPath) return null
  return { kind: 'asset', path: fallbackPath, relativePath: '', extension: fallbackPath.split('.').pop()?.toLocaleLowerCase() ?? '' }
}

export function validateSceneAssetDrop(projectRoot: string, payload: SceneAssetDragPayload, preferSprite = false): SceneAssetDropValidation {
  const relativePath = projectRelativePath(projectRoot, payload.path)
  if (!relativePath) return { ok: false, message: 'Only assets inside the active project can be added to a scene.' }
  if (relativePath.toLocaleLowerCase().endsWith('.phaser-prefab.json')) return { ok: true, relativePath, objectType: 'prefab' }
  if (!isSupportedSceneImage(relativePath)) return { ok: false, message: `${relativePath} is not a supported image or static sprite asset.` }
  return { ok: true, relativePath, objectType: preferSprite ? 'sprite' : 'image' }
}

export function projectRelativePath(root: string, candidate: string): string | null {
  if (!candidate) return null
  const normalizedRoot = root.replaceAll('\\', '/').replace(/\/$/, '')
  const normalizedCandidate = candidate.replaceAll('\\', '/')
  if (normalizedCandidate.toLocaleLowerCase() === normalizedRoot.toLocaleLowerCase()) return null
  if (!normalizedCandidate.toLocaleLowerCase().startsWith(`${normalizedRoot.toLocaleLowerCase()}/`)) return null
  return normalizedCandidate.slice(normalizedRoot.length + 1)
}

export function isSupportedSceneImage(path: string): boolean {
  return /\.(png|jpe?g|webp|gif)$/i.test(path)
}
