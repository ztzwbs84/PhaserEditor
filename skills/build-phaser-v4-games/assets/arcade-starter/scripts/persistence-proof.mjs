const phases = ['migration', 'gameplay', 'reload']
const operations = new Set(['equalsFixture', 'equals', 'preserved', 'incrementedBy', 'derivedFrom'])
const progressSources = new Set(['successProgress', 'failureProgress', 'terminalProgressTotal'])
const pathPattern = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*){0,7}$/
const forbiddenPathSegments = new Set(['__proto__', 'prototype', 'constructor'])

function invariant(condition, message) {
  if (!condition) throw new Error(message)
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isPrimitive(value) {
  return value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))
    || (typeof value === 'string' && value.length <= 256)
}

function assertPath(value, label) {
  invariant(typeof value === 'string' && value.length <= 160 && pathPattern.test(value)
    && value.split('.').every((segment) => !forbiddenPathSegments.has(segment)), `${label} must be a safe dot-separated JSON path.`)
}

function pathValue(root, dottedPath, label) {
  let value = root
  for (const segment of dottedPath.split('.')) {
    invariant(isObject(value) && Object.hasOwn(value, segment), `${label} does not exist: ${dottedPath}.`)
    value = value[segment]
  }
  invariant(isPrimitive(value), `${label} must resolve to a bounded JSON primitive: ${dottedPath}.`)
  return value
}

function sameValue(left, right) {
  return left === right
}

function exactKeys(rule, allowed, label) {
  const unexpected = Object.keys(rule).filter((key) => !allowed.includes(key))
  invariant(unexpected.length === 0, `${label} has unsupported fields: ${unexpected.join(', ')}.`)
}

function parseRule(raw, phase, index, fixture) {
  const label = `game-quality.json persistence.proofs.${phase}[${index}]`
  invariant(isObject(raw), `${label} must be an object.`)
  assertPath(raw.path, `${label}.path`)
  invariant(operations.has(raw.op), `${label}.op must be one of ${[...operations].join(', ')}.`)

  if (raw.op === 'equals') {
    exactKeys(raw, ['path', 'op', 'value'], label)
    invariant(Object.hasOwn(raw, 'value') && isPrimitive(raw.value), `${label}.value must be a bounded JSON primitive.`)
  } else if (raw.op === 'equalsFixture') {
    exactKeys(raw, ['path', 'op', 'fixturePath'], label)
    const fixturePath = raw.fixturePath ?? raw.path
    assertPath(fixturePath, `${label}.fixturePath`)
    pathValue(fixture, fixturePath, `${label}.fixturePath`)
  } else if (raw.op === 'preserved') {
    exactKeys(raw, ['path', 'op'], label)
    invariant(phase !== 'migration', `${label} cannot preserve a value before migration has established a baseline.`)
  } else if (raw.op === 'incrementedBy') {
    exactKeys(raw, ['path', 'op', 'amount', 'source', 'fixturePath'], label)
    const hasAmount = Object.hasOwn(raw, 'amount')
    const hasSource = Object.hasOwn(raw, 'source')
    invariant(hasAmount !== hasSource, `${label} must declare exactly one of amount or source.`)
    if (hasAmount) invariant(typeof raw.amount === 'number' && Number.isFinite(raw.amount) && raw.amount >= 0, `${label}.amount must be a finite non-negative number.`)
    if (hasSource) {
      invariant(progressSources.has(raw.source), `${label}.source must be successProgress, failureProgress, or terminalProgressTotal.`)
      invariant(phase !== 'migration', `${label} cannot use gameplay progress during migration.`)
    }
    invariant(phase === 'migration' || raw.fixturePath === undefined, `${label}.fixturePath is only valid during migration.`)
    if (phase === 'migration') {
      const fixturePath = raw.fixturePath ?? raw.path
      assertPath(fixturePath, `${label}.fixturePath`)
      invariant(typeof pathValue(fixture, fixturePath, `${label}.fixturePath`) === 'number', `${label}.fixturePath must resolve to a number.`)
    }
  } else {
    exactKeys(raw, ['path', 'op', 'source', 'sourcePath'], label)
    invariant(raw.source === 'fixture' || progressSources.has(raw.source), `${label}.source must be fixture, successProgress, failureProgress, or terminalProgressTotal.`)
    if (raw.source === 'fixture') {
      assertPath(raw.sourcePath, `${label}.sourcePath`)
      pathValue(fixture, raw.sourcePath, `${label}.sourcePath`)
    } else {
      invariant(raw.sourcePath === undefined, `${label}.sourcePath is only valid with source fixture.`)
      invariant(phase !== 'migration', `${label} cannot use gameplay progress during migration.`)
    }
  }
  return structuredClone(raw)
}

