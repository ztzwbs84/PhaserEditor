import {
  CURRENT_FRAME_SOURCE_VERSION,
  FRAME_SOURCE_FORMAT,
  frameSourceSchema,
  isProjectRelativeAssetPath,
  type AuthoringValidationIssue,
  type FrameSource,
  type FrameSourceFrame
} from '@phaser-editor/contracts'

export interface FrameSourceImportResult {
  source: FrameSource | null
  issues: AuthoringValidationIssue[]
}

export interface SpritesheetGridConfig {
  imagePath: string
  imageWidth: number
  imageHeight: number
  frameWidth: number
  frameHeight: number
  margin: number
  spacing: number
  startFrame?: number
  endFrame?: number
}

interface RawFrame {
  key: string | number
  value: unknown
  textureIndex: number
  frameIndex: number
}

export function importPhaserAtlas(source: string | unknown, metadataPath: string): FrameSourceImportResult {
  const issues: AuthoringValidationIssue[] = []
  const value = parseJson(source, issues)
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    issues.push(issue('$', 'invalid-atlas', 'Atlas metadata root must be an object.'))
    return { source: null, issues }
  }
  if (!isProjectRelativeAssetPath(metadataPath)) {
    issues.push(issue('$.metadataPath', 'invalid-project-path', 'Atlas metadata path must stay inside the project.'))
    return { source: null, issues }
  }

  const record = value as Record<string, unknown>
  const textures = Array.isArray(record.textures) ? record.textures : null
  let imagePath = ''
  let imageSize = { width: 0, height: 0 }
  const rawFrames: RawFrame[] = []

  if (textures) {
    textures.forEach((textureValue, textureIndex) => {
      if (!textureValue || typeof textureValue !== 'object' || Array.isArray(textureValue)) {
        issues.push(issue(`$.textures[${textureIndex}]`, 'invalid-texture', 'Atlas texture entry must be an object.'))
        return
      }
      const texture = textureValue as Record<string, unknown>
      const textureImage = stringValue(texture.image)
      if (textureIndex === 0) {
        imagePath = resolveProjectSibling(metadataPath, textureImage)
        imageSize = readSize(texture.size)
      } else if (textureImage !== stringValue((textures[0] as Record<string, unknown> | undefined)?.image)) {
        issues.push(issue(`$.textures[${textureIndex}].image`, 'multiple-textures', 'Each texture in a multi-atlas must be inspected as a separate frame source.', 'warning'))
      }
      if (!Array.isArray(texture.frames)) {
        issues.push(issue(`$.textures[${textureIndex}].frames`, 'invalid-frames', 'Texture frames must be an array.'))
        return
      }
      texture.frames.forEach((frame, frameIndex) => {
        const filename = frame && typeof frame === 'object' && !Array.isArray(frame)
          ? (frame as Record<string, unknown>).filename
          : undefined
        rawFrames.push({ key: typeof filename === 'string' && filename.length > 0 ? filename : frameIndex, value: frame, textureIndex, frameIndex })
      })
    })
  } else if (record.frames && typeof record.frames === 'object' && !Array.isArray(record.frames)) {
    const meta = record.meta && typeof record.meta === 'object' && !Array.isArray(record.meta) ? record.meta as Record<string, unknown> : {}
    imagePath = resolveProjectSibling(metadataPath, stringValue(meta.image))
    imageSize = readSize(meta.size)
    Object.entries(record.frames as Record<string, unknown>).forEach(([key, frame], frameIndex) => rawFrames.push({ key, value: frame, textureIndex: 0, frameIndex }))
  } else {
    issues.push(issue('$.frames', 'invalid-frames', 'Expected Phaser atlas hash frames or a textures array.'))
  }

  if (!imagePath || !isProjectRelativeAssetPath(imagePath)) issues.push(issue('$.meta.image', 'missing-texture', 'Atlas texture path is missing or outside the project.'))
  if (imageSize.width < 1 || imageSize.height < 1) issues.push(issue('$.meta.size', 'missing-image-size', 'Atlas texture dimensions are required for bounds validation.'))

  const frames: FrameSourceFrame[] = []
  const keys = new Set<string>()
  rawFrames.forEach((raw, normalizedIndex) => {
    if (raw.textureIndex > 0) return
    const path = textures ? `$.textures[${raw.textureIndex}].frames[${raw.frameIndex}]` : `$.frames[${JSON.stringify(String(raw.key))}]`
    const frame = normalizeAtlasFrame(raw, normalizedIndex, path, imageSize, issues)
    if (!frame) return
    const typedKey = `${typeof frame.key}:${String(frame.key)}`
    if (keys.has(typedKey)) {
      issues.push(issue(`${path}.filename`, 'duplicate-frame', `Duplicate frame key ${String(frame.key)}.`))
      return
    }
    keys.add(typedKey)
    frames.push(frame)
  })

  if (!imagePath || imageSize.width < 1 || imageSize.height < 1) return { source: null, issues }
  const candidate = {
    format: FRAME_SOURCE_FORMAT,
    version: CURRENT_FRAME_SOURCE_VERSION,
    source: { kind: 'atlas' as const, imagePath, metadataPath },
    imageSize,
    frames
  }
  const parsed = frameSourceSchema.safeParse(candidate)
  if (!parsed.success) {
    parsed.error.issues.forEach((entry) => issues.push(issue(toDataPath(entry.path), entry.code, entry.message)))
    return { source: null, issues }
  }
  return { source: parsed.data, issues }
}

