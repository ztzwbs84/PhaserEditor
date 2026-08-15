import Phaser from 'phaser'
import { AcceptedInputCounters } from '../domain/accepted-input-counters'
import { RUN_COMPLETION_TARGET, RunModel } from '../domain/run-model'
import { GAME_EVENTS, type GameServices } from '../services'

const WORLD_WIDTH = 960
const WORLD_HEIGHT = 540
const DEFENSE_Y = 472
const RESTART = { x: 480, y: 454 }
const PLAYER_SPEED = 320
const BOLT_SPEED = 760

type ArcadeContact = Phaser.Types.Physics.Arcade.GameObjectWithBody
  | Phaser.Physics.Arcade.Body
  | Phaser.Physics.Arcade.StaticBody
  | Phaser.Tilemaps.Tile

type ControlKeys = {
  up: Phaser.Input.Keyboard.Key[]
  down: Phaser.Input.Keyboard.Key[]
  left: Phaser.Input.Keyboard.Key[]
  right: Phaser.Input.Keyboard.Key[]
  fire: Phaser.Input.Keyboard.Key[]
}

export class GameScene extends Phaser.Scene {
  private readonly model = new RunModel()
  private player?: Phaser.Physics.Arcade.Sprite
  private enemies?: Phaser.Physics.Arcade.Group
  private bolts?: Phaser.Physics.Arcade.Group
  private keys?: ControlKeys
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
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y)
    if (this.fireBolt(world.x, world.y)) {
      this.acceptedInputs.accept('pointer:click')
      this.publishSnapshot()
    }
  }

  constructor(private readonly services: GameServices) { super('game') }

  init(): void {
    this.model.reset()
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
    this.add.image(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, 'starfield')
    this.physics.world.resume()
    this.physics.world.setBounds(24, 24, WORLD_WIDTH - 48, WORLD_HEIGHT - 42)
    this.player = this.physics.add.sprite(RESTART.x, RESTART.y, 'fighter')
      .setCollideWorldBounds(true)
      .setSize(42, 48)
      .setDepth(8)
    this.enemies = this.physics.add.group({ allowGravity: false })
    this.bolts = this.physics.add.group({ allowGravity: false })
    this.keys = this.createControlKeys()
    this.physics.add.overlap(this.bolts, this.enemies, this.hitEnemy, undefined, this)
    this.physics.add.overlap(this.player, this.enemies, this.collideEnemy, undefined, this)
    this.spawnEnemy()

    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown)
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
    this.updateMovement()
    if (this.keys.fire.some((key) => Phaser.Input.Keyboard.JustDown(key)) && this.fireBolt(this.player.x, 20)) {
      this.acceptedInputs.accept('key:pulse')
      this.publishSnapshot()
    }
    this.updateObjects()
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
    const wasd = keyboard.addKeys('W,A,S,D,SPACE') as Record<string, Phaser.Input.Keyboard.Key>
    return {
      up: [wasd.W, cursors.up],
      down: [wasd.S, cursors.down],
      left: [wasd.A, cursors.left],
      right: [wasd.D, cursors.right],
      fire: [wasd.SPACE]
    }
  }

  private updateMovement(): void {
    if (!this.player || !this.keys) return
    const horizontal = Number(this.keys.right.some((key) => key.isDown)) - Number(this.keys.left.some((key) => key.isDown))
    const vertical = Number(this.keys.down.some((key) => key.isDown)) - Number(this.keys.up.some((key) => key.isDown))
    const direction = new Phaser.Math.Vector2(horizontal, vertical).normalize().scale(PLAYER_SPEED)
    this.player.setVelocity(direction.x, direction.y)
  }

  private fireBolt(targetX: number, targetY: number): boolean {
    if (!this.player || !this.bolts) return false
    const direction = new Phaser.Math.Vector2(targetX - this.player.x, targetY - this.player.y)
    if (direction.lengthSq() < 1) direction.set(0, -1)
    direction.normalize().scale(BOLT_SPEED)
    const bolt = this.bolts.create(this.player.x, this.player.y - 30, 'bolt') as Phaser.Physics.Arcade.Image
    bolt.setSize(12, 28).setVelocity(direction.x, direction.y).setDepth(7)
    bolt.setRotation(Math.atan2(direction.y, direction.x) + Math.PI / 2)
    this.services.audio.playShot()
    return true
  }

  private spawnEnemy(): void {
    if (!this.enemies || this.model.phase !== 'playing') return
    const x = this.player?.x ?? RESTART.x
    const enemy = this.enemies.create(x, 138, 'raider') as Phaser.Physics.Arcade.Sprite
    enemy.setSize(48, 38).setVelocity(0, 42 + this.model.snapshot().wave * 8).setDepth(6).setData('armor', 2)
    if (!this.reducedMotion) this.tweens.add({ targets: enemy, angle: { from: -4, to: 4 }, duration: 520, yoyo: true, repeat: -1 })
  }

  private hitEnemy(boltObject: ArcadeContact, enemyObject: ArcadeContact): void {
    const bolt = boltObject as Phaser.Physics.Arcade.Image
    const enemy = enemyObject as Phaser.Physics.Arcade.Sprite
    if (!bolt.active || !enemy.active || this.model.phase !== 'playing') return
    bolt.disableBody(true, true)
    const armor = Math.max(0, Number(enemy.getData('armor') ?? 1) - 1)
    enemy.setData('armor', armor)
    this.services.audio.playHit()
    if (armor > 0) {
      enemy.setTint(0xffcb77)
      this.time.delayedCall(90, () => enemy.active && enemy.clearTint())
      return
    }
    enemy.disableBody(true, true)
    this.model.destroyRaider()
    const snapshot = this.model.snapshot()
    this.services.audio.playDestroy(snapshot.chain)
    if (!this.reducedMotion) this.cameras.main.flash(80, 85, 214, 190, true)
    if (snapshot.phase === 'playing') this.spawnEnemy()
    this.publishSnapshot()
    if (snapshot.phase === 'game-over') this.finishRun()
  }

  private collideEnemy(_playerObject: ArcadeContact, enemyObject: ArcadeContact): void {
    const enemy = enemyObject as Phaser.Physics.Arcade.Sprite
    if (!enemy.active) return
    this.applyDamage(enemy)
  }

  private updateObjects(): void {
    for (const child of this.bolts?.getChildren() ?? []) {
      const bolt = child as Phaser.Physics.Arcade.Image
      if (bolt.active && (bolt.y < -40 || bolt.y > WORLD_HEIGHT + 40 || bolt.x < -40 || bolt.x > WORLD_WIDTH + 40)) bolt.disableBody(true, true)
    }
    for (const child of this.enemies?.getChildren() ?? []) {
      const enemy = child as Phaser.Physics.Arcade.Sprite
      if (enemy.active && enemy.y >= DEFENSE_Y) {
        this.applyDamage(enemy)
      }
    }
  }

  private applyDamage(enemy: Phaser.Physics.Arcade.Sprite): void {
    const applied = this.model.damage()
    if (!applied) return
    enemy.disableBody(true, true)
    this.services.audio.playDamage()
    if (!this.reducedMotion) this.cameras.main.shake(120, 0.007)
    this.player?.setTint(0xff5d73)
    this.time.delayedCall(180, () => this.player?.clearTint())
    if (this.model.phase === 'playing') this.spawnEnemy()
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
    const enemy = this.enemies?.getFirstAlive() as Phaser.Physics.Arcade.Sprite | null
    if (this.player) document.documentElement.dataset.playerPosition = `${Math.round(this.player.x)},${Math.round(this.player.y)}`
    document.documentElement.dataset.qualityAuxiliaryName = 'wave'
    document.documentElement.dataset.qualityAuxiliaryValue = String(snapshot.wave)
    document.documentElement.dataset.qualityProgressName = 'kills'
    document.documentElement.dataset.qualityProgress = String(snapshot.kills)
    document.documentElement.dataset.qualityCompletionTarget = String(RUN_COMPLETION_TARGET)
    document.documentElement.dataset.qualityPressureName = 'shield'
    document.documentElement.dataset.qualityPressure = String(snapshot.shield)
    document.documentElement.dataset.qualityMaximumPressure = '3'
    document.documentElement.dataset.qualityPrimaryAction = 'destroy-raider'
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
        actions: [{ type: 'navigate', mode: 'directional', holdMs: 260, repeatMs: 220 }]
      }
    })
    document.documentElement.dataset.qualityAcceptedInputs = JSON.stringify(this.acceptedInputs.snapshot())
    const target = enemy ? JSON.stringify([[Math.round(enemy.x), Math.round(enemy.y)]]) : '[]'
    document.documentElement.dataset.qualityPrimaryTargets = target
    document.documentElement.dataset.qualityPressureTargets = target
    document.documentElement.dataset.qualityWorldWidth = String(WORLD_WIDTH)
    document.documentElement.dataset.qualityWorldHeight = String(WORLD_HEIGHT)
    document.documentElement.dataset.qualityRestartPosition = `${RESTART.x},${RESTART.y}`
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
