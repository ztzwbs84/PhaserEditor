#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parsePersistenceContract } from '../assets/arcade-starter/scripts/persistence-proof.mjs'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const defaultSourceRoot = path.resolve(scriptDirectory, '..', 'assets', 'arcade-starter')
const manifestName = 'phaser-quality-tools.json'
const qualityConfigName = 'game-quality.json'

function invariant(condition, message) {
  if (!condition) throw new Error(message)
}

async function exists(file) {
  try {
    await stat(file)
    return true
  } catch {
    return false
  }
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex')
}

async function fileHash(file) {
  return sha256(await readFile(file))
}

function validateManagedPath(relative) {
  invariant(typeof relative === 'string' && relative.startsWith('scripts/'), `Managed path must stay under scripts/: ${relative}`)
  invariant(!path.isAbsolute(relative), `Managed path must be relative: ${relative}`)
  const normalized = path.normalize(relative)
  invariant(normalized !== '..' && !normalized.startsWith(`..${path.sep}`), `Managed path escapes the project: ${relative}`)
  return normalized
}

function validateFileMap(files, label) {
  invariant(files && typeof files === 'object' && !Array.isArray(files), `${label}.managedFiles must be an object.`)
  const entries = Object.entries(files)
  invariant(entries.length > 0, `${label}.managedFiles must not be empty.`)
  for (const [relative, hash] of entries) {
    validateManagedPath(relative)
    invariant(/^[a-f0-9]{64}$/.test(hash), `${label} has an invalid SHA-256 for ${relative}.`)
  }
}

function validateManifest(manifest, label) {
  invariant(manifest?.schemaVersion === 1, `${label}.schemaVersion must be 1.`)
  invariant(Number.isInteger(manifest.version) && manifest.version > 0, `${label}.version must be a positive integer.`)
  validateFileMap(manifest.managedFiles, label)
  invariant(Array.isArray(manifest.knownVersions), `${label}.knownVersions must be an array.`)
  const versions = new Set([manifest.version])
  let previousVersion = manifest.version
  for (const known of manifest.knownVersions) {
    invariant(Number.isInteger(known?.version) && known.version > 0 && !versions.has(known.version), `${label} has an invalid or duplicate known version.`)
    invariant(known.version < previousVersion, `${label}.knownVersions must be strictly descending below the current version.`)
    versions.add(known.version)
    previousVersion = known.version
    validateFileMap(known.managedFiles, `${label}.knownVersions[${known.version}]`)
  }
  invariant(Array.isArray(manifest.legacyFingerprints ?? []), `${label}.legacyFingerprints must be an array.`)
  const fingerprintIds = new Set()
  for (const fingerprint of manifest.legacyFingerprints ?? []) {
    invariant(typeof fingerprint?.id === 'string' && /^[a-z0-9-]+$/.test(fingerprint.id) && !fingerprintIds.has(fingerprint.id), `${label} has an invalid or duplicate legacy fingerprint.`)
    fingerprintIds.add(fingerprint.id)
    validateFileMap(fingerprint.managedFiles, `${label}.legacyFingerprints[${fingerprint.id}]`)
  }
  return manifest
}

function sameFileMap(left, right) {
  const leftEntries = Object.entries(left).sort(([a], [b]) => a.localeCompare(b))
  const rightEntries = Object.entries(right).sort(([a], [b]) => a.localeCompare(b))
  return JSON.stringify(leftEntries) === JSON.stringify(rightEntries)
}

function versionCatalog(manifest) {
  return [{ version: manifest.version, managedFiles: manifest.managedFiles }, ...manifest.knownVersions]
}

function legacyCatalog(manifest) {
  return (manifest.legacyFingerprints ?? []).map((fingerprint) => ({
    version: `legacy:${fingerprint.id}`,
    managedFiles: fingerprint.managedFiles
  }))
}

