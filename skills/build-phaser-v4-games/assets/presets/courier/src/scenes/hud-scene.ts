import Phaser from 'phaser'
import { RUN_COMPLETION_TARGET, type RunSnapshot } from '../domain/run-model'
import { GAME_EVENTS, type GameServices } from '../services'

const GATE_COLORS = {
  north: '#56cfe1',
  east: '#f3bc5a',
  south: '#f07580',
  west: '#79d58b'
} as const

export class HudScene extends Phaser.Scene {
  private scoreText?: Phaser.GameObjects.Text
  private timeText?: Phaser.GameObjects.Text
  private integrityText?: Phaser.GameObjects.Text
  private streakText?: Phaser.GameObjects.Text
  private objectiveText?: Phaser.GameObjects.Text
  private heatBar?: Phaser.GameObjects.Graphics
  private phaseShade?: Phaser.GameObjects.Rectangle
  private phaseTitle?: Phaser.GameObjects.Text
  private phaseDetail?: Phaser.GameObjects.Text

  private readonly onSnapshot = (snapshot: RunSnapshot) => this.renderSnapshot(snapshot)

  constructor(private readonly services: GameServices) {
    super('hud')
  }

  create(): void {
    const panel = this.add.graphics().setDepth(100)
    panel.fillStyle(0x171719, 0.94).fillRoundedRect(16, 12, 928, 68, 6)
    panel.lineStyle(1, 0x725441, 0.9).strokeRoundedRect(16, 12, 928, 68, 6)
    const style: Phaser.Types.GameObjects.Text.TextStyle = {
      color: '#f7ead7',
      fontFamily: 'Arial, sans-serif',
      fontSize: '16px',
      fontStyle: 'bold'
    }
    this.scoreText = this.add.text(34, 26, '0 PTS', style).setDepth(101)
    this.streakText = this.add.text(34, 50, `STREAK 0 / 0 OF ${RUN_COMPLETION_TARGET} DELIVERED`, { ...style, color: '#d2a46f', fontSize: '12px' }).setDepth(101)
    this.objectiveText = this.add.text(480, 26, 'RETURN TO HEARTH', { ...style, fontSize: '17px' }).setOrigin(0.5, 0).setDepth(101)
    this.timeText = this.add.text(926, 25, '75s', { ...style, fontSize: '20px' }).setOrigin(1, 0).setDepth(101)
    this.integrityText = this.add.text(926, 53, 'FLAME 3/3', { ...style, color: '#f39a66', fontSize: '12px' }).setOrigin(1, 0).setDepth(101)
    this.heatBar = this.add.graphics().setDepth(102)
    this.phaseShade = this.add.rectangle(480, 300, 960, 600, 0x0c0a0a, 0.72).setDepth(110).setVisible(false)
    this.phaseTitle = this.add.text(480, 260, '', {
      color: '#f3bc5a',
      fontFamily: 'Georgia, serif',
      fontSize: '42px',
      fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(111).setVisible(false)
    this.phaseDetail = this.add.text(480, 326, '', {
      align: 'center',
      color: '#f7ead7',
      fontFamily: 'Arial, sans-serif',
      fontSize: '17px',
      lineSpacing: 8
    }).setOrigin(0.5).setDepth(111).setVisible(false)
    this.services.bus.on(GAME_EVENTS.snapshot, this.onSnapshot)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this)
  }

  private renderSnapshot(snapshot: RunSnapshot): void {
    this.scoreText?.setText(`${snapshot.score} PTS`)
    this.streakText?.setText(`STREAK ${snapshot.streak} / ${snapshot.deliveries} OF ${RUN_COMPLETION_TARGET} DELIVERED`)
    this.timeText?.setText(`${snapshot.remainingSeconds}s`)
    this.integrityText?.setText(`FLAME ${snapshot.integrity}/3`)
    this.heatBar?.clear()
    if (snapshot.cargo) {
      const color = Phaser.Display.Color.HexStringToColor(GATE_COLORS[snapshot.cargo.destination]).color
      this.objectiveText?.setText(`${snapshot.cargo.destination.toUpperCase()} BEACON / ${snapshot.cargo.remainingSeconds.toFixed(1)}s`).setColor(GATE_COLORS[snapshot.cargo.destination])
      this.heatBar?.fillStyle(0x3b2b28, 1).fillRoundedRect(330, 58, 300, 6, 3)
      this.heatBar?.fillStyle(color, 1).fillRoundedRect(330, 58, 300 * snapshot.cargo.heatRatio, 6, 3)
    } else {
      this.objectiveText?.setText('RETURN TO THE HEARTH').setColor('#e2b071')
    }
    const showOverlay = snapshot.phase !== 'playing'
    this.phaseShade?.setVisible(showOverlay)
    this.phaseTitle?.setVisible(showOverlay)
    this.phaseDetail?.setVisible(showOverlay)
    if (snapshot.phase === 'paused') {
      this.phaseTitle?.setText('ROUTE PAUSED')
      this.phaseDetail?.setText('The city waits.')
    } else if (snapshot.phase === 'game-over') {
      this.phaseTitle?.setText(snapshot.terminalKind === 'success' ? 'ROUTES COMPLETE' : 'SHIFT LOST')
      this.phaseDetail?.setText(`${snapshot.deliveries} DELIVERIES\n${snapshot.score} POINTS / BEST STREAK ${snapshot.bestStreak}`)
    }
  }

  private shutdown(): void {
    this.services.bus.off(GAME_EVENTS.snapshot, this.onSnapshot)
  }
}
