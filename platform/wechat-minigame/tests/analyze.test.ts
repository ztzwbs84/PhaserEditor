import { describe, expect, it } from 'vitest'
import { analyzeSourceText } from '../src/analyze.js'

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
      fetch('/api/run')
      wx.request({ url: '/api/state' })
    `)
    expect(result.networkApis).toHaveLength(2)
    expect(result.browserGlobals[0]).toContain('document')
  })
})
