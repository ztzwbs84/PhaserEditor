import { z } from 'zod'
import {
  isProjectRelativeAssetPath,
  sceneObjectSchema,
  type SceneObject
} from './scene'

export const FRAME_SOURCE_FORMAT = 'phaser-editor-frame-source'
export const CURRENT_FRAME_SOURCE_VERSION = 1
export const ANIMATION_ASSET_FORMAT = 'phaser-editor-animations'
export const CURRENT_ANIMATION_ASSET_VERSION = 1
export const PREFAB_FORMAT = 'phaser-editor-prefab'
export const CURRENT_PREFAB_VERSION = 1

const uuidSchema = z.uuid()
const projectPathSchema = z.string().trim().min(1).refine(isProjectRelativeAssetPath, 'Path must stay inside the project.')
const frameKeySchema = z.union([z.string().min(1), z.number().int().min(0)])
const sizeSchema = z.object({ width: z.number().int().min(1), height: z.number().int().min(1) }).strict()
const boundsSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  width: z.number().int().min(1),
  height: z.number().int().min(1)
}).strict()

export const frameSourceFrameSchema = z.object({
  key: frameKeySchema,
  index: z.number().int().min(0),
  bounds: boundsSchema,
  sourceSize: sizeSchema,
  spriteSource: z.object({
    x: z.number().int(),
    y: z.number().int(),
    width: z.number().int().min(1),
    height: z.number().int().min(1)
  }).strict(),
  rotated: z.boolean(),
  trimmed: z.boolean()
}).strict()

export type FrameSourceFrame = z.infer<typeof frameSourceFrameSchema>

export const frameSourceSchema = z.object({
  format: z.literal(FRAME_SOURCE_FORMAT),
  version: z.literal(CURRENT_FRAME_SOURCE_VERSION),
  source: z.object({
    kind: z.enum(['atlas', 'spritesheet']),
    imagePath: projectPathSchema,
    metadataPath: projectPathSchema.nullable()
  }).strict(),
  imageSize: sizeSchema,
  frames: z.array(frameSourceFrameSchema)
}).strict().superRefine((document, context) => {
  const keys = new Map<string, number>()
  document.frames.forEach((frame, index) => {
    const key = `${typeof frame.key}:${String(frame.key)}`
    const prior = keys.get(key)
    if (prior !== undefined) {
      context.addIssue({ code: 'custom', path: ['frames', index, 'key'], message: `Duplicate frame key; first used at frames[${prior}].key.` })
    } else {
      keys.set(key, index)
    }
    if (frame.bounds.x + frame.bounds.width > document.imageSize.width || frame.bounds.y + frame.bounds.height > document.imageSize.height) {
      context.addIssue({ code: 'custom', path: ['frames', index, 'bounds'], message: 'Frame bounds exceed the source image.' })
    }
  })
})

export type FrameSource = z.infer<typeof frameSourceSchema>

export const animationFrameReferenceSchema = z.object({
  source: projectPathSchema,
  frame: frameKeySchema
}).strict()

export type AnimationFrameReference = z.infer<typeof animationFrameReferenceSchema>

export const animationClipSchema = z.object({
  id: uuidSchema,
  key: z.string().trim().min(1).max(160),
  frames: z.array(animationFrameReferenceSchema).min(1),
  frameRate: z.number().finite().positive().max(1_000).nullable(),
  duration: z.number().int().positive().max(86_400_000).nullable(),
  delay: z.number().int().min(0).max(86_400_000),
  repeat: z.number().int().min(-1).max(1_000_000),
  repeatDelay: z.number().int().min(0).max(86_400_000),
  yoyo: z.boolean(),
  skipMissedFrames: z.boolean()
}).strict().superRefine((clip, context) => {
  if (clip.frameRate === null && clip.duration === null) {
    context.addIssue({ code: 'custom', path: ['frameRate'], message: 'Set either frameRate or duration.' })
  }
  if (clip.frameRate !== null && clip.duration !== null) {
    context.addIssue({ code: 'custom', path: ['duration'], message: 'Use frameRate or duration, not both.' })
  }
})

export type AnimationClip = z.infer<typeof animationClipSchema>

export const animationAssetSchema = z.object({
  format: z.literal(ANIMATION_ASSET_FORMAT),
  version: z.literal(CURRENT_ANIMATION_ASSET_VERSION),
  clips: z.array(animationClipSchema)
}).strict().superRefine((document, context) => {
  const keys = new Map<string, number>()
  document.clips.forEach((clip, index) => {
    const prior = keys.get(clip.key)
    if (prior !== undefined) {
      context.addIssue({ code: 'custom', path: ['clips', index, 'key'], message: `Duplicate animation key; first used at clips[${prior}].key.` })
    } else {
      keys.set(clip.key, index)
    }
  })
})

