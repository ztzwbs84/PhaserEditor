import { test, expect } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { promises as fs } from 'node:fs'
import { createServer } from 'node:net'
import path from 'node:path'

const editorExecutable = process.env.PHASER_EDITOR_EXECUTABLE
const skillProject = process.env.PHASER_EDITOR_SKILL_PROJECT
const screenshotRoot = path.resolve('artifacts', 'screenshots', 'skill-editor')

test.skip(process.platform !== 'win32', 'The packaged skill editor smoke test only runs on Windows.')
test.skip(!editorExecutable || !skillProject, 'Set PHASER_EDITOR_EXECUTABLE and PHASER_EDITOR_SKILL_PROJECT to run the packaged smoke test.')

test.beforeAll(async () => {
  await fs.mkdir(screenshotRoot, { recursive: true })
})

test('loads the real skill editor in the packaged Windows application', async () => {
  test.setTimeout(180_000)
  const executable = path.resolve(editorExecutable!)
  const projectRoot = path.resolve(skillProject!)
  await fs.access(executable)
  await fs.access(projectRoot)

  const runId = `${Date.now()}-${process.pid}`
  const userData = path.resolve('test-results', `user-data-packaged-skill-editor-${runId}`)
  const debuggingPort = await freePort()
  await fs.mkdir(userData, { recursive: true })

  const output = { stdout: '', stderr: '' }
  const child = spawn(executable, [
    `--remote-debugging-port=${debuggingPort}`,
    '--remote-allow-origins=*'
  ], {
    cwd: path.dirname(executable),
    env: {
      ...process.env,
      PHASER_EDITOR_USER_DATA: userData,
      PHASER_SOURCE_ROOT: process.env.PHASER_SOURCE_ROOT ?? 'I:\\Phaser\\phaser'
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  })
  child.stdout?.on('data', (chunk: Buffer) => { output.stdout = appendOutput(output.stdout, chunk) })
  child.stderr?.on('data', (chunk: Buffer) => { output.stderr = appendOutput(output.stderr, chunk) })

  let cdp: CdpClient | null = null
  const rendererErrors: string[] = []
  try {
    await once(child, 'spawn')
    const target = await waitForRendererTarget(debuggingPort, child, output)
    cdp = await CdpClient.connect(target.webSocketDebuggerUrl)
    cdp.onEvent((method, params) => {
      if (method === 'Runtime.exceptionThrown') rendererErrors.push(exceptionMessage(params))
      if (method === 'Runtime.consoleAPICalled' && isErrorConsoleEvent(params)) rendererErrors.push(consoleMessage(params))
    })
    await Promise.all([cdp.send('Runtime.enable'), cdp.send('Page.enable')])

    await waitForExpression(cdp, `Boolean([...document.querySelectorAll('h1,h2')].find((element) => element.textContent?.trim() === 'Projects'))`, 30_000, 'Project center did not render.')
    await openProjectFromCenter(cdp, projectRoot)
    await waitForExpression(cdp, `Boolean(document.querySelector('[role="alertdialog"]'))`, 30_000, 'Project plugin trust dialog did not appear.')
    const trustText = await cdp.evaluate<string>(`document.querySelector('[role="alertdialog"]')?.textContent ?? ''`)
    expect(trustText).toContain('S3 Skill Editor')
    expect(trustText).toContain('filesystem:project')
    expect(await clickButton(cdp, 'Trust and load', '[role="alertdialog"]')).toBe(true)

    await expect.poll(() => projectPluginState(cdp!), {
      timeout: 90_000,
      message: 'The packaged application did not compile the project TSX plugin with its bundled esbuild executable.'
    }).toEqual('ready')

    await openProjectFile(cdp, '200201.json')
    await waitForExpression(cdp, `Boolean(${deepQueryExpression('.lazy-plugin-surface[data-plugin="s3-skill-editor"]', '.skill-editor')})`, 30_000, 'The packaged skill editor did not mount inside Shadow DOM.')
    const editorState = await cdp.evaluate<{
      shadowRoot: boolean
      editor: boolean
      timeline: boolean
      clip: boolean
      exactTab: boolean
      dirtyTab: boolean
      documentState: string | null
    }>(`(() => {
      const host = document.querySelector('.lazy-plugin-surface[data-plugin="s3-skill-editor"] .plugin-shadow-host')
      const root = host?.shadowRoot
      const editor = ${deepQueryExpression('.lazy-plugin-surface[data-plugin="s3-skill-editor"]', '.skill-editor')}
      const tabs = [...document.querySelectorAll('[role="tab"]')].map((element) => element.textContent?.trim() ?? '')
      const documentSection = [...document.querySelectorAll('.inspector-panel .inspector-section')]
        .find((section) => section.querySelector('h3')?.textContent?.trim() === 'Document')
      const stateField = documentSection
        ? [...documentSection.querySelectorAll('.property-row')].find((row) => row.querySelector('span')?.textContent?.trim() === 'State')
        : null
      return {
        shadowRoot: Boolean(root),
        editor: Boolean(editor),
        timeline: Boolean(editor?.querySelector('.timeline-pane')),
        clip: Boolean(editor?.querySelector('.timeline-clip')),
        exactTab: tabs.includes('200201.json'),
        dirtyTab: tabs.includes('* 200201.json'),
        documentState: stateField?.querySelector('strong')?.textContent?.trim() ?? null
      }
    })()`)
    expect(editorState).toEqual({
      shadowRoot: true,
      editor: true,
      timeline: true,
      clip: true,
      exactTab: true,
      dirtyTab: false,
      documentState: 'Saved'
    })

    const screenshot = await cdp.send<{ data: string }>('Page.captureScreenshot', { format: 'png', fromSurface: true })
    await fs.writeFile(path.join(screenshotRoot, 'packaged-skill-editor.png'), Buffer.from(screenshot.data, 'base64'))
    expect(rendererErrors).toEqual([])
  } catch (error) {
    const diagnostics = cdp ? await rendererDiagnostics(cdp, rendererErrors).catch((diagnosticError) => ({ diagnosticError: String(diagnosticError) })) : null
    throw new Error(`${error instanceof Error ? error.message : String(error)}${diagnostics ? `\nRenderer diagnostics:\n${JSON.stringify(diagnostics, null, 2)}` : ''}${formatProcessOutput(child, output)}`, { cause: error })
  } finally {
    await closePackagedApp(cdp, child)
  }
})

async function waitForRendererTarget(
  port: number,
  child: ChildProcess,
  output: { stdout: string; stderr: string }
): Promise<DebugTarget> {
  const endpoint = `http://127.0.0.1:${port}/json/list`
  const deadline = Date.now() + 30_000
  let lastError: unknown
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Packaged Phaser Editor exited before CDP became available.${formatProcessOutput(child, output)}`)
    }
    try {
      const response = await fetch(endpoint)
      if (response.ok) {
        const targets = await response.json() as DebugTarget[]
        const renderer = targets.find((target) => (
          target.type === 'page'
          && target.title === 'Phaser Editor'
          && target.url.includes('/out/renderer/index.html')
          && target.webSocketDebuggerUrl
        ))
        if (renderer) return renderer
      }
    } catch (error) {
      lastError = error
    }
    await delay(100)
  }
  throw new Error(`Could not find a packaged Phaser Editor page target at ${endpoint}: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

async function openProjectFromCenter(cdp: CdpClient, projectPath: string): Promise<void> {
  expect(await clickButton(cdp, 'Open project')).toBe(true)
  await waitForExpression(cdp, `Boolean(document.querySelector('[role="dialog"]'))`, 10_000, 'Open project dialog did not appear.')
  const filled = await cdp.evaluate<boolean>(`(() => {
    const input = document.querySelector('[role="dialog"] input')
    if (!(input instanceof HTMLInputElement)) return false
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, ${JSON.stringify(projectPath)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`)
  expect(filled).toBe(true)
  expect(await clickButton(cdp, 'Open project', '[role="dialog"]')).toBe(true)
}

async function openProjectFile(cdp: CdpClient, fileName: string): Promise<void> {
  const filled = await cdp.evaluate<boolean>(`(() => {
    const input = document.querySelector('input[aria-label="Search project files"]')
    if (!(input instanceof HTMLInputElement)) return false
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, ${JSON.stringify(fileName)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  expect(filled).toBe(true)
  await waitForExpression(cdp, `Boolean([...document.querySelectorAll('[role="option"]')].find((element) => element.textContent?.trim().startsWith(${JSON.stringify(fileName)})))`, 10_000, `${fileName} did not appear in project search.`)
  const opened = await cdp.evaluate<boolean>(`(() => {
    const row = [...document.querySelectorAll('[role="option"]')]
      .find((element) => element.textContent?.trim().startsWith(${JSON.stringify(fileName)}))
    if (!(row instanceof HTMLElement)) return false
    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window }))
    return true
  })()`)
  expect(opened).toBe(true)
}

async function clickButton(cdp: CdpClient, text: string, containerSelector?: string): Promise<boolean> {
  return cdp.evaluate<boolean>(`(() => {
    const container = ${containerSelector ? `document.querySelector(${JSON.stringify(containerSelector)})` : 'document'}
    const button = container ? [...container.querySelectorAll('button')].find((element) => element.textContent?.trim() === ${JSON.stringify(text)}) : null
    if (!(button instanceof HTMLButtonElement)) return false
    button.click()
    return true
  })()`)
}

async function projectPluginState(cdp: CdpClient): Promise<string | null> {
  return cdp.evaluate<string | null>(`window.editorApi.plugins.list().then((result) => {
    if (!result.ok) throw new Error(result.error.message)
    return result.value.find((plugin) => plugin.manifest.id === 's3-skill-editor')?.build.state ?? null
  })`)
}

async function rendererDiagnostics(cdp: CdpClient, rendererErrors: string[]): Promise<unknown> {
  const state = await cdp.evaluate<unknown>(`(async () => {
    const listed = await window.editorApi.plugins.list()
    const plugin = listed.ok ? listed.value.find((candidate) => candidate.manifest.id === 's3-skill-editor') : null
    let importError = null
    let importedModule = null
    if (plugin?.uiUrl) {
      try {
        const module = await import(plugin.uiUrl)
        const surface = module.skillActionEditor ?? module.fileEditors?.['s3-skill-editor.action'] ?? module.fileEditors?.skillActionEditor
        importedModule = {
          keys: Object.keys(module),
          fileEditorKeys: module.fileEditors ? Object.keys(module.fileEditors) : [],
          surfaceType: typeof surface,
          surfaceKeys: surface && (typeof surface === 'object' || typeof surface === 'function') ? Object.keys(surface) : [],
          hasMount: typeof surface?.mount === 'function'
        }
      }
      catch (error) { importError = error instanceof Error ? error.stack ?? error.message : String(error) }
    }
    const surface = document.querySelector('.lazy-plugin-surface[data-plugin="s3-skill-editor"]')
    const host = surface?.querySelector('.plugin-shadow-host')
    return {
      tabs: [...document.querySelectorAll('[role="tab"]')].map((element) => element.textContent?.trim() ?? ''),
      surfaceText: surface?.textContent?.trim() ?? null,
      surfaceHtml: surface?.innerHTML.slice(0, 2000) ?? null,
      surfaceConnected: surface?.isConnected ?? null,
      hostHidden: host instanceof HTMLElement ? host.hidden : null,
      hostConnected: host?.isConnected ?? null,
      hostShadowRoot: Boolean(host?.shadowRoot),
      hostDisplay: host instanceof HTMLElement ? getComputedStyle(host).display : null,
      deepEditor: Boolean(${deepQueryExpression('.lazy-plugin-surface[data-plugin="s3-skill-editor"]', '.skill-editor')}),
      plugin: plugin ? { state: plugin.state, build: plugin.build, uiUrl: plugin.uiUrl, cssUrls: plugin.cssUrls } : null,
      importedModule,
      importError
    }
  })()`)
  return { rendererErrors, state }
}

async function waitForExpression(
  cdp: CdpClient,
  expression: string,
  timeout: number,
  message: string
): Promise<void> {
  const deadline = Date.now() + timeout
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      if (await cdp.evaluate<boolean>(expression)) return
    } catch (error) {
      lastError = error
    }
    await delay(100)
  }
  throw new Error(`${message}${lastError instanceof Error ? ` ${lastError.message}` : ''}`)
}

async function closePackagedApp(cdp: CdpClient | null, child: ChildProcess): Promise<void> {
  if (cdp) {
    await Promise.race([
      cdp.send('Browser.close').catch(() => undefined),
      delay(1_000)
    ])
    cdp.close()
  }
  if (await waitForExit(child, 5_000)) return
  if (child.pid) {
    const taskkill = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true
    })
    await Promise.race([
      once(taskkill, 'exit').catch(() => undefined),
      delay(5_000)
    ])
  }
  await waitForExit(child, 5_000)
}

class CdpClient {
  private nextId = 0
  private readonly pending = new Map<number, {
    resolve(value: unknown): void
    reject(error: Error): void
    timer: ReturnType<typeof setTimeout>
  }>()
  private readonly eventListeners = new Set<(method: string, params: unknown) => void>()

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', (event) => { void this.handleMessage(event.data) })
    socket.addEventListener('close', () => this.rejectPending(new Error('CDP renderer connection closed.')))
    socket.addEventListener('error', () => this.rejectPending(new Error('CDP renderer connection failed.')))
  }

  static async connect(url: string): Promise<CdpClient> {
    const socket = new WebSocket(url)
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out connecting to renderer CDP target ${url}.`)), 15_000)
      socket.addEventListener('open', () => {
        clearTimeout(timer)
        resolve()
      }, { once: true })
      socket.addEventListener('error', () => {
        clearTimeout(timer)
        reject(new Error(`Could not connect to renderer CDP target ${url}.`))
      }, { once: true })
    })
    return new CdpClient(socket)
  }

  send<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = ++this.nextId
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`CDP command ${method} timed out.`))
      }, 15_000)
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  async evaluate<T>(expression: string): Promise<T> {
    const response = await this.send<RuntimeEvaluateResponse>('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    })
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text ?? 'Runtime evaluation failed.')
    return response.result.value as T
  }

  onEvent(listener: (method: string, params: unknown) => void): () => void {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  close(): void {
    this.socket.close()
  }

  private async handleMessage(data: unknown): Promise<void> {
    const message = JSON.parse(await websocketMessageText(data)) as CdpMessage
    if (typeof message.id === 'number') {
      const request = this.pending.get(message.id)
      if (!request) return
      clearTimeout(request.timer)
      this.pending.delete(message.id)
      if (message.error) request.reject(new Error(message.error.message))
      else request.resolve(message.result ?? {})
      return
    }
    if (message.method) this.eventListeners.forEach((listener) => listener(message.method!, message.params))
  }

  private rejectPending(error: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer)
      request.reject(error)
    }
    this.pending.clear()
  }
}

