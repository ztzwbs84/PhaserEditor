import { z } from 'zod'
import type { SceneComponent, SceneObject } from '@phaser-editor/contracts'

export type ComponentFieldKind = 'number' | 'text' | 'boolean' | 'select' | 'color'

export interface ComponentPropertyDescriptor {
  path: string[]
  label: string
  kind: ComponentFieldKind
  min?: number
  max?: number
  step?: number
  options?: Array<{ value: string; label: string }>
}

export interface ComponentProjectionContext {
  scene: unknown
  gameObject: unknown
  overlay: unknown
  documentObjects: SceneObject[]
  resolveGameObject(id: string): unknown | null
  ensureTexture(path: string): { key: string; state: 'loading' | 'ready' | 'failed' }
  requestReconcile(): void
  report(message: string): void
}

export interface ComponentProjectionHandle {
  update(data: Record<string, unknown>, context: ComponentProjectionContext): void
  setActive?(active: boolean): void
  destroy(): void
}

export interface SceneComponentDefinition {
  type: string
  version: number
  label: string
  dataSchema: z.ZodType<Record<string, unknown>>
  createDefault(): Record<string, unknown>
  supports(object: SceneObject): boolean
  properties: ComponentPropertyDescriptor[]
  createProjection?: (data: Record<string, unknown>, context: ComponentProjectionContext) => ComponentProjectionHandle
}

export class SceneComponentRegistry {
  private readonly definitions = new Map<string, SceneComponentDefinition>()
  private readonly listeners = new Set<() => void>()
  private revision = 0

  register(definition: SceneComponentDefinition): () => void {
    if (this.definitions.has(definition.type)) throw new Error(`Scene component ${definition.type} is already registered.`)
    this.definitions.set(definition.type, definition)
    this.emitChange()
    return () => {
      if (this.definitions.get(definition.type) !== definition) return
      this.definitions.delete(definition.type)
      this.emitChange()
    }
  }

  get(type: string): SceneComponentDefinition | undefined { return this.definitions.get(type) }
  list(): SceneComponentDefinition[] { return [...this.definitions.values()].sort((left, right) => left.label.localeCompare(right.label)) }

  create(type: string): SceneComponent {
    const definition = this.definitions.get(type)
    if (!definition) throw new Error(`Unknown scene component ${type}.`)
    return { id: crypto.randomUUID(), type, version: definition.version, enabled: true, data: definition.dataSchema.parse(definition.createDefault()) }
  }

  validate(component: SceneComponent, objects: SceneObject[] = []): string[] {
    const definition = this.definitions.get(component.type)
    if (!definition) return [`Component provider ${component.type} is unavailable.`]
    if (component.version > definition.version) return [`Component version ${component.version} is newer than supported version ${definition.version}.`]
    const result = definition.dataSchema.safeParse(component.data)
    const issues = result.success ? [] : result.error.issues.map((issue) => `${issue.path.join('.') || 'data'}: ${issue.message}`)
    const targetId = component.type === 'phaser.camera' ? component.data.followTargetId : component.type === 'phaser.tween' ? component.data.targetId : null
    if (typeof targetId === 'string' && objects.length > 0 && !objects.some((object) => object.id === targetId)) issues.push(`Target ${targetId} does not exist in this scene.`)
    return issues
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getRevision(): number { return this.revision }

  private emitChange(): void {
    this.revision += 1
    this.listeners.forEach((listener) => listener())
  }
}

export const sceneComponentRegistry = new SceneComponentRegistry()

const vectorSchema = z.object({ x: z.number().finite(), y: z.number().finite() }).strict()
const rectSchema = z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().positive(), height: z.number().positive() }).strict()
const projectPath = z.string().trim().min(1).regex(/^(?!\/|[a-zA-Z]:)(?!.*(?:^|\/)\.\.(?:\/|$))[^\\]+$/)

export const cameraComponentSchema = z.object({
  viewport: rectSchema,
  scroll: vectorSchema,
  zoom: z.number().positive().max(100),
  rotation: z.number().finite(),
  bounds: rectSchema.nullable(),
  backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  followTargetId: z.uuid().nullable(),
  followLerp: vectorSchema
}).strict()

export const arcadeBodyComponentSchema = z.object({
  bodyType: z.enum(['dynamic', 'static']),
  shape: z.enum(['rectangle', 'circle']),
  width: z.number().positive(),
  height: z.number().positive(),
  radius: z.number().positive(),
  offset: vectorSchema,
  velocity: vectorSchema,
  gravity: vectorSchema,
  bounce: vectorSchema,
  allowGravity: z.boolean(),
  immovable: z.boolean(),
  collideWorldBounds: z.boolean(),
  collisionCategory: z.number().int().min(1),
  collisionMask: z.number().int().min(0)
}).strict()

