import Phaser from 'phaser'
import { RUN_COMPLETION_TARGET, type RunSnapshot } from '../domain/run-model'
import { GAME_EVENTS, type GameServices } from '../services'

export class HudScene extends Phaser.Scene {
  private brickText?: Phaser.GameObjects.Text
  private roundText?: Phaser.GameObjects.Text
  private ballText?: Phaser.GameObjects.Text
  private phaseText?: Phaser.GameObjects.Text

  private readonly onSnapshot = (snapshot: RunSnapshot) => {
    this.brickText?.setText(`BRICKS ${snapshot.bricks} / ${RUN_COMPLETION_TARGET}`)
    this.roundText?.setText(`ROUND ${snapshot.round}  /  CHAIN ${snapshot.chain}`)
    this.ballText?.setText(`BALLS ${snapshot.balls}`)
    this.phaseText?.setText(snapshot.phase === 'paused'
      ? 'VOLLEY PAUSED'
      : snapshot.phase === 'game-over'
        ? snapshot.terminalKind === 'success' ? 'PRISM WALL CLEARED' : 'FINAL BALL LOST'
        : '')
    this.phaseText?.setVisible(snapshot.phase !== 'playing')
  }

  constructor(private readonly services: GameServices) { super('hud') }

  create(): void {
    const panel = this.add.graphics().setDepth(100)
    panel.fillStyle(0x151515, 0.93).fillRoundedRect(20, 18, 920, 50, 5)
    panel.lineStyle(1, 0x49636b, 1).strokeRoundedRect(20, 18, 920, 50, 5)
    const style: Phaser.Types.GameObjects.Text.TextStyle = {
      color: '#f6f7f2', fontFamily: 'Arial, sans-serif', fontSize: '18px', fontStyle: 'bold'
    }
    this.brickText = this.add.text(42, 34, `BRICKS 0 / ${RUN_COMPLETION_TARGET}`, style).setDepth(101)
    this.roundText = this.add.text(480, 34, 'ROUND 1  /  CHAIN 1', style).setOrigin(0.5, 0).setDepth(101)
    this.ballText = this.add.text(918, 34, 'BALLS 3', style).setOrigin(1, 0).setDepth(101)
    this.add.text(480, 91, 'PRISM ARRAY ONLINE  /  LOWER BOUNDARY OPEN', {
      color: '#a7c4cc', fontFamily: 'Arial, sans-serif', fontSize: '14px'
    }).setOrigin(0.5).setDepth(101)
    this.phaseText = this.add.text(480, 270, '', {
      ...style, backgroundColor: '#151515', color: '#ffd166', fontSize: '34px', padding: { x: 28, y: 16 }
    }).setOrigin(0.5).setDepth(102).setVisible(false)
    this.services.bus.on(GAME_EVENTS.snapshot, this.onSnapshot)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this)
  }

  private shutdown(): void {
    this.services.bus.off(GAME_EVENTS.snapshot, this.onSnapshot)
  }
}
