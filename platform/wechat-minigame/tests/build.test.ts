import { describe, expect, it } from 'vitest'
import { parseCssFontFaces } from '../src/build.js'

describe('parseCssFontFaces', () => {
  it('extracts quoted font families and packaged font URLs', () => {
    expect(parseCssFontFaces(`
      @font-face {
        font-family: "Fusion Pixel SC";
        src: url("/assets/fonts/fusion-pixel.woff2") format("woff2");
        font-weight: 400;
      }
    `)).toEqual([{
      family: 'Fusion Pixel SC',
      path: '/assets/fonts/fusion-pixel.woff2'
    }])
  })
})
