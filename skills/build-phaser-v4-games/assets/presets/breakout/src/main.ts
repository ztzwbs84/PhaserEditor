import Phaser from 'phaser'
import './style.css'
import type { RunSnapshot } from './domain/run-model'
import { BootScene } from './scenes/boot-scene'
import { GameScene } from './scenes/game-scene'
import { HudScene } from './scenes/hud-scene'
import { GAME_EVENTS, GameServices } from './services'
import { DomControls } from './ui/dom-controls'

const services = new GameServices()
const controls = new DomControls(services)
const gameHost = document.querySelector<HTMLElement>('#game')
const focusGame = () => gameHost?.focus({ preventScroll: true })
gameHost?.addEventListener('pointerdown', focusGame)

services.bus.on(GAME_EVENTS.paused, (paused: boolean, automatic: boolean) => {
  controls.setPaused(paused)
  controls.announce(paused ? (automatic ? 'Game paused after losing focus' : 'Game paused') : 'Game resumed')
})
services.bus.on(GAME_EVENTS.snapshot, (snapshot: RunSnapshot) => {
  controls.setSnapshot(snapshot)
  if (snapshot.phase === 'game-over') controls.announce(snapshot.terminalKind === 'success'
    ? `Prism wall cleared. ${snapshot.bricks} bricks broken. Score ${snapshot.score}`
    : `Final ball lost. ${snapshot.bricks} bricks broken. Score ${snapshot.score}`)
  else controls.announce('Move the paddle and launch at the next prism brick')
})

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#151515',
  width: 960,
  height: 540,
  render: { antialias: true, pixelArt: false, powerPreference: 'high-performance' },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_HORIZONTALLY, width: 960, height: 540 },
  physics: { default: 'arcade', arcade: { gravity: { x: 0, y: 0 }, debug: false } },
  scene: [new BootScene(services), new GameScene(services), new HudScene(services)]
})

const destroy = () => {
  window.removeEventListener('beforeunload', destroy)
  gameHost?.removeEventListener('pointerdown', focusGame)
  controls.destroy()
  void services.destroy()
  game.destroy(true, false)
}

window.addEventListener('beforeunload', destroy)