export function createSpritesheetFrameSource(config: SpritesheetGridConfig): FrameSourceImportResult {
  const issues: AuthoringValidationIssue[] = []
  const numericFields: Array<'imageWidth' | 'imageHeight' | 'frameWidth' | 'frameHeight' | 'margin' | 'spacing'> = ['imageWidth', 'imageHeight', 'frameWidth', 'frameHeight', 'margin', 'spacing']
  numericFields.forEach((key) => {
    const value = config[key]
    const minimum = key === 'margin' || key === 'spacing' ? 0 : 1
    if (!Number.isInteger(value) || value < minimum) issues.push(issue(`$.${key}`, 'invalid-grid-value', `${key} must be an integer of at least ${minimum}.`))
  })
  if (!isProjectRelativeAssetPath(config.imagePath)) issues.push(issue('$.imagePath', 'invalid-project-path', 'Spritesheet image path must stay inside the project.'))
  if (issues.some((entry) => entry.severity === 'error')) return { source: null, issues }

  const frames: FrameSourceFrame[] = []
  let sourceIndex = 0
  const start = Math.max(0, config.startFrame ?? 0)
  const end = config.endFrame ?? Number.POSITIVE_INFINITY
  for (let y = config.margin; y + config.frameHeight <= config.imageHeight - config.margin; y += config.frameHeight + config.spacing) {
    for (let x = config.margin; x + config.frameWidth <= config.imageWidth - config.margin; x += config.frameWidth + config.spacing) {
      if (sourceIndex >= start && sourceIndex <= end) {
        frames.push({
          key: sourceIndex,
          index: frames.length,
          bounds: { x, y, width: config.frameWidth, height: config.frameHeight },
          sourceSize: { width: config.frameWidth, height: config.frameHeight },
          spriteSource: { x: 0, y: 0, width: config.frameWidth, height: config.frameHeight },
          rotated: false,
          trimmed: false
        })
      }
      sourceIndex += 1
    }
  }
  if (frames.length === 0) issues.push(issue('$.frameWidth', 'empty-grid', 'The grid does not contain a complete frame.'))

  const usedWidth = config.margin + Math.floor((config.imageWidth - config.margin * 2 + config.spacing) / (config.frameWidth + config.spacing)) * (config.frameWidth + config.spacing) - config.spacing
  const usedHeight = config.margin + Math.floor((config.imageHeight - config.margin * 2 + config.spacing) / (config.frameHeight + config.spacing)) * (config.frameHeight + config.spacing) - config.spacing
  if (usedWidth !== config.imageWidth - config.margin || usedHeight !== config.imageHeight - config.margin) {
    issues.push(issue('$', 'incomplete-grid-edge', 'Incomplete frames at the image edge were excluded.', 'warning'))
  }

  const candidate = {
    format: FRAME_SOURCE_FORMAT,
    version: CURRENT_FRAME_SOURCE_VERSION,
    source: { kind: 'spritesheet' as const, imagePath: config.imagePath, metadataPath: null },
    imageSize: { width: config.imageWidth, height: config.imageHeight },
    frames
  }
  const parsed = frameSourceSchema.safeParse(candidate)
  if (!parsed.success) {
    parsed.error.issues.forEach((entry) => issues.push(issue(toDataPath(entry.path), entry.code, entry.message)))
    return { source: null, issues }
  }
  return { source: parsed.data, issues }
}

