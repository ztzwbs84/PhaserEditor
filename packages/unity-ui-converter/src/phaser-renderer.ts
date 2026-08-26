import type Phaser from 'phaser'
import { resolveUILayout, type ResolvedRect } from './layout.js'
import type { Color, UIImageComponent, UINode, UIResource, UITextComponent, UnityUIDocument } from './schema.js'
import { drawUnityText, layoutUnityText, measureUnityText } from './text-layout.js'

export interface PhaserUnityUIRendererOptions {
  onWarning?: (message: string, details?: unknown) => void
  onButton?: (node: UINode) => void
}

interface RuntimeNode {
  node: UINode
  container: Phaser.GameObjects.Container
  rect: ResolvedRect
  width: number
  height: number
  visual?: Phaser.GameObjects.GameObject
}

let rendererSequence = 0

export function preloadUnityUI(scene: Phaser.Scene, document: UnityUIDocument): void {
  for (const resource of Object.values(document.resources)) {
    if (!resource.webPath || (resource.kind !== 'sprite' && resource.kind !== 'texture')) continue
    if (!isBrowserImage(resource.webPath)) continue
    scene.load.image(textureKey(resource), resource.webPath)
  }
}

export async function loadUnityFonts(document: UnityUIDocument): Promise<void> {
  if (typeof FontFace === 'undefined') return
  const loads = Object.values(document.resources)
    .filter((resource) => resource.kind === 'font' && resource.webPath)
    .map(async (resource) => {
      const face = new FontFace(fontFamily(resource), `url(${JSON.stringify(resource.webPath)})`)
      await face.load()
      globalThis.document?.fonts.add(face)
    })
  await Promise.allSettled(loads)
}

export class PhaserUnityUIRenderer {
  private readonly nodes = new Map<string, RuntimeNode>()
  private readonly roots: Phaser.GameObjects.Container[] = []
  private readonly textTextureKeys = new Set<string>()
  private readonly rendererId = rendererSequence++
  private resolvedRects = new Map<string, ResolvedRect>()

  constructor(
    private readonly scene: Phaser.Scene,
    readonly document: UnityUIDocument,
    private readonly options: PhaserUnityUIRendererOptions = {}
  ) {}

  create(width = this.document.canvas.referenceResolution.x, height = this.document.canvas.referenceResolution.y): Phaser.GameObjects.Container[] {
    this.destroy()
    this.prepareTextureFrames()
    const measurementContext = createMeasurementContext()
    this.resolvedRects = resolveUILayout(this.document, { x: width, y: height }, {
      measureText: measurementContext
        ? (component, maxWidth) => measureUnityText(measurementContext, component, maxWidth, this.fontFamilyFor(component))
        : undefined
    }).rects
    for (const rootId of this.document.rootIds) this.createNode(rootId, null)
    return this.roots
  }

  destroy(): void {
    for (const root of this.roots) root.destroy(true)
    for (const key of this.textTextureKeys) this.scene.textures.remove(key)
    this.roots.length = 0
    this.nodes.clear()
    this.textTextureKeys.clear()
    this.resolvedRects.clear()
  }

  getNode(nodeId: string): Phaser.GameObjects.Container | null {
    return this.nodes.get(nodeId)?.container ?? null
  }

  getResolvedRect(nodeId: string): ResolvedRect | null {
    const rect = this.resolvedRects.get(nodeId)
    return rect ? { ...rect } : null
  }

  private createNode(nodeId: string, parent: RuntimeNode | null): RuntimeNode | null {
    const node = this.document.nodes.find((candidate) => candidate.id === nodeId)
    if (!node) return null
    const resolved = this.resolvedRects.get(node.id)
    if (!resolved) return null
    const parentPivotX = parent ? parent.node.rect.pivot.x * parent.width : 0
    const parentPivotY = parent ? (1 - parent.node.rect.pivot.y) * parent.height : 0
    const container = this.scene.add.container(resolved.pivotX - parentPivotX, resolved.pivotY - parentPivotY)
    container.setName(node.name)
    container.setVisible(node.active)
    container.setScale(node.rect.localScale.x, node.rect.localScale.y)
    container.setRotation(-degreesToRadians(node.rect.localEulerAngles.z))
    if (parent) parent.container.add(container)
    else this.roots.push(container)

    const runtime: RuntimeNode = { node, container, rect: resolved, width: resolved.width, height: resolved.height }
    this.nodes.set(node.id, runtime)
    this.applyGroupProperties(runtime)
    runtime.visual = this.createVisual(runtime)
    this.applyInteraction(runtime)
    this.applyMask(runtime)

    const children = this.document.nodes.filter((candidate) => candidate.parentId === node.id).sort((a, b) => a.order - b.order)
    for (const child of children) this.createNode(child.id, runtime)
    return runtime
  }

