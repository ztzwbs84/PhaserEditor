import { promises as fs } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import type { ProjectCreateRequest, ProjectDescriptor } from '@phaser-editor/contracts'
import { projectCreateRequestSchema } from '@phaser-editor/contracts'
import { AppError, detectPackageManager, resolveSpawnCommand } from './domain'
import { ConfigStore } from './config-store'
import { toPackageName } from '../shared/project-name'

interface PackageJson {
  name?: string
  description?: string
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

type PackageManager = ProjectDescriptor['packageManager']
type DependencyInstaller = (cwd: string, packageManager: PackageManager) => Promise<void>

export class ProjectService {
  private active: ProjectDescriptor | null = null

  constructor(
    private readonly store: ConfigStore,
    private readonly templateRoot: string,
    private readonly installDependencies: DependencyInstaller = runInstall
  ) {}

  get activeProject(): ProjectDescriptor | null {
    return this.active
  }

  listRecent(): ProjectDescriptor[] {
    return this.store.get().recentProjects
  }

  close(): true {
    this.active = null
    return true
  }

  async removeRecent(projectPath: string): Promise<ProjectDescriptor[]> {
    const recentProjects = this.store.get().recentProjects.filter((project) => project.path !== projectPath)
    await this.store.update({ recentProjects })
    return recentProjects
  }

  async open(projectPath: string): Promise<ProjectDescriptor> {
    const descriptor = await inspectProject(projectPath)
    if (!descriptor.valid) {
      throw new AppError('INVALID_INPUT', descriptor.issue ?? 'This folder is not a Phaser project.')
    }
    this.active = descriptor
    const recent = this.store.get().recentProjects.filter((item) => item.path !== descriptor.path)
    recent.unshift(descriptor)
    await this.store.update({ recentProjects: recent.slice(0, 30) })
    return descriptor
  }

