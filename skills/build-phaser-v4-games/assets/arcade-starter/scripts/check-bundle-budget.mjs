#!/usr/bin/env node

import { gzipSync } from 'node:zlib'
import { spawn } from 'node:child_process'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { assertProjectFingerprint, createProjectFingerprint, fingerprintDist, fingerprintReleaseInputs } from './release-fingerprint.mjs'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function walk(root, current = root, output = []) {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name)
    if (entry.isDirectory()) await walk(root, absolute, output)
    else output.push(path.relative(root, absolute).replaceAll('\\', '/'))
  }
  return output
}

export async function measureBundle(root, budget) {
  const distRoot = path.join(root, 'dist')
  if (!(await stat(distRoot).catch(() => null))?.isDirectory()) {
    throw new Error('dist/ is missing. Run the production build before the bundle budget check.')
  }

  const files = []
  for (const relative of await walk(distRoot)) {
    const content = await readFile(path.join(distRoot, relative))
    files.push({ path: relative, bytes: content.length, gzipBytes: gzipSync(content).length })
  }
  const shipped = files.filter((file) => !file.path.endsWith('.map'))
  const entries = shipped.filter((file) => /(?:^|\/)assets\/[^/]+\.js$/.test(file.path))
  const sourceMaps = files.filter((file) => file.path.endsWith('.map'))
  const largestEntry = entries.toSorted((left, right) => right.bytes - left.bytes)[0] ?? null
  const totalBytes = shipped.reduce((sum, file) => sum + file.bytes, 0)
  const totalGzipBytes = shipped.reduce((sum, file) => sum + file.gzipBytes, 0)
  const failures = []

  if (!largestEntry) failures.push('No production JavaScript entry was found in dist/assets/.')
  if (largestEntry?.bytes > budget.maximumEntryBytes) {
    failures.push(`Largest JavaScript entry is ${largestEntry.bytes} bytes; budget is ${budget.maximumEntryBytes}.`)
  }
  if (largestEntry?.gzipBytes > budget.maximumEntryGzipBytes) {
    failures.push(`Largest JavaScript entry is ${largestEntry.gzipBytes} gzip bytes; budget is ${budget.maximumEntryGzipBytes}.`)
  }
  if (totalBytes > budget.maximumTotalBytes) {
    failures.push(`Shipped dist total is ${totalBytes} bytes; budget is ${budget.maximumTotalBytes}.`)
  }
  if (totalGzipBytes > budget.maximumTotalGzipBytes) {
    failures.push(`Shipped dist total is ${totalGzipBytes} gzip bytes; budget is ${budget.maximumTotalGzipBytes}.`)
  }
  if (budget.forbidSourceMaps && sourceMaps.length > 0) {
    failures.push(`Production dist contains forbidden source maps: ${sourceMaps.map((file) => file.path).join(', ')}.`)
  }

  return {
    status: failures.length === 0 ? 'pass' : 'fail',
    budget,
    summary: {
      fileCount: shipped.length,
      totalBytes,
      totalGzipBytes,
      largestEntry
    },
    files,
    failures
  }
}

export async function runLocalViteBuild(root) {
  const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')
  if (!(await stat(vite).catch(() => null))?.isFile()) {
    throw new Error('The project-local Vite executable is missing. Run npm ci before the bundle budget check.')
  }
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [vite, 'build'], { cwd: root, stdio: 'inherit', windowsHide: true })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`Project-local Vite build failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}.`))
    })
  })
}

export async function buildAndMeasureBundle(root, budget, dependencies = {}) {
  const build = dependencies.build ?? runLocalViteBuild
  const releaseInputsBefore = await fingerprintReleaseInputs(root)
  await build(root)
  const releaseInputsAfter = await fingerprintReleaseInputs(root)
  const dist = await fingerprintDist(root)
  const fingerprints = createProjectFingerprint(releaseInputsBefore, dist)
  assertProjectFingerprint(fingerprints, createProjectFingerprint(releaseInputsAfter, dist), 'Production build freshness')
  return { ...await measureBundle(root, budget), fingerprints }
}

async function main() {
  const qualityRoot = path.join(projectRoot, '.quality')
  await mkdir(qualityRoot, { recursive: true })
  const reportFile = path.join(qualityRoot, 'bundle-budget.json')
  await rm(reportFile, { force: true })
  try {
    const quality = JSON.parse(await readFile(path.join(projectRoot, 'game-quality.json'), 'utf8'))
    const report = await buildAndMeasureBundle(projectRoot, quality.bundle)
    await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    const entry = report.summary.largestEntry
    console.log(`Bundle budget: ${report.status.toUpperCase()} - ${report.summary.totalGzipBytes} total gzip bytes, ${entry?.gzipBytes ?? 0} entry gzip bytes`)
    for (const failure of report.failures) console.error(`  ${failure}`)
    if (report.status === 'fail') process.exitCode = 1
  } catch (error) {
    await rm(reportFile, { force: true })
    throw error
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
