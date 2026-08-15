import { describe, expect, it } from 'vitest'
import { RunModel } from './run-model'

describe('Courier RunModel', () => {
  it('accepts only the matching beacon', () => {
    const model = new RunModel()
    expect(model.pickup('north')).toBe(true)
    expect(model.deliver('east')).toEqual({ accepted: false, points: 0 })
    expect(model.deliver('north').accepted).toBe(true)
    expect(model.snapshot().deliveries).toBe(1)
  })

  it('rewards fast streak deliveries', () => {
    const fast = new RunModel(75_000, 3, 8)
    fast.pickup('west')
    const first = fast.deliver('west').points
    fast.pickup('south')
    expect(fast.deliver('south').points).toBeGreaterThan(first)
    expect(fast.snapshot().bestStreak).toBe(2)
  })

  it('expires cargo and extinguishes after repeated losses', () => {
    const model = new RunModel(75_000, 2, 8)
    for (const destination of ['north', 'east'] as const) {
      model.pickup(destination)
      for (let index = 0; index < 110; index += 1) model.update(100)
    }
    expect(model.snapshot().phase).toBe('game-over')
    expect(model.snapshot()).toMatchObject({ outcome: 'extinguished', terminalKind: 'failure' })
  })

  it('stops route clocks while paused', () => {
    const model = new RunModel(1_000, 3, 8)
    model.pickup('south')
    for (let index = 0; index < 5; index += 1) model.update(100)
    const before = model.snapshot()
    model.togglePause()
    model.update(500)
    expect(model.snapshot()).toEqual({ ...before, phase: 'paused' })
  })

  it('clamps a suspended-tab delta', () => {
    const model = new RunModel(1_000, 3, 8)
    model.update(10_000)
    expect(model.snapshot().remainingSeconds).toBe(1)
  })

  it('wins at the delivery target and rejects post-terminal input', () => {
    const model = new RunModel(75_000, 3, 2)
    model.pickup('north')
    model.deliver('north')
    model.pickup('east')
    expect(model.deliver('east').accepted).toBe(true)
    expect(model.snapshot()).toMatchObject({ phase: 'game-over', outcome: 'deliveries-complete', terminalKind: 'success', deliveries: 2 })
    expect(model.pickup('south')).toBe(false)
    expect(model.deliver('south')).toEqual({ accepted: false, points: 0 })
    expect(model.damage()).toEqual({ applied: false, lostCargo: false, ended: false })
    expect(model.togglePause()).toBe('game-over')
  })

  it('treats time expiry as failure and resets every terminal field', () => {
    const model = new RunModel(200, 3, 8)
    model.update(100)
    model.update(100)
    expect(model.snapshot()).toMatchObject({ outcome: 'time-expired', terminalKind: 'failure' })
    model.reset()
    expect(model.snapshot()).toMatchObject({ phase: 'playing', outcome: null, terminalKind: null, deliveries: 0, integrity: 3 })
  })
})
