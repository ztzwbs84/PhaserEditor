#!/usr/bin/env node
import { access } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { converterCli, converterRoot, skillRoot } from './runtime-paths.mjs'

const require = createRequire(import.meta.url)
const checks = []
const major = Number(process.versions.node.split('.')[0])
checks.push({ name: 'node', status: major >= 20 ? 'passed' : 'failed', detail: process.version })

for (const [name, filePath] of [
  ['converter-cli', converterCli],
  ['converter-source', path.join(converterRoot, 'src', 'cli.ts')],
  ['preview-template', path.join(converterRoot, 'templates', 'preview.html')],
  ['phaser-template', path.join(converterRoot, 'templates', 'phaser.html')],
  ['bundled-yaml-parser', path.join(converterRoot, 'vendor', 'js-yaml.mjs')],
  ['bundled-phaser-runtime', path.join(converterRoot, 'vendor', 'phaser.js')]
]) {
  checks.push({ name, status: await exists(filePath) ? 'passed' : 'failed', detail: filePath })
}

for (const dependency of ['@playwright/test', 'typescript', 'phaser']) {
  try {
    checks.push({ name: `development:${dependency}`, status: 'passed', detail: require.resolve(`${dependency}/package.json`) })
  } catch {
    checks.push({ name: `development:${dependency}`, status: 'warning', detail: `Run setup before rebuilding source or comparing pixels.` })
  }
}

const browser = await findBrowser()
checks.push({
  name: 'render-comparison-browser',
  status: browser ? 'passed' : 'warning',
  detail: browser ?? 'Install Chrome/Edge or run setup --with-browser before compare-renders.mjs.'
})

const failed = checks.filter((check) => check.status === 'failed')
const report = {
  status: failed.length === 0 ? 'passed' : 'failed',
  skillRoot,
  converterRoot,
  checks
}
console.log(JSON.stringify(report, null, 2))
if (failed.length > 0) process.exitCode = 1

async function findBrowser() {
  const explicit = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  if (explicit && await exists(explicit)) return explicit
  const candidates = process.platform === 'win32'
    ? [
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
        'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
      ]
    : process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
      : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge']
  for (const candidate of candidates) if (await exists(candidate)) return candidate
  try {
    const { chromium } = await import('@playwright/test')
    const candidate = chromium.executablePath()
    if (await exists(candidate)) return candidate
  } catch {}
  return null
}

async function exists(filePath) {
  try { await access(filePath); return true } catch { return false }
}
