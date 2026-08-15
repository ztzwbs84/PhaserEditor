import Phaser from 'phaser'
import { AcceptedInputCounters } from '../domain/accepted-input-counters'
import { RUN_COMPLETION_TARGET, RunModel } from '../domain/run-model'
import { GAME_EVENTS, type GameServices } from '../services'

const WORLD_WIDTH = 960
const WORLD_HEIGHT = 540
const START = { x: 480, y: 442 }
const MAX_SPEED = 430
const KEY_ACCELERATION = 620
const STEERING_SPEED = 190
const CHECKPOINTS = [
  { x: 760, y: 370, rotation: Math.PI / 2 },
  { x: 800, y: 170, rotation: Math.PI / 2 },
  { x: 200, y: 170, rotation: Math.PI / 2 },
  { x: 200, y: 370, rotation: Math.PI / 2 }
] as const
const BARRIER = { x: 480, y: 352 }

type ArcadeContact = Phaser.Types.Physics.Arcade.GameObjectWithBody
  | Phaser.Physics.Arcade.Body
  | Phaser.Physics.Arcade.StaticBody
  | Phaser.Tilemaps.Tile

type ControlKeys = {
  up: Phaser.Input.Keyboard.Key[]
  down: Phaser.Input.Keyboard.Key[]
  left: Phaser.Input.Keyboard.Key[]
  right: Phaser.Input.Keyboard.Key[]
  boost: Phaser.Input.Keyboard.Key[]
}

type CheckpointView = {
  zone: Phaser.GameObjects.Zone
  marker: Phaser.GameObjects.Image
  label: Phaser.GameObjects.Text
}

