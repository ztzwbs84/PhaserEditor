const scenarioKeys = new Set(['actions', 'settleMs'])
const conditionKeys = new Set(['horizontalDistanceGreaterThan'])

function invariant(condition, message) {
  if (!condition) throw new Error(message)
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exactKeys(value, allowed, label) {
  for (const key of Object.keys(value)) invariant(allowed.has(key), `${label} contains an unknown field: ${key}.`)
}

function boundedInteger(value, minimum, maximum, label, required = false) {
  if (value === undefined && !required) return
  invariant(Number.isInteger(value) && value >= minimum && value <= maximum, `${label} must be an integer from ${minimum} to ${maximum}.`)
}

function validateCondition(condition, label) {
  if (condition === undefined) return
  invariant(plainObject(condition), `${label} must be an object.`)
  exactKeys(condition, conditionKeys, label)
  const distance = condition.horizontalDistanceGreaterThan
  invariant(typeof distance === 'number' && Number.isFinite(distance) && distance >= 0 && distance <= 4_096, `${label}.horizontalDistanceGreaterThan must be from 0 to 4096.`)
}

function validatePointer(action, label) {
  exactKeys(action, new Set(['type', 'mode', 'holdMs', 'repeatMs']), label)
  invariant(['click', 'hold', 'drag'].includes(action.mode), `${label}.mode must be click, hold, or drag.`)
  boundedInteger(action.repeatMs, 50, 5_000, `${label}.repeatMs`)
  if (action.mode === 'hold' || action.mode === 'drag') boundedInteger(action.holdMs, 20, 2_000, `${label}.holdMs`, true)
  else invariant(action.holdMs === undefined, `${label}.holdMs is only valid for hold or drag.`)
}

function validateNavigate(action, label) {
  exactKeys(action, new Set(['type', 'mode', 'holdMs', 'repeatMs']), label)
  invariant(action.mode === 'directional', `${label}.mode must be directional.`)
  boundedInteger(action.holdMs, 20, 1_000, `${label}.holdMs`, true)
  boundedInteger(action.repeatMs, 50, 5_000, `${label}.repeatMs`)
}

function validateKey(action, label) {
  exactKeys(action, new Set(['type', 'mode', 'key', 'code', 'virtualKeyCode', 'holdMs', 'repeatMs', 'condition']), label)
  invariant(['pulse', 'hold'].includes(action.mode), `${label}.mode must be pulse or hold.`)
  invariant(typeof action.key === 'string' && action.key.length >= 1 && action.key.length <= 16, `${label}.key must contain 1 to 16 characters.`)
  invariant(typeof action.code === 'string' && /^[A-Za-z][A-Za-z0-9]{0,31}$/.test(action.code), `${label}.code is invalid.`)
  boundedInteger(action.virtualKeyCode, 1, 255, `${label}.virtualKeyCode`, true)
  boundedInteger(action.holdMs, 20, 2_000, `${label}.holdMs`, true)
  boundedInteger(action.repeatMs, 50, 5_000, `${label}.repeatMs`)
  validateCondition(action.condition, `${label}.condition`)
}

function validateAction(action, label) {
  invariant(plainObject(action), `${label} must be an object.`)
  invariant(['pointer', 'navigate', 'key'].includes(action.type), `${label}.type is unsupported.`)
  if (action.type === 'pointer') validatePointer(action, label)
  else if (action.type === 'navigate') validateNavigate(action, label)
  else validateKey(action, label)
}

function validateScenario(scenario, label) {
  invariant(plainObject(scenario), `${label} must be an object.`)
  exactKeys(scenario, scenarioKeys, label)
  invariant(Array.isArray(scenario.actions) && scenario.actions.length >= 1 && scenario.actions.length <= 8, `${label}.actions must contain 1 to 8 actions.`)
  scenario.actions.forEach((action, index) => validateAction(action, `${label}.actions[${index}]`))
  boundedInteger(scenario.settleMs, 0, 5_000, `${label}.settleMs`)
}

export function parseQualityInputPlan(raw) {
  let plan
  try {
    plan = JSON.parse(raw)
  } catch (error) {
    throw new Error(`qualityInputPlan is not valid JSON: ${error.message}`)
  }
  invariant(plainObject(plan), 'qualityInputPlan must be an object.')
  exactKeys(plan, new Set(['schemaVersion', 'primary', 'pressure']), 'qualityInputPlan')
  invariant(plan.schemaVersion === 1, `qualityInputPlan schemaVersion must be 1, found ${plan.schemaVersion ?? 'missing'}.`)
  validateScenario(plan.primary, 'qualityInputPlan.primary')
  validateScenario(plan.pressure, 'qualityInputPlan.pressure')
  return plan
}

export function summarizeQualityInputPlan(plan) {
  return {
    schemaVersion: plan.schemaVersion,
    primary: plan.primary.actions.map(({ type, mode }) => `${type}:${mode}`),
    pressure: plan.pressure.actions.map(({ type, mode }) => `${type}:${mode}`)
  }
}
