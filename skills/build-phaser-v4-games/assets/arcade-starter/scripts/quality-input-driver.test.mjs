import assert from 'node:assert/strict'
import test from 'node:test'

import { decodeTargetPositions, executeInputActions, parsePlayerPosition, screenPoint } from './quality-input-driver.mjs'

class FakeClient {
  calls = []

  async send(method, params) {
    this.calls.push({ method, params })
  }
}

const canvas = { left: 10, top: 20, width: 200, height: 100 }
const state = { playerPosition: '10,20', worldWidth: 100, worldHeight: 100 }

function runtime(targets = '[[80,80]]') {
  return { label: 'fixture', targets, nextAt: new Map(), evidence: [] }
}

test('validates positions and maps world points into the displayed canvas', () => {
  assert.deepEqual(parsePlayerPosition('12,34'), { x: 12, y: 34 })
  assert.deepEqual(decodeTargetPositions('[[3,4]]', 'fixture'), [{ x: 3, y: 4 }])
  assert.deepEqual(screenPoint(canvas, { x: 50, y: 50 }, 100, 100), { x: 110, y: 70 })
  assert.throws(() => parsePlayerPosition('bad'), /Invalid player position/)
  assert.throws(() => decodeTargetPositions('[["x",2]]', 'fixture'), /Invalid fixture positions/)
})

test('dispatches pointer click, hold, and drag with observable CDP sequences', async () => {
  const client = new FakeClient()
  const plan = { actions: [
    { type: 'pointer', mode: 'click' },
    { type: 'pointer', mode: 'hold', holdMs: 20 },
    { type: 'pointer', mode: 'drag', holdMs: 20 }
  ] }
  const evidence = runtime()
  await executeInputActions(client, canvas, plan, state, evidence, 100)

  assert.deepEqual(evidence.evidence.map(({ type, mode }) => `${type}:${mode}`), ['pointer:click', 'pointer:hold', 'pointer:drag'])
  assert.deepEqual(client.calls.map(({ params }) => params.type), [
    'mousePressed', 'mouseReleased',
    'mousePressed', 'mouseReleased',
    'mousePressed', 'mouseMoved', 'mouseReleased'
  ])
  assert.deepEqual(client.calls.at(-2).params, { type: 'mouseMoved', x: 170, y: 100, button: 'left', buttons: 1 })
})

test('dispatches pointer click, hold, and drag as real touch sequences', async () => {
  const client = new FakeClient()
  const plan = { actions: [
    { type: 'pointer', mode: 'click' },
    { type: 'pointer', mode: 'hold', holdMs: 20 },
    { type: 'pointer', mode: 'drag', holdMs: 20 }
  ] }
  const evidence = runtime()
  await executeInputActions(client, canvas, plan, state, evidence, 100, { pointerDevice: 'touch' })

  assert.deepEqual(evidence.evidence.map(({ device, type, mode }) => `${device}:${type}:${mode}`), [
    'touch:pointer:click', 'touch:pointer:hold', 'touch:pointer:drag'
  ])
  assert.deepEqual(client.calls.map(({ method, params }) => `${method}:${params.type}`), [
    'Input.dispatchTouchEvent:touchStart', 'Input.dispatchTouchEvent:touchEnd',
    'Input.dispatchTouchEvent:touchStart', 'Input.dispatchTouchEvent:touchEnd',
    'Input.dispatchTouchEvent:touchStart', 'Input.dispatchTouchEvent:touchMove', 'Input.dispatchTouchEvent:touchEnd'
  ])
  assert.deepEqual(client.calls.at(-2).params.touchPoints[0], {
    x: 170, y: 100, radiusX: 1, radiusY: 1, force: 1, id: 1
  })
})

test('dispatches directional and key inputs, enforces conditions, and throttles repeats', async () => {
  const client = new FakeClient()
  const plan = { actions: [
    { type: 'navigate', mode: 'directional', holdMs: 20, repeatMs: 200 },
    { type: 'key', mode: 'pulse', key: ' ', code: 'Space', virtualKeyCode: 32, holdMs: 20, repeatMs: 300 },
    { type: 'key', mode: 'hold', key: 'e', code: 'KeyE', virtualKeyCode: 69, holdMs: 20, condition: { horizontalDistanceGreaterThan: 100 } }
  ] }
  const evidence = runtime()
  await executeInputActions(client, canvas, plan, state, evidence, 1_000)
  const firstCallCount = client.calls.length
  await executeInputActions(client, canvas, plan, state, evidence, 1_100)
  await executeInputActions(client, canvas, plan, state, evidence, 1_400)

  assert.deepEqual(evidence.evidence.map(({ type, mode }) => `${type}:${mode}`), [
    'navigate:directional', 'key:pulse', 'navigate:directional', 'key:pulse'
  ])
  assert.equal(firstCallCount, 6)
  assert.equal(client.calls.some(({ params }) => params.code === 'KeyE'), false)
  assert.deepEqual(client.calls.filter(({ params }) => params.type === 'keyDown').slice(0, 3).map(({ params }) => params.code), ['KeyD', 'KeyS', 'Space'])
})

test('can dispatch every declared action while proving terminal input lock', async () => {
  const client = new FakeClient()
  const plan = { actions: [
    { type: 'pointer', mode: 'click' },
    { type: 'navigate', mode: 'directional', holdMs: 20 },
    { type: 'key', mode: 'hold', key: 'e', code: 'KeyE', virtualKeyCode: 69, holdMs: 20, condition: { horizontalDistanceGreaterThan: 100 } }
  ] }
  const evidence = runtime('[[80,80]]')
  await executeInputActions(client, canvas, plan, state, evidence, 100, { ignoreConditions: true })

  assert.deepEqual(evidence.evidence.map(({ type, mode }) => `${type}:${mode}`), [
    'pointer:click', 'navigate:directional', 'key:hold'
  ])
  assert.equal(client.calls.some(({ params }) => params.code === 'KeyE'), true)
})

test('rejects an unknown pointer device before dispatch', async () => {
  await assert.rejects(
    executeInputActions(new FakeClient(), canvas, { actions: [{ type: 'pointer', mode: 'click' }] }, state, runtime(), 100, { pointerDevice: 'pen' }),
    /Unsupported pointer device/
  )
})
