#!/usr/bin/env node
import { access } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { converterCli, skillRoot } from './runtime-paths.mjs'

const args = process.argv.slice(2)
const command = args[0]
if (command === 'setup' || command === 'doctor') {
  const script = path.join(skillRoot, 'scripts', `${command}.mjs`)
  process.exitCode = run(process.execPath, [script, ...args.slice(1)], skillRoot)
} else {
  try {
    await access(converterCli)
    await access(path.join(skillRoot, 'runtime', 'unity-ui-converter', 'vendor', 'js-yaml.mjs'))
    await access(path.join(skillRoot, 'runtime', 'unity-ui-converter', 'vendor', 'phaser.js'))
  } catch {
    console.error('Standalone runtime files are incomplete. Copy the entire skill directory again.')
    process.exit(1)
  }
  process.exitCode = run(process.execPath, [converterCli, ...args], process.cwd())
}

function run(executable, commandArgs, cwd) {
  const result = spawnSync(executable, commandArgs, {
    cwd,
    env: process.env,
    stdio: 'inherit',
    shell: false
  })
  if (result.error) {
    console.error(result.error.message)
    return 1
  }
  return result.status ?? 1
}
