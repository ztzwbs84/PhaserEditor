import { Chess } from 'chess.js'
import { describe, expect, it } from 'vitest'
import { PUZZLES, RunModel } from './run-model'

describe('Chess puzzle RunModel', () => {
  it('ships valid positions with one unique checkmate and a legal decoy', () => {
    for (const puzzle of PUZZLES) {
      const chess = new Chess(puzzle.fen)
      const mates = chess.moves({ verbose: true }).filter((move) => {
        chess.move(move)
        const mate = chess.isCheckmate()
        chess.undo()
        return mate
      })
      expect(mates.map((move) => `${move.from}${move.to}`)).toEqual([`${puzzle.activeSquare}${puzzle.solutionTarget}`])
      chess.move({ from: puzzle.activeSquare, to: puzzle.decoyTarget })
      expect(chess.isCheckmate()).toBe(false)
    }
  })

  it('advances only after the rules engine confirms checkmate', () => {
    const model = new RunModel()
    expect(model.tryMove('g1', 'g2')).toMatchObject({ accepted: true, solved: false, san: 'Rg2' })
    expect(model.snapshot()).toMatchObject({ puzzles: 0, attempts: 2 })
    expect(model.tryMove('g1', 'h1')).toMatchObject({ accepted: true, solved: true, san: 'Rh1#' })
    expect(model.snapshot()).toMatchObject({ puzzles: 1, attempts: 2, puzzle: 2 })
  })

  it('rejects illegal moves without spending an attempt', () => {
    const model = new RunModel()
    expect(model.tryMove('g1', 'a1')).toEqual({ accepted: false, solved: false, san: null })
    expect(model.snapshot()).toMatchObject({ puzzles: 0, attempts: 3 })
  })

  it('wins after all three engine-confirmed mates and locks terminal input', () => {
    const model = new RunModel()
    for (const puzzle of PUZZLES) expect(model.tryMove(puzzle.activeSquare, puzzle.solutionTarget).solved).toBe(true)
    expect(model.snapshot()).toMatchObject({ phase: 'game-over', outcome: 'tactics-complete', terminalKind: 'success', puzzles: 3 })
    expect(model.tryMove('g8', 'h8').accepted).toBe(false)
    expect(model.togglePause()).toBe('game-over')
  })

  it('fails after three ordinary legal wrong moves', () => {
    const model = new RunModel()
    for (let index = 0; index < 3; index += 1) expect(model.tryMove('g1', 'g2').accepted).toBe(true)
    expect(model.snapshot()).toMatchObject({ phase: 'game-over', outcome: 'attempts-exhausted', terminalKind: 'failure', attempts: 0 })
  })

  it('pauses and resets without changing the puzzle contract', () => {
    const model = new RunModel()
    expect(model.togglePause()).toBe('paused')
    expect(model.togglePause()).toBe('playing')
    model.tryMove('g1', 'g2')
    model.reset()
    expect(model.snapshot()).toMatchObject({ phase: 'playing', puzzles: 0, attempts: 3, score: 0, puzzle: 1 })
  })
})
