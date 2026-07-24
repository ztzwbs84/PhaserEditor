export function createProjectAssetUrl(filePath: string): string {
  const normalized = filePath.replaceAll('\\', '/')
  const absoluteKind = normalized.startsWith('/') ? 'posix' : 'windows'
  const encoded = normalized.replace(/^\//, '').split('/').map(encodeURIComponent).join('/')
  return `phaser-asset://local/${absoluteKind}/${encoded}`
}

export function resolveProjectAssetUrl(requestUrl: string, pathSeparator = '/'): string | null {
  const url = new URL(requestUrl)
  const legacyPath = url.searchParams.get('path')
  if (legacyPath) return legacyPath
  const match = url.pathname.match(/^\/(windows|posix)\/(.*)$/)
  if (!match) return null
  const decoded = decodeURIComponent(match[2]!)
  return match[1] === 'posix' ? `/${decoded}` : decoded.replaceAll('/', pathSeparator)
}
