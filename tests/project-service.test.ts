import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConfigStore } from '../src/main/config-store'
import { needsDependencyInstall, ProjectService } from '../src/main/project-service'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('project dependency installation', () => {
  it('always installs dependencies after creating a project', async () => {
    const root = await temporaryRoot()
    const store = new ConfigStore(path.join(root, 'user-data'))
    await store.load()
    const install = vi.fn(async () => undefined)
    const service = new ProjectService(store, path.resolve('resources/templates/vite-ts'), install)
    const target = path.join(root, 'created-project')

    const project = await service.create({
      name: 'Created Project',
      targetDirectory: target,
      installDependencies: false
    })

    expect(project.valid).toBe(true)
    expect(install).toHaveBeenCalledOnce()
    expect(install).toHaveBeenCalledWith(target, 'npm')
  })

  it('recognizes a project whose declared dependencies are installed', async () => {
    const root = await projectWithDependencies(['phaser', '@scope/tool'])
    await fs.mkdir(path.join(root, 'node_modules', 'phaser'), { recursive: true })
    await fs.mkdir(path.join(root, 'node_modules', '@scope', 'tool'), { recursive: true })

    await expect(needsDependencyInstall(root)).resolves.toBe(false)
  })

  it('requires installation when node_modules or a declared dependency is missing', async () => {
    const root = await projectWithDependencies(['phaser', 'vite'])
    await expect(needsDependencyInstall(root)).resolves.toBe(true)

    await fs.mkdir(path.join(root, 'node_modules', 'phaser'), { recursive: true })
    await expect(needsDependencyInstall(root)).resolves.toBe(true)
  })

  it('runs the detected package manager only when installation is required', async () => {
    const root = await projectWithDependencies(['phaser'])
    await fs.writeFile(path.join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n', 'utf8')
    const store = new ConfigStore(path.join(root, 'user-data'))
    await store.load()
    const install = vi.fn(async () => undefined)
    const service = new ProjectService(store, path.resolve('resources/templates/vite-ts'), install)
    const onInstall = vi.fn()

    await expect(service.ensureDependenciesInstalled(root, onInstall)).resolves.toBe(true)
    expect(onInstall).toHaveBeenCalledWith('pnpm')
    expect(install).toHaveBeenCalledWith(root, 'pnpm')

    await fs.mkdir(path.join(root, 'node_modules', 'phaser'), { recursive: true })
    await expect(service.ensureDependenciesInstalled(root, onInstall)).resolves.toBe(false)
    expect(install).toHaveBeenCalledOnce()
  })
})

async function temporaryRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'phaser-editor-install-'))
  temporaryRoots.push(root)
  return root
}

async function projectWithDependencies(dependencies: string[]): Promise<string> {
  const root = await temporaryRoot()
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'dependency-test',
    dependencies: Object.fromEntries(dependencies.map((name) => [name, '1.0.0']))
  }), 'utf8')
  return root
}
