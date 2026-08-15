import assert from 'node:assert/strict'
import { gzipSync } from 'node:zlib'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { buildAndMeasureBundle, measureBundle } from './check-bundle-budget.mjs'

const temporaryRoots = []

test.afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture(files) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'phaser-bundle-budget-'))
  temporaryRoots.push(root)
  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(root, 'dist', relative)
    await mkdir(path.dirname(absolute), { recursive: true })
    await writeFile(absolute, content)
  }
  return root
}

async function releaseFixture(files) {
  const root = await fixture(files)
  await mkdir(path.join(root, 'src'), { recursive: true })
  await writeFile(path.join(root, 'package.json'), '{"type":"module"}\n')
  await writeFile(path.join(root, 'src', 'main.ts'), 'export const signal = 1\n')
  return root
}

const generousBudget = {
  maximumEntryBytes: 1_000,
  maximumEntryGzipBytes: 1_000,
  maximumTotalBytes: 2_000,
  maximumTotalGzipBytes: 2_000,
  forbidSourceMaps: true
}

test('measures shipped files and their actual gzip sizes', async () => {
  const entry = 'console.log("signal")'.repeat(5)
  const root = await fixture({ 'index.html': '<main></main>', 'assets/index.js': entry })
  const report = await measureBundle(root, generousBudget)

  assert.equal(report.status, 'pass')
  assert.equal(report.summary.largestEntry.bytes, Buffer.byteLength(entry))
  assert.equal(report.summary.largestEntry.gzipBytes, gzipSync(entry).length)
})

test('fails oversized entries and production source maps', async () => {
  const root = await fixture({
    'index.html': '<main></main>',
    'assets/index.js': 'x'.repeat(100),
    'assets/index.js.map': '{}'
  })
  const report = await measureBundle(root, { ...generousBudget, maximumEntryBytes: 50 })

  assert.equal(report.status, 'fail')
  assert.ok(report.failures.some((failure) => failure.includes('Largest JavaScript entry')))
  assert.ok(report.failures.some((failure) => failure.includes('source maps')))
})

test('records release and dist fingerprints around a production rebuild', async () => {
  const root = await releaseFixture({ 'index.html': '<main></main>', 'assets/index.js': 'console.log("old")' })
  const report = await buildAndMeasureBundle(root, generousBudget, {
    build: async (target) => writeFile(path.join(target, 'dist', 'assets', 'index.js'), 'console.log("built")')
  })
  assert.equal(report.status, 'pass')
  assert.equal(report.fingerprints.schemaVersion, 1)
  assert.equal(report.fingerprints.releaseInputs.scope, 'releaseInputs')
  assert.equal(report.fingerprints.dist.scope, 'dist')
})

test('rejects a build that changes release inputs and leaves no trusted report', async () => {
  const root = await releaseFixture({ 'index.html': '<main></main>', 'assets/index.js': 'console.log("old")' })
  await assert.rejects(buildAndMeasureBundle(root, generousBudget, {
    build: async (target) => writeFile(path.join(target, 'src', 'main.ts'), 'export const signal = 2\n')
  }), /releaseInputs/)
})
