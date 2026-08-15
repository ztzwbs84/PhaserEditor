import type { Square } from 'chess.js'
import Phaser from 'phaser'
import { AcceptedInputCounters } from '../domain/accepted-input-counters'
import { RUN_COMPLETION_TARGET, RunModel } from '../domain/run-model'
import { GAME_EVENTS, type GameServices } from '../services'

const WORLD_WIDTH = 960
const WORLD_HEIGHT = 540
const BOARD = { x: 48, y: 46, size: 448, square: 56 }
const FILES = 'abcdefgh'

type CursorKeys = Phaser.Types.Input.Keyboard.CursorKeys & { submit: Phaser.Input.Keyboard.Key }
type InputMode = 'pointer:drag' | 'navigate:directional' | 'key:pulse'

function squareToWorld(square: Square): { x: number; y: number } {
  const file = FILES.indexOf(square[0])
  const rank = Number(square[1])
  return {
    x: BOARD.x + (file + 0.5) * BOARD.square,
    y: BOARD.y + (8 - rank + 0.5) * BOARD.square
  }
}

function worldToSquare(x: number, y: number): Square | null {
  const file = Math.floor((x - BOARD.x) / BOARD.square)
  const row = Math.floor((y - BOARD.y) / BOARD.square)
  if (file < 0 || file > 7 || row < 0 || row > 7) return null
  return `${FILES[file]}${8 - row}` as Square
}

