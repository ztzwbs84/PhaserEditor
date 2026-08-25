import { describe, expect, it } from 'vitest'
import { parseCliArgs } from '../src/args.js'

describe('parseCliArgs', () => {
  it('parses conversion flags', () => {
    expect(parseCliArgs([
      '--project', 'I:\\Game',
      '--output=I:\\Out',
      '--width', '960',
      '--height', '540',
      '--orientation', 'landscape',
      '--appid', 'wx-test',
      '--no-install',
      '--force',
      '--dry-run',
      '--json'
    ])).toEqual({
      project: 'I:\\Game',
      output: 'I:\\Out',
      width: 960,
      height: 540,
      orientation: 'landscape',
      appid: 'wx-test',
      install: false,
      force: true,
      dryRun: true,
      json: true,
      help: false
    })
  })

  it('rejects invalid numeric and enum values', () => {
    expect(() => parseCliArgs(['--width', '0'])).toThrow('positive integer')
    expect(() => parseCliArgs(['--orientation', 'square'])).toThrow('portrait or landscape')
    expect(() => parseCliArgs(['--unknown'])).toThrow('Unknown option')
  })
})
