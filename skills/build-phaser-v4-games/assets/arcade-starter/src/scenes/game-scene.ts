import Phaser from 'phaser'
import { AcceptedInputCounters } from '../domain/accepted-input-counters'
import { RUN_COMPLETION_TARGET, RunModel } from '../domain/run-model'
import { GAME_EVENTS, type GameServices } from '../services'

const WORLD_WIDTH = 960
const WORLD_HEIGHT = 540
const PLAYER_SPEED = 300

type ArcadeContact = Phaser.Types.Physics.Arcade.GameObjectWithBody
  | Phaser.Physics.Arcade.Body
  | Phaser.Physics.Arcade.StaticBody
  | Phaser.Tilemaps.Tile

type ControlKeys = {
  up: Phaser.Input.Keyboard.Key[]
  down: Phaser.Input.Keyboard.Key[]
  left: Phaser.Input.Keyboard.Key[]
  right: Phaser.Input.Keyboard.Key[]
}

export class GameScene extends Phaser.Scene {
  private readonly model = new RunModel()
  private player?: Phaser.Physics.Arcade.Sprite
  private shards?: Phaser.Physics.Arcade.Group
  private drones?: Phaser.Physics.Arcade.Group
  private keys?: ControlKeys
  private pointerTarget: Phaser.Math.Vector2 | null = null
  private publishAccumulator = 0
  private autoPaused = false
  private runFinished = false
  private readonly acceptedInputs = new AcceptedInputCounters(['pointer:click'] as const)
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
    if (this.model.phase !== 'playing') return
    this.acceptedInputs.accept('pointer:click')
    this.pointerTarget = new Phaser.Math.Vector2(pointer.worldX, pointer.worldY)
    this.publishSnapshot()
  }
  private readonly onPointerMove = (pointer: Phaser.Input.Pointer) => {
    if (pointer.isDown && this.model.phase === 'playing') this.pointerTarget?.set(pointer.worldX, pointer.worldY)
  }

  constructor(private readonly services: GameServices) {
    super('game')
  }

  init(): void {
    this.model.reset()
    this.publishAccumulator = 0
    this.pointerTarget = null
    this.autoPaused = false
    this.runFinished = false
    this.acceptedInputs.reset()
  }

  create(): void {
    this.services.beginRun()
    document.documentElement.dataset.gameState = 'playing'
    const previousRun = Number(document.documentElement.dataset.gameRun ?? '0')
    document.documentElement.dataset.gameRun = String(previousRun + 1)
    this.add.image(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, 'field')
    this.physics.world.resume()
    this.physics.world.setBounds(24, 24, WORLD_WIDTH - 48, WORLD_HEIGHT - 48)

    this.player = this.physics.add.sprite(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, 'player')
      .setCollideWorldBounds(true)
      .setCircle(20)
      .setDepth(5)
    this.shards = this.physics.add.group({ allowGravity: false })
    this.drones = this.physics.add.group({ allowGravity: false })
    this.keys = this.createControlKeys()

    this.physics.add.overlap(this.player, this.shards, this.collectShard, undefined, this)
    this.physics.add.overlap(this.player, this.drones, this.hitDrone, undefined, this)
    for (let index = 0; index < 5; index += 1) this.spawnShard()
    for (let index = 0; index < 3; index += 1) this.spawnDrone()

    this.time.addEvent({ delay: 2_200, loop: true, callback: this.spawnShard, callbackScope: this })
    this.time.addEvent({ delay: 5_000, loop: true, callback: this.spawnDrone, callbackScope: this })
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
      this.player.setVelocity(0, 0)
      if (this.model.phase === 'game-over') this.finishRun()
      return
    }
    this.updatePlayerVelocity()
    this.publishAccumulator += Math.min(delta, 100)
    if (this.publishAccumulator >= 100) {
      this.publishAccumulator = 0
      this.publishSnapshot()
    }
  }

  private createControlKeys(): ControlKeys {
    const keyboard = this.input.keyboard
    if (!keyboard) throw new Error('Keyboard input plugin is unavailable.')
    const cursors = keyboard.createCursorKeys()
    const wasd = keyboard.addKeys('W,A,S,D') as Record<string, Phaser.Input.Keyboard.Key>
    return {
      up: [wasd.W, cursors.up],
      down: [wasd.S, cursors.down],
      left: [wasd.A, cursors.left],
      right: [wasd.D, cursors.right]
    }
  }

  private updatePlayerVelocity(): void {
    if (!this.player || !this.keys) return
    if (this.pointerTarget) {
      const distance = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.pointerTarget.x, this.pointerTarget.y)
      if (distance < 12) {
        this.pointerTarget = null
        this.player.setVelocity(0, 0)
      } else {
        this.physics.moveToObject(this.player, this.pointerTarget, PLAYER_SPEED)
      }
      return
    }
    const horizontal = Number(this.keys.right.some((key) => key.isDown)) - Number(this.keys.left.some((key) => key.isDown))
    const vertical = Number(this.keys.down.some((key) => key.isDown)) - Number(this.keys.up.some((key) => key.isDown))
    const direction = new Phaser.Math.Vector2(horizontal, vertical).normalize().scale(PLAYER_SPEED)
    this.player.setVelocity(direction.x, direction.y)
  }

  private spawnShard(): void {
    if (this.model.phase !== 'playing' || !this.shards || this.shards.countActive(true) >= 9) return
    let x = 120
    let y = 120
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const candidateX = Phaser.Math.Between(70, WORLD_WIDTH - 70)
      const candidateY = Phaser.Math.Between(80, WORLD_HEIGHT - 60)
      if (!this.player || Phaser.Math.Distance.Between(this.player.x, this.player.y, candidateX, candidateY) >= 110) {
        x = candidateX
        y = candidateY
        break
      }
    }
    const shard = this.shards.create(
      x,
      y,
      'shard'
    ) as Phaser.Physics.Arcade.Sprite
    shard.setCircle(14).setAngularVelocity(55).setScale(0.9)
  }

  private spawnDrone(): void {
    if (this.model.phase !== 'playing' || !this.drones || this.drones.countActive(true) >= 7) return
    const drone = this.drones.create(
      Phaser.Math.RND.pick([55, WORLD_WIDTH - 55]),
      Phaser.Math.Between(85, WORLD_HEIGHT - 55),
      'drone'
    ) as Phaser.Physics.Arcade.Sprite
    drone.setCircle(18).setBounce(1).setCollideWorldBounds(true).setVelocity(
      Phaser.Math.Between(-190, 190) || 130,
      Phaser.Math.Between(-190, 190) || -130
    )
  }

  private collectShard(
    _player: ArcadeContact,
    shardObject: ArcadeContact
  ): void {
    const shard = shardObject as Phaser.Physics.Arcade.Sprite
    if (!shard.active) return
    shard.disableBody(true, true)
    const points = this.model.collect()
    this.services.audio.playPickup(this.model.snapshot().combo)
    this.showFloatText(shard.x, shard.y, `+${points}`, '#f7d36b')
    this.spawnShard()
    this.publishSnapshot()
  }

  private hitDrone(_player: ArcadeContact, droneObject: ArcadeContact): void {
    if (!this.player || !this.model.damage()) return
    const drone = droneObject as Phaser.Physics.Arcade.Sprite
    const angle = Phaser.Math.Angle.Between(this.player.x, this.player.y, drone.x, drone.y)
    const separation = new Phaser.Math.Vector2(Math.cos(angle), Math.sin(angle)).scale(54)
    drone.setPosition(
      Phaser.Math.Clamp(drone.x + separation.x, 50, WORLD_WIDTH - 50),
      Phaser.Math.Clamp(drone.y + separation.y, 80, WORLD_HEIGHT - 50)
    ).setVelocity(Math.cos(angle) * 260, Math.sin(angle) * 260)
    this.services.audio.playImpact()
    if (!this.reducedMotion) {
      this.cameras.main.shake(120, 0.006)
      this.player.setAlpha(0.35)
      this.tweens.add({ targets: this.player, alpha: 1, duration: 220, yoyo: true, repeat: 1 })
    }
    this.publishSnapshot()
    if (this.model.phase === 'game-over') this.finishRun()
  }

  private showFloatText(x: number, y: number, label: string, color: string): void {
    if (this.reducedMotion) return
    const text = this.add.text(x, y, label, {
      color,
      fontFamily: 'Arial, sans-serif',
      fontSize: '18px',
      fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(10)
    this.tweens.add({ targets: text, y: y - 32, alpha: 0, duration: 520, onComplete: () => text.destroy() })
  }

  private togglePause(): void {
    if (this.model.phase === 'game-over') return
    const phase = this.model.togglePause()
    if (phase === 'paused') this.physics.world.pause()
    else this.physics.world.resume()
    document.documentElement.dataset.gameState = phase
    this.services.bus.emit('ui:paused', phase === 'paused', this.autoPaused)
    this.autoPaused = false
    this.publishSnapshot()
  }

  private finishRun(): void {
    if (this.runFinished) return
    this.runFinished = true
    this.physics.world.pause()
    document.documentElement.dataset.gameState = 'game-over'
    this.publishSnapshot()
  }

  private publishSnapshot(): void {
    const snapshot = this.model.snapshot()
    if (this.player) {
      document.documentElement.dataset.playerPosition = `${Math.round(this.player.x)},${Math.round(this.player.y)}`
    }
    document.documentElement.dataset.score = String(snapshot.score)
    document.documentElement.dataset.shield = String(snapshot.shield)
    document.documentElement.dataset.remainingSeconds = String(snapshot.remainingSeconds)
    document.documentElement.dataset.qualityAuxiliaryName = 'time'
    document.documentElement.dataset.qualityAuxiliaryValue = String(snapshot.remainingSeconds)
    document.documentElement.dataset.shardPositions = this.objectPositions(this.shards)
    document.documentElement.dataset.dronePositions = this.objectPositions(this.drones)
    document.documentElement.dataset.qualityProgressName = 'score'
    document.documentElement.dataset.qualityProgress = String(snapshot.score)
    document.documentElement.dataset.qualityCompletionTarget = String(RUN_COMPLETION_TARGET)
    document.documentElement.dataset.qualityPressureName = 'shield'
    document.documentElement.dataset.qualityPressure = String(snapshot.shield)
    document.documentElement.dataset.qualityMaximumPressure = '3'
    document.documentElement.dataset.qualityPrimaryAction = 'collect-signal'
    document.documentElement.dataset.qualityInputPlan = JSON.stringify({
      schemaVersion: 1,
      primary: { actions: [{ type: 'pointer', mode: 'click' }] },
      pressure: {
        actions: [
          { type: 'pointer', mode: 'click', repeatMs: 200 },
          { type: 'navigate', mode: 'directional', holdMs: 140, repeatMs: 200 }
        ]
      }
    })
    document.documentElement.dataset.qualityAcceptedInputs = JSON.stringify(this.acceptedInputs.snapshot())
    document.documentElement.dataset.qualityPrimaryTargets = document.documentElement.dataset.shardPositions
    document.documentElement.dataset.qualityPressureTargets = this.objectPositions(this.drones)
    document.documentElement.dataset.qualityWorldWidth = String(WORLD_WIDTH)
    document.documentElement.dataset.qualityWorldHeight = String(WORLD_HEIGHT)
    document.documentElement.dataset.qualityRestartPosition = '480,270'
    document.documentElement.dataset.qualityTerminalKind = snapshot.terminalKind ?? ''
    document.documentElement.dataset.qualityTerminalReason = snapshot.outcome ?? ''
    this.services.publishSnapshot(snapshot)
  }

  private objectPositions(group?: Phaser.Physics.Arcade.Group): string {
    if (!group) return '[]'
    const positions = group.getChildren()
      .filter((child) => child.active)
      .map((child) => {
        const object = child as Phaser.Physics.Arcade.Sprite
        return [Math.round(object.x), Math.round(object.y)]
      })
    return JSON.stringify(positions)
  }

  private shutdown(): void {
    this.input.off(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown)
    this.input.off(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove)
    this.services.bus.off(GAME_EVENTS.pause, this.onPauseRequest)
    this.services.bus.off(GAME_EVENTS.restart, this.onRestartRequest)
    this.game.events.off(Phaser.Core.Events.BLUR, this.onBlur)
  }
}
