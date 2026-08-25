import { describe, expect, it } from 'vitest'
import { encodeResourcePath, extractAtlasPages } from '../src/output.js'

describe('resource helpers', () => {
  it('generates URI encoded aliases without encoding path separators', () => {
    expect(encodeResourcePath('assets/map/ground grass.png')).toBe('assets/map/ground%20grass.png')
    expect(encodeResourcePath('assets/ui/角色血条框.png')).toBe('assets/ui/%E8%A7%92%E8%89%B2%E8%A1%80%E6%9D%A1%E6%A1%86.png')
  })

  it('extracts Spine atlas page files and ignores regions', () => {
    expect(extractAtlasPages(`page one.png
size: 512,512
format: RGBA8888
filter: Linear,Linear
repeat: none
region_name
  rotate: false
  xy: 0,0
`)).toEqual(['page one.png'])
  })
})
