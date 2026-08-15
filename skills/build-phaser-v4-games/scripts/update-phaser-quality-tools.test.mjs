import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { updateQualityTools } from './update-phaser-quality-tools.mjs'

const temporaryRoots = []

test.afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function hash(content) {
  return createHash('sha256').update(content).digest('hex')
}

function stockProofs() {
  return {
    migration: [
      { path: 'schemaVersion', op: 'equals', value: 2 },
      { path: 'settings.muted', op: 'equalsFixture', fixturePath: 'muted' },
      { path: 'stats.runsStarted', op: 'equals', value: 1 },
      { path: 'stats.bestProgress', op: 'equalsFixture', fixturePath: 'bestProgress' }
    ],
    gameplay: [
      { path: 'schemaVersion', op: 'preserved' },
      { path: 'settings.muted', op: 'preserved' },
      { path: 'stats.runsStarted', op: 'incrementedBy', amount: 4 },
      { path: 'stats.bestProgress', op: 'derivedFrom', source: 'successProgress' }
    ],
    reload: [
      { path: 'schemaVersion', op: 'preserved' },
      { path: 'settings.muted', op: 'preserved' },
      { path: 'stats.runsStarted', op: 'incrementedBy', amount: 1 },
      { path: 'stats.bestProgress', op: 'preserved' }
    ]
  }
}