export class GameScene extends Phaser.Scene {
  private readonly model = new RunModel()
  private racer?: Phaser.Physics.Arcade.Image
  private barrier?: Phaser.Physics.Arcade.Image
  private keys?: ControlKeys
  private checkpointViews: CheckpointView[] = []
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
    if (this.model.phase !== 'playing' || !this.racer) return
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y)
    if (this.boostToward(world.x, world.y)) {
      this.acceptedInputs.accept('pointer:click')
      this.services.audio.playBoost()
      this.publishSnapshot()
    }
  }

  constructor(private readonly services: GameServices) { super('game') }

  init(): void {
    this.model.reset()
    this.checkpointViews = []
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
    this.add.image(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, 'circuit')
    this.physics.world.setBounds(44, 40, WORLD_WIDTH - 88, WORLD_HEIGHT - 80)
    this.physics.world.resume()
    this.createCheckpoints()

    this.barrier = this.physics.add.staticImage(BARRIER.x, BARRIER.y, 'barrier').setDepth(4)
    this.barrier.setSize(76, 38)
    this.add.image(480, 270, 'barrier').setAlpha(0.48).setDepth(3)
    this.add.image(405, 270, 'barrier').setAlpha(0.38).setDepth(3)
    this.add.image(555, 270, 'barrier').setAlpha(0.38).setDepth(3)

    this.racer = this.physics.add.image(START.x, START.y, 'racer')
      .setAngle(-90).setCircle(22, 14, 1).setCollideWorldBounds(true).setDepth(7)
    const racerBody = this.racer.body as Phaser.Physics.Arcade.Body
    racerBody.setAllowGravity(false).setDrag(230, 230).setMaxSpeed(MAX_SPEED)
    this.keys = this.createControlKeys()

    for (const checkpoint of this.checkpointViews) {
      this.physics.add.overlap(this.racer, checkpoint.zone, this.reachCheckpoint, undefined, this)
    }
    this.physics.add.collider(this.racer, this.barrier, this.hitBarrier, undefined, this)
    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown)
    this.services.bus.on(GAME_EVENTS.pause, this.onPauseRequest)
    this.services.bus.on(GAME_EVENTS.restart, this.onRestartRequest)
    this.game.events.on(Phaser.Core.Events.BLUR, this.onBlur)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this)
    this.updateCheckpointViews()
    this.publishSnapshot()
  }

  update(_time: number, delta: number): void {
    if (!this.racer || !this.keys) return
    if (this.model.phase !== 'playing') {
      this.racer.setAcceleration(0, 0).setVelocity(0, 0)
      if (this.model.phase === 'game-over') this.finishRun()
      return
    }

    this.updateKeyboardDrive(delta)
    if (this.keys.boost.some((key) => Phaser.Input.Keyboard.JustDown(key))) {
      const target = this.currentCheckpoint()
      if (target && this.boostToward(target.x, target.y)) {
        this.acceptedInputs.accept('key:pulse')
        this.services.audio.playBoost()
        this.publishSnapshot()
      }
    }
    this.faceVelocity(delta)
    this.publishAccumulator += Math.min(delta, 100)
    if (this.publishAccumulator >= 80) {
      this.publishAccumulator = 0
      this.publishSnapshot()
    }
  }

  private createControlKeys(): ControlKeys {
    const keyboard = this.input.keyboard
    if (!keyboard) throw new Error('Keyboard input plugin is unavailable.')
    const cursors = keyboard.createCursorKeys()
    const keys = keyboard.addKeys('W,A,S,D,SPACE') as Record<string, Phaser.Input.Keyboard.Key>
    return {
      up: [keys.W, cursors.up],
      down: [keys.S, cursors.down],
      left: [keys.A, cursors.left],
      right: [keys.D, cursors.right],
      boost: [keys.SPACE]
    }
  }

  private createCheckpoints(): void {
    CHECKPOINTS.forEach((data, index) => {
      const zone = this.add.zone(data.x, data.y, 92, 76)
      this.physics.add.existing(zone, true)
      zone.setData('checkpointIndex', index)
      const marker = this.add.image(data.x, data.y, 'checkpoint').setRotation(data.rotation).setDepth(4)
      const label = this.add.text(data.x, data.y - 48, `GATE ${index + 1}`, {
        color: '#ffd166', fontFamily: 'Arial, sans-serif', fontSize: '12px', fontStyle: 'bold'
      }).setOrigin(0.5).setDepth(5)
      this.checkpointViews.push({ zone, marker, label })
    })
  }

  private updateKeyboardDrive(delta: number): void {
    if (!this.racer || !this.keys) return
    const steering = Number(this.keys.right.some((key) => key.isDown)) - Number(this.keys.left.some((key) => key.isDown))
    const throttle = Number(this.keys.up.some((key) => key.isDown)) - Number(this.keys.down.some((key) => key.isDown))
    if (steering !== 0) this.racer.angle += steering * STEERING_SPEED * Math.min(delta, 100) / 1_000
    if (throttle === 0) {
      this.racer.setAcceleration(0, 0)
      return
    }
    const direction = this.physics.velocityFromRotation(Phaser.Math.DegToRad(this.racer.angle), KEY_ACCELERATION * throttle)
    this.racer.setAcceleration(direction.x, direction.y)
  }

  private faceVelocity(delta: number): void {
    if (!this.racer) return
    const body = this.racer.body as Phaser.Physics.Arcade.Body
    if (body.speed < 20) return
    const targetAngle = Phaser.Math.RadToDeg(body.velocity.angle())
    this.racer.angle = Phaser.Math.Angle.RotateTo(
      Phaser.Math.DegToRad(this.racer.angle),
      Phaser.Math.DegToRad(targetAngle),
      Phaser.Math.DegToRad(260 * Math.min(delta, 100) / 1_000)
    ) * Phaser.Math.RAD_TO_DEG
  }

  private boostToward(x: number, y: number): boolean {
    if (!this.racer || this.model.phase !== 'playing') return false
    const direction = new Phaser.Math.Vector2(x - this.racer.x, y - this.racer.y)
    if (direction.lengthSq() < 16) return false
    direction.normalize().scale(MAX_SPEED)
    this.racer.setAcceleration(0, 0).setVelocity(direction.x, direction.y)
    return true
  }

  private currentCheckpoint() {
    return CHECKPOINTS[this.model.snapshot().checkpoints]
  }

  private reachCheckpoint(_racerObject: ArcadeContact, checkpointObject: ArcadeContact): void {
    const checkpointIndex = Number((checkpointObject as Phaser.GameObjects.Zone).getData('checkpointIndex'))
    if (checkpointIndex !== this.model.snapshot().checkpoints || this.model.phase !== 'playing') return
    this.model.clearCheckpoint()
    const snapshot = this.model.snapshot()
    this.services.audio.playGate(snapshot.streak)
    if (!this.reducedMotion) this.cameras.main.flash(75, 101, 214, 197, true)
    this.updateCheckpointViews()
    this.publishSnapshot()
    if (snapshot.phase === 'game-over') this.finishRun()
  }

  private hitBarrier(): void {
    if (!this.racer || !this.model.crash()) return
    this.services.audio.playCrash()
    if (!this.reducedMotion) this.cameras.main.shake(130, 0.008)
    this.resetRacer()
    this.publishSnapshot()
    if (this.model.phase === 'game-over') this.finishRun()
  }

  private resetRacer(): void {
    this.racer?.setPosition(START.x, START.y).setVelocity(0, 0).setAcceleration(0, 0).setAngle(-90)
  }

  private updateCheckpointViews(): void {
    const activeIndex = this.model.snapshot().checkpoints
    this.checkpointViews.forEach((view, index) => {
      const active = index === activeIndex
      const complete = index < activeIndex
      view.marker.setAlpha(active ? 1 : complete ? 0.24 : 0.45).setTint(active ? 0xffffff : complete ? 0x65d6c5 : 0x7c9198)
      view.label.setAlpha(active ? 1 : 0.38).setColor(active ? '#ffd166' : complete ? '#65d6c5' : '#a7c1c9')
    })
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
    const snapshot = this.model.snapshot()
    const target = this.currentCheckpoint()
    const body = this.racer?.body as Phaser.Physics.Arcade.Body | undefined
    if (this.racer) document.documentElement.dataset.playerPosition = `${Math.round(this.racer.x)},${Math.round(this.racer.y)}`
    document.documentElement.dataset.qualityAuxiliaryName = 'lap'
    document.documentElement.dataset.qualityAuxiliaryValue = String(snapshot.lap)
    document.documentElement.dataset.qualityProgressName = 'checkpoints'
    document.documentElement.dataset.qualityProgress = String(snapshot.checkpoints)
    document.documentElement.dataset.qualityCompletionTarget = String(RUN_COMPLETION_TARGET)
    document.documentElement.dataset.qualityPressureName = 'chassis'
    document.documentElement.dataset.qualityPressure = String(snapshot.chassis)
    document.documentElement.dataset.qualityMaximumPressure = '3'
    document.documentElement.dataset.qualityPrimaryAction = 'clear-checkpoint'
    document.documentElement.dataset.qualityInputPlan = JSON.stringify({
      schemaVersion: 1,
      primary: {
        actions: [
          { type: 'pointer', mode: 'click', repeatMs: 220 },
          { type: 'key', mode: 'pulse', key: ' ', code: 'Space', virtualKeyCode: 32, holdMs: 80, repeatMs: 220 }
        ],
        settleMs: 180
      },
      pressure: {
        actions: [{ type: 'navigate', mode: 'directional', holdMs: 320, repeatMs: 220 }]
      }
    })
    document.documentElement.dataset.qualityAcceptedInputs = JSON.stringify(this.acceptedInputs.snapshot())
    document.documentElement.dataset.qualityPrimaryTargets = target ? JSON.stringify([[target.x, target.y]]) : '[]'
    document.documentElement.dataset.qualityPressureTargets = JSON.stringify([[BARRIER.x, BARRIER.y]])
    document.documentElement.dataset.qualityWorldWidth = String(WORLD_WIDTH)
    document.documentElement.dataset.qualityWorldHeight = String(WORLD_HEIGHT)
    document.documentElement.dataset.qualityRestartPosition = `${START.x},${START.y}`
    document.documentElement.dataset.qualityTerminalKind = snapshot.terminalKind ?? ''
    document.documentElement.dataset.qualityTerminalReason = snapshot.outcome ?? ''
    this.services.publishSnapshot(snapshot, body?.speed ?? 0)
  }

  private shutdown(): void {
    this.input.off(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown)
    this.services.bus.off(GAME_EVENTS.pause, this.onPauseRequest)
    this.services.bus.off(GAME_EVENTS.restart, this.onRestartRequest)
    this.game.events.off(Phaser.Core.Events.BLUR, this.onBlur)
    this.checkpointViews = []
  }
}
