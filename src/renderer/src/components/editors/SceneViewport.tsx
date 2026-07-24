import { useEffect, useRef } from 'react'
import Phaser from 'phaser'
import { parseAnimationAsset, type SceneAnimationReference, type SceneDocument, type SceneObject } from '@phaser-editor/contracts'
import { isSupportedSceneImage } from '../../lib/scene-assets'
import { sceneProjectionSignature } from '../../lib/scene-projection'
import { disposeSceneViewport } from '../../lib/scene-viewport-lifecycle'
import { importPhaserAtlas } from '../../lib/frame-sources'
import { SceneComponentProjectionManager } from '../../lib/component-projection'
import { sceneComponentRegistry } from '../../lib/scene-components'

type ProjectedObject = Phaser.GameObjects.Container | Phaser.GameObjects.Image | Phaser.GameObjects.Sprite | Phaser.GameObjects.Text

interface RuntimeProjection {
  object: ProjectedObject
  signature: string
}

interface RuntimeAnimation {
  key: string
  firstTexture: string
  firstFrame: string | number
}

export interface SceneViewportController {
  reconcile(document: SceneDocument, selection: string[]): void
  hitTest(clientX: number, clientY: number): string | null
  screenToWorld(clientX: number, clientY: number): { x: number; y: number }
  worldToParentLocal(objectId: string, world: { x: number; y: number }): { x: number; y: number }
  getObjectWorldCenter(objectId: string): { x: number; y: number }
  setPreviewActive(active: boolean): void
}

export function SceneViewport({
  document,
  selection,
  projectRoot,
  onReady,
  onAssetError
}: {
  document: SceneDocument
  selection: string[]
  projectRoot: string
  onReady(controller: SceneViewportController | null): void
  onAssetError(message: string): void
}): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const controller = useRef<PhaserSceneProjection | null>(null)
  const latest = useRef({ document, selection })
  latest.current = { document, selection }

  useEffect(() => {
    const mountedParent = host.current
    if (!mountedParent) return
    const parent: HTMLElement = mountedParent
    let projection: PhaserSceneProjection | null = null
    let disposed = false

    class EditorScene extends Phaser.Scene {
      create(): void {
        if (disposed) return
        projection = new PhaserSceneProjection(this, parent, projectRoot, onAssetError)
        controller.current = projection
        projection.reconcile(latest.current.document, latest.current.selection)
        onReady(projection)
      }
    }

    const bounds = parent.getBoundingClientRect()
    const game = new Phaser.Game({
      type: Phaser.CANVAS,
      parent,
      width: Math.max(1, Math.floor(bounds.width)),
      height: Math.max(1, Math.floor(bounds.height)),
      backgroundColor: document.settings.backgroundColor,
      transparent: false,
      banner: false,
      input: { keyboard: false, mouse: false, touch: false, gamepad: false },
      scale: {
        parent,
        mode: Phaser.Scale.RESIZE,
        width: '100%',
        height: '100%',
        expandParent: false
      },
      scene: EditorScene,
      physics: { default: 'arcade', arcade: { gravity: { x: 0, y: 0 }, debug: false } }
    })
    const resize = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const width = Math.max(1, Math.floor(entry.contentRect.width))
      const height = Math.max(1, Math.floor(entry.contentRect.height))
      if (game.scale.width !== width || game.scale.height !== height) game.scale.resize(width, height)
    })
    resize.observe(parent)
    const visibility = new IntersectionObserver((entries) => projection?.setPreviewActive(entries[0]?.isIntersecting ?? false), { threshold: 0.01 })
    visibility.observe(parent)

    return () => {
      disposed = true
      controller.current = null
      visibility.disconnect()
      disposeSceneViewport({ resizeObserver: resize, projection, game, releaseController: () => onReady(null) })
    }
  }, [onAssetError, onReady, projectRoot])

  useEffect(() => {
    controller.current?.reconcile(document, selection)
  }, [document, selection])

  useEffect(() => sceneComponentRegistry.subscribe(() => {
    controller.current?.reconcile(latest.current.document, latest.current.selection)
  }), [])

  return <div className="scene-phaser-host" ref={host} data-testid="scene-phaser-host" />
}

