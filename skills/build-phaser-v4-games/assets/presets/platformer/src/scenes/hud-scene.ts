import Phaser from 'phaser'
import { RUN_COMPLETION_TARGET, type RunSnapshot } from '../domain/run-model'
import { GAME_EVENTS, type GameServices } from '../services'

export class HudScene extends Phaser.Scene {
  private relicText?: Phaser.GameObjects.Text
  private timeText?: Phaser.GameObjects.Text
  private heartText?: Phaser.GameObjects.Text
  private objectiveText?: Phaser.GameObjects.Text
  private phaseShade?: Phaser.GameObjects.Rectangle
  private phaseTitle?: Phaser.GameObjects.Text
  private phaseDetail?: Phaser.GameObjects.Text
  private readonly onSnapshot = (snapshot: RunSnapshot) => this.renderSnapshot(snapshot)

  constructor(private readonly services: GameServices) { super('hud') }

  create(): void {
    const panel = this.add.graphics().setDepth(100)
    panel.fillStyle(0x17151d, 0.93).fillRoundedRect(18, 14, 924, 62, 6)
    panel.lineStyle(1, 0x63586f, 1).strokeRoundedRect(18, 14, 924, 62, 6)
    const style: Phaser.Types.GameObjects.Text.TextStyle = {
      color: '#f7f4ed', fontFamily: 'Arial, sans-serif', fontSize: '17px', fontStyle: 'bold'
    }
    this.relicText = this.add.text(38, 28, `0/${RUN_COMPLETION_TARGET} RELICS`, style).setDepth(101)
    this.objectiveText = this.add.text(480, 28, 'REACH THE NEXT RELIC', { ...style, color: '#ffd166' }).setOrigin(0.5, 0).setDepth(101)
    this.timeText = this.add.text(920, 25, '75s', { ...style, fontSize: '20px' }).setOrigin(1, 0).setDepth(101)
    this.heartText = this.add.text(920, 51, 'HEARTS 3/3', { ...style, color: '#ef7d9a', fontSize: '12px' }).setOrigin(1, 0).setDepth(101)
    this.phaseShade = this.add.rectangle(480, 270, 960, 540, 0x0d0b12, 0.72).setDepth(110).setVisible(false)
    this.phaseTitle = this.add.text(480, 238, '', {
      color: '#ffd166', fontFamily: 'Georgia, serif', fontSize: '40px', fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(111).setVisible(false)
    this.phaseDetail = this.add.text(480, 303, '', {
      align: 'center', color: '#f7f4ed', fontFamily: 'Arial, sans-serif', fontSize: '17px', lineSpacing: 8
    }).setOrigin(0.5).setDepth(111).setVisible(false)
    this.services.bus.on(GAME_EVENTS.snapshot, this.onSnapshot)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this)
  }

  private renderSnapshot(snapshot: RunSnapshot): void {
    this.relicText?.setText(`${snapshot.relics}/${RUN_COMPLETION_TARGET} RELICS / ${snapshot.score} PTS`)
    this.timeText?.setText(`${snapshot.remainingSeconds}s`)
    this.heartText?.setText(`HEARTS ${snapshot.hearts}/3`)
    const showOverlay = snapshot.phase !== 'playing'
    this.phaseShade?.setVisible(showOverlay)
    this.phaseTitle?.setVisible(showOverlay)
    this.phaseDetail?.setVisible(showOverlay)
    if (snapshot.phase === 'paused') {
      this.phaseTitle?.setText('ASCENT PAUSED')
      this.phaseDetail?.setText('Hold the line.')
    } else if (snapshot.phase === 'game-over') {
      this.phaseTitle?.setText(snapshot.terminalKind === 'success' ? 'ASCENT COMPLETE' : 'ASCENT LOST')
      this.phaseDetail?.setText(`${snapshot.relics} RELICS\n${snapshot.score} POINTS / BEST CHAIN ${snapshot.bestChain}`)
    }
  }

  private shutdown(): void {
    this.services.bus.off(GAME_EVENTS.snapshot, this.onSnapshot)
  }
}
