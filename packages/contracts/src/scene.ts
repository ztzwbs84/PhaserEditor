import { z } from 'zod'

export const SCENE_FORMAT = 'phaser-editor-scene'
export const CURRENT_SCENE_VERSION = 3

const objectIdSchema = z.uuid()
const objectNameSchema = z.string().trim().min(1).max(120)
const parentIdSchema = objectIdSchema.nullable()

export const sceneTransformSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  rotation: z.number().finite(),
  scaleX: z.number().finite(),
  scaleY: z.number().finite(),
  originX: z.number().finite().min(0).max(1),
  originY: z.number().finite().min(0).max(1)
}).strict()

export type SceneTransform = z.infer<typeof sceneTransformSchema>

export const sceneSettingsSchema = z.object({
  key: z.string().trim().min(1).max(120),
  width: z.number().int().min(1).max(16_384),
  height: z.number().int().min(1).max(16_384),
  backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  pixelArt: z.boolean()
}).strict()

export type SceneSettings = z.infer<typeof sceneSettingsSchema>

export const sceneAssetReferenceSchema = z.object({
  path: z.string().trim().min(1).refine(isProjectRelativeAssetPath, 'Asset path must stay inside the project.'),
  frame: z.union([z.string(), z.number().int()]).nullable().default(null)
}).strict()

export type SceneAssetReference = z.infer<typeof sceneAssetReferenceSchema>

export const sceneAnimationReferenceSchema = z.object({
  assetPath: z.string().trim().min(1).refine(isProjectRelativeAssetPath, 'Animation path must stay inside the project.'),
  clipKey: z.string().trim().min(1).max(160),
  autoPlay: z.boolean()
}).strict()

export type SceneAnimationReference = z.infer<typeof sceneAnimationReferenceSchema>

export const sceneComponentSchema = z.object({
  id: objectIdSchema,
  type: z.string().trim().min(1).max(160).regex(/^[a-z0-9][a-z0-9.-]+$/),
  version: z.number().int().min(1),
  enabled: z.boolean(),
  data: z.record(z.string(), z.unknown())
}).strict()

export type SceneComponent = z.infer<typeof sceneComponentSchema>

export const scenePrefabInstanceSchema = z.object({
  prefabPath: z.string().trim().min(1).refine(isProjectRelativeAssetPath, 'Prefab path must stay inside the project.'),
  instanceId: objectIdSchema,
  objectMap: z.record(objectIdSchema, objectIdSchema),
  componentMap: z.record(objectIdSchema, objectIdSchema),
  overrides: z.record(z.string().min(1), z.unknown())
}).strict()

export type ScenePrefabInstance = z.infer<typeof scenePrefabInstanceSchema>

const sharedObjectShape = {
  id: objectIdSchema,
  name: objectNameSchema,
  parentId: parentIdSchema,
  order: z.number().int().min(0),
  transform: sceneTransformSchema,
  visible: z.boolean(),
  alpha: z.number().finite().min(0).max(1),
  components: z.array(sceneComponentSchema),
  prefabInstance: scenePrefabInstanceSchema.optional()
}

export const sceneImageObjectSchema = z.object({
  ...sharedObjectShape,
  type: z.literal('image'),
  asset: sceneAssetReferenceSchema
}).strict()

export const sceneSpriteObjectSchema = z.object({
  ...sharedObjectShape,
  type: z.literal('sprite'),
  asset: sceneAssetReferenceSchema,
  animation: sceneAnimationReferenceSchema.nullable()
}).strict()

export const sceneTextObjectSchema = z.object({
  ...sharedObjectShape,
  type: z.literal('text'),
  text: z.string().max(20_000),
  style: z.object({
    fontFamily: z.string().trim().min(1).max(200),
    fontSize: z.number().int().min(1).max(512),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    align: z.enum(['left', 'center', 'right'])
  }).strict()
}).strict()

export const sceneContainerObjectSchema = z.object({
  ...sharedObjectShape,
  type: z.literal('container')
}).strict()

export const sceneObjectSchema = z.discriminatedUnion('type', [
  sceneImageObjectSchema,
  sceneSpriteObjectSchema,
  sceneTextObjectSchema,
  sceneContainerObjectSchema
])

export type SceneObject = z.infer<typeof sceneObjectSchema>
export type SceneObjectType = SceneObject['type']

export const sceneDocumentSchema = z.object({
  format: z.literal(SCENE_FORMAT),
  version: z.literal(CURRENT_SCENE_VERSION),
  settings: sceneSettingsSchema,
  objects: z.array(sceneObjectSchema)
}).strict().superRefine(validateHierarchy)

export type SceneDocument = z.infer<typeof sceneDocumentSchema>

