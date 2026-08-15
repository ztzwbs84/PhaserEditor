import Phaser from 'phaser'
import { AcceptedInputCounters } from '../domain/accepted-input-counters'
import { RUN_COMPLETION_TARGET, RunModel } from '../domain/run-model'
import { GAME_EVENTS, type GameServices } from '../services'

const WORLD_WIDTH = 960
const WORLD_HEIGHT = 540
const PADDLE_START = { x: 480, y: 458 }
const BALL_REST_Y = 424
const BALL_SPEED = 650
const PADDLE_SPEED = 700
const BRICKS = [
  { x: 180, y: 164 },
  { x: 380, y: 164 },
  { x: 580, y: 164 },
  { x: 780, y: 164 }
] as const

type ArcadeContact = Phaser.Types.Physics.Arcade.GameObjectWithBody
  | Phaser.Physics.Arcade.Body
  | Phaser.Physics.Arcade.StaticBody
  | Phaser.Tilemaps.Tile

type ControlKeys = {
  left: Phaser.Input.Keyboard.Key[]
  right: Phaser.Input.Keyboard.Key[]
  launch: Phaser.Input.Keyboard.Key[]
}

export class GameScene extends Phaser.Scene {
  private readonly model = new RunModel()
  private paddle?: Phaser.Physics.Arcade.Image
  private ball?: Phaser.Physics.Arcade.Image
  private bricks?: Phaser.Physics.Arcade.StaticGroup
  private keys?: ControlKeys
  private ballAttached = true
  private pressureTargetX = 80
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
    if (this.model.phase !== 'playing' || !this.paddle) return
    const point = this.cameras.main.getWorldPoint(pointer.x, pointer.y)
    this.paddle.setX(Phaser.Math.Clamp(point.x, 76, WORLD_WIDTH - 76)).setVelocityX(0)
    this.attachBallToPaddle()
    if (this.launchAtNextBrick()) {
      this.acceptedInputs.accept('pointer:click')
      this.services.audio.playLaunch()
      this.publishSnapshot()
    }
  }

  constructor(private readonly services: GameServices) { super('game') }

  init(): void {
    this.model.reset()
    this.ballAttached = true
    this.pressureTargetX = 80
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
    this.add.image(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, 'court')
    this.physics.world.setBoundsCollision(true, true, true, false)
    this.physics.world.resume()

    this.bricks = this.physics.add.staticGroup()
    BRICKS.forEach(({ x, y }, index) => {
      const brick = this.bricks?.create(x, y, 'brick') as Phaser.Physics.Arcade.Image
      brick.setSize(132, 44).setDepth(4).setData('brickIndex', index)
    })
    this.paddle = this.physics.add.image(PADDLE_START.x, PADDLE_START.y, 'paddle')
      .setImmovable(true).setCollideWorldBounds(true).setDepth(5)
    ;(this.paddle.body as Phaser.Physics.Arcade.Body).setAllowGravity(false)
    this.ball = this.physics.add.image(PADDLE_START.x, BALL_REST_Y, 'ball')
      .setCircle(13).setBounce(1, 1).setCollideWorldBounds(true).setDepth(6)
    ;(this.ball.body as Phaser.Physics.Arcade.Body).setAllowGravity(false)

    this.physics.add.collider(this.ball, this.paddle, this.hitPaddle, undefined, this)
    this.physics.add.collider(this.ball, this.bricks, this.hitBrick, undefined, this)
    this.keys = this.createControlKeys()
    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown)
    this.services.bus.on(GAME_EVENTS.pause, this.onPauseRequest)
    this.services.bus.on(GAME_EVENTS.restart, this.onRestartRequest)
    this.game.events.on(Phaser.Core.Events.BLUR, this.onBlur)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this)
    this.publishSnapshot()
  }

  update(_time: number, delta: number): void {
    if (!this.keys || !this.paddle || !this.ball) return
    if (this.model.phase !== 'playing') {
      if (this.model.phase === 'game-over') this.finishRun()
      return
    }

    const movingLeft = this.keys.left.some((key) => key.isDown)
    const movingRight = this.keys.right.some((key) => key.isDown)
    this.paddle.setVelocityX(movingLeft === movingRight ? 0 : movingLeft ? -PADDLE_SPEED : PADDLE_SPEED)
    if (this.ballAttached) {
      this.attachBallToPaddle()
      if (movingLeft || movingRight) {
        this.pressureTargetX = movingLeft ? 80 : WORLD_WIDTH - 80
        this.launchAtNextBrick()
      }
    }

    if (this.keys.launch.some((key) => Phaser.Input.Keyboard.JustDown(key)) && this.launchAtNextBrick()) {
      this.acceptedInputs.accept('key:pulse')
      this.services.audio.playLaunch()
      this.publishSnapshot()
    }
    if (!this.ballAttached && this.ball.y > WORLD_HEIGHT + 24) this.dropBall()

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
    const keys = keyboard.addKeys('A,D,SPACE') as Record<string, Phaser.Input.Keyboard.Key>
    return { left: [keys.A, cursors.left], right: [keys.D, cursors.right], launch: [keys.SPACE] }
  }

  private activeBricks(): Phaser.Physics.Arcade.Image[] {
    return (this.bricks?.getChildren() ?? [])
      .map((child) => child as Phaser.Physics.Arcade.Image)
      .filter((brick) => brick.active)
  }

  private nextBrick(): Phaser.Physics.Arcade.Image | undefined {
    if (!this.ball) return undefined
    return this.activeBricks().reduce<Phaser.Physics.Arcade.Image | undefined>((closest, brick) => {
      if (!closest) return brick
      const distance = Phaser.Math.Distance.Squared(this.ball?.x ?? 0, this.ball?.y ?? 0, brick.x, brick.y)
      const closestDistance = Phaser.Math.Distance.Squared(this.ball?.x ?? 0, this.ball?.y ?? 0, closest.x, closest.y)
      return distance < closestDistance ? brick : closest
    }, undefined)
  }

  private launchAtNextBrick(): boolean {
    if (!this.ball || !this.paddle || this.model.phase !== 'playing') return false
    const target = this.nextBrick()
    if (!target) return false
    this.ballAttached = false
    this.ball.setData('returnX', this.paddle.x)
    this.physics.moveToObject(this.ball, target, BALL_SPEED)
    return true
  }

  private attachBallToPaddle(): void {
    if (!this.ballAttached || !this.ball || !this.paddle) return
    this.ball.setPosition(this.paddle.x, BALL_REST_Y).setVelocity(0, 0)
  }

  private hitPaddle(ballObject: ArcadeContact): void {
    const ball = ballObject as Phaser.Physics.Arcade.Image
    const body = ball.body as Phaser.Physics.Arcade.Body
    if (!ball.active || this.model.phase !== 'playing' || body.velocity.y <= 0) return
    const target = this.nextBrick()
    if (target) this.physics.moveToObject(ball, target, BALL_SPEED)
    this.services.audio.playPaddle()
  }

  private hitBrick(ballObject: ArcadeContact, brickObject: ArcadeContact): void {
    const ball = ballObject as Phaser.Physics.Arcade.Image
    const brick = brickObject as Phaser.Physics.Arcade.Image
    if (!ball.active || !brick.active || this.model.phase !== 'playing') return
    brick.disableBody(true, true)
    this.model.breakBrick()
    const snapshot = this.model.snapshot()
    this.services.audio.playBrick(snapshot.chain)
    if (!this.reducedMotion) this.cameras.main.flash(70, 102, 217, 239, true)
    if (snapshot.phase === 'playing') {
      const returnX = Number(ball.getData('returnX') ?? PADDLE_START.x)
      this.physics.moveTo(ball, returnX, PADDLE_START.y, BALL_SPEED)
    }
    this.publishSnapshot()
    if (snapshot.phase === 'game-over') this.finishRun()
  }

  private dropBall(): void {
    if (!this.ball || !this.paddle || !this.model.dropBall()) return
    this.services.audio.playDrop()
    if (!this.reducedMotion) this.cameras.main.shake(110, 0.006)
    if (this.model.phase === 'playing') {
      this.ballAttached = true
      this.ball.setPosition(this.paddle.x, BALL_REST_Y).setVelocity(0, 0)
      this.pressureTargetX = this.paddle.x < WORLD_WIDTH / 2 ? WORLD_WIDTH - 80 : 80
    }
    this.publishSnapshot()
    if (this.model.phase === 'game-over') this.finishRun()
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
    const paddleX = Math.round(this.paddle?.x ?? PADDLE_START.x)
    document.documentElement.dataset.playerPosition = `${paddleX},${PADDLE_START.y}`
    document.documentElement.dataset.qualityAuxiliaryName = 'round'
    document.documentElement.dataset.qualityAuxiliaryValue = String(snapshot.round)
    document.documentElement.dataset.qualityProgressName = 'bricks'
    document.documentElement.dataset.qualityProgress = String(snapshot.bricks)
    document.documentElement.dataset.qualityCompletionTarget = String(RUN_COMPLETION_TARGET)
    document.documentElement.dataset.qualityPressureName = 'balls'
    document.documentElement.dataset.qualityPressure = String(snapshot.balls)
    document.documentElement.dataset.qualityMaximumPressure = '3'
    document.documentElement.dataset.qualityPrimaryAction = 'break-brick'
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
    document.documentElement.dataset.qualityPrimaryTargets = JSON.stringify(this.activeBricks().map((brick) => [Math.round(brick.x), Math.round(brick.y)]))
    document.documentElement.dataset.qualityPressureTargets = JSON.stringify([[this.pressureTargetX, PADDLE_START.y]])
    document.documentElement.dataset.qualityWorldWidth = String(WORLD_WIDTH)
    document.documentElement.dataset.qualityWorldHeight = String(WORLD_HEIGHT)
    document.documentElement.dataset.qualityRestartPosition = `${PADDLE_START.x},${PADDLE_START.y}`
    document.documentElement.dataset.qualityTerminalKind = snapshot.terminalKind ?? ''
    document.documentElement.dataset.qualityTerminalReason = snapshot.outcome ?? ''
    this.services.publishSnapshot(snapshot)
  }

  private shutdown(): void {
    this.input.off(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown)
    this.services.bus.off(GAME_EVENTS.pause, this.onPauseRequest)
    this.services.bus.off(GAME_EVENTS.restart, this.onRestartRequest)
    this.game.events.off(Phaser.Core.Events.BLUR, this.onBlur)
  }
}