async function assertSourceManifest(sourceRoot, manifest) {
  for (const [relative, expected] of Object.entries(manifest.managedFiles)) {
    const source = path.resolve(sourceRoot, validateManagedPath(relative))
    invariant(path.relative(sourceRoot, source) && !path.relative(sourceRoot, source).startsWith('..'), `Managed source escapes the template: ${relative}`)
    invariant(await exists(source), `Managed source is missing: ${relative}`)
    invariant(await fileHash(source) === expected, `Quality tool manifest hash is stale for ${relative}.`)
  }
}

async function actualHashes(projectRoot, relativeFiles) {
  const hashes = {}
  const missing = []
  for (const relative of relativeFiles) {
    const target = path.resolve(projectRoot, validateManagedPath(relative))
    const within = path.relative(projectRoot, target)
    invariant(within && !within.startsWith('..') && !path.isAbsolute(within), `Managed target escapes the project: ${relative}`)
    if (!(await exists(target))) missing.push(relative)
    else hashes[relative] = await fileHash(target)
  }
  return { hashes, missing }
}

async function detectInstalledVersion(projectRoot, sourceManifest) {
  const projectManifestFile = path.join(projectRoot, manifestName)
  if (await exists(projectManifestFile)) {
    const installed = validateManifest(JSON.parse(await readFile(projectManifestFile, 'utf8')), 'Project quality tool manifest')
    const known = versionCatalog(sourceManifest).find((candidate) => candidate.version === installed.version)
    invariant(known, `Project quality tools version ${installed.version} is not recognized by this skill.`)
    invariant(sameFileMap(installed.managedFiles, known.managedFiles), `Project quality tool manifest version ${installed.version} does not match the trusted hash catalog.`)
    const actual = await actualHashes(projectRoot, Object.keys(installed.managedFiles))
    const conflicts = [
      ...actual.missing.map((relative) => ({ path: relative, reason: 'missing' })),
      ...Object.entries(installed.managedFiles)
        .filter(([relative, expected]) => actual.hashes[relative] && actual.hashes[relative] !== expected)
        .map(([relative]) => ({ path: relative, reason: 'modified' }))
    ]
    return { version: installed.version, managedFiles: installed.managedFiles, conflicts, legacy: false }
  }

  for (const candidate of [...versionCatalog(sourceManifest), ...legacyCatalog(sourceManifest)]) {
    const actual = await actualHashes(projectRoot, Object.keys(candidate.managedFiles))
    if (actual.missing.length === 0 && sameFileMap(actual.hashes, candidate.managedFiles)) {
      return { version: candidate.version, managedFiles: candidate.managedFiles, conflicts: [], legacy: true }
    }
  }
  return {
    version: null,
    managedFiles: null,
    conflicts: [{ path: manifestName, reason: 'missing manifest and files do not match a trusted legacy version' }],
    legacy: true
  }
}

function validPersistenceContract(contract) {
  try {
    parsePersistenceContract(contract)
    return true
  } catch {
    return false
  }
}

function sameJsonValue(left, right) {
  if (left === right) return true
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object'
    || Array.isArray(left) !== Array.isArray(right)) return false
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index] && sameJsonValue(left[key], right[key]))
}

