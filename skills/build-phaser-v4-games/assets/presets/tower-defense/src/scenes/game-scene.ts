import Phaser from 'phaser'
import { AcceptedInputCounters } from '../domain/accepted-input-counters'
import { RUN_COMPLETION_TARGET, RunModel } from '../domain/run-model'
import { GAME_EVENTS, type GameServices } from '../services'

const WORLD_WIDTH = 960
const WORLD_HEIGHT = 540
const PULSE_SPEED = 680
const PATH = [
  new Phaser.Math.Vector2(60, 152),
  new Phaser.Math.Vector2(770, 152),
  new Phaser.Math.Vector2(770, 270),
  new Phaser.Math.Vector2(880, 270)
] as const
const TURRETS = [
  { x: 230, y: 304, name: 'Alpha' },
  { x: 480, y: 304, name: 'Beta' },
  { x: 690, y: 304, name: 'Gamma' }
] as const
const RESTART = TURRETS[1]

type ArcadeContact = Phaser.Types.Physics.Arcade.GameObjectWithBody
  | Phaser.Physics.Arcade.Body
  | Phaser.Physics.Arcade.StaticBody
  | Phaser.Tilemaps.Tile

type ControlKeys = {
  left: Phaser.Input.Keyboard.Key[]
  right: Phaser.Input.Keyboard.Key[]
  fire: Phaser.Input.Keyboard.Key[]
}

