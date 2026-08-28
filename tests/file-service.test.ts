import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FileService } from '../src/main/file-service'

vi.mock('electron', () => ({
  shell: { trashItem: vi.fn(async () => undefined) }
}))

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('FileService project boundary', () => {
  it('reads, lists, stats, creates, and atomically writes files inside the project', async () => {
    const root = await temporaryRoot('phaser-editor-files-')
    const sourceDirectory = path.join(root, 'src')
    const sourceFile = path.join(sourceDirectory, 'main.ts')
    await fs.mkdir(sourceDirectory)
    await fs.writeFile(sourceFile, 'export const version = 1\n', 'utf8')
    const service = new FileService(() => root)

    expect(service.contains(sourceFile)).toBe(true)
    await expect(service.list(sourceDirectory)).resolves.toMatchObject([
      { name: 'main.ts', path: sourceFile, kind: 'file', relativePath: path.join('src', 'main.ts') }
    ])

    const snapshot = await service.read(sourceFile)
    expect(snapshot.content).toBe('export const version = 1\n')
    await expect(service.stat(sourceFile)).resolves.toMatchObject({ path: sourceFile, kind: 'file' })

    const written = await service.write(sourceFile, 'export const version = 2\n', snapshot.modifiedAt)
    expect(written.content).toBe('export const version = 2\n')
    await expect(fs.readFile(sourceFile, 'utf8')).resolves.toBe('export const version = 2\n')

    await expect(service.createFile(sourceDirectory, 'created.ts')).resolves.toMatchObject({
      path: path.join(sourceDirectory, 'created.ts'),
      kind: 'file'
    })
    await expect(service.createDirectory(sourceDirectory, 'nested')).resolves.toMatchObject({
      path: path.join(sourceDirectory, 'nested'),
      kind: 'directory'
    })
  })

  it('rejects existing targets and new parents that escape through a junction or symlink', async (context) => {
    const root = await temporaryRoot('phaser-editor-project-')
    const externalRoot = await temporaryRoot('phaser-editor-external-')
    const secret = path.join(externalRoot, 'secret.txt')
    const escape = path.join(root, 'escape')
    await fs.writeFile(secret, 'outside', 'utf8')

    try {
      await fs.symlink(externalRoot, escape, process.platform === 'win32' ? 'junction' : 'dir')
    } catch (error) {
      if (isLinkPermissionError(error)) {
        context.skip()
        return
      }
      throw error
    }

    const service = new FileService(() => root)
    const escapedFile = path.join(escape, 'secret.txt')

    expect(service.contains(escapedFile)).toBe(false)
    await expect(service.list(escape)).rejects.toMatchObject({ code: 'ACCESS_DENIED' })
    await expect(service.read(escapedFile)).rejects.toMatchObject({ code: 'ACCESS_DENIED' })
    await expect(service.stat(escapedFile)).rejects.toMatchObject({ code: 'ACCESS_DENIED' })
    await expect(service.write(escapedFile, 'changed')).rejects.toMatchObject({ code: 'ACCESS_DENIED' })
    await expect(service.createFile(escape, 'created.txt')).rejects.toMatchObject({ code: 'ACCESS_DENIED' })
    await expect(service.createDirectory(escape, 'created-directory')).rejects.toMatchObject({ code: 'ACCESS_DENIED' })

    await expect(fs.readFile(secret, 'utf8')).resolves.toBe('outside')
    await expect(fs.access(path.join(externalRoot, 'created.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.access(path.join(externalRoot, 'created-directory'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  temporaryRoots.push(root)
  return root
}

function isLinkPermissionError(error: unknown): boolean {
  return ['EACCES', 'EPERM', 'ENOSYS', 'UNKNOWN'].includes((error as NodeJS.ErrnoException).code ?? '')
}
