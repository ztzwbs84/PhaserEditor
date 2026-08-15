#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { executeInputActions } from './quality-input-driver.mjs'
import { parseQualityInputPlan, summarizeQualityInputPlan } from './quality-input-plan.mjs'
import { parsePersistenceContract, verifyPersistenceProofPhase } from './persistence-proof.mjs'
import { runReleaseChecks } from './check-release.mjs'
import { assertProjectFingerprint, fingerprintProjectRelease, validateProjectFingerprint } from './release-fingerprint.mjs'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const browserEvidenceNames = ['browser-e2e.json', 'browser-desktop.png', 'browser-mobile.png', 'phaser-audit.json', 'phaser-api.json']
const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.wasm', 'application/wasm']
])

function invariant(condition, message) {
  if (!condition) throw new Error(message)
}

export async function verifyBundleFingerprintEvidence(root) {
  const reportFile = path.join(root, '.quality', 'bundle-budget.json')
  const report = JSON.parse(await readFile(reportFile, 'utf8'))
  invariant(report.status === 'pass' && Array.isArray(report.failures) && report.failures.length === 0, 'Bundle budget evidence is not release-clean.')
  const expected = validateProjectFingerprint(report.fingerprints, 'Bundle budget fingerprints')
  const current = await fingerprintProjectRelease(root)
  assertProjectFingerprint(expected, current, 'Bundle budget freshness')
  return current
}

async function removeBrowserEvidence(qualityRoot) {
  await Promise.all(browserEvidenceNames.map((name) => rm(path.join(qualityRoot, name), { force: true })))
}

export async function publishBrowserEvidence(root, report, expectedFingerprints, dependencies = {}) {
  const qualityRoot = path.join(root, '.quality')
  const reportFile = path.join(qualityRoot, 'browser-e2e.json')
  const temporary = path.join(qualityRoot, `.browser-e2e.${process.pid}.${Date.now()}.tmp`)
  const releaseChecks = dependencies.runReleaseChecks ?? runReleaseChecks
  try {
    const releaseReports = await releaseChecks(root, { expectedFingerprints })
    const fingerprints = await fingerprintProjectRelease(root)
    assertProjectFingerprint(expectedFingerprints, fingerprints, 'Browser E2E freshness')
    if (releaseReports) {
      assertProjectFingerprint(fingerprints, releaseReports.audit?.fingerprints, 'Browser/audit freshness')
      assertProjectFingerprint(fingerprints, releaseReports.api?.fingerprints, 'Browser/API freshness')
    }
    const published = { ...report, fingerprints }
    await writeFile(temporary, `${JSON.stringify(published, null, 2)}\n`, 'utf8')
    await rename(temporary, reportFile)
    return published
  } catch (error) {
    await Promise.all([rm(temporary, { force: true }), removeBrowserEvidence(qualityRoot)])
    throw error
  }
}

function primaryInputKeys(declaredPrimary) {
  invariant(Array.isArray(declaredPrimary) && declaredPrimary.length > 0, 'Declared primary inputs are missing.')
  return [...new Set(declaredPrimary)]
}

function decodeAcceptedInputs(value, context) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value
  try {
    return JSON.parse(value ?? 'null')
  } catch (error) {
    throw new Error(`${context} qualityAcceptedInputs is not valid JSON: ${error.message}`)
  }
}

export function assertAcceptedInputCounters(value, declaredPrimary, context = 'Browser') {
  const counters = decodeAcceptedInputs(value, context)
  const expected = primaryInputKeys(declaredPrimary).toSorted()
  invariant(counters && typeof counters === 'object' && !Array.isArray(counters), `${context} qualityAcceptedInputs must be an object.`)
  const actual = Object.keys(counters).toSorted()
  invariant(JSON.stringify(actual) === JSON.stringify(expected), `${context} qualityAcceptedInputs keys ${actual.join(', ') || '(none)'} do not exactly match declared primary inputs ${expected.join(', ')}.`)
  for (const key of expected) {
    invariant(Number.isInteger(counters[key]) && counters[key] >= 0, `${context} qualityAcceptedInputs.${key} must be a non-negative integer.`)
  }
  return Object.fromEntries(expected.map((key) => [key, counters[key]]))
}

function inputAcceptanceEvidence(before, after, declaredPrimary, requiredPrimary = declaredPrimary) {
  const required = primaryInputKeys(requiredPrimary)
  const declared = primaryInputKeys(declaredPrimary)
  invariant(required.every((key) => declared.includes(key)), 'Input acceptance proof contains an undeclared primary input.')
  const evidence = {
    actions: required,
    before: assertAcceptedInputCounters(before, declared, 'Primary input acceptance before'),
    after: assertAcceptedInputCounters(after, declared, 'Primary input acceptance after')
  }
  for (const key of required) {
    invariant(evidence.after[key] > evidence.before[key], `Primary input ${key} was dispatched but not accepted by gameplay.`)
  }
  return evidence
}

export function assertPrimaryInputAcceptanceEvidence(evidence, declaredPrimary) {
  const expected = primaryInputKeys(declaredPrimary)
  invariant(Array.isArray(evidence?.actions) && evidence.actions.length === expected.length
    && expected.every((key) => evidence.actions.includes(key)), 'Primary input acceptance did not prove every declared primary input.')
  return inputAcceptanceEvidence(evidence.before, evidence.after, expected)
}

export function assertGameplayContract(contract, gameplay) {
  invariant(contract && typeof contract === 'object' && !Array.isArray(contract), 'game-quality.json must declare a gameplay contract.')
  for (const field of ['primaryAction', 'progressName', 'pressureName', 'successReason', 'failureReason']) {
    invariant(typeof contract[field] === 'string' && contract[field].length > 0, `game-quality.json gameplay.${field} must be a non-empty string.`)
  }
  invariant(Number.isFinite(contract.completionTarget) && contract.completionTarget > 0, 'game-quality.json gameplay.completionTarget must be positive.')
  invariant(Number.isFinite(contract.maximumPressure) && contract.maximumPressure > 0, 'game-quality.json gameplay.maximumPressure must be positive.')
  const auxiliaryName = contract.auxiliaryName ?? 'remaining-seconds'
  invariant(typeof auxiliaryName === 'string' && auxiliaryName.length > 0, 'game-quality.json gameplay.auxiliaryName must be a non-empty string when declared.')
  invariant(gameplay.primaryAction === contract.primaryAction, `Browser primary action ${gameplay.primaryAction} does not match game-quality.json ${contract.primaryAction}.`)
  invariant(gameplay.progress.name === contract.progressName, `Browser progress ${gameplay.progress.name} does not match game-quality.json ${contract.progressName}.`)
  invariant(gameplay.progress.target === contract.completionTarget, `Browser completion target ${gameplay.progress.target} does not match game-quality.json ${contract.completionTarget}.`)
  assertPrimaryInputAcceptanceEvidence(gameplay.inputAcceptance, gameplay.inputPlan?.primary)
  invariant(gameplay.failure.pressure.name === contract.pressureName, `Browser pressure ${gameplay.failure.pressure.name} does not match game-quality.json ${contract.pressureName}.`)
  invariant(gameplay.failure.pressure.before === contract.maximumPressure, `Browser maximum pressure ${gameplay.failure.pressure.before} does not match game-quality.json ${contract.maximumPressure}.`)
  assertAuxiliaryTimeline(gameplay.auxiliary, auxiliaryName)
  invariant(gameplay.success.terminalReason === contract.successReason, `Browser success reason ${gameplay.success.terminalReason} does not match game-quality.json ${contract.successReason}.`)
  invariant(gameplay.failure.terminalReason === contract.failureReason, `Browser failure reason ${gameplay.failure.terminalReason} does not match game-quality.json ${contract.failureReason}.`)
}