export class GameScene extends Phaser.Scene {
  private readonly model = new RunModel()
  private readonly acceptedInputs = new AcceptedInputCounters<InputMode>(['pointer:drag', 'navigate:directional', 'key:pulse'])
  private boardPieces: Phaser.GameObjects.Image[] = []
  private selection?: Phaser.GameObjects.Rectangle
  private solutionHint?: Phaser.GameObjects.Rectangle
  private cursorSquare: Square = 'g1'
  private dragStart: Square | null = null
  private keys?: CursorKeys
  private autoPaused = false
  private finished = false
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  private readonly onPauseRequest = () => this.togglePause()
  private readonly onRestartRequest = () => this.scene.restart()
  private readonly onBlur = () => {
    if (this.model.phase === 'playing') {
      this.autoPaused = true
      this.togglePause()
    }
  }
  private readonly onPointerDown = (pointer: Phaser.Input.Pointer) => {
    if (this.model.phase !== 'playing') return
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y)
    const square = worldToSquare(world.x, world.y)
    if (square === this.model.currentPuzzle.activeSquare) {
      this.dragStart = square
      this.cursorSquare = square
      this.updateHighlights()
      this.services.audio.playSelect()
    } else this.dragStart = null
  }
  private readonly onPointerUp = (pointer: Phaser.Input.Pointer) => {
    if (!this.dragStart || this.model.phase !== 'playing') {
      this.dragStart = null
      return
    }
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y)
    const target = worldToSquare(world.x, world.y)
    const source = this.dragStart
    this.dragStart = null
    if (target) this.submitMove(source, target, 'pointer:drag')
  }

  constructor(private readonly services: GameServices) { super('game') }

  init(): void {
    this.model.reset()
    this.cursorSquare = this.model.currentPuzzle.activeSquare
    this.dragStart = null
    this.boardPieces = []
    this.autoPaused = false
    this.finished = false
    this.acceptedInputs.reset()
  }

  create(): void {
    this.services.beginRun()
    document.documentElement.dataset.gameState = 'playing'
    const previousRun = Number(document.documentElement.dataset.gameRun ?? '0')
    document.documentElement.dataset.gameRun = String(previousRun + 1)
    this.add.image(BOARD.x + BOARD.size / 2, BOARD.y + BOARD.size / 2, 'board')
    this.add.image(720, 112, 'tactics-seal').setScale(0.82)
    this.add.text(720, 216, 'TACTICAL ARCHIVE', {
      color: '#e7c66a', fontFamily: 'Arial, sans-serif', fontSize: '15px', fontStyle: 'bold'
    }).setOrigin(0.5)
    this.add.text(720, 247, 'CHECKMATE IN ONE', {
      color: '#f5f7f2', fontFamily: 'Arial, sans-serif', fontSize: '28px', fontStyle: 'bold'
    }).setOrigin(0.5)
    this.add.text(720, 302, 'LEGAL MOVES', {
      color: '#8ea4a4', fontFamily: 'Arial, sans-serif', fontSize: '12px'
    }).setOrigin(0.5)
    this.add.text(720, 326, 'VERIFIED BY CHESS.JS', {
      color: '#67d4c2', fontFamily: 'Arial, sans-serif', fontSize: '16px', fontStyle: 'bold'
    }).setOrigin(0.5)

    this.selection = this.add.rectangle(0, 0, BOARD.square - 8, BOARD.square - 8)
      .setStrokeStyle(4, 0xe7c66a, 1).setDepth(8)
    this.solutionHint = this.add.rectangle(0, 0, BOARD.square - 18, BOARD.square - 18)
      .setStrokeStyle(2, 0x67d4c2, 0.65).setDepth(7)
    this.keys = this.createKeys()
    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown)
    this.input.on(Phaser.Input.Events.POINTER_UP, this.onPointerUp)
    this.services.bus.on(GAME_EVENTS.pause, this.onPauseRequest)
    this.services.bus.on(GAME_EVENTS.restart, this.onRestartRequest)
    this.game.events.on(Phaser.Core.Events.BLUR, this.onBlur)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this)
    this.renderPosition()
    this.publishSnapshot()
  }

  update(): void {
    if (!this.keys || this.model.phase !== 'playing') return
    const direction = Phaser.Input.Keyboard.JustDown(this.keys.left) ? [-1, 0]
      : Phaser.Input.Keyboard.JustDown(this.keys.right) ? [1, 0]
        : Phaser.Input.Keyboard.JustDown(this.keys.up) ? [0, 1]
          : Phaser.Input.Keyboard.JustDown(this.keys.down) ? [0, -1]
            : null
    if (direction && this.moveCursor(direction[0], direction[1])) {
      this.acceptedInputs.accept('navigate:directional')
      this.services.audio.playSelect()
      this.publishSnapshot()
    }
    if (Phaser.Input.Keyboard.JustDown(this.keys.submit)) {
      this.submitMove(this.model.currentPuzzle.activeSquare, this.cursorSquare, 'key:pulse')
    }
  }

  private createKeys(): CursorKeys {
    const keyboard = this.input.keyboard
    if (!keyboard) throw new Error('Keyboard input plugin is unavailable.')
    const cursors = keyboard.createCursorKeys()
    return { ...cursors, submit: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE) }
  }

  private moveCursor(fileDelta: number, rankDelta: number): boolean {
    const file = Phaser.Math.Clamp(FILES.indexOf(this.cursorSquare[0]) + fileDelta, 0, 7)
    const rank = Phaser.Math.Clamp(Number(this.cursorSquare[1]) + rankDelta, 1, 8)
    const next = `${FILES[file]}${rank}` as Square
    if (next === this.cursorSquare) return false
    this.cursorSquare = next
    this.updateHighlights()
    return true
  }

  private submitMove(from: Square, to: Square, mode: Extract<InputMode, 'pointer:drag' | 'key:pulse'>): void {
    const result = this.model.tryMove(from, to)
    if (!result.accepted) return
    this.acceptedInputs.accept(mode)
    if (result.solved) {
      this.services.audio.playCorrect(this.model.snapshot().puzzles)
      if (!this.reducedMotion) this.cameras.main.flash(110, 103, 212, 194, true)
    } else {
      this.services.audio.playWrong()
      if (!this.reducedMotion) this.cameras.main.shake(120, 0.006)
    }
    this.cursorSquare = this.model.currentPuzzle.activeSquare
    this.renderPosition()
    this.publishSnapshot()
    if (this.model.phase === 'game-over') this.finishRun()
  }

  private renderPosition(): void {
    for (const piece of this.boardPieces) piece.destroy()
    this.boardPieces = this.model.pieces().map((piece) => {
      const position = squareToWorld(piece.square)
      const key = piece.type === 'r' ? 'rook-light' : piece.color === 'w' ? 'king-light' : 'king-dark'
      return this.add.image(position.x, position.y, key).setDepth(6)
    })
    this.updateHighlights()
  }

  private updateHighlights(): void {
    const cursor = squareToWorld(this.cursorSquare)
    const solution = squareToWorld(this.model.currentPuzzle.solutionTarget)
    this.selection?.setPosition(cursor.x, cursor.y)
    this.solutionHint?.setPosition(solution.x, solution.y)
  }

  private togglePause(): void {
    if (this.model.phase === 'game-over') return
    const phase = this.model.togglePause()
    document.documentElement.dataset.gameState = phase
    this.services.bus.emit(GAME_EVENTS.paused, phase === 'paused', this.autoPaused)
    this.autoPaused = false
    this.publishSnapshot()
  }

  private finishRun(): void {
    if (this.finished) return
    this.finished = true
    document.documentElement.dataset.gameState = 'game-over'
    this.services.audio.playEnd(this.model.snapshot().terminalKind === 'success')
    this.publishSnapshot()
  }

  private publishSnapshot(): void {
    const snapshot = this.model.snapshot()
    const source = squareToWorld(this.model.currentPuzzle.activeSquare)
    const solution = squareToWorld(this.model.currentPuzzle.solutionTarget)
    const decoy = squareToWorld(this.model.currentPuzzle.decoyTarget)
    document.documentElement.dataset.playerPosition = `${source.x},${source.y}`
    document.documentElement.dataset.qualityAuxiliaryName = 'puzzle'
    document.documentElement.dataset.qualityAuxiliaryValue = String(snapshot.puzzle)
    document.documentElement.dataset.qualityProgressName = 'puzzles'
    document.documentElement.dataset.qualityProgress = String(snapshot.puzzles)
    document.documentElement.dataset.qualityCompletionTarget = String(RUN_COMPLETION_TARGET)
    document.documentElement.dataset.qualityPressureName = 'attempts'
    document.documentElement.dataset.qualityPressure = String(snapshot.attempts)
    document.documentElement.dataset.qualityMaximumPressure = '3'
    document.documentElement.dataset.qualityPrimaryAction = 'solve-tactic'
    document.documentElement.dataset.qualityInputPlan = JSON.stringify({
      schemaVersion: 1,
      primary: {
        actions: [
          { type: 'pointer', mode: 'drag', holdMs: 90, repeatMs: 260 },
          { type: 'navigate', mode: 'directional', holdMs: 160, repeatMs: 260 },
          { type: 'key', mode: 'pulse', key: ' ', code: 'Space', virtualKeyCode: 32, holdMs: 80, repeatMs: 260 }
        ],
        settleMs: 150
      },
      pressure: {
        actions: [{ type: 'pointer', mode: 'drag', holdMs: 90, repeatMs: 260 }]
      }
    })
    document.documentElement.dataset.qualityAcceptedInputs = JSON.stringify(this.acceptedInputs.snapshot())
    document.documentElement.dataset.qualityPrimaryTargets = JSON.stringify([[solution.x, solution.y]])
    document.documentElement.dataset.qualityPressureTargets = JSON.stringify([[decoy.x, decoy.y]])
    document.documentElement.dataset.qualityWorldWidth = String(WORLD_WIDTH)
    document.documentElement.dataset.qualityWorldHeight = String(WORLD_HEIGHT)
    document.documentElement.dataset.qualityRestartPosition = `${source.x},${source.y}`
    document.documentElement.dataset.qualityTerminalKind = snapshot.terminalKind ?? ''
    document.documentElement.dataset.qualityTerminalReason = snapshot.outcome ?? ''
    this.services.publishSnapshot(snapshot)
  }

  private shutdown(): void {
    this.input.off(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown)
    this.input.off(Phaser.Input.Events.POINTER_UP, this.onPointerUp)
    this.services.bus.off(GAME_EVENTS.pause, this.onPauseRequest)
    this.services.bus.off(GAME_EVENTS.restart, this.onRestartRequest)
    this.game.events.off(Phaser.Core.Events.BLUR, this.onBlur)
    this.boardPieces = []
  }
}
