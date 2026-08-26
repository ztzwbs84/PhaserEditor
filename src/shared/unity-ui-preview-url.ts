import path from 'node:path'

export const UNITY_UI_PREVIEW_SCHEME = 'unity-ui-preview'

export function createUnityUIPreviewUrl(root: string, filePath: string): string {
  const relative = path.relative(path.resolve(root), path.resolve(filePath))
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Unity UI preview file must be inside the preview cache.')
  const encoded = relative.split(path.sep).map(encodeURIComponent).join('/')
  return `${UNITY_UI_PREVIEW_SCHEME}://local/${encoded}`
}

export function resolveUnityUIPreviewUrl(requestUrl: string, root: string): string | null {
  try {
    const url = new URL(requestUrl)
    if (url.protocol !== `${UNITY_UI_PREVIEW_SCHEME}:` || url.hostname !== 'local') return null
    const relative = decodeURIComponent(url.pathname.replace(/^\/+/, '')).replaceAll('/', path.sep)
    const resolvedRoot = path.resolve(root)
    const candidate = path.resolve(resolvedRoot, relative)
    const normalizedRoot = normalize(resolvedRoot)
    const normalizedCandidate = normalize(candidate)
    if (normalizedCandidate === normalizedRoot || !normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`)) return null
    return candidate
  } catch {
    return null
  }
}

function normalize(value: string): string {
  const resolved = path.resolve(value)
  return process.platform === 'win32' ? resolved.toLocaleLowerCase() : resolved
}