const sceneObjectV2Schema = z.discriminatedUnion('type', [
  z.object({ ...withoutComponents(sharedObjectShape), type: z.literal('image'), asset: sceneAssetReferenceSchema }).strict(),
  z.object({ ...withoutComponents(sharedObjectShape), type: z.literal('sprite'), asset: sceneAssetReferenceSchema }).strict(),
  z.object({
    ...withoutComponents(sharedObjectShape),
    type: z.literal('text'),
    text: z.string().max(20_000),
    style: z.object({
      fontFamily: z.string().trim().min(1).max(200),
      fontSize: z.number().int().min(1).max(512),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      align: z.enum(['left', 'center', 'right'])
    }).strict()
  }).strict(),
  z.object({ ...withoutComponents(sharedObjectShape), type: z.literal('container') }).strict()
])

const sceneDocumentV2Schema = z.object({
  format: z.literal(SCENE_FORMAT),
  version: z.literal(2),
  settings: sceneSettingsSchema,
  objects: z.array(sceneObjectV2Schema)
}).strict().superRefine(validateHierarchy)

const legacySceneObjectSchema = z.object({
  id: objectIdSchema,
  type: z.enum(['image', 'sprite', 'text', 'container']),
  name: objectNameSchema,
  parentId: parentIdSchema,
  order: z.number().int().min(0),
  x: z.number().finite(),
  y: z.number().finite(),
  angle: z.number().finite().default(0),
  scaleX: z.number().finite().default(1),
  scaleY: z.number().finite().default(1),
  visible: z.boolean().default(true),
  alpha: z.number().finite().min(0).max(1).default(1),
  assetPath: z.string().optional(),
  frame: z.union([z.string(), z.number().int()]).nullable().optional(),
  text: z.string().optional(),
  fontFamily: z.string().optional(),
  fontSize: z.number().int().optional(),
  color: z.string().optional()
}).strict()

const legacySceneDocumentSchema = z.object({
  format: z.literal(SCENE_FORMAT),
  version: z.literal(1),
  settings: z.object({
    key: z.string().trim().min(1).max(120),
    width: z.number().int().min(1),
    height: z.number().int().min(1),
    backgroundColor: z.string().default('#20242b'),
    pixelArt: z.boolean().default(false)
  }).strict(),
  objects: z.array(legacySceneObjectSchema)
}).strict()

export interface EditableSceneParseResult {
  status: 'editable'
  document: SceneDocument
  migratedFrom?: number
}

export interface ReadonlySceneParseResult {
  status: 'readonly'
  version: number
  raw: string
  message: string
}

export type SceneParseResult = EditableSceneParseResult | ReadonlySceneParseResult

export interface SceneValidationIssue {
  path: string
  message: string
}

export class SceneDocumentError extends Error {
  readonly issues: SceneValidationIssue[]

  constructor(message: string, issues: SceneValidationIssue[]) {
    super(message)
    this.name = 'SceneDocumentError'
    this.issues = issues
  }
}

export function createSceneDocument(key = 'MainScene'): SceneDocument {
  return {
    format: SCENE_FORMAT,
    version: CURRENT_SCENE_VERSION,
    settings: {
      key,
      width: 1280,
      height: 720,
      backgroundColor: '#20242b',
      pixelArt: false
    },
    objects: []
  }
}

export function createSceneTransform(patch: Partial<SceneTransform> = {}): SceneTransform {
  return {
    x: 0,
    y: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    originX: 0.5,
    originY: 0.5,
    ...patch
  }
}

export function parseSceneDocument(source: string): SceneParseResult {
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch (error) {
    throw new SceneDocumentError('Scene JSON is invalid.', [{ path: '$', message: error instanceof Error ? error.message : 'Invalid JSON.' }])
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SceneDocumentError('Scene root must be an object.', [{ path: '$', message: 'Expected an object.' }])
  }
  const header = value as { format?: unknown; version?: unknown }
  if (header.format !== SCENE_FORMAT) {
    throw new SceneDocumentError('Scene format marker is invalid.', [{ path: '$.format', message: `Expected ${SCENE_FORMAT}.` }])
  }
  if (!Number.isInteger(header.version) || Number(header.version) < 1) {
    throw new SceneDocumentError('Scene version is invalid.', [{ path: '$.version', message: 'Expected a positive integer.' }])
  }
  const version = Number(header.version)
  if (version > CURRENT_SCENE_VERSION) {
    return {
      status: 'readonly',
      version,
      raw: source,
      message: `This scene uses version ${version}; this editor supports up to version ${CURRENT_SCENE_VERSION}.`
    }
  }
  if (version === 1) {
    const legacy = parseWithSchema(legacySceneDocumentSchema, value)
    return { status: 'editable', document: migrateVersion1(legacy), migratedFrom: 1 }
  }
  if (version === 2) {
    const legacy = parseWithSchema(sceneDocumentV2Schema, value)
    return { status: 'editable', document: migrateVersion2(legacy), migratedFrom: 2 }
  }
  if (version === CURRENT_SCENE_VERSION) {
    return { status: 'editable', document: parseWithSchema(sceneDocumentSchema, value) }
  }
  throw new SceneDocumentError('Scene version is unsupported.', [{ path: '$.version', message: `No migration exists for version ${version}.` }])
}