function customProofs() {
  return {
    migration: [
      { path: 'schemaVersion', op: 'equals', value: 3 },
      { path: 'settings.muted', op: 'equalsFixture' },
      { path: 'stats.runsStarted', op: 'incrementedBy', amount: 1 },
      { path: 'economy.credits', op: 'derivedFrom', source: 'fixture', sourcePath: 'stats.bestProgress' }
    ],
    gameplay: [
      { path: 'schemaVersion', op: 'preserved' },
      { path: 'settings.muted', op: 'preserved' },
      { path: 'stats.runsStarted', op: 'incrementedBy', amount: 4 },
      { path: 'economy.credits', op: 'incrementedBy', source: 'successProgress' }
    ],
    reload: [
      { path: 'schemaVersion', op: 'preserved' },
      { path: 'settings.muted', op: 'preserved' },
      { path: 'stats.runsStarted', op: 'incrementedBy', amount: 1 },
      { path: 'economy.credits', op: 'preserved' }
    ]
  }
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'phaser-quality-update-'))
  temporaryRoots.push(root)
  const sourceRoot = path.join(root, 'source')
  const projectRoot = path.join(root, 'project')
  await mkdir(path.join(sourceRoot, 'scripts'), { recursive: true })
  await mkdir(path.join(projectRoot, 'scripts'), { recursive: true })
  const oldFiles = {
    'scripts/browser-e2e.mjs': 'export const gate = 1\n',
    'scripts/quality-input-driver.mjs': 'export const driver = 1\n'
  }
  const currentFiles = {
    'scripts/browser-e2e.mjs': 'export const gate = 2\n',
    'scripts/quality-input-driver.mjs': 'export const driver = 2\n'
  }
  const fileMap = (files) => Object.fromEntries(Object.entries(files).map(([relative, content]) => [relative, hash(content)]))
  const manifest = {
    schemaVersion: 1,
    version: 2,
    managedFiles: fileMap(currentFiles),
    knownVersions: [{ version: 1, managedFiles: fileMap(oldFiles) }]
  }
  const quality = {
    persistence: { required: true, migrationFromVersion: 1, migrationFixture: { schemaVersion: 1, muted: true, bestProgress: 1 }, schemaVersion: 2, proofs: stockProofs() },
    gameplay: { primaryAction: 'keep-project-gameplay' }
  }
  await writeFile(path.join(sourceRoot, 'phaser-quality-tools.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  await writeFile(path.join(sourceRoot, 'game-quality.json'), `${JSON.stringify(quality, null, 2)}\n`, 'utf8')
  for (const [relative, content] of Object.entries(currentFiles)) await writeFile(path.join(sourceRoot, relative), content, 'utf8')
  await writeFile(path.join(projectRoot, 'package.json'), '{"name":"fixture"}\n', 'utf8')
  await writeFile(path.join(projectRoot, 'game-quality.json'), `${JSON.stringify(quality, null, 2)}\n`, 'utf8')
  await writeFile(path.join(projectRoot, 'src-game.ts'), 'keep me\n', 'utf8')
  for (const [relative, content] of Object.entries(oldFiles)) await writeFile(path.join(projectRoot, relative), content, 'utf8')
  return { root, sourceRoot, projectRoot, manifest, oldFiles, currentFiles }
}

test('detects a trusted legacy version and atomically upgrades only managed tools', async () => {
  const data = await fixture()
  const checked = await updateQualityTools({ projectRoot: data.projectRoot, sourceRoot: data.sourceRoot })
  assert.equal(checked.status, 'outdated')
  assert.equal(checked.installedVersion, 1)
  assert.equal(checked.targetVersion, 2)

  const updated = await updateQualityTools({ projectRoot: data.projectRoot, sourceRoot: data.sourceRoot, apply: true })
  assert.equal(updated.status, 'updated')
  assert.equal(updated.fromVersion, 1)
  assert.equal(updated.installedVersion, 2)
  assert.deepEqual(updated.updatedFiles.sort(), [...Object.keys(data.currentFiles), 'phaser-quality-tools.json'].sort())
  assert.deepEqual(updated.removedFiles, [])
  for (const [relative, content] of Object.entries(data.currentFiles)) {
    assert.equal(await readFile(path.join(data.projectRoot, relative), 'utf8'), content)
  }
  assert.equal(await readFile(path.join(data.projectRoot, 'src-game.ts'), 'utf8'), 'keep me\n')
  assert.deepEqual(JSON.parse(await readFile(path.join(data.projectRoot, 'phaser-quality-tools.json'), 'utf8')), data.manifest)
  assert.equal((await readdir(data.projectRoot)).some((entry) => entry.startsWith('.phaser-quality-update-')), false)

  const current = await updateQualityTools({ projectRoot: data.projectRoot, sourceRoot: data.sourceRoot })
  assert.equal(current.status, 'current')
  assert.deepEqual(current.updatedFiles, [])
  assert.deepEqual(current.removedFiles, [])
})

test('transactionally retires trusted files that are absent from the new version', async () => {
  const data = await fixture()
  const retiredRelative = 'scripts/retired-gate.mjs'
  const retiredContent = 'export const retired = true\n'
  data.oldFiles[retiredRelative] = retiredContent
  data.manifest.knownVersions[0].managedFiles[retiredRelative] = hash(retiredContent)
  await writeFile(path.join(data.projectRoot, retiredRelative), retiredContent, 'utf8')
  await writeFile(path.join(data.sourceRoot, 'phaser-quality-tools.json'), `${JSON.stringify(data.manifest, null, 2)}\n`, 'utf8')

  const updated = await updateQualityTools({ projectRoot: data.projectRoot, sourceRoot: data.sourceRoot, apply: true })

  assert.equal(updated.status, 'updated')
  assert.deepEqual(updated.removedFiles, [retiredRelative])
  await assert.rejects(readFile(path.join(data.projectRoot, retiredRelative), 'utf8'), { code: 'ENOENT' })
  assert.equal(await readFile(path.join(data.projectRoot, 'src-game.ts'), 'utf8'), 'keep me\n')
  assert.equal((await readdir(data.projectRoot)).some((entry) => entry.startsWith('.phaser-quality-update-')), false)
})

test('transactionally adds a missing trusted persistence migration declaration', async () => {
  const data = await fixture()
  const projectQuality = {
    persistence: { required: true, schemaVersion: 2 },
    gameplay: { primaryAction: 'custom-project-action' }
  }
  await writeFile(path.join(data.projectRoot, 'game-quality.json'), `${JSON.stringify(projectQuality, null, 2)}\n`, 'utf8')

  const updated = await updateQualityTools({ projectRoot: data.projectRoot, sourceRoot: data.sourceRoot, apply: true })

  assert.equal(updated.status, 'updated')
  assert.ok(updated.updatedFiles.includes('game-quality.json'))
  const migrated = JSON.parse(await readFile(path.join(data.projectRoot, 'game-quality.json'), 'utf8'))
  assert.deepEqual(migrated.persistence, {
    required: true,
    schemaVersion: 2,
    migrationFromVersion: 1,
    migrationFixture: { schemaVersion: 1, muted: true, bestProgress: 1 },
    proofs: stockProofs()
  })
  assert.equal(migrated.gameplay.primaryAction, 'custom-project-action')
})

test('preserves a valid custom persistence contract during a tool upgrade', async () => {
  const data = await fixture()
  const projectQuality = {
    persistence: {
      required: true,
      migrationFromVersion: 2,
      migrationFixture: {
        schemaVersion: 2,
        settings: { muted: true },
        stats: { runsStarted: 9, runsCompleted: 7, wins: 4, losses: 3, bestProgress: 37 }
      },
      schemaVersion: 3,
      proofs: customProofs()
    },
    gameplay: { primaryAction: 'custom-project-action' }
  }
  await writeFile(path.join(data.projectRoot, 'game-quality.json'), `${JSON.stringify(projectQuality, null, 2)}\n`, 'utf8')

  const updated = await updateQualityTools({ projectRoot: data.projectRoot, sourceRoot: data.sourceRoot, apply: true })

  assert.equal(updated.status, 'updated')
  assert.equal(updated.updatedFiles.includes('game-quality.json'), false)
  assert.deepEqual(JSON.parse(await readFile(path.join(data.projectRoot, 'game-quality.json'), 'utf8')), projectQuality)
})

test('refuses to infer a missing migration source for a custom schema', async () => {
  const data = await fixture()
  const projectQuality = { persistence: { required: true, schemaVersion: 3 } }
  await writeFile(path.join(data.projectRoot, 'game-quality.json'), `${JSON.stringify(projectQuality, null, 2)}\n`, 'utf8')

  const report = await updateQualityTools({ projectRoot: data.projectRoot, sourceRoot: data.sourceRoot, apply: true })

  assert.equal(report.status, 'conflict')
  assert.match(report.conflicts.find(({ path: file }) => file === 'game-quality.json').reason, /cannot infer/)
  assert.deepEqual(JSON.parse(await readFile(path.join(data.projectRoot, 'game-quality.json'), 'utf8')), projectQuality)
  assert.equal(await readFile(path.join(data.projectRoot, 'scripts', 'browser-e2e.mjs'), 'utf8'), data.oldFiles['scripts/browser-e2e.mjs'])
})

test('refuses to infer proof semantics for a custom fixture', async () => {
  const data = await fixture()
  const projectQuality = {
    persistence: {
      required: true,
      migrationFromVersion: 1,
      migrationFixture: { schemaVersion: 1, muted: false, bestProgress: 12 },
      schemaVersion: 2
    },
    gameplay: { primaryAction: 'custom-project-action' }
  }
  await writeFile(path.join(data.projectRoot, 'game-quality.json'), `${JSON.stringify(projectQuality, null, 2)}\n`, 'utf8')

  const report = await updateQualityTools({ projectRoot: data.projectRoot, sourceRoot: data.sourceRoot, apply: true })

  assert.equal(report.status, 'conflict')
  assert.match(report.conflicts.find(({ path: file }) => file === 'game-quality.json').reason, /custom migration fixture/)
  assert.deepEqual(JSON.parse(await readFile(path.join(data.projectRoot, 'game-quality.json'), 'utf8')), projectQuality)
  assert.equal(await readFile(path.join(data.projectRoot, 'scripts', 'browser-e2e.mjs'), 'utf8'), data.oldFiles['scripts/browser-e2e.mjs'])
})

test('refuses a modified managed file without changing the project', async () => {
  const data = await fixture()
  const customized = 'project customization\n'
  await writeFile(path.join(data.projectRoot, 'scripts', 'browser-e2e.mjs'), customized, 'utf8')

  const report = await updateQualityTools({ projectRoot: data.projectRoot, sourceRoot: data.sourceRoot, apply: true })
  assert.equal(report.status, 'conflict')
  assert.equal(report.installedVersion, null)
  assert.deepEqual(report.updatedFiles, [])
  assert.equal(await readFile(path.join(data.projectRoot, 'scripts', 'browser-e2e.mjs'), 'utf8'), customized)
  assert.equal(await readFile(path.join(data.projectRoot, 'scripts', 'quality-input-driver.mjs'), 'utf8'), data.oldFiles['scripts/quality-input-driver.mjs'])
  assert.equal(await readFile(path.join(data.projectRoot, 'src-game.ts'), 'utf8'), 'keep me\n')
  await assert.rejects(readFile(path.join(data.projectRoot, 'phaser-quality-tools.json'), 'utf8'), { code: 'ENOENT' })
})

test('requires a manifest even when legacy files already match the current version', async () => {
  const data = await fixture()
  for (const [relative, content] of Object.entries(data.currentFiles)) {
    await writeFile(path.join(data.projectRoot, relative), content, 'utf8')
  }

  const checked = await updateQualityTools({ projectRoot: data.projectRoot, sourceRoot: data.sourceRoot })
  assert.equal(checked.status, 'outdated')
  assert.equal(checked.installedVersion, 2)

  const updated = await updateQualityTools({ projectRoot: data.projectRoot, sourceRoot: data.sourceRoot, apply: true })
  assert.equal(updated.status, 'updated')
  assert.equal(updated.fromVersion, 2)
  assert.deepEqual(JSON.parse(await readFile(path.join(data.projectRoot, 'phaser-quality-tools.json'), 'utf8')), data.manifest)
})

test('rolls back files already replaced when a later filesystem step fails', async () => {
  const data = await fixture()
  const legacyQuality = `${JSON.stringify({
    persistence: { required: true, schemaVersion: 2 },
    gameplay: { primaryAction: 'must-survive-rollback' }
  }, null, 2)}\n`
  await writeFile(path.join(data.projectRoot, 'game-quality.json'), legacyQuality, 'utf8')
  const retiredRelative = 'scripts/retired-gate.mjs'
  const retiredContent = 'export const retired = true\n'
  data.oldFiles[retiredRelative] = retiredContent
  data.manifest.knownVersions[0].managedFiles[retiredRelative] = hash(retiredContent)
  await writeFile(path.join(data.projectRoot, retiredRelative), retiredContent, 'utf8')
  const addedRelative = 'scripts/new-tool/gate.mjs'
  const addedContent = 'export const added = true\n'
  data.manifest.managedFiles[addedRelative] = hash(addedContent)
  await mkdir(path.join(data.sourceRoot, 'scripts', 'new-tool'), { recursive: true })
  await writeFile(path.join(data.sourceRoot, addedRelative), addedContent, 'utf8')
  await writeFile(path.join(data.sourceRoot, 'phaser-quality-tools.json'), `${JSON.stringify(data.manifest, null, 2)}\n`, 'utf8')
  await writeFile(path.join(data.projectRoot, 'phaser-quality-tools.json'), `${JSON.stringify({
    schemaVersion: 1,
    version: 1,
    managedFiles: data.manifest.knownVersions[0].managedFiles,
    knownVersions: []
  }, null, 2)}\n`, 'utf8')
  await writeFile(path.join(data.projectRoot, 'scripts', 'new-tool'), 'blocking project file\n', 'utf8')

  await assert.rejects(
    updateQualityTools({ projectRoot: data.projectRoot, sourceRoot: data.sourceRoot, apply: true }),
    /EEXIST|ENOTDIR/
  )
  for (const [relative, content] of Object.entries(data.oldFiles)) {
    assert.equal(await readFile(path.join(data.projectRoot, relative), 'utf8'), content)
  }
  assert.equal(await readFile(path.join(data.projectRoot, 'scripts', 'new-tool'), 'utf8'), 'blocking project file\n')
  assert.equal(await readFile(path.join(data.projectRoot, retiredRelative), 'utf8'), retiredContent)
  assert.equal(await readFile(path.join(data.projectRoot, 'src-game.ts'), 'utf8'), 'keep me\n')
  assert.equal(await readFile(path.join(data.projectRoot, 'game-quality.json'), 'utf8'), legacyQuality)
  const installedManifest = JSON.parse(await readFile(path.join(data.projectRoot, 'phaser-quality-tools.json'), 'utf8'))
  assert.equal(installedManifest.version, 1)
  assert.equal((await readdir(data.projectRoot)).some((entry) => entry.startsWith('.phaser-quality-update-')), false)
})

test('rejects a quality tool catalog that is not strictly descending', async () => {
  const data = await fixture()
  data.manifest.knownVersions.unshift({ version: 3, managedFiles: data.manifest.managedFiles })
  await writeFile(path.join(data.sourceRoot, 'phaser-quality-tools.json'), `${JSON.stringify(data.manifest, null, 2)}\n`, 'utf8')

  await assert.rejects(
    updateQualityTools({ projectRoot: data.projectRoot, sourceRoot: data.sourceRoot, apply: true }),
    /strictly descending/
  )
  assert.equal(await readFile(path.join(data.projectRoot, 'scripts', 'browser-e2e.mjs'), 'utf8'), data.oldFiles['scripts/browser-e2e.mjs'])
})

test('refuses a stale skill manifest before inspecting or writing the project', async () => {
  const data = await fixture()
  data.manifest.managedFiles['scripts/browser-e2e.mjs'] = '0'.repeat(64)
  await writeFile(path.join(data.sourceRoot, 'phaser-quality-tools.json'), `${JSON.stringify(data.manifest, null, 2)}\n`, 'utf8')

  await assert.rejects(
    updateQualityTools({ projectRoot: data.projectRoot, sourceRoot: data.sourceRoot, apply: true }),
    /manifest hash is stale/
  )
  assert.equal(await readFile(path.join(data.projectRoot, 'scripts', 'browser-e2e.mjs'), 'utf8'), data.oldFiles['scripts/browser-e2e.mjs'])
})
