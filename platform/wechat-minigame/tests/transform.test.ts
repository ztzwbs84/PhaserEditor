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

  it('preserves the line break around a removed CSS import', () => {
    const state = stats()
    const source = [
      "import Phaser from 'phaser'",
      "import './main.css'",
      "import { BattleScene } from './battle-scene'",
      ''
    ].join('\r\n')

    const result = transformPhaserSource(source, 'src/main.ts', state)

    expect(result.code).toBe([
      "import Phaser from 'phaser'",
      "import { BattleScene } from './battle-scene'",
      ''
    ].join('\r\n'))
  })

  it('resolves CSS font families through the generated runtime registry', () => {
    const state = stats()
    const result = transformPhaserSource(
      'export const UI_FONT = \'"Fusion Pixel SC", sans-serif\'',
      'src/ui.ts',
      state,
      ['Fusion Pixel SC']
    )

    expect(result.code).toContain('__PHASER_WECHAT_RESOLVE_FONT_FAMILY__')
    expect(result.code).toContain('Fusion Pixel SC')
  })

  it('resolves Phaser loader assets before they reach native Mini Game APIs', () => {
    const state = stats()
    const result = transformPhaserSource(`
      export function queue(scene, base, asset) {
        scene.load.image(asset.id, base + asset.url)
        scene.load.bitmapFont(asset.id, base + asset.url, base + asset.dataUrl)
      }
    `, 'src/content.ts', state)

    expect(result.code).toContain(
      'scene.load.image(asset.id, globalThis.__PHASER_WECHAT_RESOLVE_ASSET_URL__(base + asset.url))'
    )
    expect(result.code).toContain(
      'scene.load.bitmapFont(asset.id, globalThis.__PHASER_WECHAT_RESOLVE_ASSET_URL__(base + asset.url), globalThis.__PHASER_WECHAT_RESOLVE_ASSET_URL__(base + asset.dataUrl))'
    )
  })
})
