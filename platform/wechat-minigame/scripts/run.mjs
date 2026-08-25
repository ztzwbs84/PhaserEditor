#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const VALUE_OPTIONS = [
  ['project', '--project'],
  ['output', '--output'],
  ['width', '--width'],
  ['height', '--height'],
  ['orientation', '--orientation'],
  ['appid', '--appid']
]
const BOOLEAN_OPTIONS = [
  ['no_install', '--no-install'],
  ['force', '--force'],
  ['dry_run', '--dry-run'],
  ['json', '--json'],
  ['help', '--help']
]
const KNOWN_ENV_KEYS = new Set([
  ...VALUE_OPTIONS.map(([name]) => `npm_config_${name}`),
  ...BOOLEAN_OPTIONS.flatMap(([name]) => [`npm_config_${name}`, `npm_config_${name.replaceAll('_', '-')}`]),
  'npm_config_install'
])

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const rootEnv = { ...process.env }
const forwarded = restoreNpmArguments(rootEnv, process.argv.slice(2))
const cliArgs = forwarded.length > 0 ? forwarded : process.argv.slice(2)
const childEnv = { ...rootEnv }

for (const key of Object.keys(childEnv)) {
  if (key.toLowerCase().startsWith('npm_config_') && KNOWN_ENV_KEYS.has(key.toLowerCase())) delete childEnv[key]
}

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const build = spawnSync(npmCommand, ['run', 'build', '--workspace', '@phaser-editor/wechat-minigame'], {
  cwd: path.resolve(packageRoot, '..', '..'),
  env: childEnv,
  stdio: 'inherit',
  windowsHide: true,
  shell: process.platform === 'win32'
})
if (build.error) {
  console.error(build.error.message)
  process.exit(1)
}
if (build.status !== 0) process.exit(build.status ?? 1)

const cli = spawnSync(process.execPath, [path.join(packageRoot, 'dist', 'cli.js'), ...cliArgs], {
  cwd: path.resolve(packageRoot, '..', '..'),
  env: childEnv,
  stdio: 'inherit',
  windowsHide: true,
  shell: false
})
process.exit(cli.status ?? 1)

function restoreNpmArguments(env, positional) {
  const markedValues = new Map()
  const remaining = [...positional]
  let hasNpmForwarding = false

  for (const [name] of VALUE_OPTIONS) {
    const value = readEnv(env, name)
    if (value === undefined) continue
    hasNpmForwarding = true
    if (value !== 'true') {
      markedValues.set(name, value)
      removeFirst(remaining, value)
    }
  }
  for (const [name] of BOOLEAN_OPTIONS) {
    if (readEnv(env, name) !== undefined) hasNpmForwarding = true
  }
  if (!hasNpmForwarding) return []

  claimValue(markedValues, remaining, 'orientation', (value) => value === 'portrait' || value === 'landscape')
  claimValue(markedValues, remaining, 'project', (value) => isPhaserProjectPath(value))

  const numericNames = ['width', 'height'].filter((name) => readEnv(env, name) !== undefined && !markedValues.has(name))
  const numericValues = remaining.filter((value) => /^\d+$/.test(value))
  if (numericNames.length === 2 && numericValues.length >= 2 && markedValues.has('orientation')) {
    const first = Number(numericValues[0])
    const second = Number(numericValues[1])
    const landscape = markedValues.get('orientation') === 'landscape'
    markedValues.set('width', String(landscape ? Math.max(first, second) : Math.min(first, second)))
    markedValues.set('height', String(landscape ? Math.min(first, second) : Math.max(first, second)))
    removeFirst(remaining, numericValues[0])
    removeFirst(remaining, numericValues[1])
  } else {
    for (const name of numericNames) claimValue(markedValues, remaining, name, (value) => /^\d+$/.test(value))
  }

  if (readEnv(env, 'output') !== undefined && !markedValues.has('output')) {
    claimValue(markedValues, remaining, 'output', (value) => looksLikePath(value))
  }
  if (readEnv(env, 'project') !== undefined && !markedValues.has('project')) {
    claimValue(markedValues, remaining, 'project', (value) => looksLikePath(value))
  }
  if (readEnv(env, 'appid') !== undefined && !markedValues.has('appid')) {
    claimValue(markedValues, remaining, 'appid', () => true)
  }

  const args = []
  for (const [name, flag] of VALUE_OPTIONS) {
    const value = markedValues.get(name)
    if (value !== undefined && value !== '') args.push(flag, value)
  }
  for (const [name, flag] of BOOLEAN_OPTIONS) {
    const value = readEnv(env, name)
    if (value !== undefined && !/^(?:0|false|no)$/i.test(value)) args.push(flag)
  }
  return args
}

function claimValue(markedValues, remaining, name, predicate) {
  if (markedValues.has(name)) return
  const index = remaining.findIndex(predicate)
  if (index !== -1) markedValues.set(name, remaining.splice(index, 1)[0])
}

function removeFirst(values, value) {
  const index = values.indexOf(value)
  if (index !== -1) values.splice(index, 1)
}

function isPhaserProjectPath(value) {
  if (!looksLikePath(value)) return false
  const root = path.resolve(value)
  return existsSync(path.join(root, 'package.json')) && existsSync(path.join(root, 'index.html'))
}

function looksLikePath(value) {
  return path.isAbsolute(value) || value.includes('/') || value.includes('\\')
}

function readEnv(env, name) {
  const normalized = `npm_config_${name}`
  const dashed = `npm_config_${name.replaceAll('_', '-')}`
  for (const [key, value] of Object.entries(env)) {
    const lower = key.toLowerCase()
    if (lower === normalized || lower === dashed) return value
  }
  if (name === 'no_install') {
    for (const [key, value] of Object.entries(env)) {
      if (key.toLowerCase() === 'npm_config_install' && value === 'false') return 'true'
    }
  }
  return undefined
}