class PhaserSceneProjection implements SceneViewportController {
  private readonly projections = new Map<string, RuntimeProjection>()
  private readonly loadingAssets = new Set<string>()
  private readonly failedAssets = new Set<string>()
  private readonly animationStates = new Map<string, 'loading' | 'ready' | 'failed'>()
  private readonly animations = new Map<string, RuntimeAnimation>()
  private readonly animationTextureKeys = new Set<string>()
  private readonly componentProjection = new SceneComponentProjectionManager()
  private componentProjectorsLoaded = false
  private componentProjectorsLoading = false
  private readonly grid: Phaser.GameObjects.Graphics
  private readonly selectionGraphics: Phaser.GameObjects.Graphics
  private readonly guides: Phaser.GameObjects.Graphics
  private currentDocument: SceneDocument | null = null
  private currentSelection: string[] = []
  private destroyed = false

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly host: HTMLElement,
    private readonly projectRoot: string,
    private readonly onAssetError: (message: string) => void
  ) {
    this.grid = scene.add.graphics().setDepth(-10_000)
    this.guides = scene.add.graphics().setDepth(-9_999)
    this.selectionGraphics = scene.add.graphics().setDepth(10_000)
    scene.load.on(Phaser.Loader.Events.FILE_COMPLETE, this.handleFileComplete, this)
    scene.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, this.handleFileError, this)
  }

  reconcile(document: SceneDocument, selection: string[]): void {
    if (this.destroyed) return
    this.currentDocument = document
    this.currentSelection = selection
    this.scene.cameras.main.setBackgroundColor(document.settings.backgroundColor)
    this.drawGuides(document)

    const wanted = new Set(document.objects.map((object) => object.id))
    for (const [id, projection] of this.projections) {
      if (!wanted.has(id)) {
        detachBeforeDestroy(projection.object)
        projection.object.destroy(true)
        this.projections.delete(id)
      }
    }

    for (const object of document.objects) {
      const signature = this.projectionSignature(object)
      const current = this.projections.get(object.id)
      if (!current || current.signature !== signature) {
        if (current) {
          detachBeforeDestroy(current.object)
          current.object.destroy(true)
        }
        this.projections.set(object.id, { object: this.createProjection(object), signature })
      }
    }

    for (const object of document.objects) this.applyProjection(object, this.projections.get(object.id)!.object)
    this.reconcileParents(document)
    this.ensureComponentProjectors(document)
    this.componentProjection.reconcile(document.objects, (object) => {
      const gameObject = this.projections.get(object.id)?.object
      if (!gameObject) return null
      return {
        scene: this.scene,
        gameObject,
        overlay: this.guides,
        documentObjects: document.objects,
        resolveGameObject: (id) => this.projections.get(id)?.object ?? null,
        ensureTexture: (path) => {
          this.ensureAsset(path)
          const key = assetTextureKey(path)
          return { key, state: this.scene.textures.exists(key) ? 'ready' : this.failedAssets.has(key) ? 'failed' : 'loading' }
        },
        requestReconcile: () => { if (this.currentDocument) this.reconcile(this.currentDocument, this.currentSelection) },
        report: this.onAssetError
      }
    })
    this.drawSelection()
  }

  hitTest(clientX: number, clientY: number): string | null {
    const point = this.screenToWorld(clientX, clientY)
    const objects = this.currentDocument?.objects ?? []
    for (let index = objects.length - 1; index >= 0; index -= 1) {
      const documentObject = objects[index]!
      if (!documentObject.visible || documentObject.alpha <= 0) continue
      const projection = this.projections.get(documentObject.id)?.object
      if (projection?.getBounds().contains(point.x, point.y)) return documentObject.id
    }
    return null
  }

  screenToWorld(clientX: number, clientY: number): { x: number; y: number } {
    const bounds = this.host.getBoundingClientRect()
    const canvasX = (clientX - bounds.left) * this.scene.scale.width / Math.max(1, bounds.width)
    const canvasY = (clientY - bounds.top) * this.scene.scale.height / Math.max(1, bounds.height)
    const point = this.scene.cameras.main.getWorldPoint(canvasX, canvasY)
    return { x: point.x, y: point.y }
  }

  worldToParentLocal(objectId: string, world: { x: number; y: number }): { x: number; y: number } {
    const documentObject = this.currentDocument?.objects.find((object) => object.id === objectId)
    if (!documentObject?.parentId) return { ...world }
    const parent = this.projections.get(documentObject.parentId)?.object
    if (!(parent instanceof Phaser.GameObjects.Container)) return { ...world }
    const local = parent.pointToContainer(new Phaser.Math.Vector2(world.x, world.y))
    return { x: local.x, y: local.y }
  }

  getObjectWorldCenter(objectId: string): { x: number; y: number } {
    const bounds = this.projections.get(objectId)?.object.getBounds()
    return bounds ? { x: bounds.centerX, y: bounds.centerY } : { x: 0, y: 0 }
  }

  setPreviewActive(active: boolean): void { this.componentProjection.setActive(active) }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.scene.load.off(Phaser.Loader.Events.FILE_COMPLETE, this.handleFileComplete, this)
    this.scene.load.off(Phaser.Loader.Events.FILE_LOAD_ERROR, this.handleFileError, this)
    for (const animation of this.animations.values()) this.scene.anims.remove(animation.key)
    for (const textureKey of this.animationTextureKeys) this.scene.textures.remove(textureKey)
    this.animations.clear()
    this.animationStates.clear()
    this.animationTextureKeys.clear()
    this.componentProjection.destroy()
    this.projections.clear()
  }

  private createProjection(object: SceneObject): ProjectedObject {
    if (object.type === 'container') return this.scene.add.container(0, 0).setSize(32, 32)
    if (object.type === 'text') {
      return this.scene.add.text(0, 0, object.text, {
        fontFamily: object.style.fontFamily,
        fontSize: `${object.style.fontSize}px`,
        color: object.style.color,
        align: object.style.align
      })
    }
    const textureKey = assetTextureKey(object.asset.path)
    if (object.type === 'sprite' && object.animation) {
      const animation = this.animations.get(animationReferenceKey(object.animation))
      if (animation) {
        const sprite = this.scene.add.sprite(0, 0, animation.firstTexture, animation.firstFrame)
        if (object.animation.autoPlay) sprite.play(animation.key)
        else { sprite.play(animation.key); sprite.anims.pause() }
        return sprite
      }
      this.ensureAnimation(object.animation)
    }
    if (this.scene.textures.exists(textureKey)) {
      return object.type === 'sprite'
        ? this.scene.add.sprite(0, 0, textureKey, object.asset.frame ?? undefined)
        : this.scene.add.image(0, 0, textureKey, object.asset.frame ?? undefined)
    }
    this.ensureAsset(object.asset.path)
    const placeholder = this.scene.add.container(0, 0).setSize(120, 72)
    const background = this.scene.add.rectangle(0, 0, 120, 72, 0x252a30, 1).setStrokeStyle(1, this.failedAssets.has(textureKey) ? 0xd45b5b : 0x68727d, 1)
    const label = this.scene.add.text(0, 0, this.failedAssets.has(textureKey) ? 'Missing asset' : 'Loading asset', { fontFamily: 'Arial', fontSize: '12px', color: '#cfd5dc' }).setOrigin(0.5)
    placeholder.add([background, label])
    return placeholder
  }

  private applyProjection(object: SceneObject, projection: ProjectedObject): void {
    projection
      .setName(object.name)
      .setPosition(object.transform.x, object.transform.y)
      .setRotation(object.transform.rotation)
      .setScale(object.transform.scaleX, object.transform.scaleY)
      .setVisible(object.visible)
      .setAlpha(object.alpha)
    if ('setOrigin' in projection && typeof projection.setOrigin === 'function') projection.setOrigin(object.transform.originX, object.transform.originY)
    if (object.type === 'text' && projection instanceof Phaser.GameObjects.Text) {
      projection.setText(object.text)
      projection.setStyle({
        fontFamily: object.style.fontFamily,
        fontSize: `${object.style.fontSize}px`,
        color: object.style.color,
        align: object.style.align
      })
    }
    if (object.type === 'sprite' && object.animation && projection instanceof Phaser.GameObjects.Sprite) {
      const runtime = this.animations.get(animationReferenceKey(object.animation))
      if (runtime && projection.anims.currentAnim?.key !== runtime.key) {
        projection.play(runtime.key)
        if (!object.animation.autoPlay) projection.anims.pause()
      } else if (runtime) {
        object.animation.autoPlay ? projection.anims.resume() : projection.anims.pause()
      }
    }
  }

  private reconcileParents(document: SceneDocument): void {
    for (const object of document.objects) {
      const projection = this.projections.get(object.id)!.object
      const target = object.parentId ? this.projections.get(object.parentId)?.object : null
      if (target instanceof Phaser.GameObjects.Container) {
        if (projection.parentContainer !== target) target.add(projection)
      } else if (projection.parentContainer) {
        projection.parentContainer.remove(projection)
        this.scene.children.add(projection)
      }
    }
    const siblings = new Map<string | null, SceneObject[]>()
    for (const object of document.objects) siblings.set(object.parentId, [...(siblings.get(object.parentId) ?? []), object])
    for (const [parentId, children] of siblings) {
      const ordered = [...children].sort((left, right) => left.order - right.order || document.objects.indexOf(left) - document.objects.indexOf(right))
      if (parentId) {
        const parent = this.projections.get(parentId)?.object
        if (parent instanceof Phaser.GameObjects.Container) ordered.forEach((child, index) => parent.moveTo(this.projections.get(child.id)!.object, index))
      } else {
        ordered.forEach((child, index) => this.projections.get(child.id)!.object.setDepth(index))
      }
    }
    this.grid.setDepth(-10_000)
    this.guides.setDepth(-9_999)
    this.selectionGraphics.setDepth(10_000)
  }

  private drawGuides(document: SceneDocument): void {
    const width = Math.max(this.scene.scale.width, document.settings.width)
    const height = Math.max(this.scene.scale.height, document.settings.height)
    this.grid.clear().lineStyle(1, 0x343a42, 0.55)
    for (let x = 0; x <= width; x += 32) this.grid.lineBetween(x, 0, x, height)
    for (let y = 0; y <= height; y += 32) this.grid.lineBetween(0, y, width, y)
    this.guides.clear().lineStyle(1, 0x74808c, 0.9).strokeRect(0, 0, document.settings.width, document.settings.height)
    this.guides.lineStyle(2, 0xd95c5c, 0.9).lineBetween(0, 0, 56, 0)
    this.guides.lineStyle(2, 0x62a85b, 0.9).lineBetween(0, 0, 0, 56)
  }

  private drawSelection(): void {
    this.selectionGraphics.clear()
    for (const id of this.currentSelection) {
      const bounds = this.projections.get(id)?.object.getBounds()
      if (!bounds) continue
      this.selectionGraphics.lineStyle(1.5, 0x55a7e0, 1).strokeRect(bounds.x, bounds.y, bounds.width, bounds.height)
      this.selectionGraphics.fillStyle(0x55a7e0, 1)
      this.selectionGraphics.fillRect(bounds.right - 4, bounds.bottom - 4, 8, 8)
      this.selectionGraphics.fillCircle(bounds.centerX, bounds.top - 18, 5)
      this.selectionGraphics.lineStyle(1, 0x55a7e0, 1).lineBetween(bounds.centerX, bounds.top, bounds.centerX, bounds.top - 13)
    }
  }

  private projectionSignature(object: SceneObject): string {
    const base = sceneProjectionSignature(object, (path) => {
      const key = assetTextureKey(path)
      return this.scene.textures.exists(key) ? 'ready' : this.failedAssets.has(key) ? 'failed' : 'loading'
    })
    if (object.type !== 'sprite' || !object.animation) return base
    return `${base}:${this.animationStates.get(animationReferenceKey(object.animation)) ?? 'loading'}`
  }

  private ensureAnimation(reference: SceneAnimationReference): void {
    const referenceKey = animationReferenceKey(reference)
    if (this.animationStates.has(referenceKey)) return
    this.animationStates.set(referenceKey, 'loading')
    void this.loadAnimation(reference).then((runtime) => {
      if (this.destroyed) return
      this.animations.set(referenceKey, runtime)
      this.animationStates.set(referenceKey, 'ready')
      if (this.currentDocument) this.reconcile(this.currentDocument, this.currentSelection)
    }).catch((error) => {
      if (this.destroyed) return
      this.animationStates.set(referenceKey, 'failed')
      this.onAssetError(error instanceof Error ? error.message : `Could not load animation ${reference.clipKey}.`)
      if (this.currentDocument) this.reconcile(this.currentDocument, this.currentSelection)
    })
  }

  private ensureComponentProjectors(document: SceneDocument): void {
    if (this.componentProjectorsLoaded || this.componentProjectorsLoading || !document.objects.some((object) => object.components.length > 0)) return
    this.componentProjectorsLoading = true
    void import('../../lib/phaser-component-projections').then(({ installPhaserComponentProjections }) => {
      if (this.destroyed) return
      installPhaserComponentProjections()
      this.componentProjectorsLoaded = true
      this.componentProjectorsLoading = false
      if (this.currentDocument) this.reconcile(this.currentDocument, this.currentSelection)
    }).catch((error) => {
      this.componentProjectorsLoading = false
      this.onAssetError(error instanceof Error ? error.message : 'Could not load Phaser component previews.')
    })
  }

  private async loadAnimation(reference: SceneAnimationReference): Promise<RuntimeAnimation> {
    const animationResult = await window.editorApi.fileSystem.read(joinProjectPath(this.projectRoot, reference.assetPath))
    if (!animationResult.ok) throw new Error(`Could not read ${reference.assetPath}: ${animationResult.error.message}`)
    const asset = parseAnimationAsset(animationResult.value.content)
    const clip = asset.clips.find((candidate) => candidate.key === reference.clipKey)
    if (!clip) throw new Error(`Animation ${reference.clipKey} is missing from ${reference.assetPath}.`)

    const textureKeys = new Map<string, string>()
    for (const sourcePath of new Set(clip.frames.map((frame) => frame.source))) {
      const atlasResult = await window.editorApi.fileSystem.read(joinProjectPath(this.projectRoot, sourcePath))
      if (!atlasResult.ok) throw new Error(`Could not read ${sourcePath}: ${atlasResult.error.message}`)
      const imported = importPhaserAtlas(atlasResult.value.content, sourcePath)
      if (!imported.source) throw new Error(`Atlas ${sourcePath} is invalid.`)
      const textureKey = animationTextureKey(sourcePath)
      textureKeys.set(sourcePath, textureKey)
      if (!this.scene.textures.exists(textureKey)) {
        const image = await loadEditorImage(window.editorApi.fileSystem.assetUrl(joinProjectPath(this.projectRoot, imported.source.source.imagePath)))
        const atlasData = JSON.parse(atlasResult.value.content) as object
        if (!this.scene.textures.addAtlas(textureKey, image, atlasData)) throw new Error(`Could not create atlas texture ${sourcePath}.`)
        this.animationTextureKeys.add(textureKey)
      }
      for (const frame of clip.frames.filter((candidate) => candidate.source === sourcePath)) {
        if (!this.scene.textures.get(textureKey).has(String(frame.frame))) throw new Error(`Animation frame ${String(frame.frame)} is missing from ${sourcePath}.`)
      }
    }

    const key = animationRuntimeKey(reference)
    if (this.scene.anims.exists(key)) this.scene.anims.remove(key)
    const frames = clip.frames.map((frame) => ({ key: textureKeys.get(frame.source)!, frame: frame.frame }))
    const animation = this.scene.anims.create({
      key,
      frames,
      frameRate: clip.frameRate ?? undefined,
      duration: clip.duration ?? undefined,
      delay: clip.delay,
      repeat: clip.repeat,
      repeatDelay: clip.repeatDelay,
      yoyo: clip.yoyo,
      skipMissedFrames: clip.skipMissedFrames
    })
    if (!animation) throw new Error(`Could not create animation ${reference.clipKey}.`)
    const first = frames[0]!
    return { key, firstTexture: first.key, firstFrame: first.frame }
  }

  private ensureAsset(relativePath: string): void {
    const key = assetTextureKey(relativePath)
    if (this.scene.textures.exists(key) || this.loadingAssets.has(key) || this.failedAssets.has(key)) return
    if (!isSupportedSceneImage(relativePath)) {
      this.failedAssets.add(key)
      this.onAssetError(`${relativePath} is not a supported Phase 2 image asset.`)
      return
    }
    this.loadingAssets.add(key)
    const absolutePath = joinProjectPath(this.projectRoot, relativePath)
    this.scene.load.image(key, window.editorApi.fileSystem.assetUrl(absolutePath))
    if (!this.scene.load.isLoading()) this.scene.load.start()
  }

  private handleFileComplete(key: string): void {
    if (!this.loadingAssets.delete(key)) return
    if (this.currentDocument) this.reconcile(this.currentDocument, this.currentSelection)
  }

  private handleFileError(file: Phaser.Loader.File): void {
    const key = String(file.key)
    if (!this.loadingAssets.delete(key)) return
    this.failedAssets.add(key)
    this.onAssetError(`Could not load ${key.replace(/^scene-asset:/, '')}.`)
    if (this.currentDocument) this.reconcile(this.currentDocument, this.currentSelection)
  }
}

function detachBeforeDestroy(object: ProjectedObject): void {
  if (object instanceof Phaser.GameObjects.Container) object.removeAll(false)
  object.parentContainer?.remove(object)
}

function assetTextureKey(relativePath: string): string {
  return `scene-asset:${relativePath}`
}

function joinProjectPath(root: string, relativePath: string): string {
  const separator = root.includes('\\') ? '\\' : '/'
  return `${root.replace(/[\\/]+$/, '')}${separator}${relativePath.replaceAll('/', separator)}`
}

function animationReferenceKey(reference: SceneAnimationReference): string {
  return `${reference.assetPath}#${reference.clipKey}`
}

function animationRuntimeKey(reference: SceneAnimationReference): string {
  return `scene-animation:${animationReferenceKey(reference)}`
}

function animationTextureKey(sourcePath: string): string {
  return `scene-animation-atlas:${sourcePath}`
}

function loadEditorImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`Could not load animation texture ${url}.`))
    image.src = url
  })
}
