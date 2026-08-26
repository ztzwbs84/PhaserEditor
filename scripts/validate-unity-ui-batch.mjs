import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from '@playwright/test'

const outputRoot = path.resolve(process.env.UNITY_UI_OUTPUT_ROOT || 'artifacts/unity-ui')
const baseUrl = (process.env.UNITY_UI_BASE_URL || 'http://127.0.0.1:4175').replace(/\/$/, '')
const reportPath = path.join(outputRoot, 'batch-report.json')
const screenshotRoot = path.resolve('artifacts/screenshots/unity-ui-batch')
const batch = JSON.parse(await readFile(reportPath, 'utf8'))
await mkdir(screenshotRoot, { recursive: true })

const browser = await chromium.launch(await browserLaunchOptions())
const results = []
try {
  for (const entry of batch.entries) {
    if (entry.status !== 'passed') {
      results.push({ relativePath: entry.relativePath, status: 'skipped', reason: entry.failure || 'Bake failed.' })
      continue
    }
    const relativeOutput = normalize(path.relative(outputRoot, entry.outputPath))
    const safeName = relativeOutput.replace(/[^a-zA-Z0-9._-]+/g, '__')
    const expectVisualContent = hasVisualComponents(entry.components)
    const html = await validatePage({
      url: `${baseUrl}/${encodeURI(relativeOutput)}/preview.html`,
      kind: 'html',
      expectedNodes: entry.nodes,
      expectVisualContent,
      screenshotPath: path.join(screenshotRoot, `${safeName}__html.png`)
    })
    const phaser = await validatePage({
      url: `${baseUrl}/${encodeURI(relativeOutput)}/phaser.html`,
      kind: 'phaser',
      expectedNodes: entry.nodes,
      expectVisualContent,
      screenshotPath: path.join(screenshotRoot, `${safeName}__phaser.png`)
    })
    const status = html.status === 'passed' && phaser.status === 'passed' ? 'passed' : 'failed'
    results.push({ relativePath: entry.relativePath, status, html, phaser })
    console.log(`${status.toUpperCase()} ${entry.relativePath} | HTML nodes=${html.nodeCount} colors=${html.colorCount} | Phaser canvas=${phaser.canvasCount} colors=${phaser.colorCount}`)
  }
} finally {
  await browser.close()
}

const report = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  total: results.length,
  passed: results.filter((entry) => entry.status === 'passed').length,
  failed: results.filter((entry) => entry.status === 'failed').length,
  skipped: results.filter((entry) => entry.status === 'skipped').length,
  results
}
const validationPath = path.join(outputRoot, 'batch-validation.json')
await writeFile(validationPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ validationPath, total: report.total, passed: report.passed, failed: report.failed, skipped: report.skipped }, null, 2))
if (report.failed > 0 || report.skipped > 0) process.exitCode = 1

async function validatePage({ url, kind, expectedNodes, expectVisualContent, screenshotPath }) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  const errors = []
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 })
    if (!response?.ok()) errors.push(`HTTP ${response?.status() ?? 'no response'}`)
    if (kind === 'phaser') await page.waitForSelector('#game canvas', { timeout: 12000 })
    else await page.waitForSelector('.stage .unity-node', { timeout: 12000 })
    await page.waitForTimeout(kind === 'phaser' ? 900 : 350)
    const metrics = await page.evaluate(({ pageKind }) => {
      const stage = document.querySelector('.stage')
      const canvas = document.querySelector('#game canvas')
      const target = pageKind === 'phaser' ? canvas : stage
      const rect = target?.getBoundingClientRect()
      return {
        nodeCount: document.querySelectorAll('.unity-node').length,
        imageCanvasCount: document.querySelectorAll('.image-canvas').length,
        canvasCount: document.querySelectorAll('#game canvas').length,
        width: rect?.width ?? 0,
        height: rect?.height ?? 0
      }
    }, { pageKind: kind })
    const target = kind === 'phaser' ? page.locator('#game canvas') : page.locator('.stage')
    const screenshot = await target.screenshot({ path: screenshotPath })
    const colorCount = await countScreenshotColors(page, screenshot)
    if (kind === 'html' && metrics.nodeCount !== expectedNodes) errors.push(`Expected ${expectedNodes} DOM nodes, received ${metrics.nodeCount}.`)
    if (kind === 'phaser' && metrics.canvasCount !== 1) errors.push(`Expected one Phaser canvas, received ${metrics.canvasCount}.`)
    if (metrics.width <= 1 || metrics.height <= 1) errors.push('Rendered surface has no size.')
    // A valid dark/gradient overlay can quantize to four sampled colors after
    // the screenshot is reduced. Treat only three or fewer colors as blank.
    if (expectVisualContent && colorCount < 4) errors.push(`Rendered surface appears blank (${colorCount} sampled colors).`)
    return { status: errors.length ? 'failed' : 'passed', url, visualExpected: expectVisualContent, ...metrics, colorCount, errors }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error))
    return { status: 'failed', url, nodeCount: 0, imageCanvasCount: 0, canvasCount: 0, width: 0, height: 0, colorCount: 0, errors }
  } finally {
    await page.close()
  }
}

async function countScreenshotColors(page, screenshot) {
  const dataUrl = `data:image/png;base64,${screenshot.toString('base64')}`
  return page.evaluate(async (source) => {
    const image = new Image()
    image.src = source
    await image.decode()
    const canvas = document.createElement('canvas')
    // Sample the whole rendered surface, not only its top-left corner. Dark
    // overlays and bottom-anchored UI can be visually valid while the corner
    // remains the same background color as the canvas.
    const width = Math.min(160, image.width)
    const height = Math.min(160, image.height)
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    context.drawImage(image, 0, 0, image.width, image.height, 0, 0, width, height)
    const pixels = context.getImageData(0, 0, width, height).data
    const colors = new Set()
    for (let index = 0; index < pixels.length; index += 16) {
      colors.add(`${pixels[index] >> 4},${pixels[index + 1] >> 4},${pixels[index + 2] >> 4},${pixels[index + 3] >> 4}`)
      if (colors.size >= 128) break
    }
    return colors.size
  }, dataUrl)
}

async function browserLaunchOptions() {
  if (process.platform !== 'win32') return {}
  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
  ]
  for (const executablePath of candidates) {
    try { await access(executablePath); return { executablePath, headless: true } } catch {}
  }
  return { headless: true }
}

function normalize(value) { return value.replaceAll('\\', '/') }

function hasVisualComponents(components) {
  return ['image', 'raw-image', 'text', 'text-mesh-pro'].some((type) => (components?.[type] ?? 0) > 0)
}
