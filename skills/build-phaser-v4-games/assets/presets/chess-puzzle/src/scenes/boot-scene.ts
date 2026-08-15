import Phaser from 'phaser'
import type { GameServices } from '../services'

const ASSETS = [
  ['board', 'assets/board.svg'],
  ['rook-light', 'assets/rook-light.svg'],
  ['king-light', 'assets/king-light.svg'],
  ['king-dark', 'assets/king-dark.svg'],
  ['tactics-seal', 'assets/tactics-seal.svg']
] as const

export class BootScene extends Phaser.Scene {
  private progressText?: Phaser.GameObjects.Text
  private failedFiles = 0
  private readonly onProgress = (progress: number) => this.progressText?.setText(`${Math.round(progress * 100)}%`)
  private readonly onLoadError = () => { this.failedFiles += 1 }
  private readonly retryLoad = () => {
    this.input.keyboard?.off('keydown-ENTER', this.retryLoad)
    this.input.keyboard?.off('keydown-SPACE', this.retryLoad)
    this.scene.restart()
  }

  constructor(private readonly services: GameServices) { super('boot') }

  preload(): void {
    this.failedFiles = 0
    this.cameras.main.setBackgroundColor('#111718')
    this.add.text(480, 236, __GAME_TITLE_JSON__, {
      color: '#e7c66a', fontFamily: 'Arial, sans-serif', fontSize: '34px', fontStyle: 'bold'
    }).setOrigin(0.5)
    this.progressText = this.add.text(480, 286, '0%', {
      color: '#f5f7f2', fontFamily: 'Arial, sans-serif', fontSize: '18px'
    }).setOrigin(0.5)
    this.load.on(Phaser.Loader.Events.PROGRESS, this.onProgress)
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, this.onLoadError)
    for (const [key, url] of ASSETS) this.load.svg(key, url)
  }

  create(): void {
    this.load.off(Phaser.Loader.Events.PROGRESS, this.onProgress)
    this.load.off(Phaser.Loader.Events.FILE_LOAD_ERROR, this.onLoadError)
    if (this.failedFiles > 0) {
      document.documentElement.dataset.gameState = 'load-error'
      this.progressText?.setText('Puzzle archive unavailable')
      const retry = this.add.text(480, 330, 'Retry', {
        backgroundColor: '#d85b52', color: '#111718', fontFamily: 'Arial, sans-serif', fontSize: '18px', padding: { x: 18, y: 10 }
      }).setOrigin(0.5).setInteractive({ useHandCursor: true })
      retry.once(Phaser.Input.Events.POINTER_UP, this.retryLoad)
      this.input.keyboard?.once('keydown-ENTER', this.retryLoad)
      this.input.keyboard?.once('keydown-SPACE', this.retryLoad)
      return
    }
    document.documentElement.dataset.gameState = 'ready'
    this.services.audio.setMuted(this.services.profile.snapshot().settings.muted)
    this.scene.start('game')
    this.scene.launch('hud')
  }
}
