function invariant(condition, message) {
  if (!condition) throw new Error(message)
}

export function parsePlayerPosition(value) {
  const [x, y] = String(value ?? '').split(',').map(Number)
  invariant(Number.isFinite(x) && Number.isFinite(y), `Invalid player position: ${value}`)
  return { x, y }
}

export function decodeTargetPositions(value, label) {
  try {
    const positions = JSON.parse(value ?? '[]')
    invariant(Array.isArray(positions) && positions.every((position) => Array.isArray(position)
      && position.length === 2
      && position.every(Number.isFinite)), `Invalid ${label} positions.`)
    return positions.map(([x, y]) => ({ x, y }))
  } catch (error) {
    throw new Error(`Unable to decode ${label} positions: ${error.message}`)
  }
}

export function nearestPosition(origin, positions) {
  return positions.toSorted((left, right) => {
    const leftDistance = Math.hypot(left.x - origin.x, left.y - origin.y)
    const rightDistance = Math.hypot(right.x - origin.x, right.y - origin.y)
    return leftDistance - rightDistance
  })[0]
}

export function screenPoint(canvas, worldPoint, worldWidth, worldHeight) {
  invariant(worldWidth > 0 && worldHeight > 0, `Invalid quality world size: ${worldWidth}x${worldHeight}.`)
  return {
    x: Math.round(canvas.left + (worldPoint.x / worldWidth) * canvas.width),
    y: Math.round(canvas.top + (worldPoint.y / worldHeight) * canvas.height)
  }
}

async function wait(milliseconds) {
  if (milliseconds > 0) await new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function clickWorldPoint(client, canvas, target, worldWidth, worldHeight) {
  const { x, y } = screenPoint(canvas, target, worldWidth, worldHeight)
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
  return { x, y, worldX: target.x, worldY: target.y }
}

function touchPoint(point) {
  return { ...point, radiusX: 1, radiusY: 1, force: 1, id: 1 }
}

async function moveTowardWithKeyboard(client, origin, target, holdMs) {
  const keys = []
  if (target.x > origin.x + 8) keys.push({ key: 'd', code: 'KeyD', virtualKeyCode: 68 })
  else if (target.x < origin.x - 8) keys.push({ key: 'a', code: 'KeyA', virtualKeyCode: 65 })
  if (target.y > origin.y + 36) keys.push({ key: 's', code: 'KeyS', virtualKeyCode: 83 })
  else if (target.y < origin.y - 36) keys.push({ key: 'w', code: 'KeyW', virtualKeyCode: 87 })
  for (const input of keys) {
    await client.send('Input.dispatchKeyEvent', {
      type: 'keyDown', key: input.key, code: input.code, windowsVirtualKeyCode: input.virtualKeyCode
    })
  }
  await wait(keys.length > 0 ? holdMs : 0)
  for (const input of keys) {
    await client.send('Input.dispatchKeyEvent', {
      type: 'keyUp', key: input.key, code: input.code, windowsVirtualKeyCode: input.virtualKeyCode
    })
  }
  return keys.map((input) => input.code)
}

function conditionMatches(condition, player, target) {
  if (!condition) return true
  if (condition.horizontalDistanceGreaterThan !== undefined) {
    return Math.abs(target.x - player.x) > condition.horizontalDistanceGreaterThan
  }
  return true
}

async function dispatchMouseAction(client, canvas, action, player, target, worldWidth, worldHeight) {
  if (action.mode === 'click') return clickWorldPoint(client, canvas, target, worldWidth, worldHeight)
  const from = screenPoint(canvas, action.mode === 'drag' ? player : target, worldWidth, worldHeight)
  const to = screenPoint(canvas, target, worldWidth, worldHeight)
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 })
  if (action.mode === 'drag') {
    await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: to.x, y: to.y, button: 'left', buttons: 1 })
  }
  await wait(action.holdMs)
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1 })
  return { from, to, worldX: target.x, worldY: target.y }
}

async function dispatchTouchAction(client, canvas, action, player, target, worldWidth, worldHeight) {
  const from = screenPoint(canvas, action.mode === 'drag' ? player : target, worldWidth, worldHeight)
  const to = screenPoint(canvas, target, worldWidth, worldHeight)
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touchPoint(from)] })
  if (action.mode === 'drag') {
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [touchPoint(to)] })
  }
  await wait(action.mode === 'click' ? 0 : action.holdMs)
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  return { from, to, worldX: target.x, worldY: target.y }
}

async function dispatchKeyAction(client, action) {
  await client.send('Input.dispatchKeyEvent', {
    type: 'keyDown', key: action.key, code: action.code, windowsVirtualKeyCode: action.virtualKeyCode
  })
  await wait(action.holdMs)
  await client.send('Input.dispatchKeyEvent', {
    type: 'keyUp', key: action.key, code: action.code, windowsVirtualKeyCode: action.virtualKeyCode
  })
  return action.code
}

export async function executeInputActions(client, canvas, scenario, state, runtime, now = Date.now(), options = {}) {
  const player = parsePlayerPosition(state.playerPosition)
  const target = nearestPosition(player, decodeTargetPositions(runtime.targets, runtime.label))
  invariant(target, `No target is available for ${runtime.label}.`)
  const pointerDevice = options.pointerDevice ?? 'mouse'
  invariant(pointerDevice === 'mouse' || pointerDevice === 'touch', `Unsupported pointer device: ${pointerDevice}.`)
  const executed = []
  for (let index = 0; index < scenario.actions.length; index += 1) {
    const action = scenario.actions[index]
    if (!options.ignoreConditions && !conditionMatches(action.condition, player, target)) continue
    const nextAt = runtime.nextAt.get(index)
    if (nextAt === Infinity || (Number.isFinite(nextAt) && now < nextAt)) continue
    let detail
    if (action.type === 'pointer') {
      detail = pointerDevice === 'touch'
        ? await dispatchTouchAction(client, canvas, action, player, target, state.worldWidth, state.worldHeight)
        : await dispatchMouseAction(client, canvas, action, player, target, state.worldWidth, state.worldHeight)
    } else if (action.type === 'navigate') {
      detail = await moveTowardWithKeyboard(client, player, target, action.holdMs)
    } else {
      detail = await dispatchKeyAction(client, action)
    }
    runtime.nextAt.set(index, action.repeatMs ? now + action.repeatMs : Infinity)
    const device = action.type === 'pointer' ? pointerDevice : 'keyboard'
    const evidence = { device, type: action.type, mode: action.mode, detail }
    runtime.evidence.push(evidence)
    executed.push(evidence)
  }
  return { target, executed }
}
