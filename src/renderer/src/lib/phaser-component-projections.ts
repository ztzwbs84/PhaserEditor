import Phaser from 'phaser'
import type { SceneComponentDefinition, ComponentProjectionContext, ComponentProjectionHandle } from './scene-components'
import { sceneComponentRegistry } from './scene-components'

const matterRuntime = (Phaser.Physics.Matter as unknown as {
  Matter: {
    Bodies: {
      circle(x: number, y: number, radius: number, options?: MatterJS.IBodyDefinition): MatterJS.BodyType
      rectangle(x: number, y: number, width: number, height: number, options?: MatterJS.IBodyDefinition): MatterJS.BodyType
      fromVertices(x: number, y: number, vertices: MatterJS.Vector[] | MatterJS.Vector[][], options?: MatterJS.IBodyDefinition, flagInternal?: boolean): MatterJS.BodyType | MatterJS.BodyType[]
    }
  }
}).Matter

let installed = false

export function installPhaserComponentProjections(): void {
  if (installed) return
  installed = true
  attach('phaser.camera', createCameraProjection)
  attach('phaser.arcade-body', createArcadeProjection)
  attach('phaser.matter-body', createMatterProjection)
  attach('phaser.particle-emitter', createParticleProjection)
  attach('phaser.tween', createTweenProjection)
}

function attach(type: string, createProjection: NonNullable<SceneComponentDefinition['createProjection']>): void {
  const definition = sceneComponentRegistry.get(type)
  if (definition) definition.createProjection = createProjection
}

function createCameraProjection(data: Record<string, unknown>, context: ComponentProjectionContext): ComponentProjectionHandle {
  const scene = context.scene as Phaser.Scene
  const camera = scene.cameras.add(0, 0, 1, 1, false)
  const viewportOverlay = scene.add.graphics().setScrollFactor(0).setDepth(9_980)
  const boundsOverlay = scene.add.graphics().setDepth(9_979)
  camera.ignore([viewportOverlay, boundsOverlay])
  let active = true
  return {
    update(next, nextContext) {
      const viewport = objectValue(next.viewport)
      const scroll = objectValue(next.scroll)
      const bounds = nullableObjectValue(next.bounds)
      camera.setViewport(numberValue(viewport.x), numberValue(viewport.y), numberValue(viewport.width, 1), numberValue(viewport.height, 1))
      camera.setScroll(numberValue(scroll.x), numberValue(scroll.y))
      camera.setZoom(numberValue(next.zoom, 1))
      camera.setRotation(numberValue(next.rotation) * Math.PI / 180)
      camera.setBackgroundColor(String(next.backgroundColor ?? '#000000'))
      if (bounds) camera.setBounds(numberValue(bounds.x), numberValue(bounds.y), numberValue(bounds.width, 1), numberValue(bounds.height, 1))
      else camera.removeBounds()
      const target = typeof next.followTargetId === 'string' ? nextContext.resolveGameObject(next.followTargetId) as Phaser.GameObjects.GameObject | null : null
      if (target) {
        const lerp = objectValue(next.followLerp)
        camera.startFollow(target, false, numberValue(lerp.x, 1), numberValue(lerp.y, 1))
      } else camera.stopFollow()
      viewportOverlay.clear().lineStyle(2, 0x63a9d1, 0.95).strokeRect(numberValue(viewport.x), numberValue(viewport.y), numberValue(viewport.width, 1), numberValue(viewport.height, 1))
      boundsOverlay.clear()
      if (bounds) boundsOverlay.lineStyle(1.5, 0xe1b351, 0.9).strokeRect(numberValue(bounds.x), numberValue(bounds.y), numberValue(bounds.width, 1), numberValue(bounds.height, 1))
      viewportOverlay.setVisible(active)
      boundsOverlay.setVisible(active)
      camera.setVisible(active)
    },
    setActive(value) { active = value; camera.setVisible(value); viewportOverlay.setVisible(value); boundsOverlay.setVisible(value) },
    destroy() { scene.cameras.remove(camera); viewportOverlay.destroy(); boundsOverlay.destroy() }
  }
}

