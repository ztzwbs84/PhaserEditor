import { describe, expect, it } from 'vitest'
import { createProjectAssetUrl, resolveProjectAssetUrl } from '../src/shared/asset-url'

describe('project asset URLs', () => {
  it('round-trips Windows paths and keeps atlas-relative page URLs resolvable', () => {
    const atlasPath = 'I:\\Phaser Games\\assets\\monster\\monster.atlas.txt'
    const atlasUrl = createProjectAssetUrl(atlasPath)
    const pageUrl = new URL('monster page.png', atlasUrl).toString()

    expect(resolveProjectAssetUrl(atlasUrl, '\\')).toBe(atlasPath)
    expect(resolveProjectAssetUrl(pageUrl, '\\')).toBe('I:\\Phaser Games\\assets\\monster\\monster page.png')
  })

  it('round-trips POSIX paths and accepts the legacy query URL', () => {
    const filePath = '/Users/editor/My Game/hero.png'
    expect(resolveProjectAssetUrl(createProjectAssetUrl(filePath))).toBe(filePath)
    expect(resolveProjectAssetUrl(`phaser-asset://local/?path=${encodeURIComponent(filePath)}`)).toBe(filePath)
  })
})