export function parsePersistenceContract(contract) {
  invariant(isObject(contract), 'game-quality.json must declare a persistence contract.')
  invariant(contract.required === true, 'game-quality.json persistence.required must be true.')
  invariant(Number.isInteger(contract.schemaVersion) && contract.schemaVersion > 0, 'game-quality.json persistence.schemaVersion must be a positive integer.')
  invariant(Number.isInteger(contract.migrationFromVersion) && contract.migrationFromVersion > 0, 'game-quality.json persistence.migrationFromVersion must be a positive integer.')
  invariant(contract.migrationFromVersion < contract.schemaVersion, 'game-quality.json persistence.migrationFromVersion must be lower than persistence.schemaVersion.')
  invariant(isObject(contract.migrationFixture), 'game-quality.json persistence.migrationFixture must be an object.')
  invariant(contract.migrationFixture.schemaVersion === contract.migrationFromVersion, 'game-quality.json persistence.migrationFixture schema must match persistence.migrationFromVersion.')
  invariant(JSON.stringify(contract.migrationFixture).length <= 4_096, 'game-quality.json persistence.migrationFixture must not exceed 4096 JSON characters.')
  invariant(isObject(contract.proofs), 'game-quality.json persistence.proofs must declare migration, gameplay, and reload rules.')
  invariant(Object.keys(contract.proofs).every((phase) => phases.includes(phase)), 'game-quality.json persistence.proofs contains an unsupported phase.')

  const parsed = {}
  let totalRules = 0
  for (const phase of phases) {
    const rules = contract.proofs[phase]
    invariant(Array.isArray(rules) && rules.length > 0 && rules.length <= 32, `game-quality.json persistence.proofs.${phase} must contain 1 to 32 rules.`)
    const paths = new Set()
    parsed[phase] = rules.map((rule, index) => {
      const value = parseRule(rule, phase, index, contract.migrationFixture)
      invariant(!paths.has(value.path), `game-quality.json persistence.proofs.${phase} repeats ${value.path}.`)
      paths.add(value.path)
      totalRules += 1
      return value
    })
  }
  invariant(totalRules <= 64, 'game-quality.json persistence.proofs must not exceed 64 total rules.')

  const migrationPaths = new Set(parsed.migration.map(({ path }) => path))
  const gameplayPaths = new Set(parsed.gameplay.map(({ path }) => path))
  for (const rule of parsed.gameplay) {
    if (rule.op === 'preserved' || rule.op === 'incrementedBy') {
      invariant(migrationPaths.has(rule.path), `Gameplay proof ${rule.path} requires a migration baseline rule for the same path.`)
    }
  }
  for (const rule of parsed.reload) {
    if (rule.op === 'preserved' || rule.op === 'incrementedBy') {
      invariant(gameplayPaths.has(rule.path), `Reload proof ${rule.path} requires a gameplay baseline rule for the same path.`)
    }
  }
  invariant(migrationPaths.has('settings.muted'), 'Migration proofs must cover settings.muted.')
  invariant(parsed.gameplay.some((rule) => rule.path === 'settings.muted' && rule.op === 'preserved'), 'Gameplay proofs must preserve settings.muted.')
  invariant(parsed.reload.some((rule) => rule.path === 'settings.muted' && rule.op === 'preserved'), 'Reload proofs must preserve settings.muted.')
  invariant(parsed.gameplay.some((rule) => rule.op === 'derivedFrom' && progressSources.has(rule.source)
    || rule.op === 'incrementedBy' && progressSources.has(rule.source)), 'Gameplay proofs must bind at least one persisted field to terminal gameplay progress.')

  return {
    required: true,
    schemaVersion: contract.schemaVersion,
    migrationFromVersion: contract.migrationFromVersion,
    migrationFixture: structuredClone(contract.migrationFixture),
    proofs: parsed
  }
}

