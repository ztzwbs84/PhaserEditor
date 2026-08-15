import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { assertAcceptedInputCounters, assertAuxiliaryMetricState, assertAuxiliaryTimeline, assertGameplayContract, assertPauseFreezeEvidence, assertPrimaryInputAcceptanceEvidence, assertTerminalInputLockEvidence, oppositeWorldTarget, publishBrowserEvidence, runBrowserE2E, verifyBundleFingerprintEvidence } from './browser-e2e.mjs'
import { fingerprintProjectRelease } from './release-fingerprint.mjs'

const contract = {
  primaryAction: 'collect-signal',
  progressName: 'score',
  completionTarget: 60,
  auxiliaryName: 'archive-layer',
  pressureName: 'shield',
  maximumPressure: 3,
  successReason: 'target-reached',
  failureReason: 'shield-depleted'
}

const gameplay = {
  primaryAction: 'collect-signal',
  inputPlan: { primary: ['pointer:click'] },
  inputAcceptance: { actions: ['pointer:click'], before: { 'pointer:click': 2 }, after: { 'pointer:click': 3 } },
  progress: { name: 'score', target: 60 },
  auxiliary: {
    name: 'archive-layer',
    value: 0,
    checkpoints: Object.fromEntries([
      'desktopInitial', 'failureTerminal', 'failureRestart', 'successTerminal',
      'successRestart', 'mobileInitial', 'mobileProgress'
    ].map((name) => [name, { name: 'archive-layer', value: 0, visibleValue: 0 }]))
  },
  failure: { pressure: { name: 'shield', before: 3 }, terminalReason: 'shield-depleted' },
  success: { terminalReason: 'target-reached' }
}

test('accepts a declared non-time auxiliary metric whose value is zero', () => {
  assert.doesNotThrow(() => assertGameplayContract(contract, gameplay))
  assert.deepEqual(assertAuxiliaryMetricState({
    auxiliaryName: 'archive-layer',
    auxiliaryValue: 0,
    auxiliaryOutput: '0'
  }), {
    auxiliaryName: 'archive-layer',
    auxiliaryValue: 0,
    auxiliaryOutput: '0'
  })
})

test('rejects an auxiliary metric name that differs from the contract', () => {
  const mismatched = structuredClone(gameplay)
  mismatched.auxiliary.name = 'time'
  assert.throws(() => assertGameplayContract(contract, mismatched), /Browser auxiliary metric time does not match game-quality\.json archive-layer/)
})

test('rejects a visible auxiliary value that differs from machine state', () => {
  assert.throws(() => assertAuxiliaryMetricState({
    auxiliaryName: 'archive-layer',
    auxiliaryValue: 4,
    auxiliaryOutput: '3'
  }), /visible auxiliary metric 3 does not match machine value 4/)
})

test('rejects auxiliary drift after gameplay or restart', () => {
  const drifted = structuredClone(gameplay.auxiliary)
  drifted.checkpoints.successTerminal.visibleValue = 6
  assert.throws(() => assertAuxiliaryTimeline(drifted, 'archive-layer'), /successTerminal visible value 6 does not match machine value 0/)

  const renamed = structuredClone(gameplay.auxiliary)
  renamed.checkpoints.failureRestart.name = 'time'
  assert.throws(() => assertAuxiliaryTimeline(renamed, 'archive-layer'), /failureRestart is named time/)
})

test('requires the complete fixed auxiliary checkpoint set', () => {
  const incomplete = structuredClone(gameplay.auxiliary)
  delete incomplete.checkpoints.mobileProgress
  assert.throws(() => assertAuxiliaryTimeline(incomplete, 'archive-layer'), /checkpoints are incomplete/)
})

function terminalLock(terminalKind = 'success') {
  const snapshot = {
    phase: 'game-over', run: 4, progress: 80, pressure: 2, playerPosition: '480,300',
    terminalKind, terminalReason: terminalKind === 'success' ? 'archive-restored' : 'signal-lost',
    auxiliaryName: 'archive-layer', auxiliaryValue: 7, auxiliaryVisibleValue: 7,
    acceptedInputs: { 'pointer:click': 9, 'key:pulse': 4 }
  }
  return {
    terminalKind,
    actions: ['mouse:pointer:click', 'keyboard:key:pulse'],
    before: snapshot,
    after: structuredClone(snapshot)
  }
}

