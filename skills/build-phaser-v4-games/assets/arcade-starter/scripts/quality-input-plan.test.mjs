import assert from 'node:assert/strict'
import test from 'node:test'

import { parseQualityInputPlan, summarizeQualityInputPlan } from './quality-input-plan.mjs'

const validPlan = {
  schemaVersion: 1,
  primary: {
    actions: [
      { type: 'pointer', mode: 'drag', holdMs: 120 },
      { type: 'key', mode: 'pulse', key: ' ', code: 'Space', virtualKeyCode: 32, holdMs: 80, repeatMs: 300 }
    ],
    settleMs: 900
  },
  pressure: {
    actions: [
      { type: 'pointer', mode: 'hold', holdMs: 100, repeatMs: 250 },
      { type: 'navigate', mode: 'directional', holdMs: 140, repeatMs: 200 },
      { type: 'key', mode: 'hold', key: 'e', code: 'KeyE', virtualKeyCode: 69, holdMs: 100, condition: { horizontalDistanceGreaterThan: 64 } }
    ]
  }
}

test('accepts and summarizes the versioned input action vocabulary', () => {
  const plan = parseQualityInputPlan(JSON.stringify(validPlan))
  assert.deepEqual(summarizeQualityInputPlan(plan), {
    schemaVersion: 1,
    primary: ['pointer:drag', 'key:pulse'],
    pressure: ['pointer:hold', 'navigate:directional', 'key:hold']
  })
})

test('fails closed for malformed JSON, unknown versions, fields, and action types', () => {
  assert.throws(() => parseQualityInputPlan('{'), /not valid JSON/)
  assert.throws(() => parseQualityInputPlan(JSON.stringify({ ...validPlan, schemaVersion: 2 })), /schemaVersion must be 1/)
  assert.throws(() => parseQualityInputPlan(JSON.stringify({ ...validPlan, preset: 'platformer' })), /unknown field: preset/)
  const unsupported = structuredClone(validPlan)
  unsupported.primary.actions[0] = { type: 'gamepad', mode: 'press' }
  assert.throws(() => parseQualityInputPlan(JSON.stringify(unsupported)), /type is unsupported/)
})

test('rejects unsafe timing, key, condition, and scenario values', () => {
  const invalidTiming = structuredClone(validPlan)
  invalidTiming.primary.actions[1].holdMs = 0
  assert.throws(() => parseQualityInputPlan(JSON.stringify(invalidTiming)), /holdMs must be an integer/)
  const invalidKey = structuredClone(validPlan)
  invalidKey.primary.actions[1].code = 'Space;drop'
  assert.throws(() => parseQualityInputPlan(JSON.stringify(invalidKey)), /code is invalid/)
  const invalidCondition = structuredClone(validPlan)
  invalidCondition.pressure.actions[2].condition.horizontalDistanceGreaterThan = -1
  assert.throws(() => parseQualityInputPlan(JSON.stringify(invalidCondition)), /horizontalDistanceGreaterThan/)
  const empty = structuredClone(validPlan)
  empty.primary.actions = []
  assert.throws(() => parseQualityInputPlan(JSON.stringify(empty)), /must contain 1 to 8 actions/)
})
