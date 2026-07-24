import path from 'node:path'
import { existsSync } from 'node:fs'
import type { ErrorCode, FileEntry, ProjectDescriptor, Result } from '@phaser-editor/contracts'

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: string
  ) {
    super(message)
  }
}

export function success<T>(value: T): Result<T> {
  return { ok: true, value }
}

export function failure(error: unknown): Result<never> {
  if (error instanceof AppError) {
    return { ok: false, error: { code: error.code, message: error.message, details: error.details } }
  }
  const details = error instanceof Error ? error.stack : String(error)
  return { ok: false, error: { code: 'INTERNAL', message: 'The operation could not be completed.', details } }
}

export async function asResult<T>(operation: () => Promise<T>): Promise<Result<T>> {
  try {
    return success(await operation())
  } catch (error) {
    return failure(error)
  }
}

export function normalizeForComparison(value: string): string {
  const normalized = path.resolve(value)
  return process.platform === 'win32' ? normalized.toLocaleLowerCase() : normalized
}

export function isPathInside(root: string, candidate: string): boolean {
  const normalizedRoot = normalizeForComparison(root)
  const normalizedCandidate = normalizeForComparison(candidate)
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`)
}

export function detectPackageManager(root: string): ProjectDescriptor['packageManager'] {
  if (existsSync(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(path.join(root, 'yarn.lock'))) return 'yarn'
  if (existsSync(path.join(root, 'bun.lockb')) || existsSync(path.join(root, 'bun.lock'))) return 'bun'
  return 'npm'
}

export function resolveSpawnCommand(executable: string, args: string[]): { executable: string; args: string[] } {
  if (process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(executable)) {
    return {
      executable: process.env.ComSpec ?? 'cmd.exe',
      args: ['/d', '/s', '/c', executable, ...args]
    }
  }
  return { executable, args }
}

export function toFileEntry(root: string, fullPath: string, stat: import('node:fs').Stats): FileEntry {
  return {
    name: path.basename(fullPath),
    path: fullPath,
    relativePath: path.relative(root, fullPath),
    kind: stat.isDirectory() ? 'directory' : 'file',
    size: stat.size,
    modifiedAt: stat.mtimeMs,
    extension: stat.isDirectory() ? '' : path.extname(fullPath).slice(1).toLocaleLowerCase()
  }
}
