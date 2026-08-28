import { builtinModules } from 'node:module'
import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { BuildFailure, Message, Plugin } from 'esbuild'

type EsbuildModule = typeof import('esbuild')

const REVISION_PATTERN = /^[a-f0-9]{16}$/
const FORBIDDEN_MODULES = new Set([
  ...builtinModules.map((name) => name.replace(/^node:/, '')),
  'electron'
])

export interface ProjectPluginBuildDiagnostic {
  severity: 'info' | 'warning' | 'error'
  message: string
  file?: string
  line?: number
  column?: number
}

export interface ProjectPluginCompileRequest {
  instanceId: string
  projectRoot: string
  pluginRoot: string
  uiSource: string
  cacheMetadata?: unknown
  signal?: AbortSignal
}

export interface ProjectPluginCompileResult {
  revision: string
  outputRoot: string
  entryPath: string
  cssPaths: string[]
  inputs: string[]
  diagnostics: ProjectPluginBuildDiagnostic[]
  reused: boolean
}

export interface ProjectPluginCachedBuild {
  compileResult: ProjectPluginCompileResult
  cacheMetadata?: unknown
  identity: ProjectPluginCacheIdentity
}

export interface ProjectPluginCacheIdentity {
  projectRoot: string
  pluginRoot: string
  uiSource: string
  sourcePath: string
}

interface CompileCacheMetadata extends ProjectPluginCacheIdentity {
  version: 1
  revision: string
  entryPath: string
  cssPaths: string[]
  inputs: Array<{ path: string; hash: string }>
  diagnostics: ProjectPluginBuildDiagnostic[]
  cacheMetadata?: unknown
}

export class ProjectPluginCompileError extends Error {
  constructor(
    message: string,
    public readonly diagnostics: ProjectPluginBuildDiagnostic[]
  ) {
    super(message)
  }
}

export class ProjectPluginCompileAbortedError extends Error {
  constructor() {
    super('Project plugin compilation was aborted.')
    this.name = 'AbortError'
  }
}

export function configureProjectPluginEsbuildBinary(
  isPackaged: boolean,
  resourcesPath: string,
  platform: NodeJS.Platform = process.platform
): string | undefined {
  if (!isPackaged || platform !== 'win32') return undefined
  const binaryPath = path.join(resourcesPath, 'esbuild', 'esbuild.exe')
  process.env.ESBUILD_BINARY_PATH = binaryPath
  return binaryPath
}

export class ProjectPluginCompiler {
  constructor(private readonly cacheRoot: string) {}

