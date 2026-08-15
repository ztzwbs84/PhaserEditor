import Phaser from 'phaser'
import { RUN_COMPLETION_TARGET, type RunSnapshot } from '../domain/run-model'
import { GAME_EVENTS, type GameServices } from '../services'

export class HudScene extends Phaser.Scene {
  private killsText?: Phaser.GameObjects.Text
  private waveText?: Phaser.GameObjects.Text
  private shieldText?: Phaser.GameObjects.Text
  private phaseText?: Phaser.GameObjects.Text

  private readonly onSnapshot = (snapshot: RunSnapshot) => {
    this.killsText?.setText(`KILLS ${snapshot.kills} / ${RUN_COMPLETION_TARGET}`)
    this.waveText?.setText(`WAVE ${snapshot.wave}`)
    this.shieldText?.setText(`SHIELD ${snapshot.shield}`)
    this.phaseText?.setText(snapshot.phase === 'paused'
      ? 'PAUSED'
      : snapshot.phase === 'game-over'
        ? snapshot.terminalKind === 'success' ? 'SECTOR CLEAR' : 'DEFENSE LOST'
        : '')
    this.phaseText?.setVisible(snapshot.phase !== 'playing')
  }

  constructor(private readonly services: GameServices) { super('hud') }

  create(): void {
    const panel = this.add.graphics().setDepth(100)
    panel.fillStyle(0x07131b, 0.9).fillRoundedRect(20, 18, 920, 50, 5)
    panel.lineStyle(1, 0x2e6873, 1).strokeRoundedRect(20, 18, 920, 50, 5)
    const style: Phaser.Types.GameObjects.Text.TextStyle = {
      color: '#e9fff9', fontFamily: 'Arial, sans-serif', fontSize: '18px', fontStyle: 'bold'
    }
    this.killsText = this.add.text(42, 34, `KILLS 0 / ${RUN_COMPLETION_TARGET}`, style).setDepth(101)
    this.waveText = this.add.text(480, 34, 'WAVE 1', style).setOrigin(0.5, 0).setDepth(101)
    this.shieldText = this.add.text(918, 34, 'SHIELD 3', style).setOrigin(1, 0).setDepth(101)
    this.add.text(480, 91, 'RAIDER VECTOR LOCKED  /  DEFENSE LINE ACTIVE', {
      color: '#9fc8c5', fontFamily: 'Arial, sans-serif', fontSize: '14px'
    }).setOrigin(0.5).setDepth(101)
    this.phaseText = this.add.text(480, 270, '', {
      ...style, backgroundColor: '#07131b', color: '#ffcb77', fontSize: '36px', padding: { x: 28, y: 16 }
    }).setOrigin(0.5).setDepth(102).setVisible(false)
    this.services.bus.on(GAME_EVENTS.snapshot, this.onSnapshot)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this)
  }

  private shutdown(): void {
    this.services.bus.off(GAME_EVENTS.snapshot, this.onSnapshot)
  }
}
