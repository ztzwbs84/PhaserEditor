import type { FileEntry } from '@phaser-editor/contracts'

export type SpineAtlasResolution =
  | { ok: true; atlas: FileEntry }
  | { ok: false; message: string }

export function findSpineAtlas(skeletonPath: string, entries: FileEntry[]): SpineAtlasResolution {
  const skeletonName = basename(skeletonPath)
  const stem = skeletonName.replace(/\.skel$/i, '')
  const candidates = entries.filter((entry) => entry.kind === 'file' && /\.atlas(?:\.txt)?$/i.test(entry.name))
  const exact = candidates
    .filter((entry) => entry.name.toLocaleLowerCase() === `${stem}.atlas`.toLocaleLowerCase()
      || entry.name.toLocaleLowerCase() === `${stem}.atlas.txt`.toLocaleLowerCase())
    .sort((left, right) => Number(left.name.toLocaleLowerCase().endsWith('.txt')) - Number(right.name.toLocaleLowerCase().endsWith('.txt')))

  if (exact[0]) return { ok: true, atlas: exact[0] }
  if (candidates.length === 1) return { ok: true, atlas: candidates[0]! }
  if (candidates.length === 0) {
    return { ok: false, message: `Missing ${stem}.atlas or ${stem}.atlas.txt beside ${skeletonName}.` }
  }
  return { ok: false, message: `Multiple atlas files are present beside ${skeletonName}; rename the matching atlas to ${stem}.atlas.` }
}

export function parseSpineAtlasPages(content: string): string[] {
  const lines = content.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/)
  const pages: string[] = []
  let expectPage = true
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) {
      expectPage = true
      continue
    }
    if (!expectPage) continue
    pages.push(line)
    expectPage = false
  }
  return pages
}

export function resolveSpineAtlasPage(atlasPath: string, pageName: string): string {
  const normalizedAtlas = atlasPath.replaceAll('\\', '/')
  const normalizedPage = pageName.replaceAll('\\', '/')
  if (/^[a-z]:\//i.test(normalizedPage) || normalizedPage.startsWith('/')) return restoreSeparator(normalizedPage, atlasPath)
  const segments = normalizedAtlas.split('/').slice(0, -1)
  for (const segment of normalizedPage.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (segments.length > 1) segments.pop()
    } else {
      segments.push(segment)
    }
  }
  return restoreSeparator(segments.join('/'), atlasPath)
}

export function directoryOf(filePath: string): string {
  const index = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  return index < 0 ? '' : filePath.slice(0, index)
}

function basename(filePath: string): string {
  return filePath.replaceAll('\\', '/').split('/').pop() ?? filePath
}

function restoreSeparator(value: string, reference: string): string {
  return reference.includes('\\') ? value.replaceAll('/', '\\') : value
}
