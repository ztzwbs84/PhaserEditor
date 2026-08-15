import { Chess, type Color, type PieceSymbol, type Square } from 'chess.js'

export type RunPhase = 'playing' | 'paused' | 'game-over'
export type RunOutcome = 'tactics-complete' | 'attempts-exhausted' | null
export type RunTerminalKind = 'success' | 'failure' | null

export const RUN_COMPLETION_TARGET = 3

export interface PuzzleDefinition {
  id: string
  fen: string
  activeSquare: Square
  solutionTarget: Square
  decoyTarget: Square
  motif: string
}

export const PUZZLES: readonly PuzzleDefinition[] = [
  {
    id: 'sealed-file',
    fen: '8/8/5K1k/8/8/8/8/6R1 w - - 0 1',
    activeSquare: 'g1', solutionTarget: 'h1', decoyTarget: 'g2', motif: 'Seal the first rank'
  },
  {
    id: 'open-channel',
    fen: '8/8/6R1/8/5K1k/8/8/8 w - - 0 1',
    activeSquare: 'g6', solutionTarget: 'h6', decoyTarget: 'g7', motif: 'Close the sixth rank'
  },
  {
    id: 'rook-signal',
    fen: '6R1/8/5K1k/8/8/8/8/8 w - - 0 1',
    activeSquare: 'g8', solutionTarget: 'h8', decoyTarget: 'g7', motif: 'Finish on the eighth'
  }
] as const

export interface BoardPiece {
  square: Square
  type: PieceSymbol
  color: Color
}

export interface MoveResult {
  accepted: boolean
  solved: boolean
  san: string | null
}

export interface RunSnapshot {
  phase: RunPhase
  outcome: RunOutcome
  terminalKind: RunTerminalKind
  puzzles: number
  attempts: number
  score: number
  puzzle: number
  motif: string
  lastMove: string
}

export class RunModel {
  private readonly chess = new Chess()
  private puzzleIndex = 0
  private attemptsValue: number
  private scoreValue = 0
  private phaseValue: RunPhase = 'playing'
  private outcomeValue: RunOutcome = null
  private terminalKindValue: RunTerminalKind = null
  private lastMoveValue = ''

  constructor(
    private readonly maximumAttempts = 3,
    private readonly puzzles: readonly PuzzleDefinition[] = PUZZLES
  ) {
    if (puzzles.length === 0) throw new Error('At least one chess puzzle is required.')
    this.attemptsValue = maximumAttempts
    this.loadPuzzle()
  }

  get phase(): RunPhase { return this.phaseValue }
  get currentPuzzle(): PuzzleDefinition { return this.puzzles[Math.min(this.puzzleIndex, this.puzzles.length - 1)] }

  reset(): void {
    this.puzzleIndex = 0
    this.attemptsValue = this.maximumAttempts
    this.scoreValue = 0
    this.phaseValue = 'playing'
    this.outcomeValue = null
    this.terminalKindValue = null
    this.lastMoveValue = ''
    this.loadPuzzle()
  }

  pieces(): BoardPiece[] {
    const pieces: BoardPiece[] = []
    for (const rank of this.chess.board()) for (const piece of rank) if (piece) pieces.push(piece)
    return pieces
  }

  legalTargets(square: Square): Square[] {
    return this.chess.moves({ square, verbose: true }).map((move) => move.to)
  }

  tryMove(from: Square, to: Square): MoveResult {
    if (this.phaseValue !== 'playing') return { accepted: false, solved: false, san: null }
    let move
    try {
      move = this.chess.move({ from, to, promotion: 'q' })
    } catch {
      return { accepted: false, solved: false, san: null }
    }
    const solved = this.chess.isCheckmate()
    this.lastMoveValue = move.san
    if (solved) {
      this.puzzleIndex += 1
      this.scoreValue += 1_000 + this.attemptsValue * 250
      if (this.puzzleIndex >= this.puzzles.length) this.endRun('tactics-complete', 'success')
      else this.loadPuzzle()
    } else {
      this.attemptsValue = Math.max(0, this.attemptsValue - 1)
      if (this.attemptsValue === 0) this.endRun('attempts-exhausted', 'failure')
      else this.loadPuzzle()
    }
    return { accepted: true, solved, san: move.san }
  }

  togglePause(): RunPhase {
    if (this.phaseValue === 'game-over') return this.phaseValue
    this.phaseValue = this.phaseValue === 'paused' ? 'playing' : 'paused'
    return this.phaseValue
  }

  snapshot(): RunSnapshot {
    return {
      phase: this.phaseValue,
      outcome: this.outcomeValue,
      terminalKind: this.terminalKindValue,
      puzzles: this.puzzleIndex,
      attempts: this.attemptsValue,
      score: this.scoreValue,
      puzzle: Math.min(this.puzzleIndex + 1, this.puzzles.length),
      motif: this.currentPuzzle.motif,
      lastMove: this.lastMoveValue
    }
  }

  private loadPuzzle(): void {
    this.chess.load(this.currentPuzzle.fen)
  }

  private endRun(outcome: Exclude<RunOutcome, null>, terminalKind: Exclude<RunTerminalKind, null>): void {
    this.phaseValue = 'game-over'
    this.outcomeValue = outcome
    this.terminalKindValue = terminalKind
  }
}