function progressValue(progress, source, label) {
  const success = progress?.success
  const failure = progress?.failure
  const value = source === 'terminalProgressTotal'
    ? (typeof success === 'number' && typeof failure === 'number' ? success + failure : Number.NaN)
    : progress?.[source === 'successProgress' ? 'success' : 'failure']
  invariant(typeof value === 'number' && Number.isFinite(value) && value >= 0, `${label} requires a finite non-negative ${source}.`)
  return value
}

function expectedAssertion(rule, phase, contract, context) {
  const label = `Persistence ${phase} proof ${rule.path}`
  const actual = pathValue(context.profile, rule.path, `${label} profile path`)
  let expected
  let source
  if (rule.op === 'equals') {
    expected = rule.value
    source = { kind: 'literal', value: rule.value }
  } else if (rule.op === 'equalsFixture') {
    const sourcePath = rule.fixturePath ?? rule.path
    expected = pathValue(contract.migrationFixture, sourcePath, `${label} fixture path`)
    source = { kind: 'fixture', path: sourcePath, value: expected }
  } else if (rule.op === 'preserved') {
    expected = pathValue(context.previousProfile, rule.path, `${label} previous profile path`)
    source = { kind: 'previous', path: rule.path, value: expected }
  } else if (rule.op === 'incrementedBy') {
    const baselineKind = phase === 'migration' ? 'fixture' : 'previous'
    const baselinePath = phase === 'migration' ? (rule.fixturePath ?? rule.path) : rule.path
    const baselineRoot = phase === 'migration' ? contract.migrationFixture : context.previousProfile
    const baseline = pathValue(baselineRoot, baselinePath, `${label} baseline path`)
    invariant(typeof baseline === 'number', `${label} baseline must be numeric.`)
    const delta = Object.hasOwn(rule, 'amount') ? rule.amount : progressValue(context.progress, rule.source, label)
    expected = baseline + delta
    source = {
      kind: baselineKind,
      path: baselinePath,
      value: baseline,
      delta: Object.hasOwn(rule, 'amount')
        ? { kind: 'literal', value: delta }
        : { kind: rule.source, value: delta }
    }
  } else if (rule.source === 'fixture') {
    expected = pathValue(contract.migrationFixture, rule.sourcePath, `${label} fixture source`)
    source = { kind: 'fixture', path: rule.sourcePath, value: expected }
  } else {
    expected = progressValue(context.progress, rule.source, label)
    source = { kind: rule.source, value: expected }
  }
  invariant(sameValue(actual, expected), `${label} expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`)
  return { path: rule.path, op: rule.op, actual, expected, source }
}

export function verifyPersistenceProofPhase(rawContract, phase, context) {
  const contract = parsePersistenceContract(rawContract)
  invariant(phases.includes(phase), `Unsupported persistence proof phase: ${phase}.`)
  invariant(isObject(context?.profile), `Persistence ${phase} proof requires a profile snapshot.`)
  return {
    status: 'pass',
    phase,
    assertions: contract.proofs[phase].map((rule) => expectedAssertion(rule, phase, contract, context))
  }
}