export function assertAuxiliaryMetricState(state, context = 'Browser') {
  invariant(typeof state?.auxiliaryName === 'string' && state.auxiliaryName.length > 0, `${context} auxiliary metric name is missing.`)
  invariant(Number.isFinite(state?.auxiliaryValue), `${context} auxiliary metric value is not finite.`)
  invariant(typeof state?.auxiliaryOutput === 'string' && state.auxiliaryOutput.length > 0, `${context} visible auxiliary metric is missing.`)
  invariant(Number(state.auxiliaryOutput) === state.auxiliaryValue, `${context} visible auxiliary metric ${state.auxiliaryOutput} does not match machine value ${state.auxiliaryValue}.`)
  return state
}

const auxiliaryCheckpointNames = [
  'desktopInitial',
  'failureTerminal',
  'failureRestart',
  'successTerminal',
  'successRestart',
  'mobileInitial',
  'mobileProgress'
]

function auxiliaryCheckpoint(state, context) {
  assertAuxiliaryMetricState(state, context)
  return {
    name: state.auxiliaryName,
    value: state.auxiliaryValue,
    visibleValue: Number(state.auxiliaryOutput)
  }
}

export function assertAuxiliaryTimeline(auxiliary, expectedName) {
  invariant(auxiliary?.name === expectedName, `Browser auxiliary metric ${auxiliary?.name} does not match game-quality.json ${expectedName}.`)
  invariant(Number.isFinite(auxiliary?.value), 'Browser initial auxiliary metric value is not finite.')
  const checkpoints = auxiliary?.checkpoints
  invariant(checkpoints && typeof checkpoints === 'object' && !Array.isArray(checkpoints), 'Browser auxiliary metric checkpoints are missing.')
  invariant(Object.keys(checkpoints).length === auxiliaryCheckpointNames.length
    && auxiliaryCheckpointNames.every((name) => Object.hasOwn(checkpoints, name)), 'Browser auxiliary metric checkpoints are incomplete or contain unknown entries.')
  for (const name of auxiliaryCheckpointNames) {
    const checkpoint = checkpoints[name]
    invariant(checkpoint?.name === expectedName, `Browser auxiliary metric ${name} is named ${checkpoint?.name}; expected ${expectedName}.`)
    invariant(Number.isFinite(checkpoint?.value), `Browser auxiliary metric ${name} value is not finite.`)
    invariant(Number.isFinite(checkpoint?.visibleValue) && checkpoint.visibleValue === checkpoint.value, `Browser auxiliary metric ${name} visible value ${checkpoint?.visibleValue} does not match machine value ${checkpoint?.value}.`)
  }
  invariant(checkpoints.desktopInitial.value === auxiliary.value, 'Browser initial auxiliary metric does not match its desktop checkpoint.')
  return auxiliary
}

function assertPersistenceContract(contract) {
  return parsePersistenceContract(contract)
}

async function exists(file) {
  try {
    await access(file)
    return true
  } catch {
    return false
  }
}

async function findBrowser() {
  const candidates = [
    process.env.PHASER_BROWSER_PATH,
    process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : null,
    process.platform === 'win32' ? 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe' : null,
    process.platform === 'win32' ? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' : null,
    process.platform === 'win32' ? 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe' : null,
    process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : null,
    process.platform === 'darwin' ? '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge' : null,
    process.platform === 'linux' ? '/usr/bin/google-chrome' : null,
    process.platform === 'linux' ? '/usr/bin/google-chrome-stable' : null,
    process.platform === 'linux' ? '/usr/bin/chromium' : null,
    process.platform === 'linux' ? '/usr/bin/chromium-browser' : null
  ].filter(Boolean)
  for (const candidate of candidates) if (await exists(candidate)) return candidate
  throw new Error('Chrome or Edge was not found. Set PHASER_BROWSER_PATH to a Chromium browser executable.')
}

async function startServer(root) {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname).replace(/^\/+/, '')
      const absolute = path.resolve(root, relative)
      const escaped = path.relative(root, absolute).startsWith('..')
      if (escaped) {
        response.writeHead(403).end('Forbidden')
        return
      }
      const content = await readFile(absolute)
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-type': mimeTypes.get(path.extname(absolute)) ?? 'application/octet-stream'
      })
      response.end(content)
    } catch {
      response.writeHead(404).end('Not found')
    }
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  invariant(address && typeof address === 'object', 'Unable to determine the local test server port.')
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}

async function waitForDevTools(profile, child) {
  const activePortFile = path.join(profile, 'DevToolsActivePort')
  const started = Date.now()
  while (Date.now() - started < 10_000) {
    if (child.exitCode !== null) throw new Error(`Browser exited before DevTools started (code ${child.exitCode}).`)
    try {
      const [port] = (await readFile(activePortFile, 'utf8')).trim().split(/\r?\n/)
      if (port) return Number(port)
    } catch {
      // Chrome writes the port file after startup.
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('Timed out waiting for the browser debugging endpoint.')
}

class CdpClient {
  constructor(webSocket) {
    this.webSocket = webSocket
    this.nextId = 1
    this.pending = new Map()
    this.listeners = new Map()
    webSocket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data))
      if (message.id) {
        const pending = this.pending.get(message.id)
        if (!pending) return
        this.pending.delete(message.id)
        if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`))
        else pending.resolve(message.result)
        return
      }
      for (const listener of this.listeners.get(message.method) ?? []) listener(message.params)
    })
    webSocket.addEventListener('close', () => {
      for (const pending of this.pending.values()) pending.reject(new Error('Browser debugging connection closed.'))
      this.pending.clear()
    })
  }

  send(method, params = {}) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { method, resolve, reject })
      this.webSocket.send(JSON.stringify({ id, method, params }))
    })
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) ?? []
    listeners.push(listener)
    this.listeners.set(method, listeners)
  }

  once(method, timeoutMs = 10_000) {
    return new Promise((resolve, reject) => {
      const listener = (params) => {
        clearTimeout(timer)
        const listeners = this.listeners.get(method) ?? []
        this.listeners.set(method, listeners.filter((candidate) => candidate !== listener))
        resolve(params)
      }
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${method}.`)), timeoutMs)
      this.on(method, listener)
    })
  }

  close() {
    this.webSocket.close()
  }
}

async function connectPage(devToolsPort) {
  const response = await fetch(`http://127.0.0.1:${devToolsPort}/json/new?about:blank`, { method: 'PUT' })
  if (!response.ok) throw new Error(`Unable to create browser page: HTTP ${response.status}.`)
  const target = await response.json()
  const webSocket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    webSocket.addEventListener('open', resolve, { once: true })
    webSocket.addEventListener('error', reject, { once: true })
  })
  return new CdpClient(webSocket)
}

async function evaluate(client, expression) {
  const response = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true
  })
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text)
  return response.result.value
}

