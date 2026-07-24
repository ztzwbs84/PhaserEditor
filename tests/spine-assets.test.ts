import { describe, expect, it } from 'vitest'
import type { FileEntry } from '@phaser-editor/contracts'
import { findSpineAtlas, parseSpineAtlasPages, resolveSpineAtlasPage } from '../src/renderer/src/lib/spine-assets'
import { classifyFile, isMediaFile } from '../src/renderer/src/lib/file-types'

describe('Spine companion assets', () => {
  it('classifies .skel as a binary Spine preview document', () => {
    expect(classifyFile('assets/monster.skel')).toEqual({ kind: 'spine', language: 'binary' })
    expect(isMediaFile('assets/monster.skel')).toBe(true)
  })

  it('prefers an exact atlas name and supports the common .atlas.txt suffix', () => {
    const skeleton = 'I:\\Game\\assets\\monster_3220\\monster_3220.skel'
    const atlas = entry('monster_3220.atlas.txt', 'I:\\Game\\assets\\monster_3220\\monster_3220.atlas.txt')
    const unrelated = entry('shared.atlas', 'I:\\Game\\assets\\monster_3220\\shared.atlas')

    expect(findSpineAtlas(skeleton, [unrelated, atlas])).toEqual({ ok: true, atlas })
  })

  it('uses a sole atlas as a fallback and reports ambiguous or missing companions', () => {
    const skeleton = 'C:\\Game\\hero.skel'
    const shared = entry('characters.atlas', 'C:\\Game\\characters.atlas')
    expect(findSpineAtlas(skeleton, [shared])).toEqual({ ok: true, atlas: shared })
    expect(findSpineAtlas(skeleton, [shared, entry('effects.atlas', 'C:\\Game\\effects.atlas')])).toMatchObject({ ok: false })
    expect(findSpineAtlas(skeleton, [])).toEqual({ ok: false, message: 'Missing hero.atlas or hero.atlas.txt beside hero.skel.' })
  })

  it('extracts every atlas page and resolves page paths relative to the atlas', () => {
    const atlas = '\uFEFFmonster.png\nsize: 64, 64\nregion\nbounds: 0, 0, 10, 10\n\ntextures/monster-glow.png\nsize: 32, 32\nglow\nbounds: 0, 0, 8, 8\n'
    expect(parseSpineAtlasPages(atlas)).toEqual(['monster.png', 'textures/monster-glow.png'])
    expect(resolveSpineAtlasPage('I:\\Game\\spine\\monster.atlas.txt', 'textures/monster-glow.png'))
      .toBe('I:\\Game\\spine\\textures\\monster-glow.png')
  })
})

function entry(name: string, path: string): FileEntry {
  return { name, path, relativePath: name, kind: 'file', size: 1, modifiedAt: 1, extension: name.split('.').pop() ?? '' }
}