  async compile(request: ProjectPluginCompileRequest): Promise<ProjectPluginCompileResult> {
    throwIfCompilationAborted(request.signal)
    const [projectRoot, pluginRoot] = await Promise.all([
      fs.realpath(request.projectRoot),
      fs.realpath(request.pluginRoot)
    ])
    throwIfCompilationAborted(request.signal)
    assertInside(projectRoot, pluginRoot, 'Plugin directory is outside the active project.')

    const sourcePath = await fs.realpath(path.resolve(pluginRoot, request.uiSource))
    throwIfCompilationAborted(request.signal)
    assertInside(projectRoot, sourcePath, 'Plugin UI source is outside the active project.')
    assertInside(pluginRoot, sourcePath, 'Plugin UI source is outside the plugin directory.')
    if (!(await fs.stat(sourcePath)).isFile()) {
      throw new ProjectPluginCompileError('Plugin UI source is not a file.', [
        { severity: 'error', message: 'Plugin UI source is not a file.', file: sourcePath }
      ])
    }
    const uiSource = normalizeIdentityRelativePath(pluginRoot, sourcePath)
    throwIfCompilationAborted(request.signal)

    await fs.mkdir(this.cacheRoot, { recursive: true })
    const instanceRoot = this.instanceCacheRoot(request.instanceId)
    const cached = await this.readCacheMetadata(instanceRoot)
    if (cached
      && cached.projectRoot === projectRoot
      && cached.pluginRoot === pluginRoot
      && cached.uiSource === uiSource
      && cached.sourcePath === sourcePath
      && await cacheInputsMatch(cached.inputs, request.signal)) {
      throwIfCompilationAborted(request.signal)
      const cachedBuild = await this.cachedBuild(instanceRoot, cached)
      if (cachedBuild) {
        if (request.cacheMetadata !== undefined) {
          await this.writeCacheMetadata(instanceRoot, { ...cached, cacheMetadata: request.cacheMetadata }, request.signal)
        } else throwIfCompilationAborted(request.signal)
        return { ...cachedBuild.compileResult, reused: true }
      }
    }

    const virtualOutdir = path.join(this.cacheRoot, '.build-output')
    let result: Awaited<ReturnType<EsbuildModule['build']>>
    let buildContext: Awaited<ReturnType<EsbuildModule['context']>> | null = null
    let abortListener: (() => void) | null = null
    try {
      const { context } = await import('esbuild')
      throwIfCompilationAborted(request.signal)
      buildContext = await context({
        absWorkingDir: projectRoot,
        entryPoints: { ui: sourcePath },
        outdir: virtualOutdir,
        entryNames: '[name]',
        chunkNames: 'chunks/[name]-[hash]',
        assetNames: 'assets/[name]-[hash]',
        bundle: true,
        splitting: true,
        write: false,
        metafile: true,
        format: 'esm',
        platform: 'browser',
        target: 'es2022',
        jsx: 'automatic',
        charset: 'utf8',
        legalComments: 'none',
        logLevel: 'silent',
        loader: {
          '.png': 'file',
          '.jpg': 'file',
          '.jpeg': 'file',
          '.gif': 'file',
          '.webp': 'file',
          '.svg': 'file',
          '.woff': 'file',
          '.woff2': 'file',
          '.ttf': 'file',
          '.otf': 'file',
          '.wasm': 'file'
        },
        plugins: [projectBoundaryPlugin(projectRoot)]
      })
      const activeContext = buildContext
      abortListener = () => { void activeContext.cancel() }
      request.signal?.addEventListener('abort', abortListener, { once: true })
      if (request.signal?.aborted) await activeContext.cancel()
      throwIfCompilationAborted(request.signal)
      result = await activeContext.rebuild()
      throwIfCompilationAborted(request.signal)
    } catch (error) {
      if (request.signal?.aborted || error instanceof ProjectPluginCompileAbortedError) {
        throw error instanceof ProjectPluginCompileAbortedError ? error : new ProjectPluginCompileAbortedError()
      }
      const diagnostics = compileDiagnostics(error)
      throw new ProjectPluginCompileError(
        diagnostics[0]?.message ?? 'Plugin UI compilation failed.',
        diagnostics
      )
    } finally {
      if (abortListener) request.signal?.removeEventListener('abort', abortListener)
      await buildContext?.dispose().catch(() => undefined)
    }

    throwIfCompilationAborted(request.signal)
    const outputFiles = [...(result.outputFiles ?? [])].sort((left, right) => left.path.localeCompare(right.path))
    const entry = outputFiles.find((file) => normalizeRelativeOutput(virtualOutdir, file.path) === 'ui.js')
    if (!entry) {
      throw new ProjectPluginCompileError('Plugin UI build did not produce ui.js.', [
        { severity: 'error', message: 'Plugin UI build did not produce ui.js.', file: sourcePath }
      ])
    }

    const revisionHash = createHash('sha256')
    for (const file of outputFiles) {
      revisionHash.update(normalizeRelativeOutput(virtualOutdir, file.path))
      revisionHash.update('\0')
      revisionHash.update(file.contents)
      revisionHash.update('\0')
    }
    const revision = revisionHash.digest('hex').slice(0, 16)
    const outputRoot = path.join(instanceRoot, revision)
    const reused = await pathExists(outputRoot)

    const cssPaths = outputFiles
      .map((file) => normalizeRelativeOutput(virtualOutdir, file.path))
      .filter((filePath) => filePath.endsWith('.css'))
    const inputs = await Promise.all(Object.keys(result.metafile?.inputs ?? {}).map(async (input) => {
      const absolutePath = path.isAbsolute(input) ? input : path.resolve(projectRoot, input)
      return fs.realpath(absolutePath).catch(() => absolutePath)
    }))
    for (const configurationFile of [path.join(projectRoot, 'tsconfig.json'), path.join(projectRoot, 'package.json')]) {
      if (await pathExists(configurationFile)) inputs.push(await fs.realpath(configurationFile).catch(() => configurationFile))
    }
    const uniqueInputs = [...new Set(inputs)]
    const diagnostics = (result.warnings ?? []).map((warning) => messageDiagnostic('warning', warning))
    const compileResult = {
      revision,
      outputRoot,
      entryPath: 'ui.js',
      cssPaths,
      inputs: uniqueInputs,
      diagnostics,
      reused
    }
    const inputMetadata = await Promise.all(uniqueInputs.map(async (input) => ({ path: input, hash: await fileHash(input) })))
    throwIfCompilationAborted(request.signal)

    let publishedNewOutput = false
    if (!reused) {
      const temporaryRoot = path.join(instanceRoot, `.${revision}-${randomUUID()}.tmp`)
      await fs.mkdir(temporaryRoot, { recursive: true })
      try {
        for (const file of outputFiles) {
          throwIfCompilationAborted(request.signal)
          const relativePath = normalizeRelativeOutput(virtualOutdir, file.path)
          const destination = path.resolve(temporaryRoot, ...relativePath.split('/'))
          assertInside(temporaryRoot, destination, 'Plugin compiler produced an invalid output path.')
          await fs.mkdir(path.dirname(destination), { recursive: true })
          await fs.writeFile(destination, file.contents)
        }
        await fs.mkdir(instanceRoot, { recursive: true })
        throwIfCompilationAborted(request.signal)
        await fs.rename(temporaryRoot, outputRoot)
        publishedNewOutput = true
      } catch (error) {
        await safeRemove(this.cacheRoot, temporaryRoot)
        if (error instanceof ProjectPluginCompileAbortedError) throw error
        if (!await pathExists(outputRoot)) throw error
      }
    }

    try {
      await this.writeCacheMetadata(instanceRoot, {
        version: 1,
        projectRoot,
        pluginRoot,
        uiSource,
        sourcePath,
        revision,
        entryPath: compileResult.entryPath,
        cssPaths,
        inputs: inputMetadata,
        diagnostics,
        cacheMetadata: request.cacheMetadata
      }, request.signal)
    } catch (error) {
      if (publishedNewOutput) await safeRemove(this.cacheRoot, outputRoot).catch(() => undefined)
      throw error
    }

    const now = new Date()
    await fs.utimes(outputRoot, now, now).catch(() => undefined)
    await this.retainRecentRevisions(instanceRoot, revision)
    return compileResult
  }