interface DebugTarget {
  title: string
  type: string
  url: string
  webSocketDebuggerUrl: string
}

interface CdpMessage {
  id?: number
  method?: string
  params?: unknown
  result?: unknown
  error?: { message: string }
}

interface RuntimeEvaluateResponse {
  result: { value?: unknown }
  exceptionDetails?: {
    text?: string
    exception?: { description?: string }
  }
}

function isErrorConsoleEvent(params: unknown): boolean {
  return typeof params === 'object' && params !== null && (params as { type?: string }).type === 'error'
}

function consoleMessage(params: unknown): string {
  const args = typeof params === 'object' && params !== null ? (params as { args?: Array<{ value?: unknown; description?: string }> }).args ?? [] : []
  return args.map((argument) => String(argument.value ?? argument.description ?? '')).join(' ')
}

function exceptionMessage(params: unknown): string {
  if (typeof params !== 'object' || params === null) return 'Renderer exception'
  const details = (params as { exceptionDetails?: { exception?: { description?: string }; text?: string } }).exceptionDetails
  return details?.exception?.description ?? details?.text ?? 'Renderer exception'
}

async function websocketMessageText(data: unknown): Promise<string> {
  if (typeof data === 'string') return data
  if (data instanceof Blob) return data.text()
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data)
  if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data)
  return String(data)
}