export class GameScene extends Phaser.Scene {
  private readonly model = new RunModel()
  private enemies?: Phaser.Physics.Arcade.Group
  private pulses?: Phaser.Physics.Arcade.Group
  private turretSprites: Phaser.GameObjects.Image[] = []
  private selection?: Phaser.GameObjects.Arc
  private keys?: ControlKeys
  private selectedTurret = 1
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
    if (this.model.phase !== 'playing') return
    const target = this.cameras.main.getWorldPoint(pointer.x, pointer.y)
    const enemy = this.enemies?.getFirstAlive() as Phaser.Physics.Arcade.Sprite | null
    if (!enemy) return
    this.selectedTurret = this.nearestTurretIndex(enemy.x)
    this.updateSelection()
    if (this.firePulse(target.x, target.y, enemy)) {
      this.acceptedInputs.accept('pointer:click')
      this.publishSnapshot()
    }
  }

  constructor(private readonly services: GameServices) { super('game') }

  init(): void {
    this.model.reset()
    this.selectedTurret = 1
    this.turretSprites = []
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
    this.add.image(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, 'citadel')
    this.add.image(888, 270, 'core').setScale(0.78).setDepth(3)
    this.physics.world.resume()
    this.enemies = this.physics.add.group({ allowGravity: false })
    this.pulses = this.physics.add.group({ allowGravity: false })
    for (const turret of TURRETS) {
      this.turretSprites.push(this.add.image(turret.x, turret.y, 'turret').setDepth(5))
    }
    this.selection = this.add.circle(TURRETS[1].x, TURRETS[1].y, 43, 0xffcc66, 0.08)
      .setStrokeStyle(3, 0xffcc66, 0.9).setDepth(4)
    this.keys = this.createControlKeys()
    this.physics.add.overlap(this.pulses, this.enemies, this.hitEnemy, undefined, this)
    this.spawnEnemy()

    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown)
    this.services.bus.on(GAME_EVENTS.pause, this.onPauseRequest)
    this.services.bus.on(GAME_EVENTS.restart, this.onRestartRequest)
    this.game.events.on(Phaser.Core.Events.BLUR, this.onBlur)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this)
    this.publishSnapshot()
  }

  update(_time: number, delta: number): void {
    if (!this.keys) return
    if (this.model.phase !== 'playing') {
      if (this.model.phase === 'game-over') this.finishRun()
      return
    }
    if (this.keys.left.some((key) => Phaser.Input.Keyboard.JustDown(key))) this.selectTurret(-1)
    if (this.keys.right.some((key) => Phaser.Input.Keyboard.JustDown(key))) this.selectTurret(1)
    if (this.keys.fire.some((key) => Phaser.Input.Keyboard.JustDown(key))) {
      const enemy = this.enemies?.getFirstAlive() as Phaser.Physics.Arcade.Sprite | null
      if (enemy && this.firePulse(enemy.x, enemy.y, enemy)) {
        this.acceptedInputs.accept('key:pulse')
        this.publishSnapshot()
      }
    }
    this.updateInvaders(delta)
    this.updatePulses()
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
    return { left: [keys.A, cursors.left], right: [keys.D, cursors.right], fire: [keys.SPACE] }
  }

  private selectTurret(offset: number): void {
    this.selectedTurret = Phaser.Math.Wrap(this.selectedTurret + offset, 0, TURRETS.length)
    this.updateSelection()
    this.publishSnapshot()
  }

  private nearestTurretIndex(x: number): number {
    return TURRETS.map((turret, index) => ({ index, distance: Math.abs(turret.x - x) }))
      .sort((left, right) => left.distance - right.distance)[0].index
  }

  private updateSelection(): void {
    const turret = TURRETS[this.selectedTurret]
    this.selection?.setPosition(turret.x, turret.y)
  }

  private firePulse(targetX: number, targetY: number, enemy: Phaser.Physics.Arcade.Sprite): boolean {
    if (!this.pulses) return false
    const turret = TURRETS[this.selectedTurret]
    const direction = new Phaser.Math.Vector2(targetX - turret.x, targetY - turret.y)
    if (direction.lengthSq() < 1) direction.set(0, -1)
    direction.normalize().scale(PULSE_SPEED)
    const pulse = this.pulses.create(turret.x, turret.y - 16, 'pulse') as Phaser.Physics.Arcade.Image
    pulse.setCircle(10).setVelocity(direction.x, direction.y).setDepth(7).setData('target', enemy)
    this.services.audio.playPulse()
    return true
  }

  private spawnEnemy(): void {
    if (!this.enemies || this.model.phase !== 'playing') return
    const enemy = this.enemies.create(PATH[0].x, PATH[0].y, 'invader') as Phaser.Physics.Arcade.Sprite
    enemy.setSize(42, 38).setDepth(6).setData('pathIndex', 1).setData('armor', 2)
    if (!this.reducedMotion) this.tweens.add({ targets: enemy, angle: { from: -3, to: 3 }, duration: 480, yoyo: true, repeat: -1 })
  }

  private updateInvaders(delta: number): void {
    for (const child of this.enemies?.getChildren() ?? []) {
      const enemy = child as Phaser.Physics.Arcade.Sprite
      if (!enemy.active) continue
      const pathIndex = Number(enemy.getData('pathIndex') ?? 1)
      const target = PATH[pathIndex]
      if (!target) {
        this.breachCore(enemy)
        continue
      }
      const distance = Phaser.Math.Distance.Between(enemy.x, enemy.y, target.x, target.y)
      const travel = (70 + this.model.snapshot().wave * 8) * Math.min(delta, 100) / 1_000
      if (distance <= travel + 2) {
        enemy.setPosition(target.x, target.y).setData('pathIndex', pathIndex + 1)
        if (pathIndex === PATH.length - 1) this.breachCore(enemy)
      } else {
        const direction = new Phaser.Math.Vector2(target.x - enemy.x, target.y - enemy.y).normalize().scale(travel)
        enemy.setPosition(enemy.x + direction.x, enemy.y + direction.y)
      }
    }
  }

  private updatePulses(): void {
    for (const child of this.pulses?.getChildren() ?? []) {
      const pulse = child as Phaser.Physics.Arcade.Image
      if (!pulse.active) continue
      const target = pulse.getData('target') as Phaser.Physics.Arcade.Sprite | undefined
      if (target?.active) this.physics.moveToObject(pulse, target, PULSE_SPEED)
      if (pulse.x < -32 || pulse.x > WORLD_WIDTH + 32 || pulse.y < -32 || pulse.y > WORLD_HEIGHT + 32 || !target?.active) {
        pulse.disableBody(true, true)
      }
    }
  }

  private hitEnemy(pulseObject: ArcadeContact, enemyObject: ArcadeContact): void {
    const pulse = pulseObject as Phaser.Physics.Arcade.Image
    const enemy = enemyObject as Phaser.Physics.Arcade.Sprite
    if (!pulse.active || !enemy.active || this.model.phase !== 'playing') return
    pulse.disableBody(true, true)
    const armor = Math.max(0, Number(enemy.getData('armor') ?? 1) - 1)
    enemy.setData('armor', armor)
    this.services.audio.playArmor()
    if (armor > 0) {
      enemy.setTint(0xffcc66)
      this.time.delayedCall(90, () => enemy.active && enemy.clearTint())
      return
    }
    enemy.disableBody(true, true)
    this.model.intercept()
    const snapshot = this.model.snapshot()
    this.services.audio.playIntercept(snapshot.chain)
    if (!this.reducedMotion) this.cameras.main.flash(80, 127, 200, 169, true)
    if (snapshot.phase === 'playing') this.spawnEnemy()
    this.publishSnapshot()
    if (snapshot.phase === 'game-over') this.finishRun()
  }

  private breachCore(enemy: Phaser.Physics.Arcade.Sprite): void {
    if (!enemy.active || !this.model.breach()) return
    enemy.disableBody(true, true)
    this.services.audio.playBreach()
    if (!this.reducedMotion) this.cameras.main.shake(120, 0.007)
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
    const turret = TURRETS[this.selectedTurret]
    document.documentElement.dataset.playerPosition = `${turret.x},${turret.y}`
    document.documentElement.dataset.qualityAuxiliaryName = 'wave'
    document.documentElement.dataset.qualityAuxiliaryValue = String(snapshot.wave)
    document.documentElement.dataset.qualityProgressName = 'intercepts'
    document.documentElement.dataset.qualityProgress = String(snapshot.intercepts)
    document.documentElement.dataset.qualityCompletionTarget = String(RUN_COMPLETION_TARGET)
    document.documentElement.dataset.qualityPressureName = 'core'
    document.documentElement.dataset.qualityPressure = String(snapshot.core)
    document.documentElement.dataset.qualityMaximumPressure = '3'
    document.documentElement.dataset.qualityPrimaryAction = 'intercept-invader'
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
    this.services.publishSnapshot(snapshot, this.selectedTurret)
  }

  private shutdown(): void {
    this.input.off(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown)
    this.services.bus.off(GAME_EVENTS.pause, this.onPauseRequest)
    this.services.bus.off(GAME_EVENTS.restart, this.onRestartRequest)
    this.game.events.off(Phaser.Core.Events.BLUR, this.onBlur)
  }
}
