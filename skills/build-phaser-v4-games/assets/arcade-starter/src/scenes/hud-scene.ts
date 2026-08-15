import Phaser from 'phaser'
import { RUN_COMPLETION_TARGET, type RunSnapshot } from '../domain/run-model'
import { GAME_EVENTS, type GameServices } from '../services'

export class HudScene extends Phaser.Scene {
  private scoreText?: Phaser.GameObjects.Text
  private timeText?: Phaser.GameObjects.Text
  private shieldText?: Phaser.GameObjects.Text
  private phaseText?: Phaser.GameObjects.Text

  private readonly onSnapshot = (snapshot: RunSnapshot) => {
    this.scoreText?.setText(`SCORE ${snapshot.score} / ${RUN_COMPLETION_TARGET}`)
    this.timeText?.setText(`TIME ${snapshot.remainingSeconds}`)
    this.shieldText?.setText(`SHIELD ${snapshot.shield}`)
    this.phaseText?.setText(snapshot.phase === 'paused'
      ? 'PAUSED'
      : snapshot.phase === 'game-over'
        ? snapshot.terminalKind === 'success' ? 'SIGNAL SECURED' : 'RUN LOST'
        : '')
    this.phaseText?.setVisible(snapshot.phase !== 'playing')
  }

  constructor(private readonly services: GameServices) {
    super('hud')
  }

  create(): void {
    const panel = this.add.graphics().setDepth(100)
    panel.fillStyle(0x10171c, 0.88).fillRoundedRect(20, 18, 920, 48, 6)
    panel.lineStyle(1, 0x52656c, 1).strokeRoundedRect(20, 18, 920, 48, 6)
    const style: Phaser.Types.GameObjects.Text.TextStyle = {
      color: '#f5f7f2',
      fontFamily: 'Arial, sans-serif',
      fontSize: '18px',
      fontStyle: 'bold'
    }
    this.scoreText = this.add.text(42, 33, `SCORE 0 / ${RUN_COMPLETION_TARGET}`, style).setDepth(101)
    this.timeText = this.add.text(480, 33, 'TIME 60', style).setOrigin(0.5, 0).setDepth(101)
    this.shieldText = this.add.text(918, 33, 'SHIELD 3', style).setOrigin(1, 0).setDepth(101)
    this.add.text(480, 82, `SECURE ${RUN_COMPLETION_TARGET} POINTS  /  AVOID DRONES`, {
      color: '#b8c9c8',
      fontFamily: 'Arial, sans-serif',
      fontSize: '14px'
    }).setOrigin(0.5).setDepth(101)
    this.phaseText = this.add.text(480, 270, '', {
      ...style,
      backgroundColor: '#10171c',
      color: '#f7d36b',
      fontSize: '36px',
      padding: { x: 28, y: 16 }
    }).setOrigin(0.5).setDepth(102).setVisible(false)
    this.services.bus.on(GAME_EVENTS.snapshot, this.onSnapshot)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this)
  }

  private shutdown(): void {
    this.services.bus.off(GAME_EVENTS.snapshot, this.onSnapshot)
  }
}
