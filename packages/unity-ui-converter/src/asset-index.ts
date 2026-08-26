import { mkdir, open, opendir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { JSON_SCHEMA, load } from 'js-yaml'
import type { SpriteData, UIDiagnostic, UIResource, UIResourceKind } from './schema.js'
import { asArray, asNumber, asRecord, asString, quoteUnityFileIds, readVec2, readVec4, type UnityObjectReference } from './unity-yaml.js'

interface AssetIndexCache {
  version: 1
  assetsRoot: string
  generatedAt: string
  metaFileCount: number
  byGuid: Record<string, string[]>
}

export interface AssetIndexSummary {
  assetsRoot: string
  metaFileCount: number
  uniqueGuidCount: number
  duplicateGuidCount: number
  duplicateGuids: Array<{ guid: string; metaPaths: string[] }>
}

export class UnityAssetIndex {
  readonly assetsRoot: string
  readonly byGuid: Map<string, string[]>
  readonly metaFileCount: number

  private constructor(assetsRoot: string, byGuid: Map<string, string[]>, metaFileCount: number) {
    this.assetsRoot = path.resolve(assetsRoot)
    this.byGuid = byGuid
    this.metaFileCount = metaFileCount
  }

  static async build(assetsRoot: string, cachePath?: string): Promise<UnityAssetIndex> {
    const resolvedRoot = path.resolve(assetsRoot)
    if (cachePath) {
      const cached = await readCache(cachePath)
      if (cached?.version === 1 && path.resolve(cached.assetsRoot) === resolvedRoot) {
        return new UnityAssetIndex(resolvedRoot, new Map(Object.entries(cached.byGuid)), cached.metaFileCount)
      }
    }

    const metaPaths: string[] = []
    for await (const filePath of walkFiles(resolvedRoot)) {
      if (filePath.toLocaleLowerCase().endsWith('.meta')) metaPaths.push(filePath)
    }

    const byGuid = new Map<string, string[]>()
    await mapConcurrent(metaPaths, 64, async (metaPath) => {
      const guid = await readGuidHeader(metaPath)
      if (!guid) return
      const entries = byGuid.get(guid) ?? []
      entries.push(metaPath)
      byGuid.set(guid, entries)
    })
    for (const entries of byGuid.values()) entries.sort(comparePaths)

    const index = new UnityAssetIndex(resolvedRoot, byGuid, metaPaths.length)
    if (cachePath) await index.save(cachePath)
    return index
  }

  static async load(cachePath: string): Promise<UnityAssetIndex> {
    const cached = await readCache(cachePath)
    if (!cached) throw new Error(`Asset index cache does not exist or is invalid: ${cachePath}`)
    return new UnityAssetIndex(cached.assetsRoot, new Map(Object.entries(cached.byGuid)), cached.metaFileCount)
  }

  async save(cachePath: string): Promise<void> {
    const cache: AssetIndexCache = {
      version: 1,
      assetsRoot: this.assetsRoot,
      generatedAt: new Date().toISOString(),
      metaFileCount: this.metaFileCount,
      byGuid: Object.fromEntries(this.byGuid)
    }
    await mkdir(path.dirname(cachePath), { recursive: true })
    await writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`, 'utf8')
  }

  summary(): AssetIndexSummary {
    const duplicateGuids = [...this.byGuid.entries()]
      .filter(([, metaPaths]) => metaPaths.length > 1)
      .map(([guid, metaPaths]) => ({ guid, metaPaths }))
      .sort((a, b) => a.guid.localeCompare(b.guid))
    return {
      assetsRoot: this.assetsRoot,
      metaFileCount: this.metaFileCount,
      uniqueGuidCount: this.byGuid.size,
      duplicateGuidCount: duplicateGuids.length,
      duplicateGuids
    }
  }

  async resolve(reference: UnityObjectReference, kind: UIResourceKind, diagnostics: UIDiagnostic[], sourcePath?: string): Promise<UIResource> {
    const id = resourceId(reference)
    if (!reference.guid) {
      return { id, kind, guid: '', fileId: reference.fileId, sourcePath: null, metaPath: null, webPath: null }
    }

    const allCandidates = this.byGuid.get(reference.guid) ?? []
    const candidates = preferKind(allCandidates, kind)
    if (candidates.length === 0) {
      diagnostics.push({
        severity: 'warning',
        code: 'RESOURCE_GUID_MISSING',
        message: `GUID ${reference.guid} could not be resolved below ${this.assetsRoot}.`,
        sourcePath,
        details: { guid: reference.guid, fileId: reference.fileId, kind }
      })
      return { id, kind, guid: reference.guid, fileId: reference.fileId, sourcePath: null, metaPath: null, webPath: null }
    }

    if (candidates.length > 1) {
      diagnostics.push({
        severity: 'warning',
        code: 'RESOURCE_GUID_AMBIGUOUS',
        message: `GUID ${reference.guid} resolves to ${candidates.length} assets; the first deterministic match is used.`,
        sourcePath,
        details: { candidates }
      })
    }

    const metaPath = candidates[0]!
    const assetPath = metaPath.slice(0, -'.meta'.length)
    const resource: UIResource = {
      id,
      kind,
      guid: reference.guid,
      fileId: reference.fileId,
      sourcePath: assetPath,
      metaPath,
      webPath: null
    }

    if (kind === 'sprite' || kind === 'texture') {
      const dimensions = await readImageDimensions(assetPath)
      if (dimensions) Object.assign(resource, dimensions)
      const meta = await readUnityMeta(metaPath, diagnostics)
      const textureImporter = asRecord(meta.TextureImporter)
      if (kind === 'sprite' && Object.keys(textureImporter).length > 0) {
        resource.sprite = readSpriteData(textureImporter, reference.fileId, dimensions)
      }
    }
    return resource
  }
}

export function resourceId(reference: UnityObjectReference): string {
  return `${reference.guid ?? 'local'}:${reference.fileId}`
}

async function readCache(cachePath: string): Promise<AssetIndexCache | null> {
  try {
    const value = JSON.parse(await readFile(cachePath, 'utf8')) as Partial<AssetIndexCache>
    if (value.version !== 1 || typeof value.assetsRoot !== 'string' || !value.byGuid || typeof value.byGuid !== 'object') return null
    return value as AssetIndexCache
  } catch {
    return null
  }
}

async function readGuidHeader(metaPath: string): Promise<string | null> {
  let handle
  try {
    handle = await open(metaPath, 'r')
    const buffer = Buffer.alloc(2048)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    return buffer.subarray(0, bytesRead).toString('utf8').match(/^guid:\s*([0-9a-f]{32})\s*$/m)?.[1] ?? null
  } finally {
    await handle?.close()
  }
}

async function readUnityMeta(metaPath: string, diagnostics: UIDiagnostic[]): Promise<Record<string, unknown>> {
  try {
    const source = await readFile(metaPath, 'utf8')
    return asRecord(load(quoteUnityFileIds(source), { schema: JSON_SCHEMA }))
  } catch (error) {
    diagnostics.push({
      severity: 'warning',
      code: 'RESOURCE_META_INVALID',
      message: error instanceof Error ? error.message : 'Resource meta file could not be parsed.',
      sourcePath: metaPath
    })
    return {}
  }
}

function readSpriteData(importer: Record<string, unknown>, fileId: string, dimensions: { width: number; height: number } | null): SpriteData {
  const spriteMode = asNumber(importer.spriteMode)
  if (spriteMode === 2) {
    const sprites = asArray(asRecord(importer.spriteSheet).sprites).map(asRecord)
    const table = asRecord(asRecord(importer.spriteSheet).nameFileIdTable)
    const name = Object.entries(table).find(([, value]) => asString(value) === fileId)?.[0]
    const sprite = sprites.find((entry) => asString(entry.internalID) === fileId || (name && asString(entry.name) === name))
    if (sprite) {
      return {
        rect: readRect(sprite.rect, dimensions),
        border: readBorder(sprite.border),
        pivot: readVec2(sprite.pivot, { x: 0.5, y: 0.5 }),
        pixelsPerUnit: asNumber(importer.spritePixelsToUnits, 100),
        packed: true,
        name: asString(sprite.name) || name
      }
    }
  }
  return {
    rect: { x: 0, y: 0, width: dimensions?.width ?? 0, height: dimensions?.height ?? 0 },
    border: readBorder(importer.spriteBorder),
    pivot: readVec2(importer.spritePivot, { x: 0.5, y: 0.5 }),
    pixelsPerUnit: asNumber(importer.spritePixelsToUnits, 100),
    packed: false
  }
}

function readRect(value: unknown, dimensions: { width: number; height: number } | null): SpriteData['rect'] {
  const rect = asRecord(value)
  return {
    x: asNumber(rect.x),
    y: asNumber(rect.y),
    width: asNumber(rect.width, dimensions?.width ?? 0),
    height: asNumber(rect.height, dimensions?.height ?? 0)
  }
}

function readBorder(value: unknown): SpriteData['border'] {
  const border = readVec4(value)
  return { left: border.x, bottom: border.y, right: border.z, top: border.w }
}

async function readImageDimensions(filePath: string): Promise<{ width: number; height: number } | null> {
  const extension = path.extname(filePath).toLocaleLowerCase()
  if (extension !== '.png') return null
  let handle
  try {
    handle = await open(filePath, 'r')
    const header = Buffer.alloc(24)
    const { bytesRead } = await handle.read(header, 0, header.length, 0)
    if (bytesRead < 24 || header.toString('ascii', 1, 4) !== 'PNG') return null
    return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) }
  } catch {
    return null
  } finally {
    await handle?.close()
  }
}

async function* walkFiles(directory: string): AsyncGenerator<string> {
  const entries = await opendir(directory)
  for await (const entry of entries) {
    const filePath = path.join(directory, entry.name)
    if (entry.isDirectory()) yield* walkFiles(filePath)
    else if (entry.isFile()) yield filePath
  }
}

async function mapConcurrent<T>(items: T[], concurrency: number, visit: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      await visit(items[index]!)
    }
  }))
}

function preferKind(metaPaths: string[], kind: UIResourceKind): string[] {
  const extensions: Record<UIResourceKind, string[]> = {
    sprite: ['.png.meta', '.jpg.meta', '.jpeg.meta', '.psd.meta', '.tga.meta'],
    texture: ['.png.meta', '.jpg.meta', '.jpeg.meta', '.psd.meta', '.tga.meta'],
    font: ['.ttf.meta', '.otf.meta', '.woff.meta', '.woff2.meta'],
    material: ['.mat.meta'],
    prefab: ['.prefab.meta'],
    unknown: []
  }
  const preferred = metaPaths.filter((candidate) => extensions[kind].some((extension) => candidate.toLocaleLowerCase().endsWith(extension)))
  return (preferred.length > 0 ? preferred : metaPaths).slice().sort(comparePaths)
}

function comparePaths(a: string, b: string): number {
  return a.localeCompare(b, 'en', { sensitivity: 'base' })
}
