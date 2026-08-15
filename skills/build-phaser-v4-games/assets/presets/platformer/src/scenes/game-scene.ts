import Phaser from 'phaser'
import { AcceptedInputCounters } from '../domain/accepted-input-counters'
import { RUN_COMPLETION_TARGET, RunModel, type RunSnapshot } from '../domain/run-model'
import { GAME_EVENTS, type GameServices } from '../services'

const WORLD_WIDTH = 960
const WORLD_HEIGHT = 540
const GROUND_Y = 492
const PLAYER_SPEED = 285
const JUMP_SPEED = 545
const RESTART = { x: 120, y: 450 }
const RELIC_ROUTES = [
  { x: 270, y: 376 },
  { x: 500, y: 302 },
  { x: 725, y: 238 },
  { x: 850, y: 390 },
  { x: 610, y: 410 }
] as const
const SPIKES = [{ x: 440, y: 461 }, { x: 790, y: 461 }] as const

type ArcadeContact = Phaser.Types.Physics.Arcade.GameObjectWithBody
  | Phaser.Physics.Arcade.Body
  | Phaser.Physics.Arcade.StaticBody
  | Phaser.Tilemaps.Tile

type ControlKeys = {
  left: Phaser.Input.Keyboard.Key[]
  right: Phaser.Input.Keyboard.Key[]
  jump: Phaser.Input.Keyboard.Key[]
}

