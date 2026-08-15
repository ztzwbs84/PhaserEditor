import { describe, expect, it } from 'vitest'
import { RunModel } from './run-model'

describe('Shooter RunModel', () => {
  it('scores destroyed raiders with a bounded chain', () => {
    const model = new RunModel(3, 20)
    expect(model.destroyRaider()).toBe(100)
    expect(model.destroyRaider()).toBe(200)
    for (let index = 0; index < 10; index += 1) model.destroyRaider()
    expect(model.snapshot().chain).toBe(8)
  })

  it('advances waves from actual kills', () => {
    const model = new RunModel(3, 10)
    expect(model.snapshot().wave).toBe(1)
    model.destroyRaider()
    model.destroyRaider()
    expect(model.snapshot()).toMatchObject({ kills: 2, wave: 2 })
  })

  it('applies shield damage only after the cooldown', () => {
    const model = new RunModel(2, 10)
    expect(model.damage()).toBe(true)
    expect(model.damage()).toBe(false)
    for (let index = 0; index < 10; index += 1) model.update(100)
    expect(model.damage()).toBe(true)
    expect(model.snapshot()).toMatchObject({ phase: 'game-over', outcome: 'shield-depleted', terminalKind: 'failure' })
  })

  it('freezes cooldown state while paused', () => {
    const model = new RunModel(3, 10)
    model.damage()
    model.togglePause()
    model.update(10_000)
    model.togglePause()
    expect(model.damage()).toBe(false)
  })

  it('wins at the kill target and rejects terminal actions', () => {
    const model = new RunModel(3, 2)
    model.destroyRaider()
    model.destroyRaider()
    expect(model.snapshot()).toMatchObject({ phase: 'game-over', outcome: 'sector-cleared', terminalKind: 'success', kills: 2 })
    expect(model.destroyRaider()).toBe(0)
    expect(model.damage()).toBe(false)
    expect(model.togglePause()).toBe('game-over')
  })

  it('resets progress, pressure, and terminal state', () => {
    const model = new RunModel(3, 1)
    model.destroyRaider()
    model.reset()
    expect(model.snapshot()).toMatchObject({ phase: 'playing', outcome: null, kills: 0, score: 0, shield: 3, chain: 1, wave: 1 })
  })
})
