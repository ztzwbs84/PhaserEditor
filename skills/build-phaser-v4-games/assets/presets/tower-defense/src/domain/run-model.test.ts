import { describe, expect, it } from 'vitest'
import { RunModel } from './run-model'

describe('Tower defense RunModel', () => {
  it('scores interceptions with a bounded chain', () => {
    const model = new RunModel(3, 20)
    expect(model.intercept()).toBe(125)
    expect(model.intercept()).toBe(250)
    for (let index = 0; index < 10; index += 1) model.intercept()
    expect(model.snapshot().chain).toBe(8)
  })

  it('advances the wave from defended enemies', () => {
    const model = new RunModel(3, 10)
    model.intercept()
    model.intercept()
    expect(model.snapshot()).toMatchObject({ intercepts: 2, wave: 2 })
  })

  it('ends in failure after ordinary core breaches', () => {
    const model = new RunModel(2, 10)
    expect(model.breach()).toBe(true)
    expect(model.breach()).toBe(true)
    expect(model.snapshot()).toMatchObject({ phase: 'game-over', outcome: 'core-breached', terminalKind: 'failure', core: 0 })
  })

  it('wins at the interception target and rejects terminal actions', () => {
    const model = new RunModel(3, 2)
    model.intercept()
    model.intercept()
    expect(model.snapshot()).toMatchObject({ phase: 'game-over', outcome: 'sector-defended', terminalKind: 'success', intercepts: 2 })
    expect(model.intercept()).toBe(0)
    expect(model.breach()).toBe(false)
    expect(model.togglePause()).toBe('game-over')
  })

  it('pauses and resumes without changing state', () => {
    const model = new RunModel()
    expect(model.togglePause()).toBe('paused')
    expect(model.snapshot()).toMatchObject({ intercepts: 0, core: 3 })
    expect(model.togglePause()).toBe('playing')
  })

  it('resets progression, pressure, and terminal state', () => {
    const model = new RunModel(3, 1)
    model.intercept()
    model.reset()
    expect(model.snapshot()).toMatchObject({ phase: 'playing', outcome: null, intercepts: 0, core: 3, score: 0, chain: 1, wave: 1 })
  })
})