async function poll(client, expression, predicate, label, timeoutMs = 10_000) {
  const started = Date.now()
  let lastValue
  while (Date.now() - started < timeoutMs) {
    lastValue = await evaluate(client, expression)
    if (predicate(lastValue)) return lastValue
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Timed out waiting for ${label}. Last value: ${JSON.stringify(lastValue)}.`)
}

async function configureViewport(client, viewport) {
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: viewport.width < 600,
    screenWidth: viewport.width,
    screenHeight: viewport.height
  })
  await client.send('Emulation.setTouchEmulationEnabled', {
    enabled: viewport.width < 600,
    maxTouchPoints: 5
  })
}

async function navigate(client, url, scenario) {
  const loaded = client.once('Page.loadEventFired')
  const targetUrl = new URL(url)
  targetUrl.searchParams.set('e2e', `${scenario}-${Date.now()}`)
  await client.send('Page.navigate', { url: targetUrl.href })
  await loaded
  await poll(
    client,
    `({
      state: document.documentElement.dataset.gameState,
      run: Number(document.documentElement.dataset.gameRun ?? '0'),
      progress: Number(document.documentElement.dataset.qualityProgress ?? '-1'),
      pressure: Number(document.documentElement.dataset.qualityPressure ?? '-1'),
      maximumPressure: Number(document.documentElement.dataset.qualityMaximumPressure ?? '-1'),
      auxiliaryName: document.documentElement.dataset.qualityAuxiliaryName ?? 'remaining-seconds',
      auxiliaryValue: Number(document.documentElement.dataset.qualityAuxiliaryValue ?? document.documentElement.dataset.remainingSeconds ?? 'NaN'),
      progressOutput: document.querySelector('#progress-value')?.value,
      auxiliaryOutput: document.querySelector('#auxiliary-value, #time-value')?.value,
      pressureOutput: document.querySelector('#pressure-value')?.value
    })`,
    (value) => value.state === 'playing'
      && value.run === 1
      && value.progress === 0
      && value.pressure === value.maximumPressure
      && value.maximumPressure > 0
      && (() => {
        try { assertAuxiliaryMetricState(value, scenario) } catch { return false }
        return true
      })()
      && value.progressOutput === '0'
      && Number(value.pressureOutput) === value.maximumPressure,
    `the synchronized ${scenario} playable state`
  )
}

async function metrics(client) {
  return evaluate(client, `(() => {
    const canvas = document.querySelector('canvas')
    const canvasRect = canvas?.getBoundingClientRect()
    return {
      title: document.title,
      viewport: { width: innerWidth, height: innerHeight },
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      state: document.documentElement.dataset.gameState,
      run: Number(document.documentElement.dataset.gameRun ?? '0'),
      playerPosition: document.documentElement.dataset.playerPosition,
      status: document.querySelector('#game-status')?.textContent ?? '',
      progress: Number(document.documentElement.dataset.qualityProgress ?? '0'),
      pressure: Number(document.documentElement.dataset.qualityPressure ?? '0'),
      auxiliaryName: document.documentElement.dataset.qualityAuxiliaryName ?? 'remaining-seconds',
      auxiliaryValue: Number(document.documentElement.dataset.qualityAuxiliaryValue ?? document.documentElement.dataset.remainingSeconds ?? 'NaN'),
      auxiliaryOutput: document.querySelector('#auxiliary-value, #time-value')?.value,
      stats: [...document.querySelectorAll('.game-stats output')].map((output) => {
        const rect = output.getBoundingClientRect()
        return { id: output.id, value: output.value, width: rect.width, height: rect.height, visible: rect.width > 0 && rect.height > 0 }
      }),
      telemetry: [...document.querySelectorAll('.game-telemetry output')].map((output) => {
        const rect = output.getBoundingClientRect()
        return { id: output.id, value: output.value, width: rect.width, height: rect.height, visible: rect.width > 0 && rect.height > 0 }
      }),
      canvas: canvasRect ? {
        width: canvasRect.width,
        height: canvasRect.height,
        left: canvasRect.left,
        top: canvasRect.top,
        right: canvasRect.right,
        bottom: canvasRect.bottom,
        dataUrlLength: canvas.toDataURL('image/png').length
      } : null,
      buttons: [...document.querySelectorAll('button')].map((button) => {
        const rect = button.getBoundingClientRect()
        return {
          label: button.textContent?.trim() ?? '',
          ariaPressed: button.getAttribute('aria-pressed'),
          width: rect.width,
          height: rect.height,
          visible: rect.width > 0 && rect.height > 0
        }
      })
    }
  })()`)
}

async function canvasPixels(client, canvas) {
  if (!canvas) return null
  const screenshot = await client.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    clip: {
      x: Math.max(0, canvas.left),
      y: Math.max(0, canvas.top),
      width: canvas.width,
      height: canvas.height,
      scale: 1
    }
  })
  const source = `data:image/png;base64,${screenshot.data}`
  return evaluate(client, `(async () => {
    const image = new Image()
    image.src = ${JSON.stringify(source)}
    await image.decode()
    const scratch = document.createElement('canvas')
    scratch.width = image.naturalWidth
    scratch.height = image.naturalHeight
    const context = scratch.getContext('2d')
    context.drawImage(image, 0, 0)
    const width = scratch.width
    const height = scratch.height
    const pixels = context.getImageData(0, 0, width, height).data
    const colors = new Set()
    let nonTransparent = 0
    let minimumLuma = 255
    let maximumLuma = 0
    const pixelCount = width * height
    const stride = Math.max(1, Math.floor(pixelCount / 8192))
    for (let pixel = 0; pixel < pixelCount; pixel += stride) {
      const offset = pixel * 4
      const red = pixels[offset]
      const green = pixels[offset + 1]
      const blue = pixels[offset + 2]
      const alpha = pixels[offset + 3]
      if (alpha > 0) nonTransparent += 1
      const luma = Math.round(red * 0.2126 + green * 0.7152 + blue * 0.0722)
      minimumLuma = Math.min(minimumLuma, luma)
      maximumLuma = Math.max(maximumLuma, luma)
      if (colors.size < 256) colors.add([red, green, blue, alpha].join(','))
    }
    return { source: 'composited-canvas-screenshot', width, height, samples: Math.ceil(pixelCount / stride), nonTransparent, distinctColors: colors.size, minimumLuma, maximumLuma }
  })()`)
}

async function capture(client, file) {
  const screenshot = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  const bytes = Buffer.from(screenshot.data, 'base64')
  invariant(bytes.length > 5_000, `Screenshot is unexpectedly small: ${bytes.length} bytes.`)
  await writeFile(file, bytes)
  return { file: path.basename(file), bytes: bytes.length }
}

async function clickButton(client, label) {
  const clicked = await evaluate(client, `(() => {
    const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === ${JSON.stringify(label)})
    if (!button) return false
    button.click()
    return true
  })()`)
  invariant(clicked, `Button was not found: ${label}`)
}

async function clickButtonAsUser(client, selector) {
  const target = await evaluate(client, `(() => {
    const button = document.querySelector(${JSON.stringify(selector)})
    if (!(button instanceof HTMLButtonElement) || button.disabled) return null
    const rect = button.getBoundingClientRect()
    const x = rect.left + rect.width / 2
    const y = rect.top + rect.height / 2
    return { x, y, visible: rect.width > 0 && rect.height > 0, hit: document.elementFromPoint(x, y)?.closest('button') === button }
  })()`)
  invariant(target?.visible, `Visible enabled button was not found: ${selector}`)
  invariant(target.hit, `Button is obscured at its center: ${selector}`)
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: target.x, y: target.y, button: 'left', buttons: 1, clickCount: 1 })
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: target.x, y: target.y, button: 'left', buttons: 0, clickCount: 1 })
}

async function playerProfileState(client) {
  return evaluate(client, `(() => {
    const raw = document.documentElement.dataset.qualityPlayerProfile
    let profile = null
    try { profile = raw ? JSON.parse(raw) : null } catch {}
    return {
      storageKey: document.documentElement.dataset.qualityProfileStorageKey,
      schemaVersion: Number(document.documentElement.dataset.qualityProfileSchemaVersion ?? '0'),
      loadStatus: document.documentElement.dataset.qualityProfileLoadStatus,
      profile,
      audioMuted: document.documentElement.dataset.qualityAudioMuted === 'true',
      controlsReady: document.documentElement.dataset.qualitySettingsReady === 'true',
      interactions: Number(document.documentElement.dataset.qualitySettingsInteractions ?? '-1'),
      stored: document.documentElement.dataset.qualityProfileStorageKey
        ? localStorage.getItem(document.documentElement.dataset.qualityProfileStorageKey)
        : null,
      soundLabel: document.querySelector('#sound-button')?.textContent,
      soundPressed: document.querySelector('#sound-button')?.getAttribute('aria-pressed')
    }
  })()`)
}

async function reloadPlayable(client, label) {
  const loaded = client.once('Page.loadEventFired')
  await client.send('Page.reload', { ignoreCache: true })
  await loaded
  await poll(client, `({
    state: document.documentElement.dataset.gameState,
    run: Number(document.documentElement.dataset.gameRun ?? '0'),
    profile: document.documentElement.dataset.qualityPlayerProfile,
    controlsReady: document.documentElement.dataset.qualitySettingsReady === 'true'
  })`, (value) => value.state === 'playing' && value.run === 1 && Boolean(value.profile) && value.controlsReady, label)
}

async function verifyProfileMigration(client, contract) {
  const initial = await playerProfileState(client)
  if (!initial.storageKey) return { status: 'not-declared' }
  assertPersistenceContract(contract)
  invariant(initial.schemaVersion === contract.schemaVersion && initial.profile?.schemaVersion === contract.schemaVersion, `Player profile schema version ${contract.schemaVersion} was not published.`)
  await evaluate(client, `localStorage.setItem(${JSON.stringify(initial.storageKey)}, JSON.stringify(${JSON.stringify(contract.migrationFixture)}))`)
  await reloadPlayable(client, 'the migrated player profile')
  const migrated = await playerProfileState(client)
  invariant(migrated.schemaVersion === contract.schemaVersion && migrated.profile?.schemaVersion === contract.schemaVersion, `Migrated player profile did not publish schema version ${contract.schemaVersion}.`)
  invariant(migrated.loadStatus === 'migrated', `Version ${contract.migrationFromVersion} player profile did not report migration: ${migrated.loadStatus}.`)
  const proof = verifyPersistenceProofPhase(contract, 'migration', { profile: migrated.profile })
  const migratedMuted = migrated.profile?.settings?.muted
  invariant(typeof migratedMuted === 'boolean', 'Migrated player profile did not publish a boolean mute setting.')
  invariant(migrated.audioMuted === migratedMuted, `Migrated mute setting did not reach the audio adapter: ${JSON.stringify(migrated)}.`)
  invariant(migrated.soundPressed === String(migratedMuted) && typeof migrated.soundLabel === 'string' && migrated.soundLabel.length > 0, 'Migrated mute setting did not restore its accessible control state.')
  await clickButtonAsUser(client, '#sound-button')
  const unmuted = await poll(client, `(() => {
    const raw = document.documentElement.dataset.qualityPlayerProfile
    return { profile: raw ? JSON.parse(raw) : null, interactions: Number(document.documentElement.dataset.qualitySettingsInteractions ?? '-1') }
  })()`, (value) => value.profile?.settings?.muted === !migratedMuted, 'the migrated mute setting to change')
  return {
    profile: migrated.profile,
    report: {
      status: 'pass',
      fromVersion: contract.migrationFromVersion,
      toVersion: migrated.schemaVersion,
      loadStatus: migrated.loadStatus,
      muted: migratedMuted,
      audioMuted: migrated.audioMuted,
      settingsInteractions: unmuted.interactions,
      proof
    }
  }
}

async function verifyProfileReload(client, success, failure, migrationProfile, contract) {
  const declared = await playerProfileState(client)
  if (!declared.storageKey) return { status: 'not-declared' }
  assertPersistenceContract(contract)
  invariant(declared.schemaVersion === contract.schemaVersion, `Unexpected player profile schema version: ${declared.schemaVersion}; expected ${contract.schemaVersion}.`)
  await clickButtonAsUser(client, '#sound-button')
  await poll(client, `(() => {
    const raw = document.documentElement.dataset.qualityPlayerProfile
    return raw ? JSON.parse(raw)?.settings?.muted : null
  })()`, (value) => value === migrationProfile.settings.muted, 'the mute setting to persist')
  const before = await playerProfileState(client)
  const progress = { success: success.progress.after, failure: failure.progress }
  const gameplayProof = verifyPersistenceProofPhase(contract, 'gameplay', {
    profile: before.profile,
    previousProfile: migrationProfile,
    progress
  })
  await reloadPlayable(client, 'the persisted player profile')
  const after = await playerProfileState(client)
  invariant(after.loadStatus === 'current', `Reloaded player profile did not report current: ${after.loadStatus}.`)
  const reloadProof = verifyPersistenceProofPhase(contract, 'reload', {
    profile: after.profile,
    previousProfile: before.profile,
    progress
  })
  const persistedMuted = after.profile?.settings?.muted
  invariant(typeof persistedMuted === 'boolean' && after.audioMuted === persistedMuted, 'Reloaded mute setting did not reach the audio adapter.')
  invariant(after.soundPressed === String(persistedMuted) && typeof after.soundLabel === 'string' && after.soundLabel.length > 0, 'Reloaded mute setting did not restore its accessible control state.')
  return {
    status: 'pass',
    schemaVersion: after.schemaVersion,
    loadStatus: after.loadStatus,
    muted: persistedMuted,
    audioMuted: after.audioMuted,
    settingsInteractions: before.interactions,
    proof: reloadProof,
    gameplay: { status: 'pass', proof: gameplayProof }
  }
}

async function runtimeState(client) {
  return evaluate(client, `({
    phase: document.documentElement.dataset.gameState,
    run: Number(document.documentElement.dataset.gameRun ?? '0'),
    progressName: document.documentElement.dataset.qualityProgressName,
    progress: Number(document.documentElement.dataset.qualityProgress ?? '0'),
    completionTarget: Number(document.documentElement.dataset.qualityCompletionTarget ?? '0'),
    pressureName: document.documentElement.dataset.qualityPressureName,
    pressure: Number(document.documentElement.dataset.qualityPressure ?? '0'),
    maximumPressure: Number(document.documentElement.dataset.qualityMaximumPressure ?? '0'),
    primaryAction: document.documentElement.dataset.qualityPrimaryAction,
    inputPlan: document.documentElement.dataset.qualityInputPlan,
    acceptedInputs: document.documentElement.dataset.qualityAcceptedInputs,
    worldWidth: Number(document.documentElement.dataset.qualityWorldWidth ?? '0'),
    worldHeight: Number(document.documentElement.dataset.qualityWorldHeight ?? '0'),
    restartPosition: document.documentElement.dataset.qualityRestartPosition,
    terminalKind: document.documentElement.dataset.qualityTerminalKind,
    terminalReason: document.documentElement.dataset.qualityTerminalReason,
    auxiliaryName: document.documentElement.dataset.qualityAuxiliaryName ?? 'remaining-seconds',
    auxiliaryValue: Number(document.documentElement.dataset.qualityAuxiliaryValue ?? document.documentElement.dataset.remainingSeconds ?? 'NaN'),
    playerPosition: document.documentElement.dataset.playerPosition,
    primaryTargets: document.documentElement.dataset.qualityPrimaryTargets,
    pressureTargets: document.documentElement.dataset.qualityPressureTargets,
    progressOutput: document.querySelector('#progress-value')?.value,
    auxiliaryOutput: document.querySelector('#auxiliary-value, #time-value')?.value,
    pressureOutput: document.querySelector('#pressure-value')?.value,
    pauseLabel: document.querySelector('#pause-button')?.textContent,
    pausePressed: document.querySelector('#pause-button')?.getAttribute('aria-pressed'),
    status: document.querySelector('#game-status')?.textContent
  })`)
}

async function completePrimaryAction(client, canvas, options = {}) {
  const before = await runtimeState(client)
  const steps = []
  while (Date.now() - (steps[0]?.startedAt ?? Date.now()) < 15_000 && steps.length < 4) {
    const state = await runtimeState(client)
    invariant(state.phase === 'playing', `${state.primaryAction} became terminal before ${state.progressName} increased.`)
    const plan = parseQualityInputPlan(state.inputPlan)
    const declaredPrimary = summarizeQualityInputPlan(plan).primary
    const actions = options.actionFilter ? plan.primary.actions.filter(options.actionFilter) : plan.primary.actions
    invariant(actions.length > 0, `${options.label ?? state.primaryAction} has no compatible declared input actions.`)
    const scenario = { ...plan.primary, actions }
    const startedAt = steps[0]?.startedAt ?? Date.now()
    const runtime = { label: 'primary', targets: state.primaryTargets, nextAt: new Map(), evidence: [] }
    const deadline = Date.now() + 7_000
    let after
    let target
    while (Date.now() < deadline) {
      const executed = await executeInputActions(
        client,
        canvas,
        scenario,
        await runtimeState(client),
        runtime,
        Date.now(),
        { pointerDevice: options.pointerDevice ?? 'mouse' }
      )
      target = executed.target
      after = await runtimeState(client)
      if (after.progress > before.progress || after.phase === 'game-over' || after.primaryAction !== state.primaryAction) break
      await new Promise((resolve) => setTimeout(resolve, 80))
    }
    invariant(after, `${state.primaryAction} did not publish runtime state.`)
    steps.push({ startedAt, action: state.primaryAction, target, inputs: runtime.evidence, playerPosition: after.playerPosition })
    if (after.progress > before.progress) {
      invariant(Number(after.progressOutput) === after.progress, `The visible ${before.progressName} status did not match the domain snapshot.`)
      const filteredPrimary = options.actionFilter
        ? [...new Set(actions.map(({ type, mode }) => `${type}:${mode}`))]
        : null
      return {
        action: before.primaryAction,
        inputPlan: summarizeQualityInputPlan(plan),
        settleMs: plan.primary.settleMs ?? 0,
        progressName: before.progressName,
        before: before.progress,
        after: after.progress,
        auxiliary: auxiliaryCheckpoint(after, `${options.label ?? before.primaryAction} progress`),
        inputAcceptance: filteredPrimary
          ? inputAcceptanceEvidence(before.acceptedInputs, after.acceptedInputs, declaredPrimary, filteredPrimary)
          : undefined,
        steps
      }
    }
  }
  throw new Error(`${before.primaryAction} did not increase ${before.progressName} after ${steps.length} gameplay steps.`)
}

function collectInputEvidence(...values) {
  const evidence = []
  const visit = (value) => {
    if (Array.isArray(value)) value.forEach(visit)
    else if (value && typeof value === 'object') {
      if (typeof value.device === 'string' && typeof value.type === 'string' && typeof value.mode === 'string') evidence.push(value)
      else Object.values(value).forEach(visit)
    }
  }
  values.forEach(visit)
  return evidence
}

function summarizeExecutedInputs(inputs) {
  return [...new Set(inputs.map(({ device, type, mode }) => `${device}:${type}:${mode}`))]
}

function expectedTerminalInputs(declaredPrimary) {
  return [...new Set(declaredPrimary.map((action) => action.startsWith('pointer:') ? `mouse:${action}` : `keyboard:${action}`))]
}

function terminalSnapshot(state, declaredPrimary) {
  return {
    phase: state.phase,
    run: state.run,
    progress: state.progress,
    pressure: state.pressure,
    playerPosition: state.playerPosition,
    terminalKind: state.terminalKind,
    terminalReason: state.terminalReason,
    auxiliaryName: state.auxiliaryName,
    auxiliaryValue: state.auxiliaryValue,
    auxiliaryVisibleValue: Number(state.auxiliaryOutput),
    acceptedInputs: assertAcceptedInputCounters(state.acceptedInputs, declaredPrimary, 'Terminal snapshot')
  }
}

export function assertTerminalInputLockEvidence(evidence, terminalKind, declaredPrimary) {
  invariant(evidence?.terminalKind === terminalKind, `Terminal input lock kind ${evidence?.terminalKind} does not match ${terminalKind}.`)
  const expected = expectedTerminalInputs(declaredPrimary)
  invariant(Array.isArray(evidence.actions) && evidence.actions.length === expected.length
    && expected.every((action) => evidence.actions.includes(action)), `Terminal ${terminalKind} input lock did not dispatch every declared primary input.`)
  invariant(evidence.before?.phase === 'game-over' && evidence.before.terminalKind === terminalKind, `Terminal ${terminalKind} input lock has an invalid starting state.`)
  const beforeInputs = assertAcceptedInputCounters(evidence.before?.acceptedInputs, declaredPrimary, `Terminal ${terminalKind} before`)
  const afterInputs = assertAcceptedInputCounters(evidence.after?.acceptedInputs, declaredPrimary, `Terminal ${terminalKind} after`)
  invariant(JSON.stringify(afterInputs) === JSON.stringify(beforeInputs), `Terminal ${terminalKind} input was accepted after Game Over.`)
  invariant(JSON.stringify(evidence.after) === JSON.stringify(evidence.before), `Terminal ${terminalKind} input changed game state.`)
  invariant(Number.isFinite(evidence.before.auxiliaryValue)
    && evidence.before.auxiliaryVisibleValue === evidence.before.auxiliaryValue, `Terminal ${terminalKind} input lock has unsynchronized auxiliary state.`)
  return evidence
}

function pauseSnapshot(state, declaredPrimary) {
  return {
    ...terminalSnapshot(state, declaredPrimary),
    pauseLabel: state.pauseLabel,
    pausePressed: state.pausePressed
  }
}

function synchronizedAuxiliary(snapshot) {
  return Number.isFinite(snapshot?.auxiliaryValue)
    && snapshot.auxiliaryVisibleValue === snapshot.auxiliaryValue
}

export function assertPauseFreezeEvidence(evidence, declaredPrimary) {
  const expected = expectedTerminalInputs(declaredPrimary)
  invariant(Array.isArray(evidence?.actions) && evidence.actions.length === expected.length
    && expected.every((action) => evidence.actions.includes(action)), 'Pause freeze did not dispatch every declared primary input.')
  invariant(Number.isInteger(evidence.observedMs) && evidence.observedMs >= 1_000, 'Pause freeze observation was shorter than one second.')
  invariant(evidence.before?.phase === 'paused'
    && !evidence.before.terminalKind
    && !evidence.before.terminalReason
    && evidence.before.pauseLabel === 'Resume'
    && evidence.before.pausePressed === 'true', 'Pause freeze has an invalid starting state or control state.')
  invariant(JSON.stringify(evidence.after) === JSON.stringify(evidence.before), 'Paused gameplay changed during input or elapsed time.')
  invariant(synchronizedAuxiliary(evidence.before), 'Pause freeze has unsynchronized auxiliary state.')
  invariant(Number.isInteger(evidence.resumed?.observedMs) && evidence.resumed.observedMs >= 250,
    'Pause resume observation is missing or too short.')
  invariant(evidence.resumed.before?.phase === 'playing'
    && !evidence.resumed.before.terminalKind
    && !evidence.resumed.before.terminalReason
    && evidence.resumed.before.pauseLabel === 'Pause'
    && evidence.resumed.before.pausePressed === 'false', 'Pause resume has an invalid starting state or control state.')
  invariant(evidence.resumed.after?.phase === 'playing'
    && evidence.resumed.after.run === evidence.resumed.before.run
    && !evidence.resumed.after.terminalKind
    && !evidence.resumed.after.terminalReason
    && evidence.resumed.after.auxiliaryName === evidence.resumed.before.auxiliaryName
    && evidence.resumed.after.pauseLabel === 'Pause'
    && evidence.resumed.after.pausePressed === 'false', 'Pause resume did not remain in the same playable run.')
  invariant(synchronizedAuxiliary(evidence.resumed.before) && synchronizedAuxiliary(evidence.resumed.after),
    'Pause resume has unsynchronized auxiliary state.')
  const resumedBeforeInputs = assertAcceptedInputCounters(evidence.resumed.before?.acceptedInputs, declaredPrimary, 'Pause resume before')
  const resumedAfterInputs = assertAcceptedInputCounters(evidence.resumed.after?.acceptedInputs, declaredPrimary, 'Pause resume after')
  invariant(JSON.stringify(resumedAfterInputs) === JSON.stringify(resumedBeforeInputs),
    'Paused input leaked into resumed gameplay.')
  return evidence
}

export function oppositeWorldTarget(state) {
  const [x, y] = state.playerPosition.split(',').map(Number)
  invariant(Number.isFinite(x) && Number.isFinite(y), `Invalid terminal player position: ${state.playerPosition}`)
  const corners = [[1, 1], [state.worldWidth - 1, 1], [1, state.worldHeight - 1], [state.worldWidth - 1, state.worldHeight - 1]]
  return corners.toSorted((left, right) => Math.hypot(right[0] - x, right[1] - y) - Math.hypot(left[0] - x, left[1] - y))[0]
}

async function proveTerminalInputLock(client, canvas, terminalKind) {
  const beforeState = await runtimeState(client)
  invariant(beforeState.phase === 'game-over' && beforeState.terminalKind === terminalKind, `Expected terminal ${terminalKind} state before input lock proof.`)
  const plan = parseQualityInputPlan(beforeState.inputPlan)
  const declaredPrimary = summarizeQualityInputPlan(plan).primary
  const runtime = {
    label: `${terminalKind} terminal input lock`,
    targets: JSON.stringify([oppositeWorldTarget(beforeState)]),
    nextAt: new Map(),
    evidence: []
  }
  await executeInputActions(client, canvas, plan.primary, beforeState, runtime, Date.now(), { ignoreConditions: true })
  await new Promise((resolve) => setTimeout(resolve, Math.max(120, plan.primary.settleMs ?? 0)))
  const evidence = {
    terminalKind,
    actions: summarizeExecutedInputs(runtime.evidence),
    before: terminalSnapshot(beforeState, declaredPrimary),
    after: terminalSnapshot(await runtimeState(client), declaredPrimary)
  }
  return assertTerminalInputLockEvidence(evidence, terminalKind, declaredPrimary)
}

async function provePauseFreeze(client, canvas) {
  const beforeState = await runtimeState(client)
  invariant(beforeState.phase === 'paused', 'Expected paused state before freeze proof.')
  const plan = parseQualityInputPlan(beforeState.inputPlan)
  const declaredPrimary = summarizeQualityInputPlan(plan).primary
  const runtime = {
    label: 'pause freeze',
    targets: JSON.stringify([oppositeWorldTarget(beforeState)]),
    nextAt: new Map(),
    evidence: []
  }
  const startedAt = Date.now()
  await executeInputActions(client, canvas, plan.primary, beforeState, runtime, startedAt, { ignoreConditions: true })
  const elapsed = Date.now() - startedAt
  if (elapsed < 1_100) await new Promise((resolve) => setTimeout(resolve, 1_100 - elapsed))
  const evidence = {
    actions: summarizeExecutedInputs(runtime.evidence),
    observedMs: Date.now() - startedAt,
    before: pauseSnapshot(beforeState, declaredPrimary),
    after: pauseSnapshot(await runtimeState(client), declaredPrimary)
  }
  await clickButton(client, 'Resume')
  await poll(client, `document.documentElement.dataset.gameState`, (value) => value === 'playing', 'resume state')
  const resumedAt = Date.now()
  const resumedBefore = pauseSnapshot(await runtimeState(client), declaredPrimary)
  await new Promise((resolve) => setTimeout(resolve, 300))
  evidence.resumed = {
    observedMs: Date.now() - resumedAt,
    before: resumedBefore,
    after: pauseSnapshot(await runtimeState(client), declaredPrimary)
  }
  return assertPauseFreezeEvidence(evidence, declaredPrimary)
}

function dispatchedKeyboardInput(input) {
  return input.device === 'keyboard'
    && (input.type === 'key' || (input.type === 'navigate' && Array.isArray(input.detail) && input.detail.length > 0))
}

async function completeSuccessThroughGameplay(client, canvas) {
  const initial = await runtimeState(client)
  const plan = parseQualityInputPlan(initial.inputPlan)
  const declaredPrimary = summarizeQualityInputPlan(plan).primary
  invariant(initial.completionTarget > initial.progress, `Invalid ${initial.progressName} completion target: ${initial.completionTarget}.`)
  const actions = []
  let state = initial
  while (state.phase === 'playing' && state.progress < state.completionTarget) {
    const action = await completePrimaryAction(client, canvas)
    actions.push(action)
    if (action.settleMs > 0) await new Promise((resolve) => setTimeout(resolve, action.settleMs))
    state = await runtimeState(client)
  }
  invariant(state.phase === 'game-over', `${state.progressName} reached ${state.progress} without entering Game Over.`)
  invariant(state.progress >= state.completionTarget, `${state.progressName} stopped at ${state.progress}; expected ${state.completionTarget}.`)
  invariant(state.terminalKind === 'success', `Completion ended as ${state.terminalKind ?? 'unknown'} instead of success.`)
  invariant(state.terminalReason, 'Successful Game Over did not publish a terminal reason.')
  invariant(state.status && state.status !== 'Loading game', 'Successful Game Over did not publish an accessible terminal status.')
  return {
    primaryAction: actions[0]?.action ?? initial.primaryAction,
    progress: { name: initial.progressName, before: initial.progress, after: state.progress, target: state.completionTarget },
    actions,
    inputPlan: summarizeQualityInputPlan(plan),
    inputAcceptance: inputAcceptanceEvidence(initial.acceptedInputs, state.acceptedInputs, declaredPrimary),
    phase: state.phase,
    kind: state.terminalKind,
    reason: state.terminalReason,
    status: state.status,
    auxiliary: auxiliaryCheckpoint(state, 'success terminal')
  }
}

async function exhaustPressureThroughGameplay(client, canvas) {
  const hits = []
  let state = await runtimeState(client)
  const plan = parseQualityInputPlan(state.inputPlan)
  const initialPressure = state.pressure
  while (state.pressure > 0) {
    const pressureBefore = state.pressure
    const started = Date.now()
    const runtime = { label: 'pressure', targets: state.pressureTargets, nextAt: new Map(), evidence: [] }
    while (Date.now() - started < 15_000) {
      state = await runtimeState(client)
      if (state.pressure < pressureBefore || state.phase === 'game-over') break
      runtime.targets = state.pressureTargets
      await executeInputActions(client, canvas, plan.pressure, state, runtime)
      await new Promise((resolve) => setTimeout(resolve, 60))
    }
    state = await runtimeState(client)
    invariant(state.pressure < pressureBefore, `Gameplay pressure did not reduce ${state.pressureName} ${pressureBefore}: ${JSON.stringify({ phase: state.phase, playerPosition: state.playerPosition, pressureTargets: state.pressureTargets })}.`)
    invariant(Number(state.pressureOutput) === state.pressure, `The visible ${state.pressureName} status did not match the domain snapshot.`)
    hits.push({ before: pressureBefore, after: state.pressure, inputs: runtime.evidence })
    if (state.phase !== 'game-over') await new Promise((resolve) => setTimeout(resolve, 1_050))
  }
  invariant(state.phase === 'game-over', `${state.pressureName} reached ${state.pressure} without entering Game Over.`)
  invariant(state.terminalKind === 'failure', `Pressure exhaustion ended as ${state.terminalKind ?? 'unknown'} instead of failure.`)
  invariant(state.terminalReason, 'Game Over did not publish a terminal reason.')
  invariant(state.status && state.status !== 'Loading game', 'Game Over did not publish an accessible terminal status.')
  return {
    name: state.pressureName,
    initial: initialPressure,
    final: state.pressure,
    phase: state.phase,
    kind: state.terminalKind,
    reason: state.terminalReason,
    status: state.status,
    progress: state.progress,
    inputPlan: summarizeQualityInputPlan(plan),
    auxiliary: auxiliaryCheckpoint(state, 'failure terminal'),
    events: hits
  }
}

async function assertTerminalPause(client, terminalKind) {
  await clickButton(client, 'Pause')
  const state = await runtimeState(client)
  invariant(state.phase === 'game-over' && state.terminalKind === terminalKind, `Pause changed a terminal ${terminalKind} run.`)
  invariant(state.pauseLabel === 'Pause' && state.pausePressed === 'false', 'Terminal pause control state is inconsistent.')
  return state
}

async function restartRun(client, canvas, beforeRestart, label) {
  await clickButton(client, 'Restart')
  const restarted = await poll(client, `({
    run: Number(document.documentElement.dataset.gameRun ?? '0'),
    state: document.documentElement.dataset.gameState,
    position: document.documentElement.dataset.playerPosition,
    progress: Number(document.documentElement.dataset.qualityProgress ?? '-1'),
    pressure: Number(document.documentElement.dataset.qualityPressure ?? '-1'),
    maximumPressure: Number(document.documentElement.dataset.qualityMaximumPressure ?? '-1'),
    terminalKind: document.documentElement.dataset.qualityTerminalKind,
    terminalReason: document.documentElement.dataset.qualityTerminalReason,
    auxiliaryName: document.documentElement.dataset.qualityAuxiliaryName ?? 'remaining-seconds',
    auxiliaryValue: Number(document.documentElement.dataset.qualityAuxiliaryValue ?? document.documentElement.dataset.remainingSeconds ?? 'NaN'),
    auxiliaryOutput: document.querySelector('#auxiliary-value, #time-value')?.value,
    progressOutput: document.querySelector('#progress-value')?.value,
    pressureOutput: document.querySelector('#pressure-value')?.value,
    restartPosition: document.documentElement.dataset.qualityRestartPosition
  })`, (value) => value.run > beforeRestart
    && value.state === 'playing'
    && value.progress === 0
    && value.pressure === value.maximumPressure
    && !value.terminalKind
    && !value.terminalReason, label)
  invariant(restarted.position === restarted.restartPosition, `Restart did not reset the player: ${restarted.position}; expected ${restarted.restartPosition}.`)
  invariant(restarted.progressOutput === '0' && Number(restarted.pressureOutput) === restarted.maximumPressure, 'Restart did not reset the visible run status.')
  restarted.auxiliary = auxiliaryCheckpoint(restarted, label)
  const playable = await completePrimaryAction(client, canvas)
  invariant(playable.after > playable.before, 'Restarted gameplay did not complete its declared primary action.')
  await clickButton(client, 'Restart')
  const cleaned = await poll(client, `({
    run: Number(document.documentElement.dataset.gameRun ?? '0'),
    state: document.documentElement.dataset.gameState,
    progress: Number(document.documentElement.dataset.qualityProgress ?? '-1'),
    pressure: Number(document.documentElement.dataset.qualityPressure ?? '-1'),
    maximumPressure: Number(document.documentElement.dataset.qualityMaximumPressure ?? '-1')
  })`, (value) => value.run > restarted.run
    && value.state === 'playing'
    && value.progress === 0
    && value.pressure === value.maximumPressure, `${label} cleanup`)
  restarted.playable = playable
  restarted.cleanupRun = cleaned.run
  return restarted
}

async function desktopScenario(client, url, viewport, qualityRoot, persistenceContract) {
  await configureViewport(client, viewport)
  await navigate(client, url, 'desktop')
  const initial = await metrics(client)
  invariant(initial.viewport.width === viewport.width && initial.viewport.height === viewport.height, 'Desktop viewport override did not apply.')
  invariant(initial.canvas?.width > 0 && initial.canvas?.height > 0, 'Desktop canvas is missing or blank-sized.')
  invariant(initial.canvas.dataUrlLength > 5_000, 'Desktop canvas did not produce a rendered frame.')
  invariant(initial.status && initial.status !== 'Loading game', `Unexpected initial status: ${initial.status}`)
  const pixels = await canvasPixels(client, initial.canvas)
  invariant(pixels?.nonTransparent > 1_000, `Desktop canvas has too few visible pixel samples: ${pixels?.nonTransparent ?? 0}.`)
  invariant(pixels.distinctColors >= 8 && pixels.maximumLuma - pixels.minimumLuma >= 20, `Desktop canvas lacks visual variance: ${JSON.stringify(pixels)}.`)

  const profileMigration = await verifyProfileMigration(client, persistenceContract)

  await clickButton(client, 'Pause')
  const paused = await poll(client, `({
    state: document.documentElement.dataset.gameState,
    label: document.querySelector('#pause-button')?.textContent,
    pressed: document.querySelector('#pause-button')?.getAttribute('aria-pressed')
  })`, (value) => value.state === 'paused', 'pause state')
  invariant(paused.label === 'Resume' && paused.pressed === 'true', 'Pause control did not expose its resumed action and ARIA state.')
  paused.freeze = await provePauseFreeze(client, initial.canvas)

  const pressure = await exhaustPressureThroughGameplay(client, initial.canvas)
  const failureInputLock = await proveTerminalInputLock(client, initial.canvas, 'failure')
  const failureTerminalPause = await assertTerminalPause(client, 'failure')
  const failureRestart = await restartRun(client, initial.canvas, failureTerminalPause.run, 'failed Scene restart')

  const success = await completeSuccessThroughGameplay(client, initial.canvas)
  const successInputLock = await proveTerminalInputLock(client, initial.canvas, 'success')
  const successTerminalPause = await assertTerminalPause(client, 'success')
  const successRestart = await restartRun(client, initial.canvas, successTerminalPause.run, 'successful Scene restart')
  const declaredInputs = collectInputEvidence(pressure.events, failureRestart.playable, success.actions, successRestart.playable)
  const primaryInputs = collectInputEvidence(failureRestart.playable, success.actions, successRestart.playable)
  const pointerInputs = primaryInputs.filter(({ device, type }) => device === 'mouse' && type === 'pointer')
  const keyboardInputs = declaredInputs.filter(dispatchedKeyboardInput)
  const primaryKeyboardInputs = primaryInputs.filter(dispatchedKeyboardInput)
  invariant(pointerInputs.length > 0, 'Desktop gameplay did not execute a declared primary pointer action.')
  invariant(keyboardInputs.length > 0, 'Desktop gameplay did not execute a declared keyboard action.')
  const profileReload = await verifyProfileReload(client, success, pressure, profileMigration.profile, persistenceContract)
  const screenshot = await capture(client, path.join(qualityRoot, 'browser-desktop.png'))
  return {
    initial,
    pixels,
    pointer: { actions: summarizeExecutedInputs(pointerInputs) },
    keyboard: {
      actions: summarizeExecutedInputs(keyboardInputs),
      primaryActions: summarizeExecutedInputs(primaryKeyboardInputs)
    },
    paused,
    failure: { pressure, inputLock: failureInputLock, terminalPause: failureTerminalPause, restarted: failureRestart },
    success: { ...success, inputLock: successInputLock, terminalPause: successTerminalPause, restarted: successRestart },
    persistence: {
      migration: profileMigration.report,
      gameplay: profileReload.gameplay,
      reload: { ...profileReload, gameplay: undefined }
    },
    screenshot
  }
}

async function mobileScenario(client, url, viewport, minimumTouchTarget, qualityRoot) {
  await configureViewport(client, viewport)
  await navigate(client, url, 'mobile')
  const initial = await metrics(client)
  invariant(initial.viewport.width === viewport.width && initial.viewport.height === viewport.height, 'Mobile viewport override did not apply.')
  invariant(initial.overflowX === 0, `Mobile layout overflows horizontally by ${initial.overflowX}px.`)
  invariant(initial.canvas?.right <= viewport.width && initial.canvas?.bottom <= viewport.height, 'Mobile canvas does not fit the viewport.')
  invariant(initial.buttons.length === 3 && initial.buttons.every((button) => button.visible), 'Mobile critical controls are not all visible.')
  invariant(initial.buttons.every((button) => button.height >= minimumTouchTarget), `A mobile control is shorter than ${minimumTouchTarget}px.`)
  invariant(initial.stats.length === 3 && initial.stats.every((stat) => stat.visible), 'Mobile run status is not fully visible.')
  invariant(initial.stats[0].value === '0'
    && Number(initial.stats[1].value) === initial.auxiliaryValue
    && Number(initial.stats[2].value) === initial.pressure, `Unexpected mobile run status: ${JSON.stringify(initial.stats)}.`)
  invariant(initial.telemetry.length >= 4 && initial.telemetry.every((item) => item.visible && item.value.length > 0), `Mobile gameplay telemetry is incomplete: ${JSON.stringify(initial.telemetry)}.`)
  const pixels = await canvasPixels(client, initial.canvas)
  invariant(pixels?.nonTransparent > 1_000 && pixels.distinctColors >= 8, `Mobile canvas is blank or visually uniform: ${JSON.stringify(pixels)}.`)

  const touchPrimary = await completePrimaryAction(client, initial.canvas, {
    label: 'mobile primary action',
    pointerDevice: 'touch',
    actionFilter: (action) => action.type === 'pointer'
  })
  const touchInputs = collectInputEvidence(touchPrimary.steps).filter(({ device }) => device === 'touch')
  invariant(touchInputs.length > 0, 'Mobile gameplay did not execute a declared touch pointer action.')
  const screenshot = await capture(client, path.join(qualityRoot, 'browser-mobile.png'))
  return {
    initial,
    pixels,
    touch: {
      actions: summarizeExecutedInputs(touchInputs),
      progressName: touchPrimary.progressName,
      before: touchPrimary.before,
      after: touchPrimary.after,
      inputAcceptance: touchPrimary.inputAcceptance,
      auxiliary: touchPrimary.auxiliary
    },
    screenshot
  }
}

export async function runBrowserE2E(root = projectRoot) {
  const quality = JSON.parse(await readFile(path.join(root, 'game-quality.json'), 'utf8'))
  if (quality.persistence?.required) assertPersistenceContract(quality.persistence)
  const qualityRoot = path.join(root, '.quality')
  const distRoot = path.join(root, 'dist')
  await mkdir(qualityRoot, { recursive: true })
  await removeBrowserEvidence(qualityRoot)
  invariant((await exists(path.join(distRoot, 'index.html'))), 'dist/index.html is missing. Run the production build before browser E2E.')
  const initialFingerprints = await verifyBundleFingerprintEvidence(root)

  const browserPath = await findBrowser()
  const profile = await mkdtemp(path.join(os.tmpdir(), 'phaser-browser-e2e-'))
  const server = await startServer(distRoot)
  const child = spawn(browserPath, [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--no-default-browser-check',
    '--no-first-run',
    '--mute-audio',
    'about:blank'
  ], { stdio: 'ignore', windowsHide: true })
  let client
  try {
    const devToolsPort = await waitForDevTools(profile, child)
    client = await connectPage(devToolsPort)
    const consoleMessages = []
    const exceptions = []
    const failedResponses = []
    client.on('Runtime.consoleAPICalled', (event) => {
      if (event.type === 'warning' || event.type === 'error') {
        consoleMessages.push({ type: event.type, text: event.args.map((arg) => arg.value ?? arg.description ?? '').join(' ') })
      }
    })
    client.on('Runtime.exceptionThrown', (event) => exceptions.push(event.exceptionDetails.text))
    client.on('Network.responseReceived', (event) => {
      if (event.response.status >= 400) failedResponses.push({ status: event.response.status, url: event.response.url })
    })
    await Promise.all([
      client.send('Page.enable'),
      client.send('Runtime.enable'),
      client.send('Network.enable')
    ])

    const desktop = await desktopScenario(client, server.url, quality.browser.desktop, qualityRoot, quality.persistence)
    const mobile = await mobileScenario(client, server.url, quality.browser.mobile, quality.browser.minimumTouchTarget, qualityRoot)
    if (quality.persistence?.required) {
      invariant(desktop.persistence.migration.status === 'pass', 'Required player profile migration proof is missing.')
      invariant(desktop.persistence.gameplay.status === 'pass', 'Required player profile gameplay proof is missing.')
      invariant(desktop.persistence.reload.status === 'pass', 'Required player profile reload proof is missing.')
      invariant(desktop.persistence.migration.fromVersion === quality.persistence.migrationFromVersion, `Player profile migration source ${desktop.persistence.migration.fromVersion} does not match required version ${quality.persistence.migrationFromVersion}.`)
      invariant(desktop.persistence.migration.toVersion === quality.persistence.schemaVersion, `Player profile migration target ${desktop.persistence.migration.toVersion} does not match required version ${quality.persistence.schemaVersion}.`)
      invariant(desktop.persistence.reload.schemaVersion === quality.persistence.schemaVersion, `Player profile schema ${desktop.persistence.reload.schemaVersion} does not match required version ${quality.persistence.schemaVersion}.`)
    }
    invariant(exceptions.length === 0, `Browser exceptions: ${exceptions.join(' | ')}`)
    invariant(failedResponses.length === 0, `Failed browser requests: ${failedResponses.map((entry) => `${entry.status} ${entry.url}`).join(' | ')}`)
    invariant(consoleMessages.length <= quality.browser.maximumConsoleWarnings, `Browser console warnings/errors: ${consoleMessages.map((entry) => entry.text).join(' | ')}`)
    const report = {
      status: 'pass',
      browser: browserPath,
      url: server.url,
      desktop,
      mobile,
      consoleMessages,
      exceptions,
      failedResponses,
      summary: {
        status: 'pass',
        viewports: {
          desktop: desktop.initial.viewport,
          mobile: mobile.initial.viewport
        },
        interactions: {
          desktopPointer: desktop.pointer.actions,
          desktopKeyboard: desktop.keyboard.actions,
          desktopPrimaryKeyboard: desktop.keyboard.primaryActions,
          mobilePointer: mobile.touch
        },
        gameplay: {
          primaryAction: desktop.success.primaryAction,
          inputPlan: desktop.success.inputPlan,
          inputAcceptance: desktop.success.inputAcceptance,
          pauseFreeze: desktop.paused.freeze,
          auxiliary: {
            name: desktop.initial.auxiliaryName,
            value: desktop.initial.auxiliaryValue,
            checkpoints: {
              desktopInitial: auxiliaryCheckpoint(desktop.initial, 'desktop initial'),
              failureTerminal: desktop.failure.pressure.auxiliary,
              failureRestart: desktop.failure.restarted.auxiliary,
              successTerminal: desktop.success.auxiliary,
              successRestart: desktop.success.restarted.auxiliary,
              mobileInitial: auxiliaryCheckpoint(mobile.initial, 'mobile initial'),
              mobileProgress: mobile.touch.auxiliary
            }
          },
          progress: desktop.success.progress,
          success: {
            terminalState: desktop.success.phase,
            terminalKind: desktop.success.kind,
            terminalReason: desktop.success.reason,
            inputLock: desktop.success.inputLock,
            restart: {
              progress: desktop.success.restarted.progress,
              pressure: desktop.success.restarted.pressure,
              run: desktop.success.restarted.run,
              playableProgress: desktop.success.restarted.playable.after,
              cleanupRun: desktop.success.restarted.cleanupRun
            }
          },
          failure: {
            pressure: { name: desktop.failure.pressure.name, before: desktop.failure.pressure.initial, after: desktop.failure.pressure.final, events: desktop.failure.pressure.events.length },
            progress: desktop.failure.pressure.progress,
            terminalState: desktop.failure.pressure.phase,
            terminalKind: desktop.failure.pressure.kind,
            terminalReason: desktop.failure.pressure.reason,
            inputLock: desktop.failure.inputLock,
            restart: {
              progress: desktop.failure.restarted.progress,
              pressure: desktop.failure.restarted.pressure,
              run: desktop.failure.restarted.run,
              playableProgress: desktop.failure.restarted.playable.after,
              cleanupRun: desktop.failure.restarted.cleanupRun
            }
          }
        },
        persistence: desktop.persistence.reload.status === 'pass' && desktop.persistence.gameplay.status === 'pass' && desktop.persistence.migration.status === 'pass'
          ? { status: 'pass', migration: desktop.persistence.migration, gameplay: desktop.persistence.gameplay, reload: desktop.persistence.reload }
          : { status: 'not-declared' },
        errors: {
          consoleMessages: consoleMessages.length,
          exceptions: exceptions.length,
          failedResponses: failedResponses.length
        }
      }
    }
    assertGameplayContract(quality.gameplay, report.summary.gameplay)
    return publishBrowserEvidence(root, report, initialFingerprints)
  } catch (error) {
    await removeBrowserEvidence(qualityRoot)
    throw error
  } finally {
    if (client) await client.send('Browser.close').catch(() => undefined)
    client?.close()
    if (child.exitCode === null) child.kill()
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 2_000))
    ])
    await server.close().catch(() => undefined)
    await rm(profile, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function main() {
  const report = await runBrowserE2E()
  console.log(`Browser E2E: PASS - keyboard ${report.desktop.keyboard.actions.join(', ')}, touch ${report.mobile.touch.actions.join(', ')}, console 0`)
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(`Browser E2E: FAIL - ${error.message}`)
    process.exitCode = 1
  })
}
