import { describe, expect, it } from 'vitest'
import { RunModel } from './run-model'

describe('Racing RunModel', () => {
  it('scores ordered checkpoints with a bounded streak', () => {
    const model = new RunModel(3, 20)
    expect(model.clearCheckpoint()).toBe(150)
    expect(model.clearCheckpoint()).toBe(300)
    for (let index = 0; index < 10; index += 1) model.clearCheckpoint()
    expect(model.snapshot().streak).toBe(8)
  })

  it('keeps the single-lap race label stable through the finish', () => {
    const model = new RunModel(3, 4)
    model.clearCheckpoint()
    expect(model.snapshot().lap).toBe(1)
    model.clearCheckpoint()
    model.clearCheckpoint()
    model.clearCheckpoint()
    expect(model.snapshot().lap).toBe(1)
  })

  it('ends in failure after ordinary barrier crashes', () => {
    const model = new RunModel(2, 10)
    expect(model.crash()).toBe(true)
    expect(model.crash()).toBe(true)
    expect(model.snapshot()).toMatchObject({ phase: 'game-over', outcome: 'chassis-wrecked', terminalKind: 'failure', chassis: 0 })
  })

  it('wins at the checkpoint target and rejects terminal actions', () => {
    const model = new RunModel(3, 2)
    model.clearCheckpoint()
    model.clearCheckpoint()
    expect(model.snapshot()).toMatchObject({ phase: 'game-over', outcome: 'lap-complete', terminalKind: 'success', checkpoints: 2 })
    expect(model.clearCheckpoint()).toBe(0)
    expect(model.crash()).toBe(false)
    expect(model.togglePause()).toBe('game-over')
  })

  it('pauses and resumes without changing state', () => {
    const model = new RunModel()
    expect(model.togglePause()).toBe('paused')
    expect(model.snapshot()).toMatchObject({ checkpoints: 0, chassis: 3 })
    expect(model.togglePause()).toBe('playing')
  })

  it('resets race progress, chassis, and terminal state', () => {
    const model = new RunModel(3, 1)
    model.clearCheckpoint()
    model.reset()
    expect(model.snapshot()).toMatchObject({ phase: 'playing', outcome: null, checkpoints: 0, chassis: 3, score: 0, streak: 1, lap: 1 })
  })
})
