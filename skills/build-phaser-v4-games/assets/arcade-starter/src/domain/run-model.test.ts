import { describe, expect, it } from 'vitest'
import { RunModel } from './run-model'

describe('RunModel', () => {
  it('scores a growing bounded combo', () => {
    const model = new RunModel(60_000, 3, 10_000)
    expect(model.collect()).toBe(10)
    expect(model.collect()).toBe(20)
    for (let index = 0; index < 10; index += 1) model.collect()
    expect(model.snapshot().combo).toBe(8)
  })

  it('applies damage cooldown before ending the run', () => {
    const model = new RunModel(60_000, 2, 1_000)
    expect(model.damage()).toBe(true)
    expect(model.damage()).toBe(false)
    for (let index = 0; index < 10; index += 1) model.update(100)
    expect(model.damage()).toBe(true)
    expect(model.snapshot()).toMatchObject({ phase: 'game-over', outcome: 'shield-depleted', terminalKind: 'failure' })
  })

  it('stops elapsed time while paused', () => {
    const model = new RunModel(1_000, 3, 1_000)
    for (let index = 0; index < 5; index += 1) model.update(100)
    model.togglePause()
    model.update(500)
    expect(model.snapshot().remainingSeconds).toBe(1)
    model.togglePause()
    for (let index = 0; index < 5; index += 1) model.update(100)
    expect(model.snapshot()).toMatchObject({ phase: 'game-over', outcome: 'time-expired', terminalKind: 'failure' })
  })

  it('clamps a suspended-tab delta', () => {
    const model = new RunModel(1_000, 3, 1_000)
    model.update(10_000)
    expect(model.snapshot().remainingSeconds).toBe(1)
  })

  it('wins at the score target and rejects post-terminal input', () => {
    const model = new RunModel(60_000, 3, 30)
    expect(model.collect()).toBe(10)
    expect(model.collect()).toBe(20)
    expect(model.snapshot()).toMatchObject({ phase: 'game-over', outcome: 'target-reached', terminalKind: 'success', score: 30 })
    expect(model.collect()).toBe(0)
    expect(model.damage()).toBe(false)
    expect(model.togglePause()).toBe('game-over')
  })

  it('resets terminal state and progress for another run', () => {
    const model = new RunModel(60_000, 3, 10)
    model.collect()
    model.reset()
    expect(model.snapshot()).toMatchObject({ phase: 'playing', outcome: null, terminalKind: null, score: 0, shield: 3 })
  })
})
