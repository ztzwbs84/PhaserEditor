import { describe, expect, it } from 'vitest'
import { AcceptedInputCounters } from './accepted-input-counters'

describe('AcceptedInputCounters', () => {
  it('publishes exactly the declared modes and increments accepted intent', () => {
    const counters = new AcceptedInputCounters(['pointer:click', 'key:pulse'] as const)
    counters.accept('key:pulse')
    expect(counters.snapshot()).toEqual({ 'pointer:click': 0, 'key:pulse': 1 })
  })

  it('resets every mode for a new run and returns detached snapshots', () => {
    const counters = new AcceptedInputCounters(['pointer:click'] as const)
    counters.accept('pointer:click')
    const snapshot = counters.snapshot()
    snapshot['pointer:click'] = 99
    expect(counters.snapshot()['pointer:click']).toBe(1)
    counters.reset()
    expect(counters.snapshot()['pointer:click']).toBe(0)
  })

  it('rejects an empty or duplicate declaration', () => {
    expect(() => new AcceptedInputCounters([])).toThrow(/unique and non-empty/)
    expect(() => new AcceptedInputCounters(['pointer:click', 'pointer:click'])).toThrow(/unique and non-empty/)
  })
})
