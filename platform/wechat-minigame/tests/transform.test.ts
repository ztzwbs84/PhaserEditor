import { describe, expect, it } from 'vitest'
import { transformPhaserSource, type TransformStats } from '../src/transform.js'

function stats(): TransformStats {
  return { transformedGames: 0, removedCssImports: [], rewrittenAssets: [] }
}

describe('transformPhaserSource', () => {
  it('removes side-effect CSS, rewrites assets, and patches every Game construction', () => {
    const state = stats()
    const result = transformPhaserSource(`
      import Phaser from 'phaser'
      import './main.css'
      const image = '/assets/ui/角色 图.png'
      new Phaser.Game(config)
      new Phaser.Game({ width: 320, height: 180 })
    `, 'src/main.ts', state)

    expect(result.code).not.toContain("import './main.css'")
    expect(result.code).toContain('"assets/ui/角色 图.png"')
    expect(result.code.match(/__PHASER_WECHAT_CREATE_GAME__/g)).toHaveLength(2)
    expect(state.transformedGames).toBe(2)
  })

  it('patches a named Game import', () => {
    const state = stats()
    const result = transformPhaserSource(`
      import { Game as G } from 'phaser'
      new G(dynamicConfig())
    `, 'src/main.ts', state)
    expect(result.code).toContain('__PHASER_WECHAT_CREATE_GAME__(G, dynamicConfig())')
  })
})
