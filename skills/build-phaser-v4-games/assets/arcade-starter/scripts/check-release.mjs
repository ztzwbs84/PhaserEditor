#!/usr/bin/env node

import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { audit } from './audit-phaser-project.mjs'
import { checkPhaserApi } from './check-phaser-api.mjs'
import { assertProjectFingerprint, fingerprintProjectRelease } from './release-fingerprint.mjs'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDirectory, '..')
const anchorsFile = path.join(scriptDirectory, 'api-anchors.json')
const reportNames = ['phaser-audit.json', 'phaser-api.json']

export async function runReleaseChecks(root = projectRoot, dependencies = {}) {
  const qualityRoot = path.join(root, '.quality')
  await mkdir(qualityRoot, { recursive: true })
  await Promise.all(reportNames.map((name) => rm(path.join(qualityRoot, name), { force: true })))

  const auditProject = dependencies.audit ?? audit
  const checkApi = dependencies.checkApi ?? ((target) => checkPhaserApi(target, anchorsFile))
  const temporary = reportNames.map((name) => path.join(qualityRoot, `.${name}.${process.pid}.${Date.now()}.tmp`))
  try {
    const initialFingerprints = await fingerprintProjectRelease(root)
    if (dependencies.expectedFingerprints) {
      assertProjectFingerprint(dependencies.expectedFingerprints, initialFingerprints, 'Release check starting freshness')
    }
    const [auditReport, apiReport] = await Promise.all([auditProject(root), checkApi(root)])
    if (auditReport.summary.error > 0 || auditReport.summary.warning > 0) {
      throw new Error(`Strict Phaser audit failed: ${auditReport.summary.error} errors, ${auditReport.summary.warning} warnings.`)
    }
    if (apiReport.summary.fail > 0) throw new Error(`Phaser API anchor check failed: ${apiReport.summary.fail} failures.`)

    const finalFingerprints = await fingerprintProjectRelease(root)
    assertProjectFingerprint(initialFingerprints, finalFingerprints, 'Release check freshness')
    const portableAudit = { ...auditReport, projectRoot: '.', fingerprints: finalFingerprints }
    const portableApi = { ...apiReport, phaserRoot: 'node_modules/phaser', fingerprints: finalFingerprints }
    await Promise.all([
      writeFile(temporary[0], `${JSON.stringify(portableAudit, null, 2)}\n`, 'utf8'),
      writeFile(temporary[1], `${JSON.stringify(portableApi, null, 2)}\n`, 'utf8')
    ])
    for (let index = 0; index < reportNames.length; index += 1) {
      await rename(temporary[index], path.join(qualityRoot, reportNames[index]))
    }
    return { audit: portableAudit, api: portableApi }
  } catch (error) {
    await Promise.all([
      ...temporary.map((file) => rm(file, { force: true })),
      ...reportNames.map((name) => rm(path.join(qualityRoot, name), { force: true }))
    ])
    throw error
  }
}

async function main() {
  const reports = await runReleaseChecks()
  console.log(`Release checks: PASS - audit ${reports.audit.summary.error}/${reports.audit.summary.warning}, API ${reports.api.summary.pass}/${reports.api.summary.fail}`)
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
