import Phaser from 'phaser'
import { RUN_COMPLETION_TARGET, type RunSnapshot } from '../domain/run-model'
import { GAME_EVENTS, type GameServices } from '../services'

export class HudScene extends Phaser.Scene {
  private interceptText?: Phaser.GameObjects.Text
  private waveText?: Phaser.GameObjects.Text
  private coreText?: Phaser.GameObjects.Text
  private phaseText?: Phaser.GameObjects.Text

  private readonly onSnapshot = (snapshot: RunSnapshot, selectedTurret: number) => {
    this.interceptText?.setText(`INTERCEPTS ${snapshot.intercepts} / ${RUN_COMPLETION_TARGET}`)
    this.waveText?.setText(`WAVE ${snapshot.wave}  /  NODE ${selectedTurret + 1}`)
    this.coreText?.setText(`CORE ${snapshot.core}`)
    this.phaseText?.setText(snapshot.phase === 'paused'
      ? 'DEFENSE PAUSED'
      : snapshot.phase === 'game-over'
        ? snapshot.terminalKind === 'success' ? 'SECTOR DEFENDED' : 'CORE BREACHED'
        : '')
    this.phaseText?.setVisible(snapshot.phase !== 'playing')
  }

  constructor(private readonly services: GameServices) { super('hud') }

  create(): void {
    const panel = this.add.graphics().setDepth(100)
    panel.fillStyle(0x111813, 0.92).fillRoundedRect(20, 18, 920, 50, 5)
    panel.lineStyle(1, 0x57705c, 1).strokeRoundedRect(20, 18, 920, 50, 5)
    const style: Phaser.Types.GameObjects.Text.TextStyle = {
      color: '#effbe7', fontFamily: 'Arial, sans-serif', fontSize: '18px', fontStyle: 'bold'
    }
    this.interceptText = this.add.text(42, 34, `INTERCEPTS 0 / ${RUN_COMPLETION_TARGET}`, style).setDepth(101)
    this.waveText = this.add.text(480, 34, 'WAVE 1  /  NODE 2', style).setOrigin(0.5, 0).setDepth(101)
    this.coreText = this.add.text(918, 34, 'CORE 3', style).setOrigin(1, 0).setDepth(101)
    this.add.text(480, 91, 'INVADER ROUTE ACTIVE  /  CITADEL LINK STABLE', {
      color: '#b4cba5', fontFamily: 'Arial, sans-serif', fontSize: '14px'
    }).setOrigin(0.5).setDepth(101)
    this.phaseText = this.add.text(480, 270, '', {
      ...style, backgroundColor: '#111813', color: '#ffcc66', fontSize: '36px', padding: { x: 28, y: 16 }
    }).setOrigin(0.5).setDepth(102).setVisible(false)
    this.services.bus.on(GAME_EVENTS.snapshot, this.onSnapshot)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this)
  }

  private shutdown(): void {
    this.services.bus.off(GAME_EVENTS.snapshot, this.onSnapshot)
  }
}
