#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { access } from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { skillRoot } from './runtime-paths.mjs'

const args = new Set(process.argv.slice(2))
const major = Number(process.versions.node.split('.')[0])
if (!Number.isInteger(major) || major < 20) {
  console.error(`Node.js 20 or newer is required. Current version: ${process.version}`)
  process.exit(1)
}

runNpm(['install', '--no-audit', '--no-fund'], 'Install runtime dependencies')
if (!args.has('--skip-build')) runNpm(['run', 'build:converter'], 'Build the bundled converter')

if (args.has('--with-browser')) {
  const playwrightCli = path.join(skillRoot, 'node_modules', 'playwright', 'cli.js')
  try {
    await access(playwrightCli)
  } catch {
    console.error(`Playwright CLI was not installed: ${playwrightCli}`)
    process.exit(1)
  }
  run(process.execPath, [playwrightCli, 'install', 'chromium'], 'Install Playwright Chromium')
}

run(process.execPath, [path.join(skillRoot, 'scripts', 'doctor.mjs')], 'Validate the standalone runtime')

function run(command, commandArgs, label) {
  console.log(`\n${label}...`)
  const result = spawnSync(command, commandArgs, {
    cwd: skillRoot,
    env: process.env,
    stdio: 'inherit',
    shell: false
  })
  if (result.error) {
    console.error(result.error.message)
    process.exit(1)
  }
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function runNpm(commandArgs, label) {
  const npmCli = resolveNpmCli()
  if (npmCli) run(process.execPath, [npmCli, ...commandArgs], label)
  else run('npm', commandArgs, label)
}

function resolveNpmCli() {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(path.dirname(path.dirname(process.execPath)), 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')
  ].filter(Boolean)
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}
