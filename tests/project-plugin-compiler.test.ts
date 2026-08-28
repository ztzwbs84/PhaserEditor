import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ProjectPluginCompileAbortedError,
  ProjectPluginCompileError,
  ProjectPluginCompiler
} from '../src/main/project-plugin-compiler'

const temporaryRoots: string[] = []
const realSkillProject = process.env.PHASER_EDITOR_SKILL_PROJECT

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('ProjectPluginCompiler', () => {
  it.skipIf(!realSkillProject)('compiles the real skill editor plugin from a cold cache', async () => {
    const projectRoot = path.resolve(realSkillProject!)
    const pluginRoot = path.join(projectRoot, '.phaser-editor', 'plugins', 's3-skill-editor')
    const cacheRoot = await createProject()
    const compiler = new ProjectPluginCompiler(path.join(cacheRoot, 'cache'))
    const startedAt = performance.now()
    const result = await compiler.compile({
      instanceId: 'project:benchmark:s3-skill-editor',
      projectRoot,
      pluginRoot,
      uiSource: 'src/index.tsx'
    })
    const elapsed = performance.now() - startedAt

    expect(await fs.stat(path.join(result.outputRoot, result.entryPath))).toMatchObject({ size: expect.any(Number) })
    expect(result.inputs.length).toBeGreaterThan(100)
    console.info(`[project-plugin benchmark] cold skill editor compile: ${elapsed.toFixed(0)}ms, ${result.inputs.length} inputs`)
  }, 180_000)

  it('compiles a broad synthetic dependency graph without resolver amplification', async () => {
    const projectRoot = await createProject()
    const pluginRoot = path.join(projectRoot, '.phaser-editor', 'plugins', 'timeline')
    const sourceRoot = path.join(projectRoot, 'src', 'modules')
    await fs.mkdir(path.join(pluginRoot, 'src'), { recursive: true })
    await fs.mkdir(sourceRoot, { recursive: true })
    await fs.writeFile(path.join(projectRoot, 'package.json'), '{"name":"fixture"}\n')
    const moduleCount = 400
    await Promise.all(Array.from({ length: moduleCount }, (_value, index) => (
      fs.writeFile(path.join(sourceRoot, `module-${index}.ts`), `export const value${index} = ${index}\n`)
    )))
    await fs.writeFile(path.join(pluginRoot, 'src', 'ui.ts'), [
      ...Array.from({ length: moduleCount }, (_value, index) => `import { value${index} } from '../../../../src/modules/module-${index}'`),
      `export const total = ${Array.from({ length: moduleCount }, (_value, index) => `value${index}`).join(' + ')}\n`
    ].join('\n'))

    const compiler = new ProjectPluginCompiler(path.join(projectRoot, '.cache'))
    const startedAt = performance.now()
    const result = await compiler.compile({
      instanceId: 'project:abc:timeline',
      projectRoot,
      pluginRoot,
      uiSource: 'src/ui.ts'
    })
    const elapsed = performance.now() - startedAt

    expect(result.inputs.length).toBeGreaterThanOrEqual(moduleCount + 2)
    expect(elapsed).toBeLessThan(20_000)
    console.info(`[project-plugin benchmark] synthetic ${moduleCount}-module compile: ${elapsed.toFixed(0)}ms`)
  }, 30_000)

  it('bundles project-local TypeScript and CSS, reuses unchanged inputs, and retains two revisions', async () => {
    const projectRoot = await createProject()
    const pluginRoot = path.join(projectRoot, '.phaser-editor', 'plugins', 'timeline')
    const cacheRoot = path.join(projectRoot, '.cache')
    await fs.mkdir(path.join(pluginRoot, 'src'), { recursive: true })
    await fs.mkdir(path.join(projectRoot, 'src'), { recursive: true })
    await fs.writeFile(path.join(projectRoot, 'package.json'), '{"name":"fixture"}\n')
    await fs.writeFile(path.join(projectRoot, 'tsconfig.json'), '{"compilerOptions":{"target":"ES2022"}}\n')
    await fs.writeFile(path.join(projectRoot, 'src', 'model.ts'), 'export const value = 1\n')
    await fs.writeFile(path.join(pluginRoot, 'src', 'lazy.ts'), 'export const lazy = true\n')
    await fs.writeFile(path.join(pluginRoot, 'src', 'ui.css'), '.timeline { color: #fff; }\n')
    await fs.writeFile(path.join(pluginRoot, 'src', 'ui.ts'), "import './ui.css'; import { value } from '../../../../src/model'; export const answer = value; export const lazy = () => import('./lazy')\n")

    const compiler = new ProjectPluginCompiler(cacheRoot)
    const request = {
      instanceId: 'project:abc:timeline',
      projectRoot,
      pluginRoot,
      uiSource: 'src/ui.ts',
      cacheMetadata: { id: 'timeline' }
    }
    const first = await compiler.compile(request)
    expect(first.outputRoot).toBe(path.join(cacheRoot, 'abc', 'timeline', first.revision))
    expect(first.entryPath).toBe('ui.js')
    expect(first.cssPaths).toEqual(['ui.css'])
    expect(first.inputs).toContain(await fs.realpath(path.join(projectRoot, 'src', 'model.ts')))
    expect(await compiler.resolveOutput(request.instanceId, first.revision, 'ui.js')).toBe(path.join(first.outputRoot, 'ui.js'))
    await expect(compiler.loadLastGood(request.instanceId)).resolves.toMatchObject({
      identity: {
        projectRoot: await fs.realpath(projectRoot),
        pluginRoot: await fs.realpath(pluginRoot),
        uiSource: 'src/ui.ts',
        sourcePath: await fs.realpath(path.join(pluginRoot, 'src', 'ui.ts'))
      }
    })
    const chunk = (await fs.readdir(path.join(first.outputRoot, 'chunks'))).find((file) => file.endsWith('.js'))!
    expect(await compiler.resolveOutput(request.instanceId, first.revision, `chunks/${chunk}`)).toBe(path.join(first.outputRoot, 'chunks', chunk))

    const cached = await compiler.compile(request)
    expect(cached.revision).toBe(first.revision)
    expect(cached.reused).toBe(true)

    await fs.writeFile(path.join(projectRoot, 'src', 'model.ts'), 'export const value = 2\n')
    const second = await compiler.compile(request)
    expect(second.revision).not.toBe(first.revision)
    await fs.writeFile(path.join(projectRoot, 'src', 'model.ts'), 'export const value = 3\n')
    const third = await compiler.compile(request)
    expect(third.revision).not.toBe(second.revision)

    const instanceDirectories = await findRevisionDirectories(cacheRoot)
    expect(instanceDirectories).toHaveLength(2)
    expect(instanceDirectories).toContain(third.revision)
    expect(instanceDirectories).toContain(second.revision)
    expect(instanceDirectories).not.toContain(first.revision)
  }, 15_000)

  it('rejects Node builtins and keeps the last successful build after a failed rebuild', async () => {
    const projectRoot = await createProject()
    const pluginRoot = path.join(projectRoot, '.phaser-editor', 'plugins', 'timeline')
    const cacheRoot = path.join(projectRoot, '.cache')
    await fs.mkdir(pluginRoot, { recursive: true })
    await fs.writeFile(path.join(projectRoot, 'package.json'), '{"name":"fixture"}\n')
    const sourcePath = path.join(pluginRoot, 'ui.ts')
    await fs.writeFile(sourcePath, 'export const healthy = true\n')

    const compiler = new ProjectPluginCompiler(cacheRoot)
    const request = {
      instanceId: 'project:abc:timeline',
      projectRoot,
      pluginRoot,
      uiSource: 'ui.ts',
      cacheMetadata: { id: 'timeline', apiVersion: 1 }
    }
    const good = await compiler.compile(request)
    await fs.writeFile(sourcePath, "import { readFile } from 'node:fs/promises'; export { readFile }\n")

    await expect(compiler.compile(request)).rejects.toMatchObject({
      diagnostics: [expect.objectContaining({ severity: 'error', message: expect.stringContaining('cannot import Node') })]
    })
    const lastGood = await compiler.loadLastGood(request.instanceId)
    expect(lastGood?.compileResult.revision).toBe(good.revision)
    expect(lastGood?.cacheMetadata).toEqual({ id: 'timeline', apiVersion: 1 })
  })

  it('rejects UI sources and imports that resolve outside the active project realpath', async () => {
    const root = await createProject()
    const projectRoot = path.join(root, 'project')
    const pluginRoot = path.join(projectRoot, '.phaser-editor', 'plugins', 'timeline')
    await fs.mkdir(pluginRoot, { recursive: true })
    await fs.writeFile(path.join(projectRoot, 'package.json'), '{"name":"fixture"}\n')
    await fs.writeFile(path.join(root, 'outside.ts'), 'export const outside = true\n')
    await fs.writeFile(path.join(pluginRoot, 'ui.ts'), "export { outside } from '../../../../outside'\n")
    const compiler = new ProjectPluginCompiler(path.join(root, 'cache'))

    await expect(compiler.compile({
      instanceId: 'project:abc:timeline',
      projectRoot,
      pluginRoot,
      uiSource: 'ui.ts'
    })).rejects.toMatchObject({
      diagnostics: [expect.objectContaining({ message: expect.stringContaining('outside the active project') })]
    })
  })

  it('rejects imports that escape through a project junction or symlink', async (context) => {
    const root = await createProject()
    const projectRoot = path.join(root, 'project')
    const pluginRoot = path.join(projectRoot, '.phaser-editor', 'plugins', 'timeline')
    const externalRoot = path.join(root, 'outside-package')
    const linkedRoot = path.join(projectRoot, 'linked-package')
    await fs.mkdir(pluginRoot, { recursive: true })
    await fs.mkdir(externalRoot, { recursive: true })
    await fs.writeFile(path.join(projectRoot, 'package.json'), '{"name":"fixture"}\n')
    await fs.writeFile(path.join(externalRoot, 'outside.ts'), 'export const outside = true\n')
    await fs.writeFile(path.join(pluginRoot, 'ui.ts'), "export { outside } from '../../../linked-package/outside'\n")
    try {
      await fs.symlink(externalRoot, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir')
    } catch (error) {
      if (isLinkPermissionError(error)) {
        context.skip()
        return
      }
      throw error
    }

    const compiler = new ProjectPluginCompiler(path.join(root, 'cache'))
    await expect(compiler.compile({
      instanceId: 'project:abc:timeline',
      projectRoot,
      pluginRoot,
      uiSource: 'ui.ts'
    })).rejects.toMatchObject({
      diagnostics: [expect.objectContaining({ message: expect.stringContaining('outside the active project') })]
    })
  })

  it('aborts without publishing a replacement for the last successful revision', async () => {
    const projectRoot = await createProject()
    const pluginRoot = path.join(projectRoot, '.phaser-editor', 'plugins', 'timeline')
    const cacheRoot = path.join(projectRoot, '.cache')
    const sourcePath = path.join(pluginRoot, 'ui.ts')
    await fs.mkdir(pluginRoot, { recursive: true })
    await fs.writeFile(path.join(projectRoot, 'package.json'), '{"name":"fixture"}\n')
    await fs.writeFile(sourcePath, 'export const value = 1\n')

    const compiler = new ProjectPluginCompiler(cacheRoot)
    const request = {
      instanceId: 'project:abc:timeline',
      projectRoot,
      pluginRoot,
      uiSource: 'ui.ts'
    }
    const first = await compiler.compile(request)
    await fs.writeFile(sourcePath, 'export const value = 2\n')

    const controller = new AbortController()
    const compilation = compiler.compile({ ...request, signal: controller.signal })
    controller.abort()

    await expect(compilation).rejects.toBeInstanceOf(ProjectPluginCompileAbortedError)
    await expect(compiler.loadLastGood(request.instanceId)).resolves.toMatchObject({
      compileResult: { revision: first.revision }
    })
    expect(await findRevisionDirectories(cacheRoot)).toEqual([first.revision])
  })

  it('keeps current.json readable when an atomic metadata replacement fails', async () => {
    const projectRoot = await createProject()
    const pluginRoot = path.join(projectRoot, '.phaser-editor', 'plugins', 'timeline')
    const cacheRoot = path.join(projectRoot, '.cache')
    const sourcePath = path.join(pluginRoot, 'ui.ts')
    await fs.mkdir(pluginRoot, { recursive: true })
    await fs.writeFile(path.join(projectRoot, 'package.json'), '{"name":"fixture"}\n')
    await fs.writeFile(sourcePath, 'export const value = 1\n')

    const compiler = new ProjectPluginCompiler(cacheRoot)
    const request = {
      instanceId: 'project:abc:timeline',
      projectRoot,
      pluginRoot,
      uiSource: 'ui.ts'
    }
    const first = await compiler.compile(request)
    await fs.writeFile(sourcePath, 'export const value = 2\n')

    const originalRename = fs.rename
    const rename = vi.spyOn(fs, 'rename').mockImplementation(async (source, destination) => {
      if (path.basename(String(destination)) === 'current.json') throw new Error('simulated atomic replace failure')
      return originalRename(source, destination)
    })
    try {
      await expect(compiler.compile(request)).rejects.toThrow('simulated atomic replace failure')
    } finally {
      rename.mockRestore()
    }

    await expect(compiler.loadLastGood(request.instanceId)).resolves.toMatchObject({
      compileResult: { revision: first.revision }
    })
    expect(await findRevisionDirectories(cacheRoot)).toEqual([first.revision])
    expect((await findInstanceEntries(cacheRoot)).filter((name) => /^\.current-.*\.tmp$/.test(name))).toEqual([])
  })
})

async function createProject(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'phaser-editor-plugin-'))
  temporaryRoots.push(root)
  return root
}

async function findRevisionDirectories(cacheRoot: string): Promise<string[]> {
  return (await findEntriesRecursively(cacheRoot))
    .filter((entry) => entry.isDirectory() && /^[a-f0-9]{16}$/.test(entry.name))
    .map((entry) => entry.name)
}

async function findInstanceEntries(cacheRoot: string): Promise<string[]> {
  return (await findEntriesRecursively(cacheRoot)).map((entry) => entry.name)
}

async function findEntriesRecursively(root: string): Promise<import('node:fs').Dirent[]> {
  const result: import('node:fs').Dirent[] = []
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      result.push(entry)
      if (entry.isDirectory() && entry.name !== '.build-output') await visit(path.join(directory, entry.name))
    }
  }
  await visit(root)
  return result
}

function isLinkPermissionError(error: unknown): boolean {
  return ['EACCES', 'EPERM', 'ENOSYS', 'UNKNOWN'].includes((error as NodeJS.ErrnoException).code ?? '')
}
