import assert from 'node:assert/strict'
import test from 'node:test'

import {
  parsePersistenceContract,
  validatePersistenceProofSummary,
  verifyPersistenceProofPhase
} from './persistence-proof.mjs'

const contract = {
  required: true,
  migrationFromVersion: 2,
  migrationFixture: {
    schemaVersion: 2,
    settings: { muted: true },
    stats: { runsStarted: 9, runsCompleted: 7, wins: 4, losses: 3, bestProgress: 37 }
  },
  schemaVersion: 3,
  proofs: {
    migration: [
      { path: 'settings.muted', op: 'equalsFixture' },
      { path: 'stats.runsStarted', op: 'incrementedBy', amount: 1 },
      { path: 'stats.runsCompleted', op: 'equalsFixture' },
      { path: 'economy.lifetimeCredits', op: 'derivedFrom', source: 'fixture', sourcePath: 'stats.bestProgress' }
    ],
    gameplay: [
      { path: 'settings.muted', op: 'preserved' },
      { path: 'stats.runsStarted', op: 'incrementedBy', amount: 4 },
      { path: 'stats.runsCompleted', op: 'incrementedBy', amount: 2 },
      { path: 'economy.lifetimeCredits', op: 'incrementedBy', source: 'successProgress' }
    ],
    reload: [
      { path: 'settings.muted', op: 'preserved' },
      { path: 'stats.runsStarted', op: 'incrementedBy', amount: 1 },
      { path: 'stats.runsCompleted', op: 'preserved' },
      { path: 'economy.lifetimeCredits', op: 'preserved' }
    ]
  }
}

const migrated = {
  schemaVersion: 3,
  settings: { muted: true },
  stats: { runsStarted: 10, runsCompleted: 7, wins: 4, losses: 3, bestProgress: 37 },
  economy: { lifetimeCredits: 37 }
}
const played = {
  ...structuredClone(migrated),
  stats: { ...migrated.stats, runsStarted: 14, runsCompleted: 9 },
  economy: { lifetimeCredits: 97 }
}
const reloaded = {
  ...structuredClone(played),
  stats: { ...played.stats, runsStarted: 15 }
}

test('proves a custom schema migration, gameplay delta, and reload without local verifier code', () => {
  const progress = { success: 60, failure: 0 }
  const migration = verifyPersistenceProofPhase(contract, 'migration', { profile: migrated, progress })
  const gameplay = verifyPersistenceProofPhase(contract, 'gameplay', { profile: played, previousProfile: migrated, progress })
  const reload = verifyPersistenceProofPhase(contract, 'reload', { profile: reloaded, previousProfile: played, progress })
  assert.equal(validatePersistenceProofSummary({
    status: 'pass',
    migration: { status: 'pass', proof: migration },
    gameplay: { status: 'pass', proof: gameplay },
    reload: { status: 'pass', proof: reload }
  }, contract, progress), true)
})

test('rejects unsafe paths, arbitrary expressions, missing baselines, and absent progress binding', () => {
  const unsafe = structuredClone(contract)
  unsafe.proofs.migration[0].path = '__proto__.muted'
  assert.throws(() => parsePersistenceContract(unsafe), /safe dot-separated JSON path/)

  const expression = structuredClone(contract)
  expression.proofs.gameplay[3] = { path: 'economy.lifetimeCredits', op: 'derivedFrom', source: 'profile.stats.bestProgress + 1' }
  assert.throws(() => parsePersistenceContract(expression), /source must be fixture/)

  const missingBaseline = structuredClone(contract)
  missingBaseline.proofs.migration = missingBaseline.proofs.migration.filter(({ path }) => path !== 'stats.runsStarted')
  assert.throws(() => parsePersistenceContract(missingBaseline), /requires a migration baseline/)

  const noProgress = structuredClone(contract)
  noProgress.proofs.gameplay[3] = { path: 'economy.lifetimeCredits', op: 'incrementedBy', amount: 60 }
  assert.throws(() => parsePersistenceContract(noProgress), /bind at least one persisted field/)
})

test('rejects a wrong derived value and a forged summary relationship', () => {
  const wrong = structuredClone(played)
  wrong.economy.lifetimeCredits = 96
  assert.throws(
    () => verifyPersistenceProofPhase(contract, 'gameplay', { profile: wrong, previousProfile: migrated, progress: { success: 60, failure: 0 } }),
    /expected 97, received 96/
  )

  const progress = { success: 60, failure: 0 }
  const migration = verifyPersistenceProofPhase(contract, 'migration', { profile: migrated, progress })
  const gameplay = verifyPersistenceProofPhase(contract, 'gameplay', { profile: played, previousProfile: migrated, progress })
  const reload = verifyPersistenceProofPhase(contract, 'reload', { profile: reloaded, previousProfile: played, progress })
  gameplay.assertions.find(({ path }) => path === 'economy.lifetimeCredits').source.value = 38
  assert.throws(() => validatePersistenceProofSummary({
    status: 'pass',
    migration: { status: 'pass', proof: migration },
    gameplay: { status: 'pass', proof: gameplay },
    reload: { status: 'pass', proof: reload }
  }, contract, progress), /inconsistent/)
})

test('supports a bounded total of both terminal progress values', () => {
  const totalContract = structuredClone(contract)
  totalContract.proofs.gameplay[3].source = 'terminalProgressTotal'
  const withFailureEarnings = structuredClone(played)
  withFailureEarnings.economy.lifetimeCredits = 102
  const proof = verifyPersistenceProofPhase(totalContract, 'gameplay', {
    profile: withFailureEarnings,
    previousProfile: migrated,
    progress: { success: 60, failure: 5 }
  })
  assert.equal(proof.assertions.find(({ path }) => path === 'economy.lifetimeCredits').expected, 102)
})

test('rejects contradictory failed phase status despite green proof objects', () => {
  const progress = { success: 60, failure: 0 }
  const summary = {
    status: 'pass',
    migration: { status: 'pass', proof: verifyPersistenceProofPhase(contract, 'migration', { profile: migrated, progress }) },
    gameplay: { status: 'failed', proof: verifyPersistenceProofPhase(contract, 'gameplay', { profile: played, previousProfile: migrated, progress }) },
    reload: { status: 'pass', proof: verifyPersistenceProofPhase(contract, 'reload', { profile: reloaded, previousProfile: played, progress }) }
  }
  assert.throws(() => validatePersistenceProofSummary(summary, contract, progress), /gameplay summary is missing or failed/)
})