export function serializeSceneDocument(document: SceneDocument): string {
  return `${JSON.stringify(parseWithSchema(sceneDocumentSchema, document), null, 2)}\n`
}

export function isProjectRelativeAssetPath(value: string): boolean {
  if (!value || value.includes('\\') || value.startsWith('/') || /^[a-zA-Z]:/.test(value)) return false
  const segments = value.split('/')
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
}

function parseWithSchema<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (result.success) return result.data
  const issues = result.error.issues.map((issue) => ({ path: toDataPath(issue.path), message: issue.message }))
  const first = issues[0]
  throw new SceneDocumentError(first ? `${first.path}: ${first.message}` : 'Scene validation failed.', issues)
}

function toDataPath(path: PropertyKey[]): string {
  return path.reduce<string>((current, segment) => typeof segment === 'number'
    ? `${current}[${segment}]`
    : `${current}.${String(segment)}`, '$')
}

function validateHierarchy(document: { objects: Array<{ id: string; parentId: string | null }> }, context: z.RefinementCtx): void {
  const byId = new Map<string, number>()
  document.objects.forEach((object, index) => {
    const prior = byId.get(object.id)
    if (prior !== undefined) {
      context.addIssue({ code: 'custom', path: ['objects', index, 'id'], message: `Duplicate object ID; first used at objects[${prior}].id.` })
    } else {
      byId.set(object.id, index)
    }
  })

  document.objects.forEach((object, index) => {
    if (object.parentId && !byId.has(object.parentId)) {
      context.addIssue({ code: 'custom', path: ['objects', index, 'parentId'], message: 'Parent object does not exist.' })
    }
  })

  document.objects.forEach((object, index) => {
    const visited = new Set<string>([object.id])
    let parentId = object.parentId
    while (parentId) {
      if (visited.has(parentId)) {
        context.addIssue({ code: 'custom', path: ['objects', index, 'parentId'], message: 'Hierarchy contains a cycle.' })
        return
      }
      visited.add(parentId)
      const parentIndex = byId.get(parentId)
      if (parentIndex === undefined) return
      parentId = document.objects[parentIndex]?.parentId ?? null
    }
  })
}

function migrateVersion1(legacy: z.infer<typeof legacySceneDocumentSchema>): SceneDocument {
  const objects: SceneObject[] = legacy.objects.map((object) => {
    const shared = {
      id: object.id,
      name: object.name,
      parentId: object.parentId,
      order: object.order,
      transform: createSceneTransform({
        x: object.x,
        y: object.y,
        rotation: object.angle * Math.PI / 180,
        scaleX: object.scaleX,
        scaleY: object.scaleY
      }),
      visible: object.visible,
      alpha: object.alpha,
      components: []
    }
    if (object.type === 'container') return { ...shared, type: 'container' }
    if (object.type === 'text') {
      return {
        ...shared,
        type: 'text',
        text: object.text ?? '',
        style: {
          fontFamily: object.fontFamily ?? 'Arial',
          fontSize: object.fontSize ?? 32,
          color: object.color ?? '#ffffff',
          align: 'left'
        }
      }
    }
    const asset = { path: object.assetPath ?? '', frame: object.frame ?? null }
    return object.type === 'image' ? { ...shared, type: 'image', asset } : { ...shared, type: 'sprite', asset, animation: null }
  })
  return parseWithSchema(sceneDocumentSchema, {
    format: SCENE_FORMAT,
    version: CURRENT_SCENE_VERSION,
    settings: legacy.settings,
    objects
  })
}

function migrateVersion2(legacy: z.infer<typeof sceneDocumentV2Schema>): SceneDocument {
  return parseWithSchema(sceneDocumentSchema, {
    ...legacy,
    version: CURRENT_SCENE_VERSION,
    objects: legacy.objects.map((object) => object.type === 'sprite'
      ? { ...object, components: [], animation: null }
      : { ...object, components: [] })
  })
}

function withoutComponents(shape: typeof sharedObjectShape): Omit<typeof sharedObjectShape, 'components'> {
  const { components: _components, ...rest } = shape
  return rest
}
