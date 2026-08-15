import { describe, expect, it } from 'vitest'
import { RunModel } from './run-model'

describe('Breakout RunModel', () => {
  it('scores bricks with a bounded chain', () => {
    const model = new RunModel(3, 20)
    expect(model.breakBrick()).toBe(100)
    expect(model.breakBrick()).toBe(200)
    for (let index = 0; index < 10; index += 1) model.breakBrick()
    expect(model.snapshot().chain).toBe(8)
  })

  it('advances the round from cleared bricks', () => {
    const model = new RunModel(3, 10)
    model.breakBrick()
    model.breakBrick()
    expect(model.snapshot()).toMatchObject({ bricks: 2, round: 2 })
  })

  it('ends in failure after ordinary ball drops', () => {
    const model = new RunModel(2, 10)
    expect(model.dropBall()).toBe(true)
    expect(model.dropBall()).toBe(true)
    expect(model.snapshot()).toMatchObject({ phase: 'game-over', outcome: 'balls-depleted', terminalKind: 'failure', balls: 0 })
  })

  it('wins at the brick target and rejects terminal actions', () => {
    const model = new RunModel(3, 2)
    model.breakBrick()
    model.breakBrick()
    expect(model.snapshot()).toMatchObject({ phase: 'game-over', outcome: 'wall-cleared', terminalKind: 'success', bricks: 2 })
    expect(model.breakBrick()).toBe(0)
    expect(model.dropBall()).toBe(false)
    expect(model.togglePause()).toBe('game-over')
  })

  it('pauses and resumes without changing state', () => {
    const model = new RunModel()
    expect(model.togglePause()).toBe('paused')
    expect(model.snapshot()).toMatchObject({ bricks: 0, balls: 3 })
    expect(model.togglePause()).toBe('playing')
  })

  it('resets progression, pressure, and terminal state', () => {
    const model = new RunModel(3, 1)
    model.breakBrick()
    model.reset()
    expect(model.snapshot()).toMatchObject({ phase: 'playing', outcome: null, bricks: 0, balls: 3, score: 0, chain: 1, round: 1 })
  })
})