const matterVertexSchema = z.object({ x: z.number().finite(), y: z.number().finite() }).strict()
export const matterBodyComponentSchema = z.object({
  bodyType: z.enum(['dynamic', 'static']),
  shape: z.enum(['rectangle', 'circle', 'polygon']),
  width: z.number().positive(),
  height: z.number().positive(),
  radius: z.number().positive(),
  offset: vectorSchema,
  vertices: z.array(matterVertexSchema).min(3),
  sensor: z.boolean(),
  mass: z.number().positive(),
  restitution: z.number().min(0).max(1),
  friction: z.number().min(0).max(1),
  frictionAir: z.number().min(0).max(1),
  collisionCategory: z.number().int().min(1),
  collisionMask: z.number().int().min(0)
}).strict().superRefine((data, context) => {
  if (data.shape === 'polygon' && polygonSelfIntersects(data.vertices)) context.addIssue({ code: 'custom', path: ['vertices'], message: 'Polygon edges must not self-intersect.' })
})

export const particleEmitterComponentSchema = z.object({
  texture: projectPath,
  frame: z.union([z.string(), z.number().int()]).nullable(),
  frequency: z.number().int().min(-1),
  quantity: z.number().int().min(1).max(1_000),
  lifespan: z.number().int().min(1).max(60_000),
  speed: z.number().finite(),
  angleMin: z.number().finite(),
  angleMax: z.number().finite(),
  scaleStart: z.number().min(0),
  scaleEnd: z.number().min(0),
  alphaStart: z.number().min(0).max(1),
  alphaEnd: z.number().min(0).max(1),
  gravity: vectorSchema,
  maxAliveParticles: z.number().int().min(1).max(2_000)
}).strict()

export const tweenComponentSchema = z.object({
  targetId: z.uuid().nullable(),
  property: z.enum(['x', 'y', 'alpha', 'rotation', 'scaleX', 'scaleY']),
  from: z.number().finite(),
  to: z.number().finite(),
  duration: z.number().int().min(1).max(86_400_000),
  delay: z.number().int().min(0).max(86_400_000),
  ease: z.string().trim().min(1),
  repeat: z.number().int().min(-1).max(1_000_000),
  yoyo: z.boolean(),
  preview: z.boolean()
}).strict()