test('proves every declared primary input leaves terminal state unchanged', () => {
  assert.doesNotThrow(() => assertTerminalInputLockEvidence(terminalLock(), 'success', ['pointer:click', 'key:pulse']))

  const changed = terminalLock()
  changed.after.progress = 88
  assert.throws(() => assertTerminalInputLockEvidence(changed, 'success', ['pointer:click', 'key:pulse']), /input changed game state/)

  const accepted = terminalLock()
  accepted.after.acceptedInputs['key:pulse'] += 1
  assert.throws(() => assertTerminalInputLockEvidence(accepted, 'success', ['pointer:click', 'key:pulse']), /input was accepted after Game Over/)

  const missing = terminalLock()
  missing.actions.pop()
  assert.throws(() => assertTerminalInputLockEvidence(missing, 'success', ['pointer:click', 'key:pulse']), /did not dispatch every declared primary input/)
})

test('selects a valid far terminal target from a serialized player position', () => {
  assert.deepEqual(oppositeWorldTarget({ playerPosition: '135,410', worldWidth: 960, worldHeight: 600 }), [959, 1])
  assert.throws(() => oppositeWorldTarget({ playerPosition: 'bad', worldWidth: 960, worldHeight: 600 }), /Invalid terminal player position/)
})

function pauseFreeze() {
  const pausedSnapshot = {
    phase: 'paused', run: 1, progress: 8, pressure: 3, playerPosition: '480,300',
    terminalKind: '', terminalReason: '', auxiliaryName: 'archive-layer', auxiliaryValue: 7,
    auxiliaryVisibleValue: 7, pauseLabel: 'Resume', pausePressed: 'true',
    acceptedInputs: { 'pointer:click': 2, 'key:pulse': 1 }
  }
  const resumedSnapshot = {
    ...pausedSnapshot,
    phase: 'playing',
    pauseLabel: 'Pause',
    pausePressed: 'false'
  }
  return {
    actions: ['mouse:pointer:click', 'keyboard:key:pulse'],
    observedMs: 1_100,
    before: pausedSnapshot,
    after: structuredClone(pausedSnapshot),
    resumed: {
      observedMs: 300,
      before: resumedSnapshot,
      after: structuredClone(resumedSnapshot)
    }
  }
}

test('proves pause freezes domain time and every declared primary input', () => {
  assert.doesNotThrow(() => assertPauseFreezeEvidence(pauseFreeze(), ['pointer:click', 'key:pulse']))

  const drifted = pauseFreeze()
  drifted.after.auxiliaryValue = 6
  assert.throws(() => assertPauseFreezeEvidence(drifted, ['pointer:click', 'key:pulse']), /Paused gameplay changed/)

  const short = pauseFreeze()
  short.observedMs = 999
  assert.throws(() => assertPauseFreezeEvidence(short, ['pointer:click', 'key:pulse']), /shorter than one second/)

  const residualInput = pauseFreeze()
  residualInput.resumed.after.acceptedInputs['pointer:click'] += 1
  assert.throws(() => assertPauseFreezeEvidence(residualInput, ['pointer:click', 'key:pulse']), /input leaked into resumed gameplay/)

  const autonomousMotion = pauseFreeze()
  autonomousMotion.resumed.after.playerPosition = '530,300'
  autonomousMotion.resumed.after.auxiliaryValue = 6
  autonomousMotion.resumed.after.auxiliaryVisibleValue = 6
  assert.doesNotThrow(() => assertPauseFreezeEvidence(autonomousMotion, ['pointer:click', 'key:pulse']))

  const missingResume = pauseFreeze()
  delete missingResume.resumed
  assert.throws(() => assertPauseFreezeEvidence(missingResume, ['pointer:click', 'key:pulse']), /resume observation is missing or too short/)
})

test('requires exact monotonic accepted-input counters for every primary mode', () => {
  assert.deepEqual(assertAcceptedInputCounters({ 'key:pulse': 3, 'pointer:click': 7 }, ['pointer:click', 'key:pulse']), {
    'key:pulse': 3,
    'pointer:click': 7
  })
  assert.doesNotThrow(() => assertPrimaryInputAcceptanceEvidence({
    actions: ['pointer:click', 'key:pulse'],
    before: { 'pointer:click': 2, 'key:pulse': 4 },
    after: { 'pointer:click': 3, 'key:pulse': 5 }
  }, ['pointer:click', 'key:pulse']))
  assert.throws(() => assertAcceptedInputCounters({ 'pointer:click': 0, extra: 0 }, ['pointer:click']), /do not exactly match/)
  assert.throws(() => assertAcceptedInputCounters({ 'pointer:click': -1 }, ['pointer:click']), /non-negative integer/)
  assert.throws(() => assertPrimaryInputAcceptanceEvidence({
    actions: ['pointer:click'], before: { 'pointer:click': 0 }, after: { 'pointer:click': 0 }
  }, ['pointer:click']), /not accepted by gameplay/)
})