async function planQualityConfigMigration(projectRoot, sourceRoot) {
  const sourceFile = path.join(sourceRoot, qualityConfigName)
  const projectFile = path.join(projectRoot, qualityConfigName)
  invariant(await exists(sourceFile), `Skill ${qualityConfigName} is missing.`)
  const source = JSON.parse(await readFile(sourceFile, 'utf8'))
  invariant(validPersistenceContract(source.persistence), `Skill ${qualityConfigName} has an invalid persistence contract.`)
  if (!(await exists(projectFile))) {
    return { conflict: { path: qualityConfigName, reason: 'missing quality configuration' } }
  }
  let project
  try {
    project = JSON.parse(await readFile(projectFile, 'utf8'))
  } catch {
    return { conflict: { path: qualityConfigName, reason: 'invalid JSON' } }
  }
  if (validPersistenceContract(project.persistence)) return { content: null }
  const persistence = project.persistence
  if (persistence?.required !== true || !Number.isInteger(persistence.schemaVersion) || persistence.schemaVersion < 1) {
    return { conflict: { path: qualityConfigName, reason: 'invalid or missing persistence contract' } }
  }
  if (persistence.migrationFromVersion !== undefined && (!Number.isInteger(persistence.migrationFromVersion) || persistence.migrationFromVersion < 1 || persistence.migrationFromVersion >= persistence.schemaVersion)) {
    return { conflict: { path: qualityConfigName, reason: 'invalid persistence migration source' } }
  }
  if (persistence.schemaVersion !== source.persistence.schemaVersion
    || (persistence.migrationFromVersion !== undefined && persistence.migrationFromVersion !== source.persistence.migrationFromVersion)) {
    return { conflict: { path: qualityConfigName, reason: `cannot infer migration source for schema ${persistence.schemaVersion}` } }
  }
  if (persistence.migrationFixture !== undefined
    && !sameJsonValue(persistence.migrationFixture, source.persistence.migrationFixture)) {
    return { conflict: { path: qualityConfigName, reason: 'cannot infer persistence proofs for a custom migration fixture' } }
  }
  const migrated = structuredClone(project)
  migrated.persistence.migrationFromVersion ??= source.persistence.migrationFromVersion
  migrated.persistence.migrationFixture ??= structuredClone(source.persistence.migrationFixture)
  migrated.persistence.proofs ??= structuredClone(source.persistence.proofs)
  if (!validPersistenceContract(migrated.persistence)) {
    return { conflict: { path: qualityConfigName, reason: 'invalid persistence migration fixture or proof contract' } }
  }
  return { content: `${JSON.stringify(migrated, null, 2)}\n` }
}

async function applyTransaction(projectRoot, sourceRoot, sourceManifest, installed, qualityConfigContent) {
  const transaction = path.join(projectRoot, `.phaser-quality-update-${process.pid}-${Date.now()}`)
  const incoming = path.join(transaction, 'incoming')
  const backup = path.join(transaction, 'backup')
  const installedFiles = Object.keys(installed.managedFiles)
  const currentFiles = Object.keys(sourceManifest.managedFiles)
  const removedFiles = installedFiles.filter((relative) => !(relative in sourceManifest.managedFiles))
  const configTargets = qualityConfigContent === null ? [] : [qualityConfigName]
  const installTargets = [...configTargets, ...currentFiles, manifestName]
  const targets = [...removedFiles, ...installTargets]
  const installTargetSet = new Set(installTargets)
  const moved = []
  const installedTargets = []
  await mkdir(incoming, { recursive: true })
  await mkdir(backup, { recursive: true })
  try {
    for (const relative of Object.keys(sourceManifest.managedFiles)) {
      const staged = path.join(incoming, relative)
      await mkdir(path.dirname(staged), { recursive: true })
      await copyFile(path.join(sourceRoot, validateManagedPath(relative)), staged)
      invariant(await fileHash(staged) === sourceManifest.managedFiles[relative], `Staged quality tool hash mismatch: ${relative}`)
    }
    if (qualityConfigContent !== null) await writeFile(path.join(incoming, qualityConfigName), qualityConfigContent, 'utf8')
    await copyFile(path.join(sourceRoot, manifestName), path.join(incoming, manifestName))

    for (const relative of targets) {
      const destination = path.join(projectRoot, relative)
      const saved = path.join(backup, relative)
      await mkdir(path.dirname(saved), { recursive: true })
      if (await exists(destination)) {
        await rename(destination, saved)
        moved.push({ destination, saved })
      }
      if (!installTargetSet.has(relative)) continue
      await mkdir(path.dirname(destination), { recursive: true })
      await rename(path.join(incoming, relative), destination)
      installedTargets.push(destination)
    }
  } catch (error) {
    for (const destination of installedTargets.toReversed()) await rm(destination, { force: true }).catch(() => undefined)
    for (const { destination, saved } of moved.toReversed()) {
      if (await exists(saved)) await rename(saved, destination).catch(() => undefined)
    }
    throw error
  } finally {
    await rm(transaction, { recursive: true, force: true }).catch(() => undefined)
  }
  return {
    fromVersion: installed.version,
    toVersion: sourceManifest.version,
    updatedFiles: installTargets,
    removedFiles
  }
}

