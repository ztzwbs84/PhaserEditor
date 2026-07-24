export interface TiledTileset {
  firstgid: number
  source?: string
  name?: string
  image?: string
  imagewidth?: number
  imageheight?: number
  tilewidth?: number
  tileheight?: number
  tilecount?: number
  columns?: number
  spacing?: number
  margin?: number
  [key: string]: unknown
}

export interface TiledLayer {
  id: number
  name: string
  type: 'tilelayer' | 'objectgroup' | 'group' | 'imagelayer'
  visible?: boolean
  locked?: boolean
  width?: number
  height?: number
  data?: number[]
  objects?: TiledObject[]
  layers?: TiledLayer[]
  [key: string]: unknown
}

export interface TiledObject {
  id: number
  name?: string
  type?: string
  x: number
  y: number
  width?: number
  height?: number
  visible?: boolean
  properties?: Array<{ name: string; type?: string; value: unknown }>
  [key: string]: unknown
}

export interface TiledDocument {
  width: number
  height: number
  tilewidth: number
  tileheight: number
  infinite?: boolean
  orientation: string
  renderorder?: string
  layers: TiledLayer[]
  tilesets: TiledTileset[]
  [key: string]: unknown
}

export interface TiledValidation {
  document: TiledDocument | null
  editable: boolean
  issues: string[]
}

export function parseTiled(content: string): TiledValidation {
  try {
    const value = JSON.parse(content) as Partial<TiledDocument>
    const issues: string[] = []
    if (!Number.isInteger(value.width) || !Number.isInteger(value.height)) issues.push('Map dimensions are missing or invalid.')
    if (!Number.isInteger(value.tilewidth) || !Number.isInteger(value.tileheight)) issues.push('Tile dimensions are missing or invalid.')
    if (!Array.isArray(value.layers) || !Array.isArray(value.tilesets)) issues.push('Layers or tilesets are missing.')
    if (value.orientation !== 'orthogonal') issues.push(`Orientation ${value.orientation ?? 'unknown'} is read-only in this version.`)
    if (value.infinite) issues.push('Infinite chunked maps are read-only in this version.')
    const layers = Array.isArray(value.layers) ? value.layers : []
    for (const layer of flattenLayers(layers)) {
      if (layer.type === 'tilelayer' && !Array.isArray(layer.data)) issues.push(`Layer ${layer.name} uses compressed or chunked data.`)
    }
    const document = value as TiledDocument
    const structurallyValid = issues.every((issue) => !issue.includes('missing') && !issue.includes('invalid'))
    return { document: structurallyValid ? document : null, editable: issues.length === 0, issues }
  } catch (error) {
    return { document: null, editable: false, issues: [error instanceof Error ? error.message : 'Invalid Tiled JSON.'] }
  }
}

export function flattenLayers(layers: TiledLayer[], prefix = ''): Array<TiledLayer & { displayName: string }> {
  const result: Array<TiledLayer & { displayName: string }> = []
  for (const layer of layers) {
    const displayName = prefix ? `${prefix}/${layer.name}` : layer.name
    result.push({ ...layer, displayName })
    if (layer.type === 'group' && layer.layers) result.push(...flattenLayers(layer.layers, displayName))
  }
  return result
}

export function findLayer(layers: TiledLayer[], id: number): TiledLayer | null {
  for (const layer of layers) {
    if (layer.id === id) return layer
    if (layer.layers) {
      const nested = findLayer(layer.layers, id)
      if (nested) return nested
    }
  }
  return null
}

export function setTile(document: TiledDocument, layerId: number, x: number, y: number, gid: number): boolean {
  const layer = findLayer(document.layers, layerId)
  if (!layer?.data || layer.type !== 'tilelayer') return false
  const width = layer.width ?? document.width
  const height = layer.height ?? document.height
  if (x < 0 || y < 0 || x >= width || y >= height) return false
  layer.data[y * width + x] = gid
  return true
}

export function getTile(document: TiledDocument, layerId: number, x: number, y: number): number {
  const layer = findLayer(document.layers, layerId)
  if (!layer?.data || layer.type !== 'tilelayer') return 0
  const width = layer.width ?? document.width
  return layer.data[y * width + x] ?? 0
}

export function fillRect(document: TiledDocument, layerId: number, x1: number, y1: number, x2: number, y2: number, gid: number): void {
  const left = Math.min(x1, x2)
  const right = Math.max(x1, x2)
  const top = Math.min(y1, y2)
  const bottom = Math.max(y1, y2)
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) setTile(document, layerId, x, y, gid)
  }
}

export function serializeTiled(document: TiledDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`
}
