import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { analyzeProject, analyzeSourceText } from '../src/analyze.js'

describe('analyzeSourceText', () => {
  it('finds a default Phaser import and infers variable config dimensions', () => {
    const result = analyzeSourceText(`
      import Phaser from 'phaser'
      import './style.css'
      const config: Phaser.Types.Core.GameConfig = {
        type: Phaser.AUTO,
        width: 800,
        height: 600,
        scene: []
      }
      new Phaser.Game(config)
    `)

    expect(result.gameSites).toHaveLength(1)
    expect(result.gameSites[0]).toMatchObject({ constructorText: 'Phaser.Game', width: 800, height: 600 })
    expect(result.cssImports[0]).toContain('./style.css')
  })

  it('supports namespace, named, and aliased named imports with dynamic configs', () => {
    const namespace = analyzeSourceText(`
      import * as P from 'phaser'
      new P.Game(makeConfig())
      new P.Game({ scale: { width: 720, height: 1280 } })
    `)
    const named = analyzeSourceText(`
      import { Game as PhaserGame } from 'phaser'
      new PhaserGame(configFromElsewhere)
    `)

    expect(namespace.gameSites).toHaveLength(2)
    expect(namespace.gameSites[0]?.width).toBeUndefined()
    expect(namespace.gameSites[1]).toMatchObject({ width: 720, height: 1280 })
    expect(named.gameSites[0]?.constructorText).toBe('PhaserGame')
  })

  it('does not treat unrelated Game constructors as Phaser', () => {
    const result = analyzeSourceText(`
      import Phaser from 'phaser'
      class Game {}
      new Game()
    `)
    expect(result.gameSites).toHaveLength(0)
  })

  it('reports direct network APIs and browser globals', () => {
    const result = analyzeSourceText(`
      import Phaser from 'phaser'
      document.fonts.ready.then(() => new Phaser.Game(config))
      class ContentRepository {
        private basePath = \`\${import.meta.env.BASE_URL}content/packs/base/\`
        load(relativePath: string) { return fetch(\`\${this.basePath}\${relativePath}\`) }
      }
      fetch('./assets/config.json')
      fetch('/api/run')
      wx.request({ url: '/api/state' })
    `)
    expect(result.networkApis).toHaveLength(2)
    expect(result.browserGlobals[0]).toContain('document')
  })

  it('infers game dimensions imported from a project module', async () => {
    const project = await mkdtemp(path.join(os.tmpdir(), 'wechat-analyze-dimensions-'))
    try {
      await mkdir(path.join(project, 'src'))
      await writeFile(path.join(project, 'package.json'), JSON.stringify({
        dependencies: { phaser: '4.2.1' }
      }))
      await writeFile(path.join(project, 'index.html'), '<script type="module" src="/src/main.ts"></script>')
      await writeFile(path.join(project, 'src', 'viewport.ts'), [
        'export const GAME_WIDTH = 750',
        'export const GAME_HEIGHT = 1624'
      ].join('\n'))
      await writeFile(path.join(project, 'src', 'main.ts'), [
        "import Phaser from 'phaser'",
        "import { GAME_WIDTH, GAME_HEIGHT } from './viewport'",
        'new Phaser.Game({ width: GAME_WIDTH, height: GAME_HEIGHT })'
      ].join('\n'))

      const result = await analyzeProject(project)

      expect(result).toMatchObject({ inferredWidth: 750, inferredHeight: 1624 })
    } finally {
      await rm(project, { recursive: true, force: true })
    }
  })
})
