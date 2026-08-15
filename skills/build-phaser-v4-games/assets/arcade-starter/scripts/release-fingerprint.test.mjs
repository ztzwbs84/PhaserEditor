import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { assertProjectFingerprint, fingerprintProjectRelease, fingerprintReleaseInputs } from './release-fingerprint.mjs'

const roots = []

test.afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'phaser-release-fingerprint-'))
  roots.push(root)
  await Promise.all([
    mkdir(path.join(root, 'src'), { recursive: true }),
    mkdir(path.join(root, 'public', 'assets'), { recursive: true }),
    mkdir(path.join(root, 'dist', 'assets'), { recursive: true }),
    mkdir(path.join(root, '.quality'), { recursive: true }),
    mkdir(path.join(root, 'node_modules', 'cache'), { recursive: true })
  ])
  await Promise.all([
    writeFile(path.join(root, 'package.json'), '{"type":"module"}\n'),
    writeFile(path.join(root, 'src', 'main.ts'), 'export const signal = 1\n'),
    writeFile(path.join(root, 'public', 'assets', 'signal.txt'), 'signal\n'),
    writeFile(path.join(root, 'dist', 'index.html'), '<main></main>\n'),
    writeFile(path.join(root, 'dist', 'assets', 'index.js'), 'console.log("signal")\n'),
    writeFile(path.join(root, '.quality', 'old.json'), '{}\n'),
    writeFile(path.join(root, 'node_modules', 'cache', 'entry'), 'ignored\n')
  ])
  return root
}

test('is deterministic and excludes generated, quality, dependency, and VCS roots', async () => {
  const root = await fixture()
  const initial = await fingerprintProjectRelease(root)
  const repeated = await fingerprintProjectRelease(root)
  assert.deepEqual(repeated, initial)

  await writeFile(path.join(root, '.quality', 'old.json'), '{"changed":true}\n')
  await writeFile(path.join(root, 'node_modules', 'cache', 'entry'), 'changed\n')
  assert.deepEqual(await fingerprintProjectRelease(root), initial)
})

test('detects release-input and dist drift independently', async () => {
  const root = await fixture()
  const initial = await fingerprintProjectRelease(root)

  await writeFile(path.join(root, 'src', 'main.ts'), 'export const signal = 2\n')
  const sourceDrift = await fingerprintProjectRelease(root)
  assert.notEqual(sourceDrift.releaseInputs.digest, initial.releaseInputs.digest)
  assert.equal(sourceDrift.dist.digest, initial.dist.digest)
  assert.throws(() => assertProjectFingerprint(initial, sourceDrift, 'Freshness'), /releaseInputs/)

  await writeFile(path.join(root, 'src', 'main.ts'), 'export const signal = 1\n')
  await writeFile(path.join(root, 'dist', 'assets', 'index.js'), 'console.log("changed")\n')
  const distDrift = await fingerprintProjectRelease(root)
  assert.equal(distDrift.releaseInputs.digest, initial.releaseInputs.digest)
  assert.notEqual(distDrift.dist.digest, initial.dist.digest)
  assert.throws(() => assertProjectFingerprint(initial, distDrift, 'Freshness'), /dist/)
})

test('rejects symbolic links instead of hashing outside their tree', async (context) => {
  const root = await fixture()
  try {
    await symlink(path.join(root, 'package.json'), path.join(root, 'src', 'linked.json'), 'file')
  } catch (error) {
    if (error?.code === 'EPERM') return context.skip('Symbolic links are not permitted in this environment.')
    throw error
  }
  await assert.rejects(fingerprintReleaseInputs(root), /forbidden symbolic link/)
})

test('rejects a dist root that is itself a symbolic link', async (context) => {
  const source = await fixture()
  const root = await mkdtemp(path.join(os.tmpdir(), 'phaser-release-fingerprint-linked-dist-'))
  roots.push(root)
  await writeFile(path.join(root, 'package.json'), '{"type":"module"}\n')
  try {
    await symlink(path.join(source, 'dist'), path.join(root, 'dist'), process.platform === 'win32' ? 'junction' : 'dir')
  } catch (error) {
    if (error?.code === 'EPERM') return context.skip('Symbolic links are not permitted in this environment.')
    throw error
  }
  await assert.rejects(fingerprintProjectRelease(root), /must not be a symbolic link/)
})
