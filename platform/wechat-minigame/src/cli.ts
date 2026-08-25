#!/usr/bin/env node
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { parseCliArgs } from './args.js'
import { convertProject } from './convert.js'

let jsonMode = process.argv.includes('--json')

try {
  const options = parseCliArgs(process.argv.slice(2))
  jsonMode = options.json
  if (options.help) {
    printHelp()
  } else {
    const project = options.project ?? await promptProject()
    const outcome = await convertProject({ ...options, project })
    if (options.json) console.log(JSON.stringify(outcome.report, null, 2))
    else printSummary(outcome.report)
    process.exitCode = outcome.exitCode
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  if (jsonMode) console.log(JSON.stringify({ runnable: false, fatal: true, error: message }, null, 2))
  else console.error(`Wechat conversion failed: ${message}`)
  process.exitCode = 1
}

async function promptProject(): Promise<string> {
  if (!input.isTTY) throw new Error('--project is required when stdin is not interactive.')
  const readline = createInterface({ input, output })
  try {
    const value = (await readline.question('Phaser project path: ')).trim()
    if (!value) throw new Error('Project path is required.')
    return value
  } finally {
    readline.close()
  }
}

function printSummary(report: Awaited<ReturnType<typeof convertProject>>['report']): void {
  console.log(`Source: ${report.sourceProject}`)
  console.log(`Output: ${report.outputProject}`)
  console.log(`Phaser: ${report.phaserVersion ?? 'unknown'}`)
  console.log(`Game: ${report.gameCount} found, ${report.transformedGameCount} transformed`)
  console.log(`Viewport: ${report.width}x${report.height} ${report.orientation}`)
  console.log(`Runnable: ${report.runnable ? 'yes' : 'no'}`)
  if (report.diagnostics.length > 0) {
    console.log('Diagnostics:')
    for (const diagnostic of report.diagnostics) {
      console.log(`  [${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message}`)
    }
  }
}

function printHelp(): void {
  console.log(`Phaser 4 to WeChat Mini Game converter

Usage:
  npm run wechat:patch
  npm run wechat:patch -- --project <path> [options]

Options:
  --project <path>                 Vite Phaser 4 project
  --output <path>                  Output directory (default: <project>-wechat)
  --width <number>                 Logical game width
  --height <number>                Logical game height
  --orientation portrait|landscape WeChat device orientation
  --appid <appid>                  WeChat AppID (default: preserved or touristappid)
  --no-install                     Do not install missing npm dependencies
  --force                          Allow publishing into an unmanaged non-empty output
  --dry-run                        Analyze without building or writing output
  --json                           Print a machine-readable report
  --help                           Show this help`)
}
