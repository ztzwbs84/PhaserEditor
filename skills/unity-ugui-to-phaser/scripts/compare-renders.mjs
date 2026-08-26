#!/usr/bin/env node
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from '@playwright/test'

const args = parseArgs(process.argv.slice(2))
if (args.help || args.h) {
  printHelp()
  process.exit(0)
}

const referencePath = requiredPath(args.reference, '--reference')
const actualPath = requiredPath(args.actual, '--actual')
const outputPath = args.output ? path.resolve(String(args.output)) : null
const diffPath = args.diff ? path.resolve(String(args.diff)) : null
const channelThreshold = boundedNumber(args['channel-threshold'], 8, 0, 255)
const maxMismatchRatio = boundedNumber(args['max-mismatch-ratio'], 0.0025, 0, 1)
const maxMeanError = boundedNumber(args['max-mean-error'], 1, 0, 255)

const [referenceBuffer, actualBuffer] = await Promise.all([readFile(referencePath), readFile(actualPath)])
const browser = await chromium.launch(await browserLaunchOptions())
let metrics
try {
  const page = await browser.newPage()
  metrics = await page.evaluate(async ({ referenceUrl, actualUrl, threshold }) => {
    const loadImage = (source) => new Promise((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('PNG could not be decoded.'))
      image.src = source
    })
    const [reference, actual] = await Promise.all([loadImage(referenceUrl), loadImage(actualUrl)])
    const dimensions = {
      reference: { width: reference.naturalWidth, height: reference.naturalHeight },
      actual: { width: actual.naturalWidth, height: actual.naturalHeight }
    }
    if (dimensions.reference.width !== dimensions.actual.width || dimensions.reference.height !== dimensions.actual.height) {
      return { dimensionsMatch: false, dimensions }
    }
    const width = dimensions.reference.width
    const height = dimensions.reference.height
    const createPixels = (image) => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d', { willReadFrequently: true })
      context.clearRect(0, 0, width, height)
      context.drawImage(image, 0, 0)
      return context.getImageData(0, 0, width, height).data
    }
    const referencePixels = createPixels(reference)
    const actualPixels = createPixels(actual)
    const pixelCount = width * height
    const histogram = new Uint32Array(256)
    const diffPixels = new Uint8ClampedArray(pixelCount * 4)
    let mismatchCount = 0
    let totalChannelError = 0
    let maxChannelError = 0
    let minX = width
    let minY = height
    let maxX = -1
    let maxY = -1
    for (let pixel = 0; pixel < pixelCount; pixel++) {
      const offset = pixel * 4
      let pixelError = 0
      for (let channel = 0; channel < 4; channel++) {
        const error = Math.abs(referencePixels[offset + channel] - actualPixels[offset + channel])
        totalChannelError += error
        pixelError = Math.max(pixelError, error)
      }
      histogram[pixelError]++
      maxChannelError = Math.max(maxChannelError, pixelError)
      if (pixelError > threshold) {
        mismatchCount++
        const x = pixel % width
        const y = Math.floor(pixel / width)
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
      diffPixels[offset] = pixelError
      diffPixels[offset + 1] = 0
      diffPixels[offset + 2] = 0
      diffPixels[offset + 3] = pixelError === 0 ? 0 : 255
    }
    const percentile = (ratio) => {
      const target = Math.ceil(pixelCount * ratio)
      let seen = 0
      for (let value = 0; value < histogram.length; value++) {
        seen += histogram[value]
        if (seen >= target) return value
      }
      return 255
    }
    const diffCanvas = document.createElement('canvas')
    diffCanvas.width = width
    diffCanvas.height = height
    diffCanvas.getContext('2d').putImageData(new ImageData(diffPixels, width, height), 0, 0)
    return {
      dimensionsMatch: true,
      dimensions,
      pixelCount,
      mismatchCount,
      mismatchRatio: mismatchCount / pixelCount,
      meanChannelError: totalChannelError / (pixelCount * 4),
      maxChannelError,
      p95PixelError: percentile(0.95),
      p99PixelError: percentile(0.99),
      differenceBounds: mismatchCount > 0 ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : null,
      diffDataUrl: diffCanvas.toDataURL('image/png')
    }
  }, {
    referenceUrl: `data:image/png;base64,${referenceBuffer.toString('base64')}`,
    actualUrl: `data:image/png;base64,${actualBuffer.toString('base64')}`,
    threshold: channelThreshold
  })
} finally {
  await browser.close()
}

const passed = metrics.dimensionsMatch
  && metrics.mismatchRatio <= maxMismatchRatio
  && metrics.meanChannelError <= maxMeanError
const report = {
  generatedAt: new Date().toISOString(),
  reference: referencePath,
  actual: actualPath,
  status: passed ? 'passed' : 'failed',
  thresholds: { channelThreshold, maxMismatchRatio, maxMeanError },
  metrics: { ...metrics, diffDataUrl: undefined }
}

if (diffPath && metrics.diffDataUrl) {
  await mkdir(path.dirname(diffPath), { recursive: true })
  await writeFile(diffPath, Buffer.from(metrics.diffDataUrl.slice(metrics.diffDataUrl.indexOf(',') + 1), 'base64'))
}
if (outputPath) {
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}
console.log(JSON.stringify({ ...report, metrics: report.metrics, output: outputPath, diff: diffPath }, null, 2))
if (!passed) process.exitCode = 1

function parseArgs(values) {
  const result = {}
  for (let index = 0; index < values.length; index++) {
    const value = values[index]
    if (!value.startsWith('--')) continue
    const key = value.slice(2)
    const next = values[index + 1]
    if (!next || next.startsWith('--')) result[key] = true
    else { result[key] = next; index++ }
  }
  return result
}

function requiredPath(value, name) {
  if (!value || value === true) throw new Error(`${name} is required.`)
  return path.resolve(String(value))
}

function boundedNumber(value, fallback, minimum, maximum) {
  const number = value == null ? fallback : Number(value)
  if (!Number.isFinite(number) || number < minimum || number > maximum) throw new Error(`Numeric option must be between ${minimum} and ${maximum}.`)
  return number
}

async function browserLaunchOptions() {
  const explicit = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  if (explicit) return { executablePath: explicit, headless: true }
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
  for (const executablePath of candidates) {
    try { await access(executablePath); return { executablePath, headless: true } } catch {}
  }
  return { headless: true }
}

function printHelp() {
  console.log('Compare two PNG renders with exact dimension and pixel gates.\n\nRequired:\n  --reference <png-file>\n  --actual <png-file>\n\nOptional:\n  --output <json-file>\n  --diff <png-file>\n  --channel-threshold <number>\n  --max-mismatch-ratio <number>\n  --max-mean-error <number>')
}
