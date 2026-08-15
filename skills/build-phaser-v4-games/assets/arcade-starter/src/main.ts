import Phaser from 'phaser'
import './style.css'
import { BootScene } from './scenes/boot-scene'
import { GameScene } from './scenes/game-scene'
import { HudScene } from './scenes/hud-scene'
import { GameServices } from './services'
import type { RunSnapshot } from './domain/run-model'
import { DomControls } from './ui/dom-controls'

const services = new GameServices()
const controls = new DomControls(services)

services.bus.on('ui:paused', (paused: boolean, automatic: boolean) => {
  controls.setPaused(paused)
  controls.announce(paused ? (automatic ? 'Game paused after losing focus' : 'Game paused') : 'Game resumed')
})
services.bus.on('run:snapshot', (snapshot: RunSnapshot) => {
  controls.setSnapshot(snapshot)
  if (snapshot.phase === 'game-over') controls.announce(snapshot.terminalKind === 'success'
    ? `Signal secured. Score ${snapshot.score}`
    : `Run lost. Score ${snapshot.score}`)
  else if (snapshot.phase === 'playing' && snapshot.score === 0) controls.announce('Collect signals and avoid drones')
})

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#10171c',
  width: 960,
  height: 540,
  render: {
    antialias: true,
    pixelArt: false,
    powerPreference: 'high-performance'
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_HORIZONTALLY,
    width: 960,
    height: 540
  },
  physics: {
    default: 'arcade',
    arcade: { gravity: { x: 0, y: 0 }, debug: false }
  },
  scene: [new BootScene(services), new GameScene(services), new HudScene(services)]
})

const destroy = () => {
  window.removeEventListener('beforeunload', destroy)
  controls.destroy()
  void services.destroy()
  game.destroy(true, false)
}

window.addEventListener('beforeunload', destroy)