export class GameScene extends Phaser.Scene {
  private readonly model = new RunModel()
  private player?: Phaser.Physics.Arcade.Sprite
  private platforms?: Phaser.Physics.Arcade.StaticGroup
  private relics?: Phaser.Physics.Arcade.Group
  private spikes?: Phaser.Physics.Arcade.StaticGroup
  private keys?: ControlKeys
  private pointerTargetX: number | null = null
  private pointerJumpQueued = false
  private nextRelicIndex = 0
  private publishAccumulator = 0
  private autoPaused = false
  private finished = false
  private readonly acceptedInputs = new AcceptedInputCounters(['pointer:click', 'key:pulse'] as const)
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  private readonly onPauseRequest = () => this.togglePause()
  private readonly onRestartRequest = () => this.scene.restart()
  private readonly onBlur = () => {
    if (this.model.phase === 'playing') {
      this.autoPaused = true
      this.togglePause()
    }
  }
  private readonly onPointerDown = (pointer: Phaser.Input.Pointer) => {
    if (this.model.phase !== 'playing' || !this.player) return
    this.acceptedInputs.accept('pointer:click')
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y)
    this.pointerTargetX = Phaser.Math.Clamp(world.x, 32, WORLD_WIDTH - 32)
    this.pointerJumpQueued = world.y < this.player.y - 28
    this.publishSnapshot()
  }
  private readonly onPointerMove = (pointer: Phaser.Input.Pointer) => {
    if (!pointer.isDown || this.model.phase !== 'playing') return
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y)
    this.pointerTargetX = Phaser.Math.Clamp(world.x, 32, WORLD_WIDTH - 32)
    if (this.player && world.y < this.player.y - 28) this.pointerJumpQueued = true
  }

  constructor(private readonly services: GameServices) { super('game') }

  init(): void {
    this.model.reset()
    this.pointerTargetX = null
    this.pointerJumpQueued = false
    this.nextRelicIndex = 0
    this.publishAccumulator = 0
    this.autoPaused = false
    this.finished = false
    this.acceptedInputs.reset()
  }

  create(): void {
    this.services.beginRun()
    document.documentElement.dataset.gameState = 'playing'
    const previousRun = Number(document.documentElement.dataset.gameRun ?? '0')
    document.documentElement.dataset.gameRun = String(previousRun + 1)
    this.add.image(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, 'skyline')
    this.physics.world.resume()
    this.physics.world.setBounds(24, 24, WORLD_WIDTH - 48, WORLD_HEIGHT - 24)
    this.createCourse()
    this.player = this.physics.add.sprite(RESTART.x, RESTART.y, 'runner')
      .setCollideWorldBounds(true)
      .setSize(34, 54)
      .setMaxVelocity(PLAYER_SPEED, 760)
      .setDepth(8)
    this.relics = this.physics.add.group({ allowGravity: false, immovable: true })
    this.keys = this.createControlKeys()
    this.physics.add.collider(this.player, this.platforms!)
    this.physics.add.overlap(this.player, this.relics, this.collectRelic, undefined, this)
    this.physics.add.overlap(this.player, this.spikes!, this.hitSpike, undefined, this)
    this.spawnRelic()

    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown)
    this.input.on(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove)
    this.services.bus.on(GAME_EVENTS.pause, this.onPauseRequest)
    this.services.bus.on(GAME_EVENTS.restart, this.onRestartRequest)
    this.game.events.on(Phaser.Core.Events.BLUR, this.onBlur)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this)
    this.publishSnapshot()
  }

  update(_time: number, delta: number): void {
    if (!this.player || !this.keys) return
    this.model.update(delta)
    if (this.model.phase !== 'playing') {
      this.player.setVelocityX(0)
      if (this.model.phase === 'game-over') this.finishRun()
      return
    }
    this.updateMovement()
    this.publishAccumulator += Math.min(delta, 100)
    if (this.publishAccumulator >= 80) {
      this.publishAccumulator = 0
      this.publishSnapshot()
    }
  }

  private createCourse(): void {
    this.platforms = this.physics.add.staticGroup()
    this.addPlatform(WORLD_WIDTH / 2, GROUND_Y, WORLD_WIDTH - 48)
    this.addPlatform(285, 421, 156)
    this.addPlatform(515, 345, 168)
    this.addPlatform(735, 278, 166)
    this.addPlatform(850, 435, 132)
    this.spikes = this.physics.add.staticGroup()
    for (const position of SPIKES) {
      const spike = this.spikes.create(position.x, position.y, 'spike') as Phaser.Physics.Arcade.Image
      spike.setSize(52, 30).setDepth(6).refreshBody()
    }
  }

  private addPlatform(x: number, y: number, width: number): void {
    const platform = this.platforms!.create(x, y, 'platform') as Phaser.Physics.Arcade.Image
    platform.setDisplaySize(width, 30).setDepth(3).refreshBody()
  }

  private createControlKeys(): ControlKeys {
    const keyboard = this.input.keyboard
    if (!keyboard) throw new Error('Keyboard input plugin is unavailable.')
    const cursors = keyboard.createCursorKeys()
    const wasd = keyboard.addKeys('W,A,D,SPACE') as Record<string, Phaser.Input.Keyboard.Key>
    return {
      left: [wasd.A, cursors.left],
      right: [wasd.D, cursors.right],
      jump: [wasd.W, wasd.SPACE, cursors.up]
    }
  }

  private updateMovement(): void {
    if (!this.player || !this.keys) return
    const left = this.keys.left.some((key) => key.isDown)
    const right = this.keys.right.some((key) => key.isDown)
    let direction = Number(right) - Number(left)
    if (direction !== 0) {
      this.pointerTargetX = null
    } else if (this.pointerTargetX !== null) {
      const difference = this.pointerTargetX - this.player.x
      if (Math.abs(difference) < 9) this.pointerTargetX = null
      else direction = Math.sign(difference)
    }
    this.player.setVelocityX(direction * PLAYER_SPEED).setFlipX(direction < 0)

    const body = this.player.body as Phaser.Physics.Arcade.Body
    const grounded = body.blocked.down || body.touching.down
    const keyboardJump = this.keys.jump.some((key) => Phaser.Input.Keyboard.JustDown(key))
    if (grounded && keyboardJump) {
      this.acceptedInputs.accept('key:pulse')
      this.publishSnapshot()
    }
    if (grounded && (keyboardJump || this.pointerJumpQueued)) {
      this.player.setVelocityY(-JUMP_SPEED)
      this.pointerJumpQueued = false
      this.services.audio.playJump()
    }
  }

  private spawnRelic(): void {
    if (!this.relics || this.model.phase !== 'playing') return
    const position = RELIC_ROUTES[this.nextRelicIndex % RELIC_ROUTES.length]
    this.nextRelicIndex += 1
    const relic = this.relics.create(position.x, position.y, 'relic') as Phaser.Physics.Arcade.Image
    relic.setCircle(18, 4, 4).setDepth(7)
    if (!this.reducedMotion) this.tweens.add({ targets: relic, y: position.y - 7, duration: 650, yoyo: true, repeat: -1, ease: 'Sine.inOut' })
  }

  private collectRelic(_player: ArcadeContact, relicObject: ArcadeContact): void {
    const relic = relicObject as Phaser.Physics.Arcade.Image
    const heightBonus = Math.max(0, GROUND_Y - relic.y) / 2
    relic.disableBody(true, true)
    this.model.collect(heightBonus)
    this.services.audio.playRelic(this.model.snapshot().chain)
    this.cameras.main.flash(90, 255, 209, 102, true)
    this.spawnRelic()
    this.publishSnapshot()
  }

  private hitSpike(): void {
    if (!this.player) return
    const result = this.model.damage()
    if (!result.applied) return
    this.services.audio.playImpact()
    if (!this.reducedMotion) this.cameras.main.shake(120, 0.006)
    this.player.setTint(0xef476f)
    this.time.delayedCall(180, () => this.player?.clearTint())
    if (!result.ended) {
      this.player.setPosition(360, RESTART.y).setVelocity(0, 0)
      this.pointerTargetX = null
      this.pointerJumpQueued = false
    }
    this.publishSnapshot()
    if (result.ended) this.finishRun()
  }

  private togglePause(): void {
    if (this.model.phase === 'game-over') return
    const phase = this.model.togglePause()
    if (phase === 'paused') this.physics.world.pause()
    else this.physics.world.resume()
    document.documentElement.dataset.gameState = phase
    this.services.bus.emit(GAME_EVENTS.paused, phase === 'paused', this.autoPaused)
    this.autoPaused = false
    this.publishSnapshot()
  }

  private finishRun(): void {
    if (this.finished) return
    this.finished = true
    this.physics.world.pause()
    document.documentElement.dataset.gameState = 'game-over'
    this.services.audio.playEnd(this.model.snapshot().terminalKind === 'success')
    this.publishSnapshot()
  }

  private publishSnapshot(): void {
    const snapshot: RunSnapshot = this.model.snapshot()
    const relic = this.relics?.getFirstAlive() as Phaser.Physics.Arcade.Image | null
    const heightMeters = this.player ? Math.max(0, Math.round((GROUND_Y - this.player.y) / 4)) : 0
    if (this.player) document.documentElement.dataset.playerPosition = `${Math.round(this.player.x)},${Math.round(this.player.y)}`
    document.documentElement.dataset.remainingSeconds = String(snapshot.remainingSeconds)
    document.documentElement.dataset.qualityAuxiliaryName = 'time'
    document.documentElement.dataset.qualityAuxiliaryValue = String(snapshot.remainingSeconds)
    document.documentElement.dataset.qualityProgressName = 'relics'
    document.documentElement.dataset.qualityProgress = String(snapshot.relics)
    document.documentElement.dataset.qualityCompletionTarget = String(RUN_COMPLETION_TARGET)
    document.documentElement.dataset.qualityPressureName = 'hearts'
    document.documentElement.dataset.qualityPressure = String(snapshot.hearts)
    document.documentElement.dataset.qualityMaximumPressure = '3'
    document.documentElement.dataset.qualityPrimaryAction = 'jump-to-relic'
    document.documentElement.dataset.qualityInputPlan = JSON.stringify({
      schemaVersion: 1,
      primary: {
        actions: [
          { type: 'pointer', mode: 'click' },
          { type: 'key', mode: 'pulse', key: ' ', code: 'Space', virtualKeyCode: 32, holdMs: 80, repeatMs: 300 }
        ],
        settleMs: 900
      },
      pressure: {
        actions: [
          { type: 'pointer', mode: 'click', repeatMs: 200 },
          { type: 'navigate', mode: 'directional', holdMs: 140, repeatMs: 200 },
          {
            type: 'key',
            mode: 'pulse',
            key: ' ',
            code: 'Space',
            virtualKeyCode: 32,
            holdMs: 80,
            condition: { horizontalDistanceGreaterThan: 160 }
          }
        ]
      }
    })
    document.documentElement.dataset.qualityAcceptedInputs = JSON.stringify(this.acceptedInputs.snapshot())
    document.documentElement.dataset.qualityPrimaryTargets = relic ? JSON.stringify([[Math.round(relic.x), Math.round(relic.y)]]) : '[]'
    document.documentElement.dataset.qualityPressureTargets = JSON.stringify(SPIKES.map(({ x, y }) => [x - 30, y]))
    document.documentElement.dataset.qualityWorldWidth = String(WORLD_WIDTH)
    document.documentElement.dataset.qualityWorldHeight = String(WORLD_HEIGHT)
    document.documentElement.dataset.qualityRestartPosition = `${RESTART.x},${RESTART.y}`
    document.documentElement.dataset.qualityTerminalKind = snapshot.terminalKind ?? ''
    document.documentElement.dataset.qualityTerminalReason = snapshot.outcome ?? ''
    this.services.publishSnapshot(snapshot, heightMeters)
  }

  private shutdown(): void {
    this.input.off(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown)
    this.input.off(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove)
    this.services.bus.off(GAME_EVENTS.pause, this.onPauseRequest)
    this.services.bus.off(GAME_EVENTS.restart, this.onRestartRequest)
    this.game.events.off(Phaser.Core.Events.BLUR, this.onBlur)
  }
}