  async loadLastGood(instanceId: string): Promise<ProjectPluginCachedBuild | null> {
    const instanceRoot = this.instanceCacheRoot(instanceId)
    const metadata = await this.readCacheMetadata(instanceRoot)
    if (!metadata) return null
    return this.cachedBuild(instanceRoot, metadata)
  }

  async resolveOutput(instanceId: string, revision: string, relativePath: string): Promise<string | null> {
    if (!REVISION_PATTERN.test(revision) || !isSafeRelativePath(relativePath)) return null
    const revisionRoot = path.join(this.instanceCacheRoot(instanceId), revision)
    const candidate = path.resolve(revisionRoot, ...relativePath.replaceAll('\\', '/').split('/'))
    if (!isPathInside(revisionRoot, candidate)) return null
    try {
      const [realRoot, realCandidate] = await Promise.all([fs.realpath(revisionRoot), fs.realpath(candidate)])
      if (!isPathInside(realRoot, realCandidate)) return null
      return (await fs.stat(realCandidate)).isFile() ? realCandidate : null
    } catch {
      return null
    }
  }

  async disposeInstance(instanceId: string): Promise<void> {
    await safeRemove(this.cacheRoot, this.instanceCacheRoot(instanceId))
  }

  private instanceCacheRoot(instanceId: string): string {
    const projectInstance = /^project:([a-f0-9]{3,64}):([a-z0-9][a-z0-9.-]+)$/.exec(instanceId)
    if (projectInstance) return path.join(this.cacheRoot, projectInstance[1]!, projectInstance[2]!)
    const key = createHash('sha256').update(instanceId).digest('hex').slice(0, 24)
    return path.join(this.cacheRoot, key)
  }

