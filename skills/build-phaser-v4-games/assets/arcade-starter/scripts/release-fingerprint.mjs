import { createHash } from 'node:crypto'
import { lstat, readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'

const schemaVersion = 1
const algorithm = 'sha256'
const excludedReleaseDirectories = new Set(['.git', '.quality', 'dist', 'node_modules'])

function invariant(condition, message) {
  if (!condition) throw new Error(message)
}

function comparePaths(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function portablePath(root, absolute) {
  return path.relative(root, absolute).replaceAll('\\', '/')
}

async function collectFiles(root, { excludeRootDirectories = new Set(), label }) {
  const rootStat = await lstat(root).catch(() => null)
  invariant(rootStat, `${label} directory is missing: ${root}`)
  invariant(!rootStat.isSymbolicLink(), `${label} directory must not be a symbolic link: ${root}`)
  invariant(rootStat.isDirectory(), `${label} path is not a directory: ${root}`)
  const files = []

  async function visit(current) {
    const entries = (await readdir(current, { withFileTypes: true }))
      .toSorted((left, right) => comparePaths(left.name, right.name))
    for (const entry of entries) {
      if (current === root && entry.isDirectory() && excludeRootDirectories.has(entry.name)) continue
      const absolute = path.join(current, entry.name)
      const metadata = await lstat(absolute)
      const relative = portablePath(root, absolute)
      invariant(!metadata.isSymbolicLink(), `${label} contains a forbidden symbolic link: ${relative}`)
      if (metadata.isDirectory()) await visit(absolute)
      else {
        invariant(metadata.isFile(), `${label} contains an unsupported filesystem entry: ${relative}`)
        files.push({ absolute, relative })
      }
    }
  }

  await visit(root)
  return files.toSorted((left, right) => comparePaths(left.relative, right.relative))
}

async function fingerprintTree(root, options) {
  const files = await collectFiles(path.resolve(root), options)
  invariant(!options.requireFiles || files.length > 0, `${options.label} contains no files.`)
  const hash = createHash(algorithm)
  hash.update(Buffer.from(`phaser-release-fingerprint-v${schemaVersion}\0${options.scope}\0`, 'utf8'))
  let bytes = 0
  for (const file of files) {
    const content = await readFile(file.absolute)
    const encodedPath = Buffer.from(file.relative, 'utf8')
    bytes += content.length
    hash.update(Buffer.from(`file\0${encodedPath.length}\0`, 'utf8'))
    hash.update(encodedPath)
    hash.update(Buffer.from(`\0${content.length}\0`, 'utf8'))
    hash.update(content)
  }
  return {
    scope: options.scope,
    algorithm,
    fileCount: files.length,
    bytes,
    digest: hash.digest('hex')
  }
}

export async function fingerprintReleaseInputs(root) {
  return fingerprintTree(root, {
    scope: 'releaseInputs',
    label: 'Release inputs',
    excludeRootDirectories: excludedReleaseDirectories,
    requireFiles: true
  })
}

export async function fingerprintDist(root) {
  return fingerprintTree(path.join(path.resolve(root), 'dist'), {
    scope: 'dist',
    label: 'Production dist',
    requireFiles: true
  })
}

export async function fingerprintProjectRelease(root) {
  const [releaseInputs, dist] = await Promise.all([
    fingerprintReleaseInputs(root),
    fingerprintDist(root)
  ])
  return { schemaVersion, releaseInputs, dist }
}

function validateTreeFingerprint(value, scope, label) {
  invariant(value && typeof value === 'object' && !Array.isArray(value), `${label}.${scope} must be an object.`)
  invariant(value.scope === scope, `${label}.${scope}.scope must be ${scope}.`)
  invariant(value.algorithm === algorithm, `${label}.${scope}.algorithm must be ${algorithm}.`)
  invariant(Number.isInteger(value.fileCount) && value.fileCount > 0, `${label}.${scope}.fileCount must be a positive integer.`)
  invariant(Number.isInteger(value.bytes) && value.bytes >= 0, `${label}.${scope}.bytes must be a non-negative integer.`)
  invariant(/^[a-f0-9]{64}$/.test(value.digest ?? ''), `${label}.${scope}.digest must be a SHA-256 digest.`)
  return value
}

export function validateProjectFingerprint(value, label = 'Project fingerprint') {
  invariant(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object.`)
  invariant(value.schemaVersion === schemaVersion, `${label}.schemaVersion must be ${schemaVersion}.`)
  validateTreeFingerprint(value.releaseInputs, 'releaseInputs', label)
  validateTreeFingerprint(value.dist, 'dist', label)
  return value
}

function sameTreeFingerprint(left, right) {
  return left.scope === right.scope
    && left.algorithm === right.algorithm
    && left.fileCount === right.fileCount
    && left.bytes === right.bytes
    && left.digest === right.digest
}

export function assertProjectFingerprint(expected, actual, label = 'Project fingerprint') {
  validateProjectFingerprint(expected, `${label} expected`)
  validateProjectFingerprint(actual, `${label} actual`)
  invariant(sameTreeFingerprint(expected.releaseInputs, actual.releaseInputs), `${label} releaseInputs do not match current project files.`)
  invariant(sameTreeFingerprint(expected.dist, actual.dist), `${label} dist does not match current production files.`)
  return actual
}

export function createProjectFingerprint(releaseInputs, dist) {
  return validateProjectFingerprint({ schemaVersion, releaseInputs, dist })
}