function normalizeAtlasFrame(raw: RawFrame, index: number, path: string, imageSize: { width: number; height: number }, issues: AuthoringValidationIssue[]): FrameSourceFrame | null {
  if (!raw.value || typeof raw.value !== 'object' || Array.isArray(raw.value)) {
    issues.push(issue(path, 'invalid-frame', 'Frame entry must be an object.'))
    return null
  }
  const value = raw.value as Record<string, unknown>
  const bounds = readBounds(value.frame)
  if (!bounds || bounds.width < 1 || bounds.height < 1 || bounds.x < 0 || bounds.y < 0) {
    issues.push(issue(`${path}.frame`, 'invalid-frame-bounds', `Frame ${String(raw.key)} has invalid bounds.`))
    return null
  }
  if (bounds.x + bounds.width > imageSize.width || bounds.y + bounds.height > imageSize.height) {
    issues.push(issue(`${path}.frame`, 'frame-out-of-bounds', `Frame ${String(raw.key)} exceeds the source image.`))
    return null
  }
  const sourceSize = readSize(value.sourceSize)
  const spriteSource = readBounds(value.spriteSourceSize)
  return {
    key: raw.key,
    index,
    bounds,
    sourceSize: sourceSize.width > 0 && sourceSize.height > 0 ? sourceSize : { width: bounds.width, height: bounds.height },
    spriteSource: spriteSource && spriteSource.width > 0 && spriteSource.height > 0
      ? spriteSource
      : { x: 0, y: 0, width: bounds.width, height: bounds.height },
    rotated: value.rotated === true,
    trimmed: value.trimmed === true
  }
}

function parseJson(source: string | unknown, issues: AuthoringValidationIssue[]): unknown {
  if (typeof source !== 'string') return source
  try {
    return JSON.parse(source)
  } catch (error) {
    issues.push(issue('$', 'invalid-json', error instanceof Error ? error.message : 'Invalid atlas JSON.'))
    return null
  }
}

function readBounds(value: unknown): { x: number; y: number; width: number; height: number } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const x = numberValue(record.x)
  const y = numberValue(record.y)
  const width = numberValue(record.w ?? record.width)
  const height = numberValue(record.h ?? record.height)
  return [x, y, width, height].every(Number.isFinite) ? { x, y, width, height } : null
}

function readSize(value: unknown): { width: number; height: number } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { width: 0, height: 0 }
  const record = value as Record<string, unknown>
  return { width: numberValue(record.w ?? record.width), height: numberValue(record.h ?? record.height) }
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) ? value : Number.NaN
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function resolveProjectSibling(metadataPath: string, sibling: string): string {
  if (!sibling || sibling.includes('\\') || sibling.startsWith('/') || /^[a-zA-Z]:/.test(sibling)) return ''
  const parent = metadataPath.split('/').slice(0, -1)
  for (const segment of sibling.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (parent.length === 0) return ''
      parent.pop()
    } else {
      parent.push(segment)
    }
  }
  return parent.join('/')
}

function issue(path: string, code: string, message: string, severity: AuthoringValidationIssue['severity'] = 'error'): AuthoringValidationIssue {
  return { path, code, message, severity }
}

function toDataPath(path: PropertyKey[]): string {
  return path.reduce<string>((current, segment) => typeof segment === 'number' ? `${current}[${segment}]` : `${current}.${String(segment)}`, '$')
}