export async function updateQualityTools({ projectRoot, sourceRoot = defaultSourceRoot, apply = false }) {
  const project = path.resolve(projectRoot)
  const source = path.resolve(sourceRoot)
  invariant(await exists(path.join(project, 'package.json')), `Project package.json is missing: ${project}`)
  const sourceManifest = validateManifest(JSON.parse(await readFile(path.join(source, manifestName), 'utf8')), 'Skill quality tool manifest')
  await assertSourceManifest(source, sourceManifest)
  const installed = await detectInstalledVersion(project, sourceManifest)
  const configMigration = await planQualityConfigMigration(project, source)
  const conflicts = [...installed.conflicts, ...(configMigration.conflict ? [configMigration.conflict] : [])]
  if (conflicts.length > 0) {
    return { status: 'conflict', project, installedVersion: installed.version, targetVersion: sourceManifest.version, conflicts, updatedFiles: [], removedFiles: [] }
  }
  if (installed.version === sourceManifest.version && !installed.legacy && configMigration.content === null) {
    return { status: 'current', project, installedVersion: installed.version, targetVersion: sourceManifest.version, conflicts: [], updatedFiles: [], removedFiles: [] }
  }
  if (!apply) {
    return { status: 'outdated', project, installedVersion: installed.version, targetVersion: sourceManifest.version, conflicts: [], updatedFiles: [], removedFiles: [] }
  }
  const result = await applyTransaction(project, source, sourceManifest, installed, configMigration.content)
  return { status: 'updated', project, installedVersion: result.toVersion, targetVersion: sourceManifest.version, conflicts: [], updatedFiles: result.updatedFiles, removedFiles: result.removedFiles, fromVersion: result.fromVersion }
}

function parseArguments(argv) {
  const options = { projectRoot: null, apply: false, json: false }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--apply') options.apply = true
    else if (argument === '--check') options.apply = false
    else if (argument === '--json') options.json = true
    else if (argument === '--help' || argument === '-h') options.help = true
    else if (argument.startsWith('-')) throw new Error(`Unknown option: ${argument}`)
    else if (!options.projectRoot) options.projectRoot = path.resolve(argument)
    else throw new Error(`Unexpected argument: ${argument}`)
  }
  invariant(options.help || options.projectRoot, 'A project directory is required.')
  return options
}

function usage() {
  return `Usage: node update-phaser-quality-tools.mjs <project-directory> [--check|--apply] [--json]

Audit or safely update only the generated project's managed Phaser quality scripts.
The command refuses to overwrite modified or unrecognized managed files.`
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  if (options.help) {
    console.log(usage())
    return
  }
  const report = await updateQualityTools(options)
  if (options.json) console.log(JSON.stringify(report, null, 2))
  else if (report.status === 'current') console.log(`Phaser quality tools are current at version ${report.targetVersion}.`)
  else if (report.status === 'updated') console.log(`Updated Phaser quality tools ${report.fromVersion} -> ${report.targetVersion} (${report.updatedFiles.length} installed, ${report.removedFiles.length} removed).`)
  else if (report.status === 'outdated') console.error(`Phaser quality tools are outdated: ${report.installedVersion} -> ${report.targetVersion}. Run again with --apply.`)
  else console.error(`Phaser quality tool update refused: ${report.conflicts.map(({ path: file, reason }) => `${file}: ${reason}`).join('; ')}`)
  if (report.status === 'outdated' || report.status === 'conflict') process.exitCode = 1
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(`Quality tool update failed: ${error.message}`)
    process.exitCode = 1
  })
}