test('independently rejects stale bundle evidence before browser execution', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'phaser-browser-fingerprint-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  await Promise.all([
    mkdir(path.join(root, '.quality'), { recursive: true }),
    mkdir(path.join(root, 'src'), { recursive: true }),
    mkdir(path.join(root, 'dist', 'assets'), { recursive: true })
  ])
  await Promise.all([
    writeFile(path.join(root, 'package.json'), '{"type":"module"}\n'),
    writeFile(path.join(root, 'src', 'main.ts'), 'export const signal = 1\n'),
    writeFile(path.join(root, 'dist', 'index.html'), '<main></main>\n'),
    writeFile(path.join(root, 'dist', 'assets', 'index.js'), 'console.log("release")\n')
  ])
  const fingerprints = await fingerprintProjectRelease(root)
  await writeFile(path.join(root, '.quality', 'bundle-budget.json'), JSON.stringify({
    status: 'pass', failures: [], fingerprints
  }))

  assert.deepEqual(await verifyBundleFingerprintEvidence(root), fingerprints)
  await writeFile(path.join(root, 'src', 'main.ts'), 'export const signal = 2\n')
  await assert.rejects(verifyBundleFingerprintEvidence(root), /releaseInputs do not match/)
})

test('removes stale browser evidence before rejecting stale bundle inputs', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'phaser-browser-stale-evidence-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const qualityRoot = path.join(root, '.quality')
  await Promise.all([
    mkdir(qualityRoot, { recursive: true }),
    mkdir(path.join(root, 'src'), { recursive: true }),
    mkdir(path.join(root, 'dist', 'assets'), { recursive: true })
  ])
  await Promise.all([
    writeFile(path.join(root, 'package.json'), '{"type":"module"}\n'),
    writeFile(path.join(root, 'game-quality.json'), '{}\n'),
    writeFile(path.join(root, 'src', 'main.ts'), 'export const signal = 1\n'),
    writeFile(path.join(root, 'dist', 'index.html'), '<main></main>\n'),
    writeFile(path.join(root, 'dist', 'assets', 'index.js'), 'console.log("release")\n')
  ])
  const fingerprints = await fingerprintProjectRelease(root)
  await Promise.all([
    writeFile(path.join(qualityRoot, 'bundle-budget.json'), JSON.stringify({ status: 'pass', failures: [], fingerprints })),
    writeFile(path.join(qualityRoot, 'browser-e2e.json'), '{"status":"stale"}\n'),
    writeFile(path.join(qualityRoot, 'browser-desktop.png'), 'stale'),
    writeFile(path.join(qualityRoot, 'browser-mobile.png'), 'stale')
  ])
  await writeFile(path.join(root, 'src', 'main.ts'), 'export const signal = 2\n')

  await assert.rejects(runBrowserE2E(root), /releaseInputs do not match/)
  for (const name of ['browser-e2e.json', 'browser-desktop.png', 'browser-mobile.png', 'phaser-audit.json', 'phaser-api.json']) {
    assert.equal(await stat(path.join(qualityRoot, name)).catch(() => null), null)
  }
})

test('publishes browser evidence only after release checks finish without project drift', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'phaser-browser-publish-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const qualityRoot = path.join(root, '.quality')
  await Promise.all([
    mkdir(qualityRoot, { recursive: true }),
    mkdir(path.join(root, 'src'), { recursive: true }),
    mkdir(path.join(root, 'dist', 'assets'), { recursive: true })
  ])
  await Promise.all([
    writeFile(path.join(root, 'package.json'), '{"type":"module"}\n'),
    writeFile(path.join(root, 'src', 'main.ts'), 'export const signal = 1\n'),
    writeFile(path.join(root, 'dist', 'index.html'), '<main></main>\n'),
    writeFile(path.join(root, 'dist', 'assets', 'index.js'), 'console.log("release")\n')
  ])
  const fingerprints = await fingerprintProjectRelease(root)
  const report = { status: 'pass', summary: { status: 'pass' } }
  const releaseReports = { audit: { fingerprints }, api: { fingerprints } }
  const published = await publishBrowserEvidence(root, report, fingerprints, { runReleaseChecks: async () => releaseReports })
  assert.deepEqual(JSON.parse(await readFile(path.join(qualityRoot, 'browser-e2e.json'), 'utf8')), published)

  await assert.rejects(publishBrowserEvidence(root, report, fingerprints, {
    runReleaseChecks: async () => {
      await writeFile(path.join(root, 'src', 'main.ts'), 'export const signal = 2\n')
      await Promise.all([
        writeFile(path.join(qualityRoot, 'phaser-audit.json'), '{"status":"pass"}\n'),
        writeFile(path.join(qualityRoot, 'phaser-api.json'), '{"status":"pass"}\n')
      ])
    }
  }), /releaseInputs do not match/)
  for (const name of ['browser-e2e.json', 'phaser-audit.json', 'phaser-api.json']) {
    assert.equal(await stat(path.join(qualityRoot, name)).catch(() => null), null)
  }
})