  private async cachedBuild(instanceRoot: string, metadata: CompileCacheMetadata): Promise<ProjectPluginCachedBuild | null> {
    const outputRoot = path.join(instanceRoot, metadata.revision)
    if (!await pathExists(path.join(outputRoot, metadata.entryPath))) return null
    if (!(await Promise.all(metadata.cssPaths.map((cssPath) => pathExists(path.join(outputRoot, cssPath))))).every(Boolean)) return null
    return {
      compileResult: {
        revision: metadata.revision,
        outputRoot,
        entryPath: metadata.entryPath,
        cssPaths: metadata.cssPaths,
        inputs: metadata.inputs.map((input) => input.path),
        diagnostics: metadata.diagnostics,
        reused: true
      },
      cacheMetadata: metadata.cacheMetadata,
      identity: {
        projectRoot: metadata.projectRoot,
        pluginRoot: metadata.pluginRoot,
        uiSource: metadata.uiSource,
        sourcePath: metadata.sourcePath
      }
    }
  }

  private async readCacheMetadata(instanceRoot: string): Promise<CompileCacheMetadata | null> {
    try {
      const value = JSON.parse(await fs.readFile(path.join(instanceRoot, 'current.json'), 'utf8')) as Partial<CompileCacheMetadata>
      if (value.version !== 1
        || typeof value.projectRoot !== 'string'
        || typeof value.pluginRoot !== 'string'
        || typeof value.uiSource !== 'string'
        || typeof value.sourcePath !== 'string'
        || typeof value.revision !== 'string'
        || !REVISION_PATTERN.test(value.revision)
        || typeof value.entryPath !== 'string'
        || !Array.isArray(value.cssPaths)
        || !Array.isArray(value.inputs)
        || !Array.isArray(value.diagnostics)) return null
      if (!path.isAbsolute(value.projectRoot)
        || !path.isAbsolute(value.pluginRoot)
        || !path.isAbsolute(value.sourcePath)
        || !isSafeRelativePath(value.uiSource)
        || !isSafeRelativePath(value.entryPath)
        || !value.cssPaths.every((cssPath) => typeof cssPath === 'string' && isSafeRelativePath(cssPath))) return null
      if (!value.inputs.every((input) => input && typeof input.path === 'string' && typeof input.hash === 'string')) return null
      return value as CompileCacheMetadata
    } catch {
      return null
    }
  }

  private async writeCacheMetadata(instanceRoot: string, metadata: CompileCacheMetadata, signal?: AbortSignal): Promise<void> {
    await fs.mkdir(instanceRoot, { recursive: true })
    const destination = path.join(instanceRoot, 'current.json')
    const temporary = path.join(instanceRoot, `.current-${randomUUID()}.tmp`)
    try {
      await fs.writeFile(temporary, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')
      throwIfCompilationAborted(signal)
      await fs.rename(temporary, destination)
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => undefined)
    }
  }

  private async retainRecentRevisions(instanceRoot: string, currentRevision: string): Promise<void> {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(instanceRoot, { withFileTypes: true })
    } catch {
      return
    }
    const revisions = await Promise.all(entries
      .filter((entry) => entry.isDirectory() && REVISION_PATTERN.test(entry.name))
      .map(async (entry) => ({
        name: entry.name,
        modifiedAt: (await fs.stat(path.join(instanceRoot, entry.name))).mtimeMs
      })))
    revisions.sort((left, right) => {
      if (left.name === currentRevision) return -1
      if (right.name === currentRevision) return 1
      return right.modifiedAt - left.modifiedAt || left.name.localeCompare(right.name)
    })
    for (const revision of revisions.slice(2)) {
      await safeRemove(this.cacheRoot, path.join(instanceRoot, revision.name))
    }
  }
}

function projectBoundaryPlugin(projectRoot: string): Plugin {
  const realpathCache = new Map<string, Promise<string>>()
  const cachedRealpath = (candidate: string): Promise<string> => {
    const resolved = path.resolve(candidate)
    const key = process.platform === 'win32' ? resolved.toLocaleLowerCase() : resolved
    let pending = realpathCache.get(key)
    if (!pending) {
      pending = fs.realpath(resolved)
      realpathCache.set(key, pending)
    }
    return pending
  }

  return {
    name: 'phaser-editor-project-plugin-boundary',
    setup(pluginBuild) {
      pluginBuild.onResolve({ filter: /.*/ }, (args) => {
        if (isForbiddenModule(args.path)) {
          return { errors: [{ text: `Project editor plugins cannot import Node or Electron module ${JSON.stringify(args.path)}.` }] }
        }
        return undefined
      })
      pluginBuild.onLoad({ filter: /.*/, namespace: 'file' }, async (args) => {
        let realPath: string
        try {
          realPath = await cachedRealpath(args.path)
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error)
          return { errors: [{ text: `Project plugin file could not be resolved securely: ${args.path}: ${reason}` }] }
        }
        if (!isPathInside(projectRoot, realPath)) {
          return { errors: [{ text: `Plugin import resolves outside the active project: ${args.path}` }] }
        }
        return undefined
      })
    }
  }
}

