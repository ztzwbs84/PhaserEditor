import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createConnection } from 'node:net'
import type { LogEntry, RunConfiguration, RunSession } from '@phaser-editor/contracts'
import { AppError, resolveSpawnCommand } from './domain'
import { inspectProject, ProjectService } from './project-service'
import { parseCommandLine } from '../shared/command-line'

const ansiPattern = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g
const urlPattern = /(https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/[^\s]*)?)/i
const locationPattern = /((?:[A-Za-z]:)?[^\s:()]+\.(?:ts|tsx|js|jsx|json|md)):(\d+):(\d+)/

export class RunnerService {
  private child: ChildProcessWithoutNullStreams | null = null
  private stopPromise: Promise<RunSession> | null = null
  private config: RunConfiguration | undefined
  private session: RunSession = { id: randomUUID(), status: 'idle' }

  constructor(
    private readonly projectService: ProjectService,
    private readonly emitState: (session: RunSession) => void,
    private readonly emitLog: (entry: LogEntry) => void
  ) {}

  getState(): RunSession {
    return { ...this.session }
  }

  hasActiveProcess(): boolean {
    return this.child !== null
  }

  async start(config?: RunConfiguration): Promise<RunSession> {
    if (this.child) throw new AppError('CONFLICT', 'The project is already running.')
    const activeProject = this.projectService.activeProject
    if (!activeProject) throw new AppError('INVALID_INPUT', 'Open a project before starting it.')
    const project = await inspectProject(activeProject.path)
    if (!project.valid) throw new AppError('INVALID_INPUT', project.issue ?? 'The active project is no longer valid.')
    this.config = config
    const resolved = config ?? resolveDefaultRunConfiguration(project)
    const executable = windowsCommand(resolved.executable)
    const command = resolveSpawnCommand(executable, resolved.args)
    const cwd = resolved.cwd ?? project.path
    const configuredUrl = inferRunUrl(project, resolved)
    this.setState({ id: randomUUID(), status: 'starting', startedAt: new Date().toISOString() })
    this.log('info', `Starting ${resolved.executable} ${resolved.args.join(' ')} in ${cwd}`)

    try {
      const child = spawn(command.executable, command.args, {
        cwd,
        env: { ...process.env, ...resolved.env, FORCE_COLOR: '1' },
        windowsHide: true,
        detached: process.platform !== 'win32',
        shell: false
      })
      this.child = child
      this.setState({ ...this.session, pid: child.pid, status: 'starting' })
      pipeLines(child.stdout, (line) => this.handleOutput(line, 'info'))
      pipeLines(child.stderr, (line) => this.handleOutput(line, 'error'))
      child.once('spawn', () => {
        const sessionId = this.session.id
        this.setState({ ...this.session, status: 'running', message: 'Waiting for a preview URL...' })
        if (configuredUrl) void this.publishPreviewWhenReady(child, sessionId, configuredUrl)
      })
      child.once('error', (error) => {
        this.log('error', error.message)
        this.child = null
        this.setState({ ...this.session, status: 'error', message: error.message })
      })
      child.once('exit', (code) => {
        this.child = null
        const status = code === 0 || this.session.status === 'stopped' ? 'stopped' : 'error'
        this.setState({ ...this.session, status, stoppedAt: new Date().toISOString(), exitCode: code })
        this.log(status === 'error' ? 'error' : 'info', `Project process exited with code ${code ?? 'unknown'}.`)
      })
      return this.getState()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.log('error', message)
      this.child = null
      this.setState({ ...this.session, status: 'error', message })
      throw error
    }
  }

  async stop(): Promise<RunSession> {
    if (this.stopPromise) return this.stopPromise
    const operation = this.stopCurrentProcess()
    this.stopPromise = operation
    try {
      return await operation
    } finally {
      if (this.stopPromise === operation) this.stopPromise = null
    }
  }

  private async stopCurrentProcess(): Promise<RunSession> {
    if (!this.child?.pid) {
      this.setState({ ...this.session, status: 'stopped', stoppedAt: new Date().toISOString() })
      return this.getState()
    }
    const child = this.child
    const pid = this.child.pid
    this.setState({ ...this.session, message: 'Stopping process tree...' })
    await stopProcessTree(pid)
    if (this.child === child) this.child = null
    this.setState({ ...this.session, status: 'stopped', stoppedAt: new Date().toISOString(), message: 'Project process stopped.' })
    this.log('info', 'Project process stopped.')
    return this.getState()
  }

  async restart(config?: RunConfiguration): Promise<RunSession> {
    await this.stop()
    return this.start(config ?? this.config)
  }

  async sendInput(input: string): Promise<true> {
    if (!this.child || !this.child.stdin.writable) throw new AppError('CONFLICT', 'Start the project before sending console input.')
    const value = input.trimEnd()
    if (!value) throw new AppError('INVALID_INPUT', 'Console input cannot be empty.')
    if (value.length > 4_096) throw new AppError('INVALID_INPUT', 'Console input is limited to 4096 characters.')
    this.child.stdin.write(`${value}\n`)
    this.log('debug', `> ${value}`)
    return true
  }