function waitForExit(child: ChildProcess, timeout: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true)
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off('exit', exited)
      resolve(false)
    }, timeout)
    const exited = (): void => {
      clearTimeout(timer)
      resolve(true)
    }
    child.once('exit', exited)
  })
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('Could not allocate a remote debugging port.'))
        return
      }
      server.close((error) => error ? reject(error) : resolve(address.port))
    })
  })
}

function appendOutput(current: string, chunk: Buffer): string {
  return `${current}${chunk.toString()}`.slice(-20_000)
}

function formatProcessOutput(child: ChildProcess, output: { stdout: string; stderr: string }): string {
  const details = [
    `\nProcess exitCode=${String(child.exitCode)} signal=${String(child.signalCode)}`,
    output.stdout.trim() ? `\nstdout:\n${output.stdout.trim()}` : '',
    output.stderr.trim() ? `\nstderr:\n${output.stderr.trim()}` : ''
  ]
  return details.join('')
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function deepQueryExpression(rootSelector: string, targetSelector: string): string {
  return `(() => {
    const visit = (root) => {
      const direct = root.querySelector(${JSON.stringify(targetSelector)})
      if (direct) return direct
      for (const element of root.querySelectorAll('*')) {
        if (element.shadowRoot) {
          const nested = visit(element.shadowRoot)
          if (nested) return nested
        }
      }
      return null
    }
    const root = document.querySelector(${JSON.stringify(rootSelector)})
    return root ? visit(root) : null
  })()`
}