function createArcadeProjection(data: Record<string, unknown>, context: ComponentProjectionContext): ComponentProjectionHandle {
  const scene = context.scene as Phaser.Scene
  const gameObject = context.gameObject as Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Transform
  const overlay = scene.add.graphics().setDepth(9_970)
  let bodyType = ''
  let active = true
  const disableBody = (): void => { if ('body' in gameObject && gameObject.body) scene.physics.world.disable(gameObject) }
  return {
    update(next) {
      const nextBodyType = String(next.bodyType)
      if (bodyType !== nextBodyType || !('body' in gameObject) || !gameObject.body) {
        disableBody()
        scene.physics.add.existing(gameObject, nextBodyType === 'static')
        bodyType = nextBodyType
      }
      const body = (gameObject as Phaser.Types.Physics.Arcade.GameObjectWithBody).body
      const offset = objectValue(next.offset)
      if (String(next.shape) === 'circle') body.setCircle(numberValue(next.radius, 1), numberValue(offset.x), numberValue(offset.y))
      else { body.setSize(numberValue(next.width, 1), numberValue(next.height, 1), false); body.setOffset(numberValue(offset.x), numberValue(offset.y)) }
      body.enable = active
      if (body instanceof Phaser.Physics.Arcade.Body) {
        const velocity = objectValue(next.velocity)
        const gravity = objectValue(next.gravity)
        const bounce = objectValue(next.bounce)
        body.setVelocity(numberValue(velocity.x), numberValue(velocity.y))
        body.setGravity(numberValue(gravity.x), numberValue(gravity.y))
        body.setBounce(numberValue(bounce.x), numberValue(bounce.y))
        body.setAllowGravity(Boolean(next.allowGravity))
        body.setImmovable(Boolean(next.immovable))
        body.setCollideWorldBounds(Boolean(next.collideWorldBounds))
        body.setCollisionCategory(numberValue(next.collisionCategory, 1))
        body.setCollidesWith(numberValue(next.collisionMask))
        body.moves = false
      }
      drawBodyOverlay(overlay, gameObject, next, 0x64b66b, active)
    },
    setActive(value) { active = value; overlay.setVisible(value); if ('body' in gameObject && gameObject.body) (gameObject.body as Phaser.Physics.Arcade.Body).enable = value },
    destroy() { disableBody(); overlay.destroy() }
  }
}

function createMatterProjection(data: Record<string, unknown>, context: ComponentProjectionContext): ComponentProjectionHandle {
  const scene = context.scene as Phaser.Scene
  const gameObject = context.gameObject as Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Transform
  const overlay = scene.add.graphics().setDepth(9_969)
  let body: MatterJS.BodyType | null = null
  let signature = ''
  let active = true
  return {
    update(next) {
      const nextSignature = JSON.stringify(next)
      if (nextSignature !== signature) {
        const position = worldPosition(gameObject)
        const options: MatterJS.IBodyDefinition = {
          isStatic: next.bodyType === 'static',
          isSensor: Boolean(next.sensor),
          mass: numberValue(next.mass, 1),
          restitution: numberValue(next.restitution),
          friction: numberValue(next.friction, 0.1),
          frictionAir: numberValue(next.frictionAir, 0.01),
          collisionFilter: { category: numberValue(next.collisionCategory, 1), mask: numberValue(next.collisionMask), group: 0 }
        }
        if (next.shape === 'circle') body = matterRuntime.Bodies.circle(position.x, position.y, numberValue(next.radius, 1), options)
        else if (next.shape === 'polygon') body = matterRuntime.Bodies.fromVertices(position.x, position.y, next.vertices as MatterJS.Vector[], options, true) as MatterJS.BodyType
        else body = matterRuntime.Bodies.rectangle(position.x, position.y, numberValue(next.width, 1), numberValue(next.height, 1), options)
        gameObject.setData('__phaserEditorMatterBody', body)
        signature = nextSignature
      }
      drawBodyOverlay(overlay, gameObject, next, 0xd07a61, active)
    },
    setActive(value) { active = value; overlay.setVisible(value) },
    destroy() { gameObject.setData('__phaserEditorMatterBody', null); body = null; overlay.destroy() }
  }
}

