import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { convertProject } from '../src/convert.js'

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')
const templateProject = path.join(repoRoot, 'resources', 'templates', 'vite-ts')
const zjcsProject = 'I:\\Phaser\\ZJCS'

describe('converter integration', () => {
  it('converts the PhaserEditor Vite template and preserves unmanaged output on rerun', async () => {
    const outputParent = await mkdtemp(path.join(os.tmpdir(), 'wechat-template-test-'))
    const output = path.join(outputParent, 'game-wechat')
    const before = await sourceDigest(templateProject, ['package.json', 'index.html', 'src/main.ts', 'src/style.css'])
    try {
      const first = await convertProject({
        project: templateProject,
        output,
        install: false,
        force: false,
        dryRun: false,
        json: true
      })
      expect(first.exitCode).toBe(0)
      expect(first.report).toMatchObject({ runnable: true, gameCount: 1, transformedGameCount: 1 })
      const bundle = await readFile(path.join(output, 'js', 'game.bundle.js'), 'utf8')
      const entry = await readFile(path.join(output, 'game.js'), 'utf8')
      expect(bundle).not.toMatch(/\bimport\s*\(/)
      expect(bundle).not.toMatch(/(?:["'])\/assets\//)
      expect(bundle).not.toContain('Phaser v')
      expect(entry.indexOf("require('./js/weapp-adapter.js')")).toBeLessThan(entry.indexOf("require('./js/phaser.js')"))
      expect(entry.indexOf("require('./js/phaser.js')")).toBeLessThan(entry.indexOf("require('./js/game.bundle.js')"))
      expect(existsSync(path.join(output, 'js', 'weapp-adapter.js'))).toBe(true)
      expect(existsSync(path.join(output, 'js', 'phaser.js'))).toBe(true)

      const configPath = path.join(output, 'project.config.json')
      const config = JSON.parse(await readFile(configPath, 'utf8'))
      config.appid = 'wx-preserved-integration'
      await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`)
      await writeFile(path.join(output, 'project.private.config.json'), '{}\n')
      await writeFile(path.join(output, 'manual.txt'), 'keep\n')

      const second = await convertProject({
        project: templateProject,
        output,
        install: false,
        force: false,
        dryRun: false,
        json: true
      })
      expect(second.report.appid).toBe('wx-preserved-integration')
      expect(existsSync(path.join(output, 'project.private.config.json'))).toBe(true)
      expect(await readFile(path.join(output, 'manual.txt'), 'utf8')).toBe('keep\n')
      expect(await sourceDigest(templateProject, ['package.json', 'index.html', 'src/main.ts', 'src/style.css'])).toBe(before)
    } finally {
      await rm(outputParent, { recursive: true, force: true })
    }
  })

  it.skipIf(!existsSync(zjcsProject))('converts ZJCS with encoded aliases and complete Spine files', async () => {
    const outputParent = await mkdtemp(path.join(os.tmpdir(), 'wechat-zjcs-test-'))
    const output = path.join(outputParent, 'zjcs-wechat')
    const before = await sourceDigest(zjcsProject, ['package.json', 'index.html', 'src/main.ts', 'src/assets.ts'])
    try {
      const outcome = await convertProject({
        project: zjcsProject,
        output,
        install: false,
        force: false,
        dryRun: false,
        json: true
      })
      expect(outcome.exitCode).toBe(2)
      expect(outcome.report).toMatchObject({ runnable: true, gameCount: 1, transformedGameCount: 1 })
      expect(outcome.report.diagnostics.some((item) => item.code === 'MAIN_PACKAGE_BUDGET_EXCEEDED')).toBe(true)
      expect(existsSync(path.join(output, 'assets', 'map', 'ground%20grass.png'))).toBe(true)
      expect(existsSync(path.join(output, 'assets', 'ui', '%E8%A7%92%E8%89%B2%E8%A1%80%E6%9D%A1%E6%A1%86.png'))).toBe(true)
      for (const extension of ['skel', 'atlas.txt', 'png']) {
        expect(existsSync(path.join(output, 'assets', 'spine_monster', 'monster_3220', `monster_3220.${extension}`))).toBe(true)
      }
      expect(await sourceDigest(zjcsProject, ['package.json', 'index.html', 'src/main.ts', 'src/assets.ts'])).toBe(before)
    } finally {
      await rm(outputParent, { recursive: true, force: true })
    }
  })
})

async function sourceDigest(root: string, files: string[]): Promise<string> {
  const hash = createHash('sha256')
  for (const relative of files) {
    hash.update(relative)
    hash.update(await readFile(path.join(root, relative)))
  }
  return hash.digest('hex')
}