  private createVisual(runtime: RuntimeNode): Phaser.GameObjects.GameObject | undefined {
    const image = runtime.node.components.find((component): component is UIImageComponent => component.type === 'image' || component.type === 'raw-image')
    const mask = runtime.node.components.find((component) => component.type === 'mask')
    const hidesMaskGraphic = mask && 'properties' in mask && mask.properties.showMaskGraphic === false
    if (image && !hidesMaskGraphic) return this.createImage(runtime, image)
    const text = runtime.node.components.find((component): component is UITextComponent => component.type === 'text' || component.type === 'text-mesh-pro')
    if (text) return this.createText(runtime, text)
    return undefined
  }

  private createImage(runtime: RuntimeNode, component: UIImageComponent): Phaser.GameObjects.GameObject | undefined {
    const resource = component.resourceId ? this.document.resources[component.resourceId] : undefined
    if (!resource || !this.scene.textures.exists(textureKey(resource))) {
      this.warn(`Texture is unavailable for ${runtime.node.name}.`, resource)
      return undefined
    }
    const frame = frameKey(resource)
    const originX = runtime.node.rect.pivot.x
    const originY = 1 - runtime.node.rect.pivot.y
    let object: Phaser.GameObjects.Image | Phaser.GameObjects.NineSlice | Phaser.GameObjects.TileSprite
    if (component.imageType === 'sliced' && resource.sprite) {
      const border = resource.sprite.border
      object = this.scene.add.nineslice(0, 0, textureKey(resource), frame, runtime.width, runtime.height, border.left, border.right, border.top, border.bottom)
    } else if (component.imageType === 'tiled') {
      object = this.scene.add.tileSprite(0, 0, runtime.width, runtime.height, textureKey(resource), frame)
    } else {
      const image = this.scene.add.image(0, 0, textureKey(resource), frame)
      if (component.preserveAspect && resource.sprite?.rect.width && resource.sprite.rect.height) {
        const scale = Math.min(runtime.width / resource.sprite.rect.width, runtime.height / resource.sprite.rect.height)
        image.setDisplaySize(resource.sprite.rect.width * scale, resource.sprite.rect.height * scale)
      } else image.setDisplaySize(runtime.width, runtime.height)
      if (component.imageType === 'filled') applySimpleFill(image, component, runtime.width, runtime.height, resource)
      object = image
    }
    object.setOrigin(originX, originY)
    object.setTint(colorToTint(component.color))
    object.setAlpha(component.color.a)
    runtime.container.add(object)
    return object
  }

  private createText(runtime: RuntimeNode, component: UITextComponent): Phaser.GameObjects.Image {
    const measurementContext = createMeasurementContext()
    const textureKey = `unity-text:${this.rendererId}:${runtime.node.id}`
    if (!measurementContext) {
      this.warn(`Canvas text context is unavailable for ${runtime.node.name}.`)
      return this.scene.add.image(0, 0, textureKey)
    }
    const layout = layoutUnityText(measurementContext, component, {
      fontFamily: this.fontFamilyFor(component),
      width: runtime.width,
      height: runtime.height
    })
    const ratio = Math.min(2, globalThis.devicePixelRatio || 1)
    const pixelWidth = Math.max(1, Math.ceil(layout.bounds.width * ratio))
    const pixelHeight = Math.max(1, Math.ceil(layout.bounds.height * ratio))
    const texture = this.scene.textures.createCanvas(textureKey, pixelWidth, pixelHeight)
    if (!texture) throw new Error(`Could not create text texture for ${runtime.node.name}.`)
    const context = texture.getContext()
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.clearRect(0, 0, layout.bounds.width, layout.bounds.height)
    drawUnityText(context, layout, component, -layout.bounds.x, -layout.bounds.y)
    texture.refresh()
    this.textTextureKeys.add(textureKey)

    const originX = runtime.node.rect.pivot.x * runtime.width
    const originY = (1 - runtime.node.rect.pivot.y) * runtime.height
    const image = this.scene.add.image(-originX + layout.bounds.x, -originY + layout.bounds.y, textureKey)
    image.setOrigin(0, 0)
    image.setDisplaySize(layout.bounds.width, layout.bounds.height)
    runtime.container.add(image)
    return image
  }

  private applyGroupProperties(runtime: RuntimeNode): void {
    const group = runtime.node.components.find((component) => component.type === 'canvas-group')
    if (!group || !('properties' in group)) return
    runtime.container.setAlpha(numberProperty(group.properties.m_Alpha, 1))
    if (!booleanProperty(group.properties.m_Interactable, true) || !booleanProperty(group.properties.m_BlocksRaycasts, true)) runtime.container.disableInteractive()
  }

