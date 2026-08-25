import { spawn } from 'node:child_process'
import { access, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { analyzeProject, findInstalledPackageJson } from './analyze.js'
import { buildWechatBundle } from './build.js'
import {
  manualChecklist,
  publishWechatProject,
  readPreservedAppid,
  writeConversionReport
} from './output.js'
import type {
  ConversionOptions,
  ConversionOutcome,
  ConversionReport,
  Diagnostic,
  Orientation
} from './types.js'

const REGISTERED_PHASER_VERSIONS = new Set(['4.0.0', '4.2.1'])

export async function convertProject(options: ConversionOptions): Promise<ConversionOutcome> {
  const projectRoot = path.resolve(options.project)
  const outputRoot = path.resolve(options.output ?? path.join(path.dirname(projectRoot), `${path.basename(projectRoot)}-wechat`))
  if (samePath(projectRoot, outputRoot)) throw new Error('Output directory must be different from the source project.')

  const dependencyDiagnostics = await ensureProjectDependencies(projectRoot, options.install, options.dryRun, options.json)
  const analysis = await analyzeProject(projectRoot)
  const width = options.width ?? analysis.inferredWidth ?? 720
  const height = options.height ?? analysis.inferredHeight ?? 1280
  const orientation: Orientation = options.orientation ?? (width > height ? 'landscape' : 'portrait')
  const appid = await readPreservedAppid(outputRoot, options.appid)
  const diagnostics: Diagnostic[] = [...dependencyDiagnostics, ...analysis.diagnostics]

  if (!REGISTERED_PHASER_VERSIONS.has(analysis.phaserVersion)) {
    diagnostics.push({
      code: 'UNREGISTERED_PHASER_VERSION',
      severity: 'warning',
      message: `Phaser ${analysis.phaserVersion} is not in the converter compatibility registry. The generic Phaser 4 patches will still be applied.`,
      runtimeImpact: true
    })
  }

  if (options.dryRun) {
    const report = createReport({
      analysis,
      outputRoot,
      width,
      height,
      orientation,
      appid,
      transformedGames: analysis.source.gameSites.length,
      generatedFiles: [],
      packageBytes: 0,
      diagnostics,
      dryRun: true
    })
    return { exitCode: reportExitCode(report), report }
  }

  const build = await buildWechatBundle(analysis, width, height, orientation)
  try {
    if (build.transformedGames !== analysis.source.gameSites.length) {
      diagnostics.push({
        code: 'GAME_TRANSFORM_COUNT_MISMATCH',
        severity: 'error',
        message: `Analysis found ${analysis.source.gameSites.length} Game creation(s), but the Vite build transformed ${build.transformedGames}.`,
        runtimeImpact: true
      })
    }
    const publish = await publishWechatProject(analysis, build, {
      outputRoot,
      width,
      height,
      orientation,
      explicitAppid: options.appid,
      force: options.force
    })
    diagnostics.push(...publish.diagnostics)
    const report = createReport({
      analysis,
      outputRoot,
      width,
      height,
      orientation,
      appid: publish.appid,
      transformedGames: build.transformedGames,
      generatedFiles: publish.generatedFiles,
      packageBytes: publish.packageBytes,
      diagnostics,
      dryRun: false
    })
    await writeConversionReport(outputRoot, report)
    await checkGeneratedSyntax(outputRoot)
    return { exitCode: reportExitCode(report), report }
  } finally {
    await rm(build.directory, { recursive: true, force: true }).catch(() => undefined)
  }
}

interface ReportInput {
  analysis: Awaited<ReturnType<typeof analyzeProject>>
  outputRoot: string
  width: number
  height: number
  orientation: Orientation
  appid: string
  transformedGames: number
  generatedFiles: string[]
  packageBytes: number
  diagnostics: Diagnostic[]
  dryRun: boolean
}

function createReport(input: ReportInput): ConversionReport {
  const runtimeErrors = input.diagnostics.some((diagnostic) => diagnostic.runtimeImpact && diagnostic.severity === 'error')
  const runnable = input.analysis.source.gameSites.length > 0
    && input.transformedGames === input.analysis.source.gameSites.length
    && !runtimeErrors
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceProject: input.analysis.projectRoot,
    outputProject: input.outputRoot,
    sourceEntry: path.relative(input.analysis.projectRoot, input.analysis.entryPath).split(path.sep).join('/'),
    phaserVersion: input.analysis.phaserVersion,
    runnable,
    dryRun: input.dryRun,
    width: input.width,
    height: input.height,
    orientation: input.orientation,
    appid: input.appid,
    gameCount: input.analysis.source.gameSites.length,
    transformedGameCount: input.transformedGames,
    generatedFiles: input.generatedFiles,
    packageBytes: input.packageBytes,
    diagnostics: input.diagnostics,
    manualChecklist: manualChecklist()
  }
}

function reportExitCode(report: ConversionReport): 0 | 2 {
  if (!report.runnable) return 2
  return report.diagnostics.some((diagnostic) => diagnostic.runtimeImpact && diagnostic.severity !== 'info') ? 2 : 0
}

async function ensureProjectDependencies(
  projectRoot: string,
  install: boolean,
  dryRun: boolean,
  jsonMode: boolean
): Promise<Diagnostic[]> {
  const packageJsonPath = path.join(projectRoot, 'package.json')
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8').catch(() => {
    throw new Error(`package.json not found: ${packageJsonPath}`)
  })) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
  const declared = [...new Set([
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.devDependencies ?? {})
  ])]
  const missing: string[] = []
  for (const packageName of declared) {
    if (!await findInstalledPackageJson(projectRoot, packageName)) missing.push(packageName)
  }
  if (missing.length === 0) return []

  if (dryRun) {
    return [{
      code: 'DEPENDENCIES_NOT_INSTALLED',
      severity: 'warning',
      message: `Dry run skipped installation of missing dependencies: ${missing.join(', ')}`,
      runtimeImpact: true
    }]
  }
  if (!install) throw new Error(`Missing project dependencies and --no-install was used: ${missing.join(', ')}`)

  const hasLock = await access(path.join(projectRoot, 'package-lock.json')).then(() => true, () => false)
  const args = hasLock ? ['ci'] : ['install', '--no-package-lock']
  await runCommand(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, projectRoot, jsonMode)
  for (const packageName of missing) {
    if (!await findInstalledPackageJson(projectRoot, packageName)) {
      throw new Error(`Dependency installation completed but ${packageName} is still unavailable.`)
    }
  }
  return []
}

async function checkGeneratedSyntax(outputRoot: string): Promise<void> {
  const node = process.execPath
  for (const relative of [
    'game.js',
    'js/weapp-adapter.js',
    'js/phaser.js',
    'js/game.bundle.js'
  ]) {
    await runCommand(node, ['--check', path.join(outputRoot, relative)], outputRoot, true)
  }
}

function runCommand(command: string, args: string[], cwd: string, quiet: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      windowsHide: true,
      shell: false
    })
    let stderr = ''
    if (quiet) child.stderr?.on('data', (chunk) => { stderr += String(chunk) })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} ${args.join(' ')} failed with exit code ${code}.${stderr ? `\n${stderr.trim()}` : ''}`))
    })
  })
}

function samePath(left: string, right: string): boolean {
  return process.platform === 'win32'
    ? path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase()
    : path.resolve(left) === path.resolve(right)
}
