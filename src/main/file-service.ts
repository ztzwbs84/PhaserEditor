import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { watch, type FSWatcher } from 'chokidar'
import type { FileChangeEvent, FileChangeKind, FileEntry, FileSnapshot } from '@phaser-editor/contracts'
import { shell } from 'electron'
import { AppError, isPathInside, toFileEntry } from './domain'

export class FileService {
  private watcher: FSWatcher | null = null
  private readonly watchedDirectories = new Set<string>()

  constructor(
    private readonly getRoot: () => string | null,
    private readonly emitChange: (event: FileChangeEvent) => void = () => undefined
  ) {}

  async watchProject(projectPath: string): Promise<void> {
    await this.disposeWatcher()
    const root = path.resolve(projectPath)
    const watcher = watch(root, {
      ignoreInitial: true,
      depth: 0,
      ignored: /(^|[\\/])(node_modules|\.git|dist|out)([\\/]|$)/,
      awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 30 }
    })
    this.watcher = watcher
    this.watchedDirectories.add(root)
    const forward = (kind: FileChangeKind) => (changedPath: string): void => {
      if (this.watcher === watcher) this.emitChange({ kind, path: path.resolve(changedPath) })
    }
    watcher.on('add', forward('add'))
    watcher.on('change', forward('change'))
    watcher.on('unlink', forward('unlink'))
    watcher.on('addDir', forward('addDir'))
    watcher.on('unlinkDir', forward('unlinkDir'))
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const timeout = setTimeout(() => {
        settled = true
        resolve()
      }, 250)
      watcher.once('ready', () => {
        clearTimeout(timeout)
        settled = true
        resolve()
      })
      watcher.once('error', (error) => {
        clearTimeout(timeout)
        if (!settled) reject(error)
      })
    })
  }

  async dispose(): Promise<void> {
    await this.disposeWatcher()
  }

  contains(candidate: string): boolean {
    const root = this.getRoot()
    return root !== null && isPathInside(root, candidate)
  }

  async list(requestedPath?: string): Promise<FileEntry[]> {
    const root = this.requireRoot()
    const directory = this.guard(requestedPath ?? root)
    this.watchDirectory(directory)
    const entries = await fs.readdir(directory, { withFileTypes: true })
    const result = await Promise.all(entries.map(async (entry) => {
      const fullPath = path.join(directory, entry.name)
      return toFileEntry(root, fullPath, await fs.stat(fullPath))
    }))
    return result.sort((a, b) => Number(b.kind === 'directory') - Number(a.kind === 'directory') || a.name.localeCompare(b.name))
  }

  async search(query: string): Promise<FileEntry[]> {
    const root = this.requireRoot()
    const normalizedQuery = query.trim().toLocaleLowerCase()
    if (!normalizedQuery) return []
    const matches: FileEntry[] = []
    const visit = async (directory: string): Promise<void> => {
      if (matches.length >= 500) return
      let children: import('node:fs').Dirent[]
      try {
        children = await fs.readdir(directory, { withFileTypes: true })
      } catch {
        return
      }
      for (const child of children) {
        if (matches.length >= 500 || child.isSymbolicLink()) break
        const fullPath = path.join(directory, child.name)
        if (child.name.toLocaleLowerCase().includes(normalizedQuery)) {
          matches.push(toFileEntry(root, fullPath, await fs.stat(fullPath)))
        }
        if (child.isDirectory() && !['node_modules', '.git', 'out', 'dist'].includes(child.name)) {
          await visit(fullPath)
        }
      }
    }
    await visit(root)
    return matches
  }

  async read(filePath: string): Promise<FileSnapshot> {
    const guarded = this.guard(filePath)
    const stat = await fs.stat(guarded)
    if (!stat.isFile()) throw new AppError('INVALID_INPUT', 'The selected path is not a file.')
    if (stat.size > 10 * 1024 * 1024) throw new AppError('UNSUPPORTED', 'Text files larger than 10 MB are not supported and were not opened.')
    return {
      path: guarded,
      content: await fs.readFile(guarded, 'utf8'),
      modifiedAt: stat.mtimeMs,
      size: stat.size,
      encoding: 'utf8'
    }
  }

  async write(filePath: string, content: string, expectedModifiedAt?: number): Promise<FileSnapshot> {
    const guarded = this.guard(filePath)
    const current = await fs.stat(guarded)
    if (expectedModifiedAt !== undefined && Math.abs(current.mtimeMs - expectedModifiedAt) > 1) {
      throw new AppError('CONFLICT', 'The file changed on disk. Reload it before saving or explicitly overwrite it.')
    }
    const temporary = path.join(path.dirname(guarded), `.${path.basename(guarded)}.${randomUUID()}.tmp`)
    await fs.writeFile(temporary, content, 'utf8')
    await fs.rename(temporary, guarded)
    return this.read(guarded)
  }

  async createFile(parent: string, name: string): Promise<FileEntry> {
    validateName(name)
    const root = this.requireRoot()
    const target = this.guard(path.join(parent, name))
    await fs.writeFile(target, '', { encoding: 'utf8', flag: 'wx' })
    return toFileEntry(root, target, await fs.stat(target))
  }

  async createDirectory(parent: string, name: string): Promise<FileEntry> {
    validateName(name)
    const root = this.requireRoot()
    const target = this.guard(path.join(parent, name))
    await fs.mkdir(target, { recursive: false })
    return toFileEntry(root, target, await fs.stat(target))
  }

  async rename(source: string, name: string): Promise<FileEntry> {
    validateName(name)
    const root = this.requireRoot()
    const guarded = this.guard(source)
    const target = this.guard(path.join(path.dirname(guarded), name))
    await ensureMissing(target)
    await fs.rename(guarded, target)
    return toFileEntry(root, target, await fs.stat(target))
  }

  async copy(source: string, destinationDirectory: string): Promise<FileEntry> {
    const root = this.requireRoot()
    const guardedSource = this.guard(source)
    const destination = this.guard(path.join(destinationDirectory, path.basename(guardedSource)))
    await ensureMissing(destination)
    await fs.cp(guardedSource, destination, { recursive: true, errorOnExist: true })
    return toFileEntry(root, destination, await fs.stat(destination))
  }

  async move(source: string, destinationDirectory: string): Promise<FileEntry> {
    const root = this.requireRoot()
    const guardedSource = this.guard(source)
    const destination = this.guard(path.join(destinationDirectory, path.basename(guardedSource)))
    if (isPathInside(guardedSource, destination)) throw new AppError('INVALID_INPUT', 'A folder cannot be moved into itself.')
    await ensureMissing(destination)
    await fs.rename(guardedSource, destination)
    return toFileEntry(root, destination, await fs.stat(destination))
  }

  async trash(filePath: string): Promise<true> {
    const guarded = this.guard(filePath)
    if (guarded === this.requireRoot()) throw new AppError('ACCESS_DENIED', 'The project root cannot be deleted from the explorer.')
    await shell.trashItem(guarded)
    return true
  }

  async stat(filePath: string): Promise<FileEntry> {
    const root = this.requireRoot()
    const guarded = this.guard(filePath)
    return toFileEntry(root, guarded, await fs.stat(guarded))
  }

  private requireRoot(): string {
    const root = this.getRoot()
    if (!root) throw new AppError('INVALID_INPUT', 'Open a project before accessing files.')
    return root
  }

  private guard(candidate: string): string {
    const root = this.requireRoot()
    const resolved = path.resolve(candidate)
    if (!isPathInside(root, resolved)) throw new AppError('ACCESS_DENIED', 'The path is outside the active project.')
    return resolved
  }

  private async disposeWatcher(): Promise<void> {
    const watcher = this.watcher
    this.watcher = null
    this.watchedDirectories.clear()
    if (watcher) await watcher.close()
  }

  private watchDirectory(directory: string): void {
    if (!this.watcher || this.watchedDirectories.has(directory)) return
    this.watchedDirectories.add(directory)
    this.watcher.add(directory)
  }
}

function validateName(name: string): void {
  if (!name.trim() || /[<>:\"/\\|?*]/.test(name) || name === '.' || name === '..') {
    throw new AppError('INVALID_INPUT', 'Enter a valid file or folder name.')
  }
}

async function ensureMissing(target: string): Promise<void> {
  try {
    await fs.access(target)
    throw new AppError('CONFLICT', `A file or folder named ${path.basename(target)} already exists.`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}