  private applyInteraction(runtime: RuntimeNode): void {
    if (!runtime.node.components.some((component) => component.type === 'button')) return
    const zone = this.scene.add.zone(0, 0, runtime.width, runtime.height)
    zone.setOrigin(runtime.node.rect.pivot.x, 1 - runtime.node.rect.pivot.y)
    zone.setInteractive({ useHandCursor: true })
    zone.on('pointerdown', () => runtime.container.setScale(runtime.node.rect.localScale.x * 0.96, runtime.node.rect.localScale.y * 0.96))
    zone.on('pointerup', () => {
      runtime.container.setScale(runtime.node.rect.localScale.x, runtime.node.rect.localScale.y)
      this.options.onButton?.(runtime.node)
    })
    zone.on('pointerout', () => runtime.container.setScale(runtime.node.rect.localScale.x, runtime.node.rect.localScale.y))
    runtime.container.addAt(zone, 0)
  }

  private applyMask(runtime: RuntimeNode): void {
    const hasMask = runtime.node.components.some((component) => component.type === 'mask' || component.type === 'rect-mask-2d' || component.type === 'scroll-rect')
    if (!hasMask) return
    const originX = runtime.node.rect.pivot.x * runtime.width
    const originY = (1 - runtime.node.rect.pivot.y) * runtime.height
    const graphics = this.scene.make.graphics({ x: runtime.container.x, y: runtime.container.y })
    graphics.fillStyle(0xffffff).fillRect(-originX, -originY, runtime.width, runtime.height)
    runtime.container.setMask(graphics.createGeometryMask())
  }

  private prepareTextureFrames(): void {
    for (const resource of Object.values(this.document.resources)) {
      if (!resource.sprite?.packed || !this.scene.textures.exists(textureKey(resource))) continue
      const texture = this.scene.textures.get(textureKey(resource))
      const sprite = resource.sprite
      const source = texture.getSourceImage() as { height: number }
      const top = (resource.height ?? source.height) - sprite.rect.y - sprite.rect.height
      if (!texture.has(frameKey(resource)!)) texture.add(frameKey(resource)!, 0, sprite.rect.x, top, sprite.rect.width, sprite.rect.height)
    }
  }

  private warn(message: string, details?: unknown): void {
    this.options.onWarning?.(message, details)
    if (!this.options.onWarning) console.warn(`[unity-ui] ${message}`, details)
  }

  private fontFamilyFor(component: UITextComponent): string {
    const resource = component.resourceId ? this.document.resources[component.resourceId] : undefined
    return resource ? fontFamily(resource) : 'sans-serif'
  }
}

function applySimpleFill(image: Phaser.GameObjects.Image, component: UIImageComponent, width: number, height: number, resource: UIResource): void {
  const amount = Math.max(0, Math.min(1, component.fillAmount))
  const sourceWidth = resource.sprite?.rect.width ?? resource.width ?? width
  const sourceHeight = resource.sprite?.rect.height ?? resource.height ?? height
  if (component.fillMethod === 0) {
    const cropWidth = sourceWidth * amount
    image.setCrop(component.fillOrigin === 1 ? sourceWidth - cropWidth : 0, 0, cropWidth, sourceHeight)
  } else if (component.fillMethod === 1) {
    const cropHeight = sourceHeight * amount
    image.setCrop(0, component.fillOrigin === 1 ? 0 : sourceHeight - cropHeight, sourceWidth, cropHeight)
  }
}

function textureKey(resource: UIResource): string { return `unity-resource:${resource.id}` }
function frameKey(resource: UIResource): string | undefined { return resource.sprite?.packed ? `unity-frame:${resource.fileId}` : undefined }
function fontFamily(resource: UIResource): string { return `unity-font-${resource.guid || resource.fileId}` }
function colorToTint(color: Color): number { return (Math.round(color.r * 255) << 16) | (Math.round(color.g * 255) << 8) | Math.round(color.b * 255) }
function colorToCss(color: Color): string { return `#${colorToTint(color).toString(16).padStart(6, '0')}` }
function isBrowserImage(value: string): boolean { return /\.(?:png|jpe?g|webp|gif|bmp)$/i.test(value) }
function degreesToRadians(value: number): number { return value * Math.PI / 180 }
function numberProperty(value: unknown, fallback: number): number { const number = Number(value); return Number.isFinite(number) ? number : fallback }
function booleanProperty(value: unknown, fallback: boolean): boolean { return value === 0 || value === '0' ? false : value === 1 || value === '1' ? true : fallback }

export function verticalTextPadding(alignment: number, boxHeight: number, contentHeight: number): number {
  const available = Math.max(0, boxHeight - contentHeight)
  return alignment === 1 ? available / 2 : alignment === 2 ? available : 0
}

function createMeasurementContext(): CanvasRenderingContext2D | null {
  return globalThis.document?.createElement('canvas').getContext('2d') ?? null
}
