import { describe, expect, it } from 'vitest'
import { RunModel } from './run-model'

describe('platform ascent run model', () => {
  it('scores relic height and advances the chain', () => {
    const model = new RunModel(75_000, 3, 8)
    expect(model.collect(35)).toBe(115)
    expect(model.snapshot()).toMatchObject({ relics: 1, score: 115, chain: 2 })
  })

  it('resets the chain when damage applies', () => {
    const model = new RunModel(75_000, 3, 8)
    model.collect(0)
    expect(model.damage()).toEqual({ applied: true, ended: false })
    expect(model.snapshot()).toMatchObject({ hearts: 2, chain: 1 })
  })

  it('enforces the damage cooldown', () => {
    const model = new RunModel(75_000, 3, 8)
    expect(model.damage().applied).toBe(true)
    expect(model.damage().applied).toBe(false)
    model.update(1_100)
    for (let index = 0; index < 10; index += 1) model.update(100)
    expect(model.damage().applied).toBe(true)
  })

  it('ends after the last heart and ignores pause', () => {
    const model = new RunModel(75_000, 1, 8)
    expect(model.damage()).toEqual({ applied: true, ended: true })
    expect(model.snapshot()).toMatchObject({ phase: 'game-over', outcome: 'hearts-depleted', terminalKind: 'failure', hearts: 0 })
    expect(model.togglePause()).toBe('game-over')
  })

  it('clamps large deltas and supports a clean reset', () => {
    const model = new RunModel(200, 3, 8)
    model.update(10_000)
    expect(model.snapshot().phase).toBe('playing')
    model.update(10_000)
    expect(model.snapshot()).toMatchObject({ phase: 'game-over', outcome: 'time-expired', terminalKind: 'failure' })
    model.reset()
    expect(model.snapshot()).toMatchObject({ phase: 'playing', outcome: null, terminalKind: null, relics: 0, score: 0, hearts: 3, chain: 1 })
  })

  it('wins at the relic target and ignores post-terminal input', () => {
    const model = new RunModel(75_000, 3, 2)
    model.collect(0)
    model.collect(0)
    expect(model.snapshot()).toMatchObject({ phase: 'game-over', outcome: 'relics-complete', terminalKind: 'success', relics: 2 })
    expect(model.collect(0)).toBe(0)
    expect(model.damage()).toEqual({ applied: false, ended: false })
    expect(model.togglePause()).toBe('game-over')
  })
})
