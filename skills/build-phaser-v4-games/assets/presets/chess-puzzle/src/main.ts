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
  controls.announce(paused ? (automatic ? 'Puzzle paused after losing focus' : 'Puzzle paused') : 'Puzzle resumed')
})
services.bus.on(GAME_EVENTS.snapshot, (snapshot: RunSnapshot) => {
  controls.setSnapshot(snapshot)
  if (snapshot.phase === 'game-over') controls.announce(snapshot.terminalKind === 'success'
    ? `Tactics complete. ${snapshot.puzzles} checkmates found. Score ${snapshot.score}`
    : `Attempts exhausted after ${snapshot.puzzles} solved tactics. Score ${snapshot.score}`)
  else controls.announce(`${snapshot.motif}. Find checkmate in one.`)
})

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#111718',
  width: 960,
  height: 540,
  render: { antialias: true, pixelArt: false, powerPreference: 'high-performance' },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_HORIZONTALLY, width: 960, height: 540 },
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