function assertionMap(report, rules, phase) {
  invariant(isObject(report) && report.status === 'pass' && report.phase === phase, `Persistence ${phase} proof report is missing or failed.`)
  invariant(Array.isArray(report.assertions) && report.assertions.length === rules.length, `Persistence ${phase} proof report has the wrong assertion count.`)
  const output = new Map()
  for (let index = 0; index < rules.length; index += 1) {
    const assertion = report.assertions[index]
    const rule = rules[index]
    invariant(isObject(assertion) && assertion.path === rule.path && assertion.op === rule.op, `Persistence ${phase} proof report does not match rule ${rule.path}.`)
    invariant(isPrimitive(assertion.actual) && isPrimitive(assertion.expected), `Persistence ${phase} proof ${rule.path} must report primitive values.`)
    output.set(rule.path, assertion.actual)
  }
  return output
}

function reportExpectation(rule, phase, contract, previous, progress) {
  let expected
  let source
  if (rule.op === 'equals') {
    expected = rule.value
    source = { kind: 'literal', value: rule.value }
  } else if (rule.op === 'equalsFixture') {
    const sourcePath = rule.fixturePath ?? rule.path
    expected = pathValue(contract.migrationFixture, sourcePath, `Persistence ${phase} fixture path`)
    source = { kind: 'fixture', path: sourcePath, value: expected }
  } else if (rule.op === 'preserved') {
    invariant(previous.has(rule.path), `Persistence ${phase} proof lacks the previous ${rule.path} observation.`)
    expected = previous.get(rule.path)
    source = { kind: 'previous', path: rule.path, value: expected }
  } else if (rule.op === 'incrementedBy') {
    const baselineKind = phase === 'migration' ? 'fixture' : 'previous'
    const baselinePath = phase === 'migration' ? (rule.fixturePath ?? rule.path) : rule.path
    const baseline = phase === 'migration'
      ? pathValue(contract.migrationFixture, baselinePath, `Persistence ${phase} baseline path`)
      : previous.get(baselinePath)
    invariant(typeof baseline === 'number' && Number.isFinite(baseline), `Persistence ${phase} proof lacks a numeric ${baselinePath} baseline.`)
    const delta = Object.hasOwn(rule, 'amount') ? rule.amount : progressValue(progress, rule.source, `Persistence ${phase} proof ${rule.path}`)
    expected = baseline + delta
    source = {
      kind: baselineKind,
      path: baselinePath,
      value: baseline,
      delta: Object.hasOwn(rule, 'amount') ? { kind: 'literal', value: delta } : { kind: rule.source, value: delta }
    }
  } else if (rule.source === 'fixture') {
    expected = pathValue(contract.migrationFixture, rule.sourcePath, `Persistence ${phase} fixture source`)
    source = { kind: 'fixture', path: rule.sourcePath, value: expected }
  } else {
    expected = progressValue(progress, rule.source, `Persistence ${phase} proof ${rule.path}`)
    source = { kind: rule.source, value: expected }
  }
  return { path: rule.path, op: rule.op, actual: expected, expected, source }
}

function sameJson(left, right) {
  if (left === right) return true
  if (!isObject(left) || !isObject(right)) return false
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && sameJson(left[key], right[key]))
}

export function validatePersistenceProofSummary(persistence, rawContract, progress) {
  const contract = parsePersistenceContract(rawContract)
  invariant(isObject(persistence) && persistence.status === 'pass', 'Persistence summary is missing or failed.')
  for (const phase of phases) {
    invariant(persistence[phase]?.status === 'pass', `Persistence ${phase} summary is missing or failed.`)
  }
  const reports = {
    migration: persistence.migration?.proof,
    gameplay: persistence.gameplay?.proof,
    reload: persistence.reload?.proof
  }
  let previous = new Map()
  for (const phase of phases) {
    const observed = assertionMap(reports[phase], contract.proofs[phase], phase)
    for (let index = 0; index < contract.proofs[phase].length; index += 1) {
      const expected = reportExpectation(contract.proofs[phase][index], phase, contract, previous, progress)
      invariant(sameJson(reports[phase].assertions[index], expected), `Persistence ${phase} proof report is inconsistent for ${expected.path}.`)
    }
    previous = observed
  }
  return true
}