  private handleOutput(raw: string, fallback: LogEntry['level']): void {
    const message = raw.replace(ansiPattern, '').trimEnd()
    if (!message) return
    const level = /\b(error|failed|exception)\b/i.test(message) ? 'error'
      : /\b(warn(?:ing)?)\b/i.test(message) ? 'warning'
        : fallback
    this.log(level, message)
    const match = message.match(urlPattern)
    if (match?.[1] && this.session.url !== match[1]) {
      this.setState({ ...this.session, status: 'running', url: match[1], message: 'Preview is ready.' })
    }
  }

  private async publishPreviewWhenReady(child: ChildProcessWithoutNullStreams, sessionId: string, url: string): Promise<void> {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (this.child !== child || this.session.id !== sessionId || this.session.url) return
      if (await canConnect(url)) {
        if (this.child === child && this.session.id === sessionId && !this.session.url) {
          this.setState({ ...this.session, status: 'running', url, message: 'Preview is ready.' })
        }
        return
      }
      await delay(250)
    }
    if (this.child === child && this.session.id === sessionId && !this.session.url) {
      this.setState({ ...this.session, message: `The process is running, but ${url} is not accepting connections.` })
      this.log('warning', `Preview server did not become ready at ${url}`)
    }
  }

  private log(level: LogEntry['level'], message: string): void {
    const location = message.match(locationPattern)
    this.emitLog({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      source: 'project',
      level,
      message,
      file: location?.[1],
      line: location?.[2] ? Number(location[2]) : undefined,
      column: location?.[3] ? Number(location[3]) : undefined
    })
  }

  private setState(session: RunSession): void {
    this.session = session
    this.emitState(this.getState())
  }
}

export function resolveDefaultRunConfiguration(project: NonNullable<ProjectService['activeProject']>): RunConfiguration {
  const script = ['start', 'dev', 'serve', 'preview'].find((candidate) => project.scripts[candidate])
  if (!script) {
    const available = Object.keys(project.scripts)
    throw new AppError(
      'INVALID_INPUT',
      available.length > 0
        ? `No runnable start, dev, serve, or preview script was found. Available scripts: ${available.join(', ')}.`
        : 'No npm scripts were found. Add a start or dev script, or save a custom run configuration in the Inspector.'
    )
  }
  return { executable: project.packageManager, args: ['run', script] }
}

function windowsCommand(executable: string): string {
  if (process.platform !== 'win32' || /\.[a-z0-9]+$/i.test(executable)) return executable
  return ['npm', 'pnpm', 'yarn'].includes(executable.toLocaleLowerCase()) ? `${executable}.cmd` : executable
}

export function inferLocalUrl(args: string[]): string | undefined {
  const port = optionValue(args, ['-p', '--port'])
  if (!port || !/^\d+$/.test(port)) return undefined
  const configuredHost = optionValue(args, ['-a', '--address', '--host']) ?? '127.0.0.1'
  const host = ['0.0.0.0', '::', '[::]'].includes(configuredHost) ? '127.0.0.1' : configuredHost
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) return undefined
  return `http://${host}:${port}/`
}

export function inferRunUrl(project: NonNullable<ProjectService['activeProject']>, config: RunConfiguration): string | undefined {
  const direct = inferLocalUrl(config.args)
  if (direct) return direct
  const scriptName = config.args[0] === 'run' ? config.args[1] : config.args[0]
  const script = scriptName ? project.scripts[scriptName] : undefined
  return script ? inferLocalUrl(parseCommandLine(script)) : undefined
}

function optionValue(args: string[], names: string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!
    if (names.includes(argument)) return args[index + 1]
    for (const name of names) {
      if (argument.startsWith(`${name}=`)) return argument.slice(name.length + 1)
    }
  }
  return undefined
}

function pipeLines(stream: NodeJS.ReadableStream, listener: (line: string) => void): void {
  let buffer = ''
  stream.on('data', (chunk: Buffer | string) => {
    buffer += chunk.toString()
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''
    lines.forEach(listener)
  })
  stream.on('end', () => { if (buffer) listener(buffer) })
}

function canConnect(value: string): Promise<boolean> {
  return new Promise((resolve) => {
    const url = new URL(value)
    const host = url.hostname.replace(/^\[|\]$/g, '')
    const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80))
    const socket = createConnection({ host, port })
    let settled = false
    const finish = (connected: boolean): void => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(connected)
    }
    socket.setTimeout(500)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function stopProcessTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      const killer = spawn('taskkill.exe', ['/pid', String(pid), '/t', '/f'], { windowsHide: true })
      let settled = false
      const finish = (): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        resolve()
      }
      const timeout = setTimeout(() => {
        killer.kill()
        finish()
      }, 10_000)
      killer.once('exit', finish)
      killer.once('error', finish)
    } else {
      try { process.kill(-pid, 'SIGTERM') } catch { /* The process may already be gone. */ }
      resolve()
    }
  })
}