export type AnimationAsset = z.infer<typeof animationAssetSchema>

const propertyPathSegmentSchema = z.union([z.string().min(1), z.number().int().min(0)])

export const prefabExposedPropertySchema = z.object({
  id: uuidSchema,
  name: z.string().trim().min(1).max(160),
  objectId: uuidSchema,
  componentId: uuidSchema.nullable(),
  propertyPath: z.array(propertyPathSegmentSchema).min(1)
}).strict()

export type PrefabExposedProperty = z.infer<typeof prefabExposedPropertySchema>

export const prefabSchema = z.object({
  format: z.literal(PREFAB_FORMAT),
  version: z.literal(CURRENT_PREFAB_VERSION),
  rootObjectId: uuidSchema,
  objects: z.array(sceneObjectSchema).min(1),
  exposedProperties: z.array(prefabExposedPropertySchema)
}).strict().superRefine(validatePrefab)

export type PrefabDocument = z.infer<typeof prefabSchema>

export const prefabInstanceSchema = z.object({
  prefabPath: projectPathSchema,
  instanceId: uuidSchema,
  overrides: z.record(z.string().min(1), z.unknown())
}).strict()

export type PrefabInstance = z.infer<typeof prefabInstanceSchema>

export interface AuthoringValidationIssue {
  path: string
  code: string
  message: string
  severity: 'error' | 'warning'
}

export class AuthoringDocumentError extends Error {
  readonly issues: AuthoringValidationIssue[]

  constructor(message: string, issues: AuthoringValidationIssue[]) {
    super(message)
    this.name = 'AuthoringDocumentError'
    this.issues = issues
  }
}

export function createAnimationAsset(): AnimationAsset {
  return { format: ANIMATION_ASSET_FORMAT, version: CURRENT_ANIMATION_ASSET_VERSION, clips: [] }
}

export function createAnimationClip(key = 'animation'): AnimationClip {
  return {
    id: crypto.randomUUID(),
    key,
    frames: [{ source: 'assets/atlas.json', frame: 0 }],
    frameRate: 24,
    duration: null,
    delay: 0,
    repeat: 0,
    repeatDelay: 0,
    yoyo: false,
    skipMissedFrames: true
  }
}

export function parseFrameSource(value: unknown): FrameSource {
  return parseAuthoringSchema(frameSourceSchema, parseJson(value, 'Frame source'))
}

export function serializeFrameSource(document: FrameSource): string {
  return serializeAuthoringSchema(frameSourceSchema, document)
}

export function parseAnimationAsset(value: unknown): AnimationAsset {
  return parseAuthoringSchema(animationAssetSchema, parseJson(value, 'Animation asset'))
}

export function serializeAnimationAsset(document: AnimationAsset): string {
  return serializeAuthoringSchema(animationAssetSchema, document)
}

export function parsePrefab(value: unknown): PrefabDocument {
  return parseAuthoringSchema(prefabSchema, parseJson(value, 'Prefab'))
}

export function serializePrefab(document: PrefabDocument): string {
  return serializeAuthoringSchema(prefabSchema, document)
}

export function frameSourceReferencePath(source: FrameSource): string {
  return source.source.metadataPath ?? source.source.imagePath
}

export function validateAnimationFrameReferences(asset: AnimationAsset, sources: readonly FrameSource[]): AuthoringValidationIssue[] {
  const byPath = new Map(sources.map((source) => [frameSourceReferencePath(source), source]))
  const issues: AuthoringValidationIssue[] = []
  asset.clips.forEach((clip, clipIndex) => clip.frames.forEach((reference, frameIndex) => {
    const source = byPath.get(reference.source)
    const path = `$.clips[${clipIndex}].frames[${frameIndex}]`
    if (!source) {
      issues.push({ path: `${path}.source`, code: 'missing-frame-source', message: `Frame source ${reference.source} is unavailable.`, severity: 'error' })
      return
    }
    const exists = source.frames.some((frame) => typeof frame.key === typeof reference.frame && frame.key === reference.frame)
    if (!exists) issues.push({ path: `${path}.frame`, code: 'missing-frame', message: `Frame ${String(reference.frame)} is unavailable.`, severity: 'error' })
  }))
  return issues
}

export function createPrefabOverrideKey(objectId: string, componentId: string | null, propertyPath: Array<string | number>): string {
  return JSON.stringify([objectId, componentId, ...propertyPath])
}

