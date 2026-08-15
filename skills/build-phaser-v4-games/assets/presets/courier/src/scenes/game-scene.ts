import Phaser from 'phaser'
import { AcceptedInputCounters } from '../domain/accepted-input-counters'
import { RUN_COMPLETION_TARGET, RunModel, type Destination, type RunSnapshot } from '../domain/run-model'
import { GAME_EVENTS, type GameServices } from '../services'

const WORLD_WIDTH = 960
const WORLD_HEIGHT = 600
const PLAYER_SPEED = 275
const HAZARD_SPEED = 145
const DEPOT = { x: 480, y: 328 }
const DESTINATIONS: Destination[] = ['north', 'east', 'south', 'west']
const GATES: Record<Destination, { x: number; y: number; color: number; label: string }> = {
  north: { x: 480, y: 114, color: 0x56cfe1, label: 'NORTH' },
  east: { x: 890, y: 328, color: 0xf3bc5a, label: 'EAST' },
  south: { x: 480, y: 550, color: 0xf07580, label: 'SOUTH' },
  west: { x: 70, y: 328, color: 0x79d58b, label: 'WEST' }
}

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

type GateView = {
  zone: Phaser.GameObjects.Zone
  marker: Phaser.GameObjects.Image
  label: Phaser.GameObjects.Text
}

