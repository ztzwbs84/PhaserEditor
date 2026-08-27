#!/usr/bin/env node
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { skillRoot } from './runtime-paths.mjs'

const keep = process.argv.includes('--keep')
const withBrowser = process.argv.includes('--with-browser')
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'unity-ugui-skill-smoke-'))
const projectRoot = path.join(temporaryRoot, 'UnityProject')
const prefabRoot = path.join(projectRoot, 'Assets', 'UI')
const outputRoot = path.join(temporaryRoot, 'output')
const wrapper = path.join(skillRoot, 'scripts', 'ugui.mjs')

try {
  await Promise.all([
    mkdir(prefabRoot, { recursive: true }),
    mkdir(path.join(projectRoot, 'ProjectSettings'), { recursive: true }),
    mkdir(outputRoot, { recursive: true })
  ])
  await Promise.all([
    writeFile(path.join(prefabRoot, 'Main.prefab'), prefabFixture('Main'), 'utf8'),
    writeFile(path.join(projectRoot, 'ProjectSettings', 'ProjectVersion.txt'), 'm_EditorVersion: 2022.3.20f1\n', 'utf8')
  ])

  const scanReport = path.join(outputRoot, 'scan-report.json')
  const profileReport = path.join(outputRoot, 'profile-report.json')
  const bakedRoot = path.join(outputRoot, 'single')
  const batchRoot = path.join(outputRoot, 'batch-output')
  const auditReport = path.join(outputRoot, 'commercial-audit.json')

  run(process.execPath, [path.join(skillRoot, 'scripts', 'profile-corpus.mjs'), '--prefab-root', prefabRoot, '--output', profileReport])
  run(process.execPath, [wrapper, 'scan', '--project', projectRoot, '--output', scanReport])
  run(process.execPath, [wrapper, 'bake', '--project', projectRoot, '--prefab', 'Main.prefab', '--output', bakedRoot])
  run(process.execPath, [wrapper, 'batch', '--project', projectRoot, '--output-root', batchRoot])
  run(process.execPath, [path.join(skillRoot, 'scripts', 'audit-batch.mjs'), '--batch-report', path.join(batchRoot, 'batch-report.json'), '--output', auditReport])

  if (withBrowser) {
    const reference = path.join(outputRoot, 'reference.png')
    const actual = path.join(outputRoot, 'actual.png')
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlC6fQAAAAASUVORK5CYII=', 'base64')
    await Promise.all([writeFile(reference, png), writeFile(actual, png)])
    run(process.execPath, [path.join(skillRoot, 'scripts', 'compare-renders.mjs'), '--reference', reference, '--actual', actual])
  }

  const [scan, batch, audit] = await Promise.all([
    readJson(scanReport),
    readJson(path.join(batchRoot, 'batch-report.json')),
    readJson(auditReport)
  ])
  for (const required of ['ui.json', 'conversion-report.json', 'preview.html', 'phaser.html', 'vendor/phaser.js']) {
    await access(path.join(bakedRoot, ...required.split('/')))
  }
  if (scan.paths.uiRawRoot !== null) throw new Error('Smoke fixture unexpectedly resolved a UIRaw directory.')
  if (batch.passed !== 1 || batch.failed !== 0) throw new Error('Standalone batch smoke test did not pass exactly one Prefab.')
  if (audit.status !== 'passed') throw new Error('Standalone commercial audit did not pass.')

  console.log(JSON.stringify({
    status: 'passed',
    temporaryRoot,
    uiRawRoot: scan.paths.uiRawRoot,
    prefabs: scan.prefabs.count,
    batch: { passed: batch.passed, failed: batch.failed },
    audit: audit.status,
    browserComparison: withBrowser ? 'passed' : 'skipped'
  }, null, 2))
} finally {
  if (!keep) await removeTemporaryRoot(temporaryRoot)
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: temporaryRoot, env: process.env, stdio: 'inherit', shell: false })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Command failed with exit code ${result.status}: ${command} ${args.join(' ')}`)
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'))
}

async function removeTemporaryRoot(root) {
  const resolvedRoot = path.resolve(root)
  const resolvedTemp = path.resolve(os.tmpdir())
  const expectedPrefix = `${resolvedTemp}${path.sep}`
  if (!resolvedRoot.startsWith(expectedPrefix) || !path.basename(resolvedRoot).startsWith('unity-ugui-skill-smoke-')) {
    throw new Error(`Refusing to remove unexpected smoke-test directory: ${resolvedRoot}`)
  }
  await rm(resolvedRoot, { recursive: true, force: true })
}

function prefabFixture(name) {
  return `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1 &1000
GameObject:
  m_ObjectHideFlags: 0
  m_Component:
  - component: {fileID: 2000}
  m_Layer: 5
  m_Name: ${name}
  m_IsActive: 1
--- !u!224 &2000
RectTransform:
  m_ObjectHideFlags: 0
  m_GameObject: {fileID: 1000}
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalPosition: {x: 0, y: 0, z: 0}
  m_LocalScale: {x: 1, y: 1, z: 1}
  m_Children: []
  m_Father: {fileID: 0}
  m_RootOrder: 0
  m_AnchorMin: {x: 0.5, y: 0.5}
  m_AnchorMax: {x: 0.5, y: 0.5}
  m_AnchoredPosition: {x: 0, y: 0}
  m_SizeDelta: {x: 300, y: 160}
  m_Pivot: {x: 0.5, y: 0.5}
`
}
