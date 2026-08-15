import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { runReleaseChecks } from './check-release.mjs'

const roots = []
test.afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'phaser-release-check-'))
  roots.push(root)
  await Promise.all([
    mkdir(path.join(root, '.quality')),
    mkdir(path.join(root, 'src')),
    mkdir(path.join(root, 'dist', 'assets'), { recursive: true })
  ])
  await Promise.all([
    writeFile(path.join(root, 'package.json'), '{"type":"module"}\n'),
    writeFile(path.join(root, 'src', 'main.ts'), 'export const signal = 1\n'),
    writeFile(path.join(root, 'dist', 'index.html'), '<main></main>\n'),
    writeFile(path.join(root, 'dist', 'assets', 'index.js'), 'console.log("release")\n')
  ])
  return root
}

const passingAudit = { projectRoot: 'absolute', summary: { error: 0, warning: 0, info: 0 }, findings: [] }
const passingApi = { phaserRoot: 'absolute', summary: { pass: 25, fail: 0, skipped: 0 }, results: [] }

test('writes portable audit and API evidence only after both checks pass', async () => {
  const root = await fixture()
  const reports = await runReleaseChecks(root, {
    audit: async () => passingAudit,
    checkApi: async () => passingApi
  })

  assert.equal(reports.audit.projectRoot, '.')
  assert.equal(reports.api.phaserRoot, 'node_modules/phaser')
  assert.deepEqual(reports.audit.fingerprints, reports.api.fingerprints)
  assert.equal(JSON.parse(await readFile(path.join(root, '.quality', 'phaser-audit.json'), 'utf8')).projectRoot, '.')
  assert.equal(JSON.parse(await readFile(path.join(root, '.quality', 'phaser-api.json'), 'utf8')).phaserRoot, 'node_modules/phaser')
})

test('removes stale release evidence when either strict check fails', async () => {
  const root = await fixture()
  for (const name of ['phaser-audit.json', 'phaser-api.json']) {
    await writeFile(path.join(root, '.quality', name), 'stale\n', 'utf8')
  }

  await assert.rejects(runReleaseChecks(root, {
    audit: async () => ({ ...passingAudit, summary: { error: 0, warning: 1, info: 0 } }),
    checkApi: async () => passingApi
  }), /Strict Phaser audit failed/)
  for (const name of ['phaser-audit.json', 'phaser-api.json']) {
    await assert.rejects(readFile(path.join(root, '.quality', name), 'utf8'), { code: 'ENOENT' })
  }
})

test('rejects project drift during release checks and publishes neither report', async () => {
  const root = await fixture()
  await assert.rejects(runReleaseChecks(root, {
    audit: async () => {
      await writeFile(path.join(root, 'src', 'main.ts'), 'export const signal = 2\n')
      return passingAudit
    },
    checkApi: async () => passingApi
  }), /releaseInputs do not match/)
  for (const name of ['phaser-audit.json', 'phaser-api.json']) {
    await assert.rejects(readFile(path.join(root, '.quality', name), 'utf8'), { code: 'ENOENT' })
  }
})
