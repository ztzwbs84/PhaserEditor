import Phaser from 'phaser'
import './style.css'

class MainScene extends Phaser.Scene {
  constructor() {
    super('MainScene')
  }

  create(): void {
    const centerX = this.scale.width / 2
    const centerY = this.scale.height / 2
    this.add.text(centerX, centerY - 24, 'Phaser 4', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '42px',
      color: '#ffffff'
    }).setOrigin(0.5)
    this.add.text(centerX, centerY + 28, 'Created with Phaser Editor', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '18px',
      color: '#8dd9ff'
    }).setOrigin(0.5)
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#15171b',
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: '100%',
    height: '100%'
  },
  scene: MainScene
})