function createParticleProjection(data: Record<string, unknown>, context: ComponentProjectionContext): ComponentProjectionHandle {
  const scene = context.scene as Phaser.Scene
  const gameObject = context.gameObject as Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Transform
  let emitter: Phaser.GameObjects.Particles.ParticleEmitter | null = null
  let signature = ''
  let active = true
  const rebuild = (next: Record<string, unknown>, nextContext: ComponentProjectionContext): void => {
    const texture = nextContext.ensureTexture(String(next.texture ?? ''))
    if (texture.state !== 'ready') { emitter?.destroy(); emitter = null; return }
    emitter?.destroy()
    emitter = scene.add.particles(0, 0, texture.key, {
      frame: next.frame as string | number | undefined,
      frequency: numberValue(next.frequency),
      quantity: numberValue(next.quantity, 1),
      lifespan: numberValue(next.lifespan, 1000),
      speed: numberValue(next.speed),
      angle: { min: numberValue(next.angleMin), max: numberValue(next.angleMax, 360) },
      scale: { start: numberValue(next.scaleStart, 1), end: numberValue(next.scaleEnd) },
      alpha: { start: numberValue(next.alphaStart, 1), end: numberValue(next.alphaEnd) },
      gravityX: numberValue(objectValue(next.gravity).x),
      gravityY: numberValue(objectValue(next.gravity).y),
      maxAliveParticles: Math.min(2_000, numberValue(next.maxAliveParticles, 200))
    })
    emitter.startFollow(gameObject)
    emitter.setDepth(9_000)
    if (!active) emitter.pause()
  }
  return {
    update(next, nextContext) {
      const nextSignature = JSON.stringify(next)
      if (nextSignature !== signature || !emitter) { signature = nextSignature; rebuild(next, nextContext) }
    },
    setActive(value) { active = value; if (emitter) value ? emitter.resume() : emitter.pause() },
    destroy() { emitter?.destroy(); emitter = null }
  }
}

function createTweenProjection(data: Record<string, unknown>, context: ComponentProjectionContext): ComponentProjectionHandle {
  const scene = context.scene as Phaser.Scene
  let tween: Phaser.Tweens.Tween | null = null
  let signature = ''
  let active = true
  const rebuild = (next: Record<string, unknown>, nextContext: ComponentProjectionContext): void => {
    tween?.destroy()
    tween = null
    if (!next.preview) return
    const target = typeof next.targetId === 'string' ? nextContext.resolveGameObject(next.targetId) : nextContext.gameObject
    if (!target) return
    const property = String(next.property)
    const config: Phaser.Types.Tweens.TweenBuilderConfig = {
      targets: target,
      duration: numberValue(next.duration, 1000),
      delay: numberValue(next.delay),
      ease: String(next.ease ?? 'Power2'),
      repeat: numberValue(next.repeat),
      yoyo: Boolean(next.yoyo),
      persist: true,
      [property]: { from: numberValue(next.from), to: numberValue(next.to) }
    }
    tween = scene.tweens.add(config)
    if (!active) tween.pause()
  }
  return {
    update(next, nextContext) {
      const nextSignature = JSON.stringify(next)
      if (nextSignature !== signature) { signature = nextSignature; rebuild(next, nextContext) }
    },
    setActive(value) { active = value; if (tween) value ? tween.resume() : tween.pause() },
    destroy() { tween?.destroy(); tween = null }
  }
}

function drawBodyOverlay(overlay: Phaser.GameObjects.Graphics, gameObject: Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Transform, data: Record<string, unknown>, color: number, visible: boolean): void {
  const position = worldPosition(gameObject)
  const offset = objectValue(data.offset)
  overlay.clear().lineStyle(1.5, color, 0.95).setVisible(visible)
  if (data.shape === 'circle') overlay.strokeCircle(position.x + numberValue(offset.x), position.y + numberValue(offset.y), numberValue(data.radius, 1))
  else if (data.shape === 'polygon' && Array.isArray(data.vertices)) {
    const points = (data.vertices as Array<{ x: number; y: number }>).map((point) => new Phaser.Math.Vector2(position.x + point.x + numberValue(offset.x), position.y + point.y + numberValue(offset.y)))
    if (points.length > 2) overlay.strokePoints(points, true)
  } else overlay.strokeRect(position.x + numberValue(offset.x) - numberValue(data.width, 1) / 2, position.y + numberValue(offset.y) - numberValue(data.height, 1) / 2, numberValue(data.width, 1), numberValue(data.height, 1))
}

function worldPosition(gameObject: Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Transform): { x: number; y: number } {
  const matrix = gameObject.getWorldTransformMatrix()
  return { x: matrix.tx, y: matrix.ty }
}

function objectValue(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {} }
function nullableObjectValue(value: unknown): Record<string, unknown> | null { return value === null ? null : objectValue(value) }
function numberValue(value: unknown, fallback = 0): number { return typeof value === 'number' && Number.isFinite(value) ? value : fallback }
