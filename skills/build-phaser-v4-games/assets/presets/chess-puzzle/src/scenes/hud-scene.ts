import Phaser from 'phaser'
import { RUN_COMPLETION_TARGET, type RunSnapshot } from '../domain/run-model'
import { GAME_EVENTS, type GameServices } from '../services'

export class HudScene extends Phaser.Scene {
  private puzzleText?: Phaser.GameObjects.Text
  private motifText?: Phaser.GameObjects.Text
  private attemptsText?: Phaser.GameObjects.Text
  private moveText?: Phaser.GameObjects.Text
  private phaseText?: Phaser.GameObjects.Text

  private readonly onSnapshot = (snapshot: RunSnapshot) => {
    this.puzzleText?.setText(`PUZZLES ${snapshot.puzzles} / ${RUN_COMPLETION_TARGET}`)
    this.motifText?.setText(`PUZZLE ${snapshot.puzzle}  /  ${snapshot.motif.toUpperCase()}`)
    this.attemptsText?.setText(`ATTEMPTS ${snapshot.attempts}`)
    this.moveText?.setText(snapshot.lastMove ? `LAST MOVE  ${snapshot.lastMove}` : 'WHITE TO MOVE')
    this.phaseText?.setText(snapshot.phase === 'paused'
      ? 'POSITION PAUSED'
      : snapshot.phase === 'game-over'
        ? snapshot.terminalKind === 'success' ? 'ARCHIVE CLEARED' : 'ATTEMPTS EXHAUSTED'
        : '')
    this.phaseText?.setVisible(snapshot.phase !== 'playing')
  }

  constructor(private readonly services: GameServices) { super('hud') }

  create(): void {
    const panel = this.add.graphics().setDepth(100)
    panel.fillStyle(0x111718, 0.94).fillRoundedRect(24, 16, 912, 52, 5)
    panel.lineStyle(1, 0x526765, 1).strokeRoundedRect(24, 16, 912, 52, 5)
    const style: Phaser.Types.GameObjects.Text.TextStyle = {
      color: '#f5f7f2', fontFamily: 'Arial, sans-serif', fontSize: '17px', fontStyle: 'bold'
    }
    this.puzzleText = this.add.text(44, 34, `PUZZLES 0 / ${RUN_COMPLETION_TARGET}`, style).setDepth(101)
    this.motifText = this.add.text(480, 34, 'PUZZLE 1', style).setOrigin(0.5, 0).setDepth(101)
    this.attemptsText = this.add.text(916, 34, 'ATTEMPTS 3', style).setOrigin(1, 0).setDepth(101)
    this.moveText = this.add.text(720, 382, 'WHITE TO MOVE', {
      color: '#8ea4a4', fontFamily: 'Arial, sans-serif', fontSize: '14px'
    }).setOrigin(0.5).setDepth(101)
    this.phaseText = this.add.text(480, 270, '', {
      ...style, backgroundColor: '#111718', color: '#e7c66a', fontSize: '34px', padding: { x: 28, y: 16 }
    }).setOrigin(0.5).setDepth(102).setVisible(false)
    this.services.bus.on(GAME_EVENTS.snapshot, this.onSnapshot)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this)
  }

  private shutdown(): void {
    this.services.bus.off(GAME_EVENTS.snapshot, this.onSnapshot)
  }
}