function isForbiddenModule(specifier: string): boolean {
  const normalized = specifier.replace(/^node:/, '')
  const root = normalized.split('/')[0] ?? normalized
  return FORBIDDEN_MODULES.has(normalized) || FORBIDDEN_MODULES.has(root)
}

function compileDiagnostics(error: unknown): ProjectPluginBuildDiagnostic[] {
  const failure = error as Partial<BuildFailure>
  const errors = Array.isArray(failure.errors) ? failure.errors : []
  const warnings = Array.isArray(failure.warnings) ? failure.warnings : []
  const diagnostics = [
    ...errors.map((message) => messageDiagnostic('error', message)),
    ...warnings.map((message) => messageDiagnostic('warning', message))
  ]
  if (diagnostics.length > 0) return diagnostics
  return [{ severity: 'error', message: error instanceof Error ? error.message : String(error) }]
}

function messageDiagnostic(severity: ProjectPluginBuildDiagnostic['severity'], message: Message): ProjectPluginBuildDiagnostic {
  return {
    severity,
    message: message.text,
    file: message.location?.file || undefined,
    line: message.location?.line,
    column: message.location ? message.location.column + 1 : undefined
  }
}

function normalizeRelativeOutput(outdir: string, filePath: string): string {
  const relativePath = path.relative(outdir, filePath).replaceAll('\\', '/')
  if (!isSafeRelativePath(relativePath)) throw new Error(`Plugin compiler produced an invalid output path: ${filePath}`)
  return relativePath
}

function normalizeIdentityRelativePath(root: string, filePath: string): string {
  const relativePath = path.relative(root, filePath).replaceAll('\\', '/')
  if (!isSafeRelativePath(relativePath)) {
    throw new ProjectPluginCompileError('Plugin UI source is outside the plugin directory.', [
      { severity: 'error', message: 'Plugin UI source is outside the plugin directory.', file: filePath }
    ])
  }
  return relativePath
}

function isSafeRelativePath(relativePath: string): boolean {
  if (!relativePath || relativePath.includes('\0') || path.isAbsolute(relativePath)) return false
  const normalized = relativePath.replaceAll('\\', '/')
  return !normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..')
}

function assertInside(root: string, candidate: string, message: string): void {
  if (!isPathInside(root, candidate)) throw new ProjectPluginCompileError(message, [{ severity: 'error', message, file: candidate }])
}

function isPathInside(root: string, candidate: string): boolean {
  const relativePath = path.relative(root, candidate)
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
}

async function safeRemove(root: string, target: string): Promise<void> {
  const resolvedRoot = path.resolve(root)
  const resolvedTarget = path.resolve(target)
  if (resolvedTarget === resolvedRoot || !isPathInside(resolvedRoot, resolvedTarget)) {
    throw new Error(`Refusing to remove path outside the plugin cache: ${resolvedTarget}`)
  }
  await fs.rm(resolvedTarget, { recursive: true, force: true })
}

async function cacheInputsMatch(inputs: Array<{ path: string; hash: string }>, signal?: AbortSignal): Promise<boolean> {
  throwIfCompilationAborted(signal)
  if (inputs.length === 0) return false
  const current = await Promise.all(inputs.map(async (input) => {
    try {
      return await fileHash(input.path) === input.hash
    } catch {
      return false
    }
  }))
  throwIfCompilationAborted(signal)
  return current.every(Boolean)
}

function throwIfCompilationAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ProjectPluginCompileAbortedError()
}

async function fileHash(filePath: string): Promise<string> {
  return createHash('sha256').update(await fs.readFile(filePath)).digest('hex')
}

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await fs.access(candidate)
    return true
  } catch {
    return false
  }
}