export class GameScene extends Phaser.Scene {
  private readonly model = new RunModel()
  private player?: Phaser.Physics.Arcade.Sprite
  private carriedEmber?: Phaser.GameObjects.Image
  private depotZone?: Phaser.GameObjects.Zone
  private hazards?: Phaser.Physics.Arcade.Group
  private readonly gates = new Map<Destination, GateView>()
  private keys?: ControlKeys
  private pointerTarget: Phaser.Math.Vector2 | null = null
  private publishAccumulator = 0
  private autoPaused = false
  private nextDestinationIndex = 0
  private finished = false
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
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y)
    this.pointerTarget = new Phaser.Math.Vector2(world.x, world.y)
    this.publishSnapshot()
  }
  private readonly onPointerMove = (pointer: Phaser.Input.Pointer) => {
    if (!pointer.isDown || this.model.phase !== 'playing') return
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y)
    this.pointerTarget?.set(world.x, world.y)
  }

  constructor(private readonly services: GameServices) {
    super('game')
  }

  init(): void {
    this.model.reset()
    this.publishAccumulator = 0
    this.pointerTarget = null
    this.autoPaused = false
    this.nextDestinationIndex = 0
    this.finished = false
    this.acceptedInputs.reset()
    this.gates.clear()
  }

  create(): void {
    this.services.beginRun()
    document.documentElement.dataset.gameState = 'playing'
    const previousRun = Number(document.documentElement.dataset.gameRun ?? '0')
    document.documentElement.dataset.gameRun = String(previousRun + 1)
    this.add.image(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, 'field')
    this.drawRoutes()
    this.physics.world.resume()
    this.physics.world.setBounds(30, 92, WORLD_WIDTH - 60, WORLD_HEIGHT - 122)
    this.createGates()
    this.createDepot()

    this.player = this.physics.add.sprite(DEPOT.x, DEPOT.y, 'courier')
      .setCollideWorldBounds(true)
      .setCircle(20, 6, 8)
      .setDepth(8)
    this.carriedEmber = this.add.image(DEPOT.x, DEPOT.y - 34, 'ember').setScale(0.56).setDepth(10).setVisible(false)
    this.hazards = this.physics.add.group({ allowGravity: false })
    this.keys = this.createControlKeys()

    this.physics.add.overlap(this.player, this.depotZone!, this.reachDepot, undefined, this)
    for (const [destination, gate] of this.gates) {
      gate.zone.setData('destination', destination)
      this.physics.add.overlap(this.player, gate.zone, this.reachGate, undefined, this)
    }
    this.physics.add.overlap(this.player, this.hazards, this.hitHazard, undefined, this)
    this.spawnHazard('horizontal', 220, 205, 1)
    this.spawnHazard('horizontal', 740, 452, -1)
    this.spawnHazard('vertical', 328, 370, -1)

    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown)
    this.input.on(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove)
    this.services.bus.on(GAME_EVENTS.pause, this.onPauseRequest)
    this.services.bus.on(GAME_EVENTS.restart, this.onRestartRequest)
    this.game.events.on(Phaser.Core.Events.BLUR, this.onBlur)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this)
    this.pickupEmber()
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
    this.updateCarriedEmber()
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
    const wasd = keyboard.addKeys('W,A,S,D') as Record<string, Phaser.Input.Keyboard.Key>
    return {
      up: [wasd.W, cursors.up],
      down: [wasd.S, cursors.down],
      left: [wasd.A, cursors.left],
      right: [wasd.D, cursors.right]
    }
  }

  private drawRoutes(): void {
    const routes = this.add.graphics().setDepth(1)
    routes.lineStyle(4, 0x82533c, 0.26)
    routes.lineBetween(84, DEPOT.y, 876, DEPOT.y)
    routes.lineBetween(DEPOT.x, 126, DEPOT.x, 538)
    routes.lineStyle(1, 0xe6c184, 0.16)
    routes.strokeCircle(DEPOT.x, DEPOT.y, 122)
    routes.strokeCircle(DEPOT.x, DEPOT.y, 196)
  }

  private createGates(): void {
    for (const destination of DESTINATIONS) {
      const data = GATES[destination]
      const zone = this.add.zone(data.x, data.y, destination === 'north' || destination === 'south' ? 112 : 72, destination === 'north' || destination === 'south' ? 70 : 112)
      this.physics.add.existing(zone, true)
      const marker = this.add.image(data.x, data.y, 'gate').setTint(data.color).setDepth(3).setAlpha(0.62)
      if (destination === 'east' || destination === 'west') marker.setRotation(Math.PI / 2)
      const labelX = destination === 'west' ? 38 : destination === 'east' ? 922 : data.x
      const labelY = destination === 'north' ? 94 : destination === 'south' ? 570 : data.y + 38
      const label = this.add.text(labelX, labelY, data.label, {
        color: Phaser.Display.Color.IntegerToColor(data.color).rgba,
        fontFamily: 'Arial, sans-serif',
        fontSize: '12px',
        fontStyle: 'bold'
      }).setOrigin(0.5).setDepth(4).setAlpha(0.72)
      this.gates.set(destination, { zone, marker, label })
    }
  }

  private createDepot(): void {
    this.add.image(DEPOT.x, DEPOT.y, 'hearth').setDepth(3)
    this.add.text(DEPOT.x, DEPOT.y + 53, 'HEARTH', {
      color: '#dca66d',
      fontFamily: 'Arial, sans-serif',
      fontSize: '12px',
      fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(4)
    this.depotZone = this.add.zone(DEPOT.x, DEPOT.y, 86, 86)
    this.physics.add.existing(this.depotZone, true)
  }

  private updatePlayerVelocity(): void {
    if (!this.player || !this.keys) return
    const horizontal = Number(this.keys.right.some((key) => key.isDown)) - Number(this.keys.left.some((key) => key.isDown))
    const vertical = Number(this.keys.down.some((key) => key.isDown)) - Number(this.keys.up.some((key) => key.isDown))
    if (horizontal !== 0 || vertical !== 0) {
      this.pointerTarget = null
      const direction = new Phaser.Math.Vector2(horizontal, vertical).normalize().scale(PLAYER_SPEED)
      this.player.setVelocity(direction.x, direction.y).setFlipX(direction.x < 0)
      return
    }
    if (!this.pointerTarget) {
      this.player.setVelocity(0, 0)
      return
    }
    const distance = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.pointerTarget.x, this.pointerTarget.y)
    if (distance < 10) {
      this.player.setVelocity(0, 0)
      this.pointerTarget = null
    } else {
      this.physics.moveToObject(this.player, this.pointerTarget, PLAYER_SPEED)
      this.player.setFlipX(this.pointerTarget.x < this.player.x)
    }
  }

  private updateCarriedEmber(): void {
    if (!this.player || !this.carriedEmber) return
    const cargo = this.model.snapshot().cargo
    this.carriedEmber.setVisible(Boolean(cargo)).setPosition(this.player.x, this.player.y - 34)
    if (cargo) {
      this.carriedEmber.setTint(GATES[cargo.destination].color)
      if (!this.reducedMotion) this.carriedEmber.setScale(0.5 + Math.sin(this.time.now / 90) * 0.05)
    }
  }

  private pickupEmber(): void {
    const destination = DESTINATIONS[this.nextDestinationIndex % DESTINATIONS.length]
    if (!this.model.pickup(destination)) return
    this.nextDestinationIndex += 1
    this.services.audio.playPickup(this.model.snapshot().streak + 1)
    this.setActiveGate(destination)
    this.publishSnapshot()
  }

  private reachDepot(): void {
    if (!this.model.snapshot().cargo) this.pickupEmber()
  }

  private reachGate(_player: ArcadeContact, gateObject: ArcadeContact): void {
    const destination = (gateObject as Phaser.GameObjects.Zone).getData('destination') as Destination
    const result = this.model.deliver(destination)
    if (!result.accepted) return
    this.services.audio.playDelivery(this.model.snapshot().streak)
    this.cameras.main.flash(90, 230, 197, 118, true)
    this.setActiveGate(null)
    const deliveries = this.model.snapshot().deliveries
    if (deliveries === 2 || deliveries === 5 || deliveries === 8) this.addEscalationHazard(deliveries)
    this.publishSnapshot()
  }

  private hitHazard(): void {
    if (!this.player) return
    const result = this.model.damage()
    if (!result.applied) return
    this.services.audio.playImpact()
    if (!this.reducedMotion) this.cameras.main.shake(130, 0.007)
    this.player.setAlpha(0.32)
    this.tweens.add({ targets: this.player, alpha: 1, duration: this.reducedMotion ? 1 : 180, yoyo: true, repeat: this.reducedMotion ? 0 : 2 })
    if (result.lostCargo) this.setActiveGate(null)
    this.publishSnapshot()
    if (result.ended) this.finishRun()
  }

  private spawnHazard(axis: 'horizontal' | 'vertical', x: number, y: number, direction: number): void {
    if (!this.hazards) return
    const hazard = this.hazards.create(x, y, 'wisp') as Phaser.Physics.Arcade.Sprite
    hazard.setCircle(16, 5, 5).setBounce(1).setCollideWorldBounds(true).setDepth(6)
    const speed = HAZARD_SPEED + this.model.snapshot().deliveries * 8
    hazard.setVelocity(axis === 'horizontal' ? speed * direction : 54 * direction, axis === 'vertical' ? speed * direction : 46 * direction)
    hazard.setAngularVelocity(90 * direction)
  }

  private addEscalationHazard(deliveries: number): void {
    const horizontal = deliveries !== 5
    this.spawnHazard(horizontal ? 'horizontal' : 'vertical', horizontal ? 180 : 650, horizontal ? 475 : 180, deliveries % 2 === 0 ? 1 : -1)
  }

  private setActiveGate(destination: Destination | null): void {
    for (const [key, gate] of this.gates) {
      const active = key === destination
      gate.marker.setAlpha(active ? 1 : 0.52).setScale(active ? 1.08 : 0.92)
      gate.label.setAlpha(active ? 1 : 0.55)
    }
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
    const cargo = snapshot.cargo
    const primary = cargo ? GATES[cargo.destination] : DEPOT
    if (this.player) document.documentElement.dataset.playerPosition = `${Math.round(this.player.x)},${Math.round(this.player.y)}`
    document.documentElement.dataset.remainingSeconds = String(snapshot.remainingSeconds)
    document.documentElement.dataset.qualityAuxiliaryName = 'time'
    document.documentElement.dataset.qualityAuxiliaryValue = String(snapshot.remainingSeconds)
    document.documentElement.dataset.qualityProgressName = 'deliveries'
    document.documentElement.dataset.qualityProgress = String(snapshot.deliveries)
    document.documentElement.dataset.qualityCompletionTarget = String(RUN_COMPLETION_TARGET)
    document.documentElement.dataset.qualityPressureName = 'flame'
    document.documentElement.dataset.qualityPressure = String(snapshot.integrity)
    document.documentElement.dataset.qualityMaximumPressure = '3'
    document.documentElement.dataset.qualityPrimaryAction = cargo ? `deliver-${cargo.destination}` : 'return-to-hearth'
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
    document.documentElement.dataset.qualityPrimaryTargets = JSON.stringify([[primary.x, primary.y]])
    document.documentElement.dataset.qualityPressureTargets = this.hazardPositions()
    document.documentElement.dataset.qualityWorldWidth = String(WORLD_WIDTH)
    document.documentElement.dataset.qualityWorldHeight = String(WORLD_HEIGHT)
    document.documentElement.dataset.qualityRestartPosition = `${DEPOT.x},${DEPOT.y}`
    document.documentElement.dataset.qualityTerminalKind = snapshot.terminalKind ?? ''
    document.documentElement.dataset.qualityTerminalReason = snapshot.outcome ?? ''
    this.services.publishSnapshot(snapshot)
  }

  private hazardPositions(): string {
    if (!this.hazards) return '[]'
    return JSON.stringify(this.hazards.getChildren()
      .filter((child) => child.active)
      .map((child) => {
        const hazard = child as Phaser.Physics.Arcade.Sprite
        return [Math.round(hazard.x), Math.round(hazard.y)]
      }))
  }

  private shutdown(): void {
    this.input.off(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown)
    this.input.off(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove)
    this.services.bus.off(GAME_EVENTS.pause, this.onPauseRequest)
    this.services.bus.off(GAME_EVENTS.restart, this.onRestartRequest)
    this.game.events.off(Phaser.Core.Events.BLUR, this.onBlur)
    this.gates.clear()
  }
}