  async create(input: ProjectCreateRequest): Promise<ProjectDescriptor> {
    const request = projectCreateRequestSchema.parse(input)
    const target = path.resolve(request.targetDirectory)
    await ensureTargetReady(target)

    await fs.mkdir(target, { recursive: true })
    try {
      await copyTemplate(this.templateRoot, target, request.name)
    } catch (error) {
      await fs.rm(target, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }

    let installIssue: string | undefined
    try {
      await this.installDependencies(target, 'npm')
      await clearInstallError(target)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await fs.writeFile(path.join(target, '.phaser-editor-install-error.log'), message, 'utf8')
      installIssue = 'The project was created, but dependency installation failed. Run npm install from the project directory to repair it.'
    }
    const descriptor = await this.open(target)
    return installIssue ? { ...descriptor, issue: installIssue } : descriptor
  }

  async ensureDependenciesInstalled(projectPath: string, onInstall?: (packageManager: PackageManager) => void): Promise<boolean> {
    const root = path.resolve(projectPath)
    if (!await needsDependencyInstall(root)) return false
    const packageManager = detectPackageManager(root)
    onInstall?.(packageManager)
    await this.installDependencies(root, packageManager)
    await clearInstallError(root)
    return true
  }
}

export async function inspectProject(projectPath: string): Promise<ProjectDescriptor> {
  const root = path.resolve(projectPath)
  const packagePath = path.join(root, 'package.json')
  let packageJson: PackageJson
  try {
    packageJson = JSON.parse(await fs.readFile(packagePath, 'utf8')) as PackageJson
  } catch (error) {
    return {
      name: path.basename(root),
      path: root,
      phaserVersion: null,
      packageManager: 'npm',
      scripts: {},
      dependencies: {},
      folders: [],
      lastOpenedAt: new Date().toISOString(),
      valid: false,
      issue: (error as NodeJS.ErrnoException).code === 'ENOENT'
        ? 'package.json was not found in the selected folder.'
        : 'package.json is not valid JSON.'
    }
  }

  const dependencies = { ...packageJson.devDependencies, ...packageJson.dependencies }
  const phaserVersion = dependencies.phaser ?? await detectPhaserVersion(root, packageJson)
  const folders: string[] = []
  for (const folder of ['src', 'public', 'assets']) {
    try {
      if ((await fs.stat(path.join(root, folder))).isDirectory()) folders.push(folder)
    } catch {
      // Optional Phaser project convention.
    }
  }

  return {
    name: packageJson.name ?? path.basename(root),
    path: root,
    phaserVersion,
    packageManager: detectPackageManager(root),
    scripts: packageJson.scripts ?? {},
    dependencies,
    folders,
    lastOpenedAt: new Date().toISOString(),
    valid: phaserVersion !== null,
    issue: phaserVersion === null ? 'The project does not declare Phaser in dependencies.' : undefined
  }
}

async function detectPhaserVersion(root: string, packageJson: PackageJson): Promise<string | null> {
  const candidates = [
    path.join(root, 'README.md'),
    path.join(root, 'readme.md'),
    path.join(root, 'index.html'),
    path.join(root, 'public', 'index.html')
  ]
  for (const candidate of candidates) {
    try {
      const content = await fs.readFile(candidate, 'utf8')
      const match = content.match(/\bPhaser\s*(?:v(?:ersion)?\s*)?(\d+(?:\.\d+){0,2})\b/i)
      if (match?.[1]) return match[1]
      if (/\bPhaser\b/i.test(content)) return 'Detected'
    } catch {
      // Marker files are optional.
    }
  }
  const packageMarker = `${packageJson.name ?? ''} ${packageJson.description ?? ''}`
  if (/\bphaser\b|phaser[-_ ]?\d/i.test(packageMarker)) {
    return packageMarker.match(/phaser[-_ ]?(\d+(?:\.\d+){0,2})/i)?.[1] ?? 'Detected'
  }
  return null
}

async function ensureTargetReady(target: string): Promise<void> {
  try {
    const stat = await fs.stat(target)
    if (!stat.isDirectory()) throw new AppError('CONFLICT', 'The target path is an existing file.')
    const children = await fs.readdir(target)
    if (children.length > 0) throw new AppError('CONFLICT', 'The target directory must be empty.')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const parent = path.dirname(target)
    await fs.access(parent, fs.constants.W_OK).catch(() => {
      throw new AppError('ACCESS_DENIED', 'The parent directory is not writable.')
    })
  }
}

async function copyTemplate(source: string, destination: string, projectName: string): Promise<void> {
  await fs.access(source)
  await fs.cp(source, destination, { recursive: true, force: false })
  const packagePath = path.join(destination, 'package.json')
  const packageJson = JSON.parse(await fs.readFile(packagePath, 'utf8')) as PackageJson
  packageJson.name = toPackageName(projectName)
  await fs.writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8')
  const readmePath = path.join(destination, 'README.md')
  const readme = await fs.readFile(readmePath, 'utf8')
  await fs.writeFile(readmePath, readme.replaceAll('__PROJECT_NAME__', projectName), 'utf8')
}

export async function needsDependencyInstall(root: string): Promise<boolean> {
  let packageJson: PackageJson
  try {
    packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')) as PackageJson
  } catch {
    return true
  }

  const dependencies = Object.keys({ ...packageJson.devDependencies, ...packageJson.dependencies })
  if (dependencies.length === 0) return false

  if (await pathExists(path.join(root, '.pnp.cjs')) || await pathExists(path.join(root, '.pnp.js'))) {
    return false
  }
  if (!await pathExists(path.join(root, 'node_modules'))) return true

  const installed = await Promise.all(dependencies.map((name) => pathExists(path.join(root, 'node_modules', ...name.split('/')))))
  return installed.some((exists) => !exists)
}

function runInstall(cwd: string, packageManager: PackageManager): Promise<void> {
  return new Promise((resolve, reject) => {
    const executable = process.platform === 'win32' && packageManager !== 'bun' ? `${packageManager}.cmd` : packageManager
    const args = packageManager === 'npm' ? ['install', '--no-audit', '--no-fund'] : ['install']
    const command = resolveSpawnCommand(executable, args)
    const child = spawn(command.executable, command.args, { cwd, windowsHide: true })
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new AppError('PROCESS_FAILED', `Dependency installation failed with ${packageManager}.`, stderr))
    })
  })
}

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await fs.access(candidate)
    return true
  } catch {
    return false
  }
}

async function clearInstallError(root: string): Promise<void> {
  await fs.rm(path.join(root, '.phaser-editor-install-error.log'), { force: true }).catch(() => undefined)
}