export function parsePrefabOverrideKey(key: string): { objectId: string; componentId: string | null; propertyPath: Array<string | number> } | null {
  try {
    const value = JSON.parse(key) as unknown
    if (!Array.isArray(value) || value.length < 3 || typeof value[0] !== 'string' || (value[1] !== null && typeof value[1] !== 'string')) return null
    const propertyPath = value.slice(2)
    if (!propertyPath.every((segment) => (typeof segment === 'string' && segment.length > 0) || (typeof segment === 'number' && Number.isInteger(segment) && segment >= 0))) return null
    return { objectId: value[0], componentId: value[1], propertyPath: propertyPath as Array<string | number> }
  } catch {
    return null
  }
}

export function validatePrefabOverrides(prefab: PrefabDocument, instance: PrefabInstance): AuthoringValidationIssue[] {
  const objects = new Map(prefab.objects.map((object) => [object.id, object]))
  const issues: AuthoringValidationIssue[] = []
  Object.keys(instance.overrides).forEach((key) => {
    const target = parsePrefabOverrideKey(key)
    const path = `$.overrides[${JSON.stringify(key)}]`
    if (!target) { issues.push({ path, code: 'invalid-override-key', message: 'Override key is malformed.', severity: 'error' }); return }
    const object = objects.get(target.objectId)
    if (!object) { issues.push({ path, code: 'missing-override-object', message: `Prefab object ${target.objectId} no longer exists.`, severity: 'warning' }); return }
    const root: unknown = target.componentId
      ? object.components.find((component) => component.id === target.componentId)?.data
      : object
    if (root === undefined) { issues.push({ path, code: 'missing-override-component', message: `Prefab component ${target.componentId} no longer exists.`, severity: 'warning' }); return }
    if (!hasPropertyPath(root, target.propertyPath)) issues.push({ path, code: 'missing-override-property', message: `Override property ${target.propertyPath.join('.')} no longer exists.`, severity: 'warning' })
  })
  return issues
}

function validatePrefab(document: { rootObjectId: string; objects: SceneObject[]; exposedProperties: PrefabExposedProperty[] }, context: z.RefinementCtx): void {
  const byId = new Map<string, SceneObject>()
  document.objects.forEach((object, index) => {
    if (byId.has(object.id)) context.addIssue({ code: 'custom', path: ['objects', index, 'id'], message: 'Duplicate prefab object ID.' })
    byId.set(object.id, object)
  })
  if (!byId.has(document.rootObjectId)) context.addIssue({ code: 'custom', path: ['rootObjectId'], message: 'Prefab root object does not exist.' })
  document.objects.forEach((object, index) => {
    if (object.id === document.rootObjectId && object.parentId !== null) context.addIssue({ code: 'custom', path: ['objects', index, 'parentId'], message: 'Prefab root must not have a parent.' })
    if (object.id !== document.rootObjectId && (!object.parentId || !byId.has(object.parentId))) context.addIssue({ code: 'custom', path: ['objects', index, 'parentId'], message: 'Prefab objects must belong to the root subtree.' })
  })
  document.exposedProperties.forEach((property, index) => {
    const object = byId.get(property.objectId)
    if (!object) {
      context.addIssue({ code: 'custom', path: ['exposedProperties', index, 'objectId'], message: 'Exposed property object does not exist.' })
      return
    }
    if (property.componentId && !object.components.some((component) => component.id === property.componentId)) {
      context.addIssue({ code: 'custom', path: ['exposedProperties', index, 'componentId'], message: 'Exposed property component does not exist.' })
    }
  })
}

function parseJson(value: unknown, label: string): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch (error) {
    throw new AuthoringDocumentError(`${label} JSON is invalid.`, [{
      path: '$',
      code: 'invalid-json',
      message: error instanceof Error ? error.message : 'Invalid JSON.',
      severity: 'error'
    }])
  }
}

function parseAuthoringSchema<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (result.success) return result.data
  const issues = result.error.issues.map((issue) => ({
    path: toDataPath(issue.path),
    code: issue.code,
    message: issue.message,
    severity: 'error' as const
  }))
  throw new AuthoringDocumentError(issues[0] ? `${issues[0].path}: ${issues[0].message}` : 'Authoring document validation failed.', issues)
}

function serializeAuthoringSchema<T>(schema: z.ZodType<T>, document: T): string {
  return `${JSON.stringify(parseAuthoringSchema(schema, document), null, 2)}\n`
}

function toDataPath(path: PropertyKey[]): string {
  return path.reduce<string>((current, segment) => typeof segment === 'number' ? `${current}[${segment}]` : `${current}.${String(segment)}`, '$')
}

function hasPropertyPath(root: unknown, path: Array<string | number>): boolean {
  let value = root
  for (const segment of path) {
    if (typeof segment === 'number') {
      if (!Array.isArray(value) || segment >= value.length) return false
      value = value[segment]
      continue
    }
    if (!value || typeof value !== 'object' || !(segment in value)) return false
    value = (value as Record<string, unknown>)[segment]
  }
  return true
}
