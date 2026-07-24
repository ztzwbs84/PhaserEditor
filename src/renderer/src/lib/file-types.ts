import type { EditorDocument } from '@phaser-editor/contracts'
import { pluginContributionRuntime } from './plugin-runtime'

const imageExtensions = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif'])
const audioExtensions = new Set(['mp3', 'wav', 'ogg'])
const binaryPreviewExtensions = new Set([...imageExtensions, ...audioExtensions, 'skel'])
const textLanguages: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  json: 'json',
  md: 'markdown',
  css: 'css',
  scss: 'scss',
  html: 'html',
  htm: 'html',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  glsl: 'glsl',
  frag: 'glsl',
  vert: 'glsl',
  txt: 'plaintext',
  csv: 'plaintext',
  tmx: 'xml'
}

export function classifyFile(path: string, content?: string): Pick<EditorDocument, 'kind' | 'language'> {
  if (pluginContributionRuntime.getFileHandlerResolution(path).winner) return { kind: 'plugin', language: languageForPath(path) }
  const normalized = path.toLocaleLowerCase()
  if (normalized.endsWith('.phaser-scene.json')) return { kind: 'scene', language: 'json' }
  if (normalized.endsWith('.phaser-animations.json')) return { kind: 'animation', language: 'json' }
  if (normalized.endsWith('.phaser-prefab.json')) return { kind: 'prefab', language: 'json' }
  if (normalized.endsWith('.phaser-atlas.json') || normalized.endsWith('.phaser-spritesheet.json') || looksLikePhaserAtlas(content)) return { kind: 'atlas', language: 'json' }
  const extension = path.split('.').pop()?.toLocaleLowerCase() ?? ''
  if (imageExtensions.has(extension)) return { kind: 'image', language: 'binary' }
  if (audioExtensions.has(extension)) return { kind: 'audio', language: 'binary' }
  if (extension === 'skel') return { kind: 'spine', language: 'binary' }
  if (extension === 'md') return { kind: 'markdown', language: 'markdown' }
  if (extension === 'json' && looksLikeTiledMap(content)) return { kind: 'tilemap', language: 'json' }
  return { kind: 'text', language: textLanguages[extension] ?? 'plaintext' }
}

function languageForPath(path: string): string {
  const extension = path.split('.').pop()?.toLocaleLowerCase() ?? ''
  return textLanguages[extension] ?? 'plaintext'
}

export function looksLikePhaserAtlas(content?: string): boolean {
  if (!content) return false
  try {
    const data = JSON.parse(content) as Record<string, unknown>
    if (Array.isArray(data.textures)) return data.textures.some((texture) => Boolean(texture) && typeof texture === 'object' && Array.isArray((texture as Record<string, unknown>).frames))
    return Boolean(data.frames) && typeof data.frames === 'object' && !Array.isArray(data.frames) && Boolean(data.meta) && typeof data.meta === 'object'
  } catch {
    return false
  }
}

export function isMediaFile(path: string): boolean {
  const extension = path.split('.').pop()?.toLocaleLowerCase() ?? ''
  return binaryPreviewExtensions.has(extension)
}

export function looksLikeTiledMap(content?: string): boolean {
  if (!content) return false
  try {
    const data = JSON.parse(content) as Record<string, unknown>
    return typeof data.tilewidth === 'number' && typeof data.tileheight === 'number' && Array.isArray(data.layers) && Array.isArray(data.tilesets)
  } catch {
    return false
  }
}

export function basename(path: string): string {
  return path.replaceAll('\\', '/').split('/').pop() ?? path
}
