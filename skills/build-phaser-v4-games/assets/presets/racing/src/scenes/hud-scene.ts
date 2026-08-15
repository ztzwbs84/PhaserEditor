import Phaser from 'phaser'
import { RUN_COMPLETION_TARGET, type RunSnapshot } from '../domain/run-model'
import { GAME_EVENTS, type GameServices } from '../services'

export class HudScene extends Phaser.Scene {
  private gateText?: Phaser.GameObjects.Text
  private lapText?: Phaser.GameObjects.Text
  private chassisText?: Phaser.GameObjects.Text
  private phaseText?: Phaser.GameObjects.Text

  private readonly onSnapshot = (snapshot: RunSnapshot, speed: number) => {
    this.gateText?.setText(`GATES ${snapshot.checkpoints} / ${RUN_COMPLETION_TARGET}`)
    this.lapText?.setText(`LAP ${snapshot.lap}  /  SPEED ${Math.round(speed)}`)
    this.chassisText?.setText(`CHASSIS ${snapshot.chassis}`)
    this.phaseText?.setText(snapshot.phase === 'paused'
      ? 'RACE PAUSED'
      : snapshot.phase === 'game-over'
        ? snapshot.terminalKind === 'success' ? 'LAP COMPLETE' : 'CHASSIS WRECKED'
        : '')
    this.phaseText?.setVisible(snapshot.phase !== 'playing')
  }

  constructor(private readonly services: GameServices) { super('hud') }

  create(): void {
    const panel = this.add.graphics().setDepth(100)
    panel.fillStyle(0x121618, 0.93).fillRoundedRect(20, 18, 920, 50, 5)
    panel.lineStyle(1, 0x49616a, 1).strokeRoundedRect(20, 18, 920, 50, 5)
    const style: Phaser.Types.GameObjects.Text.TextStyle = {
      color: '#f6f7f2', fontFamily: 'Arial, sans-serif', fontSize: '18px', fontStyle: 'bold'
    }
    this.gateText = this.add.text(42, 34, `GATES 0 / ${RUN_COMPLETION_TARGET}`, style).setDepth(101)
    this.lapText = this.add.text(480, 34, 'LAP 1  /  SPEED 0', style).setOrigin(0.5, 0).setDepth(101)
    this.chassisText = this.add.text(918, 34, 'CHASSIS 3', style).setOrigin(1, 0).setDepth(101)
    this.add.text(480, 91, 'ORDERED GATES ACTIVE  /  INFIELD BARRIERS ARMED', {
      color: '#a7c1c9', fontFamily: 'Arial, sans-serif', fontSize: '14px'
    }).setOrigin(0.5).setDepth(101)
    this.phaseText = this.add.text(480, 270, '', {
      ...style, backgroundColor: '#121618', color: '#ffd166', fontSize: '36px', padding: { x: 28, y: 16 }
    }).setOrigin(0.5).setDepth(102).setVisible(false)
    this.services.bus.on(GAME_EVENTS.snapshot, this.onSnapshot)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this)
  }

  private shutdown(): void {
    this.services.bus.off(GAME_EVENTS.snapshot, this.onSnapshot)
  }
}