registerBuiltin({
  type: 'phaser.camera', version: 1, label: 'Camera', dataSchema: cameraComponentSchema,
  supports: (object) => object.type === 'container',
  createDefault: () => ({ viewport: { x: 0, y: 0, width: 800, height: 600 }, scroll: { x: 0, y: 0 }, zoom: 1, rotation: 0, bounds: null, backgroundColor: '#000000', followTargetId: null, followLerp: { x: 1, y: 1 } }),
  properties: [numberField('viewport.x', 'Viewport X'), numberField('viewport.y', 'Viewport Y'), numberField('viewport.width', 'Viewport W', 1), numberField('viewport.height', 'Viewport H', 1), numberField('scroll.x', 'Scroll X'), numberField('scroll.y', 'Scroll Y'), numberField('zoom', 'Zoom', 0.01, 100, 0.05), numberField('rotation', 'Rotation', undefined, undefined, 1), colorField('backgroundColor', 'Background'), textField('followTargetId', 'Follow Target')]
})
registerBuiltin({
  type: 'phaser.arcade-body', version: 1, label: 'Arcade Body', dataSchema: arcadeBodyComponentSchema,
  supports: textured,
  createDefault: () => ({ bodyType: 'dynamic', shape: 'rectangle', width: 64, height: 64, radius: 32, offset: { x: 0, y: 0 }, velocity: { x: 0, y: 0 }, gravity: { x: 0, y: 0 }, bounce: { x: 0, y: 0 }, allowGravity: true, immovable: false, collideWorldBounds: false, collisionCategory: 1, collisionMask: 2147483647 }),
  properties: [selectField('bodyType', 'Body Type', ['dynamic', 'static']), selectField('shape', 'Shape', ['rectangle', 'circle']), numberField('width', 'Width', 1), numberField('height', 'Height', 1), numberField('radius', 'Radius', 1), numberField('offset.x', 'Offset X'), numberField('offset.y', 'Offset Y'), numberField('velocity.x', 'Velocity X'), numberField('velocity.y', 'Velocity Y'), numberField('bounce.x', 'Bounce X', 0, 1, 0.05), numberField('bounce.y', 'Bounce Y', 0, 1, 0.05), booleanField('allowGravity', 'Allow Gravity'), booleanField('immovable', 'Immovable'), booleanField('collideWorldBounds', 'World Bounds')]
})
registerBuiltin({
  type: 'phaser.matter-body', version: 1, label: 'Matter Body', dataSchema: matterBodyComponentSchema,
  supports: textured,
  createDefault: () => ({ bodyType: 'dynamic', shape: 'rectangle', width: 64, height: 64, radius: 32, offset: { x: 0, y: 0 }, vertices: [{ x: -32, y: -32 }, { x: 32, y: -32 }, { x: 32, y: 32 }, { x: -32, y: 32 }], sensor: false, mass: 1, restitution: 0, friction: 0.1, frictionAir: 0.01, collisionCategory: 1, collisionMask: 4294967295 }),
  properties: [selectField('bodyType', 'Body Type', ['dynamic', 'static']), selectField('shape', 'Shape', ['rectangle', 'circle', 'polygon']), numberField('width', 'Width', 1), numberField('height', 'Height', 1), numberField('radius', 'Radius', 1), numberField('offset.x', 'Offset X'), numberField('offset.y', 'Offset Y'), booleanField('sensor', 'Sensor'), numberField('mass', 'Mass', 0.001), numberField('restitution', 'Restitution', 0, 1, 0.05), numberField('friction', 'Friction', 0, 1, 0.05), numberField('frictionAir', 'Air Friction', 0, 1, 0.01)]
})
registerBuiltin({
  type: 'phaser.particle-emitter', version: 1, label: 'Particle Emitter', dataSchema: particleEmitterComponentSchema,
  supports: () => true,
  createDefault: () => ({ texture: 'assets/particle.png', frame: null, frequency: 100, quantity: 1, lifespan: 1000, speed: 100, angleMin: 0, angleMax: 360, scaleStart: 1, scaleEnd: 0, alphaStart: 1, alphaEnd: 0, gravity: { x: 0, y: 0 }, maxAliveParticles: 200 }),
  properties: [textField('texture', 'Texture'), numberField('frequency', 'Frequency', -1), numberField('quantity', 'Quantity', 1, 1000, 1), numberField('lifespan', 'Lifespan', 1), numberField('speed', 'Speed'), numberField('angleMin', 'Angle Min'), numberField('angleMax', 'Angle Max'), numberField('scaleStart', 'Scale Start', 0, undefined, 0.05), numberField('scaleEnd', 'Scale End', 0, undefined, 0.05), numberField('alphaStart', 'Alpha Start', 0, 1, 0.05), numberField('alphaEnd', 'Alpha End', 0, 1, 0.05), numberField('maxAliveParticles', 'Max Alive', 1, 2000, 1)]
})
registerBuiltin({
  type: 'phaser.tween', version: 1, label: 'Tween', dataSchema: tweenComponentSchema,
  supports: () => true,
  createDefault: () => ({ targetId: null, property: 'x', from: 0, to: 100, duration: 1000, delay: 0, ease: 'Power2', repeat: 0, yoyo: false, preview: true }),
  properties: [textField('targetId', 'Target'), selectField('property', 'Property', ['x', 'y', 'alpha', 'rotation', 'scaleX', 'scaleY']), numberField('from', 'From'), numberField('to', 'To'), numberField('duration', 'Duration', 1), numberField('delay', 'Delay', 0), textField('ease', 'Ease'), numberField('repeat', 'Repeat', -1), booleanField('yoyo', 'Yoyo'), booleanField('preview', 'Preview')]
})

function registerBuiltin(definition: SceneComponentDefinition): void { sceneComponentRegistry.register(definition) }
function textured(object: SceneObject): boolean { return object.type === 'image' || object.type === 'sprite' }
function numberField(path: string, label: string, min?: number, max?: number, step = 1): ComponentPropertyDescriptor { return { path: path.split('.'), label, kind: 'number', min, max, step } }
function textField(path: string, label: string): ComponentPropertyDescriptor { return { path: path.split('.'), label, kind: 'text' } }
function colorField(path: string, label: string): ComponentPropertyDescriptor { return { path: path.split('.'), label, kind: 'color' } }
function booleanField(path: string, label: string): ComponentPropertyDescriptor { return { path: path.split('.'), label, kind: 'boolean' } }
function selectField(path: string, label: string, options: string[]): ComponentPropertyDescriptor { return { path: path.split('.'), label, kind: 'select', options: options.map((value) => ({ value, label: value })) } }

function polygonSelfIntersects(vertices: Array<{ x: number; y: number }>): boolean {
  for (let left = 0; left < vertices.length; left += 1) {
    const a1 = vertices[left]!
    const a2 = vertices[(left + 1) % vertices.length]!
    for (let right = left + 1; right < vertices.length; right += 1) {
      if (Math.abs(left - right) <= 1 || (left === 0 && right === vertices.length - 1)) continue
      const b1 = vertices[right]!
      const b2 = vertices[(right + 1) % vertices.length]!
      if (segmentsIntersect(a1, a2, b1, b2)) return true
    }
  }
  return false
}

function segmentsIntersect(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }, d: { x: number; y: number }): boolean {
  const cross = (p: typeof a, q: typeof a, r: typeof a): number => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  const abC = cross(a, b, c)
  const abD = cross(a, b, d)
  const cdA = cross(c, d, a)
  const cdB = cross(c, d, b)
  return abC * abD < 0 && cdA * cdB < 0
}
